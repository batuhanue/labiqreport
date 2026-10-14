/*
 * Tablo okuma (sunucu ve test için saf fonksiyonlar): CSV/TSV ve Excel metnini tabloya çevirir, sayıları Türkçe
 * biçimden okur ve "ön hesap" çıkarır: hangi sütun tarih, dosyada hangi aylar var, ay ay satır sayısı ve sayısal
 * sütunların toplamı. Beyin binlerce satırı kafadan toplamaz; rakamlarda bu kesin hesaba dayanır.
 */

// ------------------------------------------------------------------ ayrıştırma
export function parseCsv(textIn: string): string[][] {
  // ayırıcı: ilk satırlarda en çok geçen (rapor başlığı satırı ayırıcısız olabilir)
  const head = textIn.split(/\r?\n/, 30).join("\n");
  const count = (c: string) => head.split(c).length - 1;
  const d = [";", "\t", ","].reduce((a, c) => (count(c) > count(a) ? c : a), ",");
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
export function splitHeader(rows: string[][]) {
  const width = Math.max(0, ...rows.slice(0, 40).map((r) => r.filter((x) => x.trim()).length));
  const h = rows.slice(0, 12).findIndex((r) => r.filter((x) => x.trim()).length >= Math.max(2, Math.ceil(width * 0.6)));
  const at = h < 0 ? 0 : h;
  const headers = (rows[at] ?? []).map((x, i) => x.trim() || `Sütun ${i + 1}`);
  return { headers, rows: rows.slice(at + 1).filter((r) => r.some((x) => x.trim())), preamble: rows.slice(0, at).map((r) => r.filter(Boolean).join(" ")).filter(Boolean) };
}

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

export interface Table {
  sheet: string;
  headers: string[];
  rows: string[][];
  preamble: string[];
}

/**
 * Arşivdeki dosya metninden tablolar: Excel metni ("--- Sayfa: X ---" + sekmeyle ayrılmış satırlar) ya da CSV/TSV.
 * Parça parça saklanan CSV'de her parçanın başında tekrar eden başlık satırı ayıklanır.
 */
export function tablesFromText(text: string, kind: string, name = "Tablo"): Table[] {
  if (kind === "xlsx" || /^--- Sayfa: .* ---$/m.test(text)) {
    return text
      .split(/^--- Sayfa: (.*) ---$/m)
      .slice(1)
      .reduce<{ sheet: string; body: string }[]>((acc, x, i, arr) => (i % 2 === 0 ? [...acc, { sheet: x, body: arr[i + 1] ?? "" }] : acc), [])
      .map((s) => ({ sheet: s.sheet, ...splitHeader(s.body.split("\n").filter((l) => l.trim()).map((l) => l.split("\t"))) }))
      .filter((t) => t.rows.length);
  }
  if (kind === "csv" || kind === "tsv") {
    const t = { sheet: name, ...splitHeader(parseCsv(text.replace(/^﻿/, ""))) };
    const head = t.headers.join("\u0001");
    // parçaların başında tekrar eden başlık ve tek hücrelik başlık/not satırları (ör. "# Rapor — Sayfa") veri değildir
    t.rows = t.rows.filter((r) => r.map((x, i) => x.trim() || `Sütun ${i + 1}`).join("\u0001") !== head && (t.headers.length < 3 || r.filter((x) => x.trim()).length > 1));
    return t.rows.length ? [t] : [];
  }
  return [];
}

// ------------------------------------------------------------------ tarih ve ay
const AYLAR = ["oca", "şub", "mar", "nis", "may", "haz", "tem", "ağu", "eyl", "eki", "kas", "ara"];
const AY_TAM = ["ocak", "şubat", "mart", "nisan", "mayıs", "haziran", "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık"];
const ym = (y: number, m: number) => (y >= 1990 && y <= 2100 && m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, "0")}` : null);

/** Bir hücredeki tarih/ay → "YYYY-AA" (gg.aa.yyyy · yyyy-aa-gg · aa.yyyy · yyyy-aa · "Ocak 2026" · "Oca.26") */
export function monthOf(v: string): string | null {
  const s = String(v ?? "").trim().toLocaleLowerCase("tr");
  if (!s || s.length > 32) return null;
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ t]\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (m) {
    let [d, mo] = [Number(m[1]), Number(m[2])];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // aa/gg/yyyy
    return d >= 1 && d <= 31 ? ym(Number(m[3]), mo) : null;
  }
  m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ t].*)?$/);
  if (m) return ym(Number(m[1]), Number(m[2]));
  m = s.match(/^(\d{4})[./-](\d{1,2})$/);
  if (m) return ym(Number(m[1]), Number(m[2]));
  m = s.match(/^(\d{1,2})[./-](\d{4})$/);
  if (m) return ym(Number(m[2]), Number(m[1]));
  m = s.match(/^([a-zçğıöşü]{3,8})\.?[\s./-]*(\d{2}|\d{4})$/);
  if (m) {
    const i = AY_TAM.indexOf(m[1]) >= 0 ? AY_TAM.indexOf(m[1]) : AYLAR.indexOf(m[1].slice(0, 3));
    const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return i >= 0 ? ym(y, i + 1) : null;
  }
  return null;
}

const MONTH_TR = (k: string) => `${AY_TAM[Number(k.slice(5)) - 1].replace(/^./, (c) => c.toLocaleUpperCase("tr"))} ${k.slice(0, 4)}`;
const fmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });

// ------------------------------------------------------------------ ön hesap
const ID_COL = /(^|[\s_.-])(no|nr|kod|kodu|numara|numarası|id|barkod|lot|tc|telefon|protokol)([\s_.-]|$)|^(sıra|sira|#|seri no)$/i;
const TOTAL_ROW = /^(genel\s+)?(toplam|total|ara\s*toplam|grand total)\b/i;

export interface TableProfile {
  sheet: string;
  rows: number;
  /** "toplam" satırları (toplamlara katılmadı) */
  totals: number;
  dateCol?: string;
  /** dosyada bulunan aylar → satır sayısı ve sayısal sütun toplamları */
  months: { month: string; rows: number; sums: number[] }[];
  /** tarihi okunamayan satırlar */
  undated: number;
  numCols: string[];
  sums: number[];
}

/** Tablonun kesin özeti: tarih sütunu, aylar, ay ay satır ve toplamlar */
export function profileTable(t: Table): TableProfile {
  const body = t.rows.filter((r) => !TOTAL_ROW.test((r.find((x) => x.trim()) ?? "").trim()));
  const totals = t.rows.length - body.length;
  const sample = body.length > 400 ? body.filter((_, i) => i % Math.ceil(body.length / 400) === 0) : body;
  const filled = (c: number) => sample.map((r) => r[c] ?? "").filter((x) => x.trim());
  // tarih sütunu: değerlerin çoğu tarih/ay; adında "tarih/ay/dönem" geçen öne çıkar
  let dateCol = -1;
  let best = 0;
  t.headers.forEach((h, c) => {
    const vals = filled(c);
    if (vals.length < Math.min(3, sample.length)) return;
    const ok = vals.filter((v) => monthOf(v)).length / vals.length;
    const score = ok + (/tarih|date|dönem|donem|^ay$|ay\b/i.test(h) ? 0.15 : 0);
    if (ok >= 0.7 && score > best) (best = score), (dateCol = c);
  });
  // sayısal sütunlar (kimlik/kod sütunları ve tarih hariç)
  const numCols = t.headers
    .map((h, c) => ({ h, c }))
    .filter(({ h, c }) => {
      if (c === dateCol || ID_COL.test(h)) return false;
      const vals = filled(c);
      if (vals.length < Math.min(3, sample.length)) return false;
      const nums = vals.map(num);
      if (nums.filter((n) => n != null).length / vals.length < 0.8) return false;
      // uzun tam sayılar (barkod, protokol no) toplanmaz
      return !nums.every((n) => n == null || (Number.isInteger(n) && Math.abs(n) >= 1e7));
    })
    .slice(0, 8);
  const by = new Map<string, { rows: number; sums: number[] }>();
  const sums = numCols.map(() => 0);
  let undated = 0;
  for (const r of body) {
    const vals = numCols.map(({ c }) => num(r[c] ?? "") ?? 0);
    vals.forEach((v, i) => (sums[i] += v));
    if (dateCol < 0) continue;
    const m = monthOf(r[dateCol] ?? "");
    if (!m) {
      undated++;
      continue;
    }
    const g = by.get(m) ?? { rows: 0, sums: numCols.map(() => 0) };
    g.rows++;
    vals.forEach((v, i) => (g.sums[i] += v));
    by.set(m, g);
  }
  return {
    sheet: t.sheet,
    rows: body.length,
    totals,
    dateCol: dateCol >= 0 ? t.headers[dateCol] : undefined,
    months: [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, g]) => ({ month, ...g })),
    undated,
    numCols: numCols.map((x) => x.h),
    sums,
  };
}

/**
 * Ön hesabın beyne giden metni. expected verilirse (dönemin ayları) dosyada eksik kalan ve dönem dışında kalan
 * aylar da yazılır.
 */
export function profileText(p: TableProfile, expected: string[] = []) {
  const L: string[] = [`#### ${p.sheet} — ${p.rows.toLocaleString("tr-TR")} satır${p.totals ? ` (+${p.totals} "toplam" satırı, toplamlara katılmadı)` : ""}${p.dateCol ? ` · tarih sütunu: "${p.dateCol}"` : " · tarih sütunu bulunamadı"}`];
  const cols = p.numCols.slice(0, 6);
  if (p.months.length) {
    L.push(`| Ay | Satır |${cols.map((c) => ` ${c} (toplam) |`).join("")}`, `|---|---:|${cols.map(() => "---:|").join("")}`);
    for (const m of p.months) L.push(`| ${MONTH_TR(m.month)} | ${m.rows.toLocaleString("tr-TR")} |${cols.map((_, i) => ` ${fmt(m.sums[i])} |`).join("")}`);
  }
  if (cols.length) L.push(`Tüm satırlar toplamı: ${cols.map((c, i) => `${c} = ${fmt(p.sums[i])}`).join(" · ")}`);
  if (p.undated) L.push(`Tarihi okunamayan satır: ${p.undated}`);
  if (expected.length > 1 && p.dateCol) {
    const have = new Set(p.months.map((m) => m.month));
    const missing = expected.filter((m) => !have.has(m));
    const outside = p.months.filter((m) => !expected.includes(m.month));
    L.push(missing.length ? `Dönemde olup dosyada OLMAYAN aylar: ${missing.map(MONTH_TR).join(", ")}` : "Dönemin bütün ayları dosyada var.");
    if (outside.length) L.push(`Dönem DIŞI aylar: ${outside.map((m) => `${MONTH_TR(m.month)} (${m.rows} satır)`).join(", ")}`);
  }
  return L.join("\n");
}

/** Dosyanın kapsadığı aylar (yükleme sonrası klasörde göstermek için) */
export function coverageOf(text: string, kind: string, name?: string) {
  const ps = tablesFromText(text, kind, name).map(profileTable);
  const months = [...new Set(ps.flatMap((p) => p.months.map((m) => m.month)))].sort();
  return { months, rows: ps.reduce((s, p) => s + p.rows, 0), dated: ps.some((p) => p.dateCol), tables: ps.length };
}

export const monthTr = MONTH_TR;
