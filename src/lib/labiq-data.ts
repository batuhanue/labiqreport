import "server-only";
import { store } from "./db";
import { addText, listCategories, saveCategory } from "./kurum";
import { exportViaCable, fetchFile, getLabiqStatus } from "./labiq";
import { openPage, withParams, type Params } from "./labiq-browse";
import { officeText } from "./officetext";
import { norm } from "./archive";

/*
 * LabIQ'dan inen dosyalar: Excel/CSV tabloya çevrilir, şirket verisi klasörüne (hastane · dönem · "LabIQ · <rapor>")
 * kaydedilir — beyin ve asistan da okur — ve tablo olarak saklanır; ajan `labiq_table_query` ile süzer, gruplar,
 * toplar (binlerce satırı modelin kafadan toplaması yerine gerçek hesap).
 */

export interface StoredTable {
  id: string;
  name: string;
  title: string;
  sheet: string;
  headers: string[];
  rows: string[][];
  totalRows: number;
  hospital: string;
  period: string;
  source: { page?: string; params?: Params; company?: string; url?: string };
  kurumFileId?: string;
  at: string;
}
export type TableMeta = Omit<StoredTable, "rows" | "headers"> & { cols: number; headers: string[] };

const MAX_ROWS = 20000;
const INDEX = "labiq-tables";
const tableKey = (id: string) => `labiq-table-${id}`;
export const listTables = async () => (await store().getKV<TableMeta[]>(INDEX)) ?? [];
export const getTable = (id: string) => store().getKV<StoredTable>(tableKey(id));

// ------------------------------------------------------------------ tabloya çevirme
function parseCsv(textIn: string): string[][] {
  const first = textIn.split(/\r?\n/, 1)[0] ?? "";
  const d = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : first.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < textIn.length; i++) {
    const c = textIn[i];
    if (q) {
      if (c === '"' && textIn[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === d) row.push(cur), (cur = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && textIn[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur || row.length) row.push(cur), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** Başlık satırı: ilk 12 satırda en dolu ve ardından benzer genişlikte satırlar gelen satır (rapor başlığı satırlarını atlar) */
function splitHeader(rows: string[][]) {
  const width = Math.max(0, ...rows.slice(0, 40).map((r) => r.filter((x) => x.trim()).length));
  const h = rows.slice(0, 12).findIndex((r) => r.filter((x) => x.trim()).length >= Math.max(2, Math.ceil(width * 0.6)));
  const at = h < 0 ? 0 : h;
  const headers = (rows[at] ?? []).map((x, i) => x.trim() || `Sütun ${i + 1}`);
  return { headers, rows: rows.slice(at + 1).filter((r) => r.some((x) => x.trim())), preamble: rows.slice(0, at).map((r) => r.filter(Boolean).join(" ")).filter(Boolean) };
}

export function toTables(name: string, buf: Buffer, type: string): { sheet: string; headers: string[]; rows: string[][]; preamble: string[] }[] {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx" || /spreadsheetml/.test(type)) {
    const txt = officeText(buf, "xlsx");
    return txt
      .split(/^--- Sayfa: (.*) ---$/m)
      .slice(1)
      .reduce<{ sheet: string; body: string }[]>((acc, x, i, arr) => (i % 2 === 0 ? [...acc, { sheet: x, body: arr[i + 1] ?? "" }] : acc), [])
      .map((s) => ({ sheet: s.sheet, ...splitHeader(s.body.split("\n").filter((l) => l.trim()).map((l) => l.split("\t"))) }))
      .filter((t) => t.rows.length || t.headers.length);
  }
  if (ext === "csv" || ext === "tsv" || /csv|text\/plain/.test(type)) return [{ sheet: name, ...splitHeader(parseCsv(buf.toString("utf8").replace(/^﻿/, ""))) }];
  throw new Error(`Bu dosya türü tabloya çevrilemiyor (.${ext}); Excel ya da CSV dışa aktarın.`);
}

// ------------------------------------------------------------------ dönem ve klasör
const MONTH = /(\d{4})-(\d{2})-\d{2}|(\d{2})[./](\d{2})[./](\d{4})/g;
/** filtredeki tarihlerden dönem: başlangıç ve bitiş aynı aydaysa o ay, değilse başlangıç ayı */
export function periodFrom(params?: Params) {
  const months = Object.values(params ?? {})
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .flatMap((v) => [...String(v ?? "").matchAll(MONTH)].map((m) => (m[1] ? `${m[1]}-${m[2]}` : `${m[5]}-${m[4]}`)));
  return months[0] ?? "";
}

async function categoryFor(title: string) {
  const name = `LabIQ · ${title}`.slice(0, 60);
  const cats = await listCategories();
  return (
    cats.find((c) => c.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr")) ??
    (await saveCategory({ name, description: `LabIQ'daki "${title}" raporundan ajanın otomatik indirdiği dosyalar. Dosya adında ve kaynağında uygulanan filtreler yazar.` }))
  );
}

// ------------------------------------------------------------------ dışa aktarma
export interface ExportOutcome {
  ok: boolean;
  error?: string;
  tableId?: string;
  fileName?: string;
  downloadUrl?: string;
  folder?: string;
  sheets?: { sheet: string; headers: string[]; rows: number }[];
  preview?: string[][];
  preamble?: string[];
}

/**
 * Bir raporu filtrelerle dışa aktarır, indirir, tabloya çevirir ve kaydeder.
 * `exportUrl` verilmezse sayfadaki dışa aktarma bağlantısı (Excel öncelikli) kullanılır.
 */
export async function exportReport(input: { page?: string; exportUrl?: string; params?: Params; title?: string; period?: string; save?: boolean }): Promise<ExportOutcome> {
  let exportUrl = input.exportUrl;
  let title = input.title;
  if (!exportUrl) {
    if (!input.page) return { ok: false, error: "page ya da exportUrl gerekli" };
    const view = await openPage(input.page, input.params);
    title ??= view.title;
    const ex = view.exports.sort((a, b) => Number(/xlsx|excel/i.test(b.href + b.label)) - Number(/xlsx|excel/i.test(a.href + a.label)))[0];
    if (!ex) return { ok: false, error: `"${view.title}" sayfasında dışa aktarma bağlantısı bulunamadı. Tabloyu labiq_open_page ile sayfa sayfa okuyabilirsin.` };
    exportUrl = ex.href;
  }
  const url = withParams(exportUrl, input.params);
  const r = await exportViaCable(url, 25000);
  if (!r.ok) return { ok: false, error: r.error };
  let buf: Buffer;
  let type = "";
  let name = r.fileName ?? "labiq-rapor.xlsx";
  if (r.file) ({ buf, type, name } = r.file);
  else if (r.downloadUrl) ({ buf, type } = await fetchFile(r.downloadUrl));
  else return { ok: false, error: "Dosya alınamadı" };
  return ingest({ buf, type, name, title, params: input.params, period: input.period, page: input.page, url, downloadUrl: r.downloadUrl, save: input.save });
}

/** İnen dosyayı (başka yoldan indirilmiş olsa da) tabloya çevirip klasöre ve tablo deposuna kaydeder */
export async function importDownloaded(downloadUrl: string, opts: { fileName?: string; title: string; params?: Params; period?: string }) {
  const { buf, type } = await fetchFile(downloadUrl);
  return ingest({ buf, type, name: opts.fileName ?? `${opts.title}.xlsx`, title: opts.title, params: opts.params, period: opts.period, downloadUrl });
}

async function ingest(x: { buf: Buffer; type: string; name: string; title?: string; params?: Params; period?: string; page?: string; url?: string; downloadUrl?: string; save?: boolean }): Promise<ExportOutcome> {
  const { buf, type, name, downloadUrl } = x;
  const input = { params: x.params, page: x.page, save: x.save };
  const url = x.url ?? downloadUrl ?? "";
  const r = { downloadUrl };
  let title = x.title;
  const status = getLabiqStatus();
  const hospital = status.companyKey ?? "genel";
  const period = x.period ?? periodFrom(input.params);
  title ||= name.replace(/\.[^.]+$/, "");
  const tables = toTables(name, buf, type);
  if (!tables.length) return { ok: false, error: "Dosya boş ya da okunamadı", downloadUrl: r.downloadUrl, fileName: name };

  // şirket verisi klasörüne (beyin ve asistan da okur)
  let kurumFileId: string | undefined;
  let folder: string | undefined;
  if (input.save !== false) {
    const cat = await categoryFor(title);
    const filt = Object.entries(input.params ?? {})
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("|") : v}`)
      .join(", ");
    const txt = tables.map((t) => `# ${title} — ${t.sheet}\nKaynak: LabIQ ${status.companyLabel}${filt ? ` · filtre: ${filt}` : ""}\n${t.headers.join("\t")}\n${t.rows.map((x) => x.join("\t")).join("\n")}`).join("\n\n");
    const f = await addText(name.replace(/\.(xlsx|csv)$/i, "") + ".tsv", txt, { hospital, period, category: cat.id, size: buf.length });
    kurumFileId = f.id;
    folder = `${hospital} · ${period || "dönemsiz"} · ${cat.name}`;
  }

  // sorgulanabilir tablo (en büyük sayfa)
  const main = tables.sort((a, b) => b.rows.length - a.rows.length)[0];
  const id = Math.random().toString(36).slice(2, 10);
  const st: StoredTable = { id, name, title, sheet: main.sheet, headers: main.headers, rows: main.rows.slice(0, MAX_ROWS), totalRows: main.rows.length, hospital, period, source: { page: input.page, params: input.params, company: status.companyLabel, url }, kurumFileId, at: new Date().toISOString() };
  await store().setKV(tableKey(id), st);
  const { rows: _r, ...meta } = st;
  void _r;
  await store().setKV(INDEX, [{ ...meta, cols: st.headers.length }, ...(await listTables())].slice(0, 60));
  return { ok: true, tableId: id, fileName: name, downloadUrl: r.downloadUrl, folder, sheets: tables.map((t) => ({ sheet: t.sheet, headers: t.headers, rows: t.rows.length })), preview: [main.headers, ...main.rows.slice(0, 8)], preamble: main.preamble.slice(0, 5) };
}

// ------------------------------------------------------------------ tablo sorgusu
/** "1.234,56" · "1,234.56" · "%12,5" · "12 adet" → sayı */
export function num(v: string): number | null {
  let s = String(v ?? "").replace(/[%\s₺€$]|TL|adet|kutu|test/gi, "");
  if (!s || !/\d/.test(s)) return null;
  if (/^-?[\d.]+,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?[\d,]+\.\d+$/.test(s)) s = s.replace(/,/g, "");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface QueryInput {
  where?: { column: string; op?: "contains" | "=" | "!=" | ">" | "<" | ">=" | "<=" | "not_contains"; value: string }[];
  groupBy?: string[];
  sum?: string[];
  avg?: string[];
  columns?: string[];
  sort?: { column: string; dir?: "asc" | "desc" };
  limit?: number;
}

export function runQuery(t: Pick<StoredTable, "headers" | "rows">, q: QueryInput) {
  const col = (name: string) => {
    const n = norm(name);
    let i = t.headers.findIndex((h) => norm(h) === n);
    if (i < 0) i = t.headers.findIndex((h) => norm(h).includes(n) || n.includes(norm(h)));
    if (i < 0) throw new Error(`Sütun bulunamadı: "${name}". Sütunlar: ${t.headers.join(" | ")}`);
    return i;
  };
  let rows = t.rows;
  for (const w of q.where ?? []) {
    const i = col(w.column);
    const op = w.op ?? "contains";
    const v = norm(w.value);
    const vn = num(w.value);
    rows = rows.filter((r) => {
      const c = r[i] ?? "";
      const cn = num(c);
      if (op === "contains") return norm(c).includes(v);
      if (op === "not_contains") return !norm(c).includes(v);
      if (op === "=") return cn != null && vn != null ? cn === vn : norm(c) === v;
      if (op === "!=") return cn != null && vn != null ? cn !== vn : norm(c) !== v;
      if (cn == null || vn == null) return false;
      return op === ">" ? cn > vn : op === "<" ? cn < vn : op === ">=" ? cn >= vn : cn <= vn;
    });
  }
  const matched = rows.length;
  if (q.groupBy?.length || q.sum?.length || q.avg?.length) {
    const g = (q.groupBy ?? []).map(col);
    const s = (q.sum ?? []).map(col);
    const a = (q.avg ?? []).map(col);
    const groups = new Map<string, { key: string[]; count: number; sums: number[]; avgs: { t: number; n: number }[] }>();
    for (const r of rows) {
      const key = g.map((i) => r[i] ?? "");
      const k = key.join("\u0001");
      let x = groups.get(k);
      if (!x) groups.set(k, (x = { key, count: 0, sums: s.map(() => 0), avgs: a.map(() => ({ t: 0, n: 0 })) }));
      x.count++;
      s.forEach((i, j) => (x!.sums[j] += num(r[i] ?? "") ?? 0));
      a.forEach((i, j) => {
        const v = num(r[i] ?? "");
        if (v != null) (x!.avgs[j].t += v), x!.avgs[j].n++;
      });
    }
    const headers = [...g.map((i) => t.headers[i]), "Satır sayısı", ...s.map((i) => `Toplam ${t.headers[i]}`), ...a.map((i) => `Ortalama ${t.headers[i]}`)];
    let out = [...groups.values()].map((x) => [...x.key, String(x.count), ...x.sums.map((v) => String(Math.round(v * 100) / 100)), ...x.avgs.map((v) => (v.n ? String(Math.round((v.t / v.n) * 100) / 100) : ""))]);
    if (q.sort) {
      const i = headers.findIndex((h) => norm(h).includes(norm(q.sort!.column)));
      if (i >= 0) out = out.sort((x, y) => ((num(x[i]) ?? 0) - (num(y[i]) ?? 0)) * (q.sort!.dir === "asc" ? 1 : -1));
    } else if (s.length) out = out.sort((x, y) => (num(y[g.length + 1]) ?? 0) - (num(x[g.length + 1]) ?? 0));
    return { matchedRows: matched, groups: out.length, headers, rows: out.slice(0, Math.min(q.limit ?? 50, 200)) };
  }
  if (q.sort) {
    const i = col(q.sort.column);
    rows = [...rows].sort((x, y) => {
      const a = num(x[i] ?? "");
      const b = num(y[i] ?? "");
      const d = a != null && b != null ? a - b : (x[i] ?? "").localeCompare(y[i] ?? "", "tr");
      return q.sort!.dir === "asc" ? d : -d;
    });
  }
  const cols = q.columns?.length ? q.columns.map(col) : t.headers.map((_, i) => i);
  return { matchedRows: matched, headers: cols.map((i) => t.headers[i]), rows: rows.slice(0, Math.min(q.limit ?? 30, 200)).map((r) => cols.map((i) => r[i] ?? "")) };
}

export async function tableQuery(id: string, q: QueryInput) {
  const t = await getTable(id);
  if (!t) throw new Error(`Tablo bulunamadı: ${id}. labiq_list_tables ile kayıtlı tabloları gör.`);
  return { tablo: `${t.title} (${t.sheet})`, kaynak: t.source, toplamSatir: t.totalRows, ...runQuery(t, q) };
}
