import JSZip from "jszip";
import { AREAS, ALL_ITEMS, HOSPITALS, areaByCode } from "./checklist";
import { areaProgress, newPeriod, normalizePeriod, PERIOD_RE } from "./period";
import type { ActionRow, Mark, PeriodData, PeriodStatus, Signoff } from "./types";
import { getCellText, parseSharedStrings, setCached, setCell } from "./xlsx-xml";

const SHEET_NAMES = {
  control: "01_Aylık_Kontrol_Rapor",
  panel: "03_Durum_Panosu",
  actions: "02_Aksiyon_Takip",
};

const MARK_TO_CELL: Record<string, string> = { ok: "☑", fail: "x", na: "N/A" };
const markToCell = (m: Mark) => (m ? MARK_TO_CELL[m] : "☐");

export function cellToMark(v: string): Mark {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (["☑", "✓", "✔", "✅", "ok", "evet"].includes(s)) return "ok";
  if (["x", "✗", "✘", "☒", "❌", "hayır"].includes(s)) return "fail";
  if (["n/a", "na", "uygulanmaz", "-"].includes(s)) return "na";
  return null;
}

const trDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso || "";
};
const isoFromTr = (s: string) => {
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s.trim());
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  // Excel seri tarih
  if (/^\d{5}(\.\d+)?$/.test(s.trim())) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return s.trim();
};
const signoffText = (s: Signoff, placeholder: string) => {
  if (!s.name && !s.date) return placeholder;
  return [s.name, trDate(s.date)].filter(Boolean).join(" / ");
};

async function sheetPaths(zip: JSZip) {
  const wb = await zip.file("xl/workbook.xml")!.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  const out: Record<string, string> = {};
  for (const m of wb.matchAll(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)) {
    const target = new RegExp(`Id="${m[2]}"[^>]*?Target="([^"]+)"|Target="([^"]+)"[^>]*?Id="${m[2]}"`).exec(rels);
    const t = target?.[1] ?? target?.[2];
    if (t) out[m[1]] = t.startsWith("/") ? t.slice(1) : `xl/${t}`;
  }
  return out;
}

/** Şablonu doldurur ve .xlsx döndürür. Biçim, grafik ve açılır listeler korunur. */
export async function buildWorkbook(template: Buffer | Uint8Array, data: PeriodData): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template);
  const paths = await sheetPaths(zip);

  // ---------------------------------------------------- 01_Aylık_Kontrol_Rapor
  const p1 = paths[SHEET_NAMES.control];
  let s1 = await zip.file(p1)!.async("string");
  s1 = setCell(s1, "D5", data.period);
  s1 = setCell(s1, "G5", trDate(data.preparedAt));
  s1 = setCell(s1, "I5", data.status);
  s1 = setCell(s1, "K5", data.version);
  s1 = setCell(s1, "A8", signoffText(data.signoffs.preparer, "Ad Soyad / Tarih"));
  s1 = setCell(s1, "D8", signoffText(data.signoffs.control, "Ad Soyad / Tarih"));
  s1 = setCell(s1, "G8", signoffText(data.signoffs.preApproval, "Proje Yöneticisi / Tarih"));
  s1 = setCell(s1, "I8", signoffText(data.signoffs.finalApproval, "Genel Müdür / Tarih"));
  s1 = setCell(s1, "K8", signoffText(data.signoffs.closing, "Onaylandı / Revizyon"));
  for (const it of ALL_ITEMS) {
    const st = data.items[it.id];
    for (const h of HOSPITALS) s1 = setCell(s1, `${h.excelCol}${it.row}`, markToCell(st?.[h.id] ?? null));
    s1 = setCell(s1, `E${it.row}`, st?.note?.trim() || null);
  }
  // Not kolonunda birleştirilmiş hücre kalmasın (her maddenin kendi notu olsun)
  s1 = s1.replace(/<mergeCell ref="E\d+:E\d+"\/>/g, "");
  s1 = s1.replace(/<mergeCells count="\d+">([\s\S]*?)<\/mergeCells>/, (_, inner: string) => {
    const n = (inner.match(/<mergeCell /g) ?? []).length;
    return `<mergeCells count="${n}">${inner}</mergeCells>`;
  });
  zip.file(p1, s1);

  // ---------------------------------------------------- 03_Durum_Panosu (önbellek değerleri)
  const p2 = paths[SHEET_NAMES.panel];
  if (p2 && zip.file(p2)) {
    let s2 = await zip.file(p2)!.async("string");
    let tb = 0, tk = 0, tt = 0;
    AREAS.forEach((a, i) => {
      const r = 11 + i;
      const pr = areaProgress(data, a);
      // Excel formülü yalnızca ☑ sayar
      const b = a.items.filter((it) => data.items[it.id]?.bursa === "ok").length;
      const k = a.items.filter((it) => data.items[it.id]?.basaksehir === "ok").length;
      const n = pr.total;
      tb += b; tk += k; tt += n;
      const rem = n * 2 - b - k;
      s2 = setCached(s2, `E${r}`, b);
      s2 = setCached(s2, `F${r}`, b / n);
      s2 = setCached(s2, `G${r}`, k);
      s2 = setCached(s2, `H${r}`, k / n);
      s2 = setCached(s2, `I${r}`, rem);
      s2 = setCached(s2, `J${r}`, rem === 0 ? "Tamamlandı" : b + k === 0 ? "Başlanmadı" : "Devam ediyor");
      s2 = setCached(s2, `O${r}`, `${a.code} ${a.title}`);
      s2 = setCached(s2, `P${r}`, b);
      s2 = setCached(s2, `Q${r}`, n - b);
      s2 = setCached(s2, `R${r}`, k);
      s2 = setCached(s2, `S${r}`, n - k);
      s2 = setCached(s2, `T${r}`, b / n);
      s2 = setCached(s2, `U${r}`, k / n);
    });
    s2 = setCached(s2, "D21", tt);
    s2 = setCached(s2, "E21", tb);
    s2 = setCached(s2, "F21", tb / tt);
    s2 = setCached(s2, "G21", tk);
    s2 = setCached(s2, "H21", tk / tt);
    s2 = setCached(s2, "I21", tt * 2 - tb - tk);
    s2 = setCached(s2, "B8", tb / tt);
    s2 = setCached(s2, "E8", tk / tt);
    s2 = setCached(s2, "H8", (tb + tk) / (tt * 2));
    s2 = setCached(s2, "K8", tt * 2 - tb - tk);
    s2 = setCached(s2, "C5", data.period);
    s2 = setCached(s2, "P23", tb);
    s2 = setCached(s2, "P24", tt - tb);
    s2 = setCached(s2, "P26", tk);
    s2 = setCached(s2, "P27", tt - tk);
    zip.file(p2, s2);
  }

  // ---------------------------------------------------- 02_Aksiyon_Takip
  const p3 = paths[SHEET_NAMES.actions];
  if (p3 && zip.file(p3)) {
    let s3 = await zip.file(p3)!.async("string");
    const cols = "ABCDEFGHIJKLM".split("");
    const rowCount = Math.max(100, data.actions.length);
    for (let i = 0; i < rowCount; i++) {
      const r = 5 + i;
      const a = data.actions[i];
      if (!a) {
        if (r > 104) break;
        for (const c of cols) s3 = setCell(s3, `${c}${r}`, null);
        continue;
      }
      if (r > 104 && !new RegExp(`<row r="${r}"`).test(s3)) {
        // şablondaki son satırın biçimini kopyala
        const tpl = /<row r="104"[\s\S]*?<\/row>/.exec(s3)?.[0];
        if (tpl) {
          const clone = tpl.replace(/r="104"/, `r="${r}"`).replace(/r="([A-Z]+)104"/g, `r="$1${r}"`);
          s3 = s3.replace("</sheetData>", `${clone}</sheetData>`);
        }
      }
      const area = areaByCode(a.areaCode);
      const item = a.itemId ? ALL_ITEMS.find((x) => x.id === a.itemId) : undefined;
      const values = [
        a.hospital === "bursa" ? "Bursa" : "Başakşehir",
        data.period,
        a.areaCode,
        item ? `${area?.title ?? ""} › ${item.text.trim()}` : area?.title ?? "",
        a.finding,
        a.financialImpact,
        a.operationalImpact,
        a.priority,
        a.action,
        a.owner,
        trDate(a.due),
        a.status,
        a.managementNote,
      ];
      values.forEach((v, j) => (s3 = setCell(s3, `${cols[j]}${r}`, v || null)));
    }
    if (data.actions.length > 100) {
      s3 = s3.replace(/<dimension ref="A1:M\d+"\/>/, `<dimension ref="A1:M${4 + data.actions.length}"/>`);
    }
    zip.file(p3, s3);
  }

  // Excel açılışta tüm formülleri yeniden hesaplasın
  let wb = await zip.file("xl/workbook.xml")!.async("string");
  wb = wb.replace(/<calcPr([^>]*?)\s*\/>/, (_m, attrs: string) =>
    `<calcPr${attrs.replace(/\s+fullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"/>`,
  );
  zip.file("xl/workbook.xml", wb);

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

/** Mevcut bir kontrol Excel'ini okuyup dönem verisine çevirir. */
export async function parseWorkbook(buf: ArrayBuffer | Uint8Array, fallbackPeriod?: string): Promise<PeriodData> {
  const zip = await JSZip.loadAsync(buf);
  const paths = await sheetPaths(zip);
  const shared = parseSharedStrings((await zip.file("xl/sharedStrings.xml")?.async("string")) ?? null);
  const p1 = paths[SHEET_NAMES.control] ?? Object.values(paths)[0];
  if (!p1 || !zip.file(p1)) throw new Error("Kontrol sayfası (01_Aylık_Kontrol_Rapor) bulunamadı.");
  const s1 = await zip.file(p1)!.async("string");

  const filePeriod = getCellText(s1, "D5", shared).trim();
  const period = fallbackPeriod && PERIOD_RE.test(fallbackPeriod) ? fallbackPeriod : PERIOD_RE.test(filePeriod) ? filePeriod : null;
  if (!period) throw new Error("Dönem okunamadı; lütfen dönemi seçin.");

  const data = newPeriod(period);
  const status = getCellText(s1, "I5", shared).trim();
  if (["Taslak", "Ön Onay", "Son Onay"].includes(status)) data.status = status as PeriodStatus;
  const version = getCellText(s1, "K5", shared).trim();
  if (version) data.version = version;

  for (const it of ALL_ITEMS) {
    data.items[it.id] = {
      bursa: cellToMark(getCellText(s1, `C${it.row}`, shared)),
      basaksehir: cellToMark(getCellText(s1, `D${it.row}`, shared)),
      note: getCellText(s1, `E${it.row}`, shared).trim(),
    };
  }

  const p3 = paths[SHEET_NAMES.actions];
  if (p3 && zip.file(p3)) {
    const s3 = await zip.file(p3)!.async("string");
    const rows = [...s3.matchAll(/<row r="(\d+)"/g)].map((m) => Number(m[1])).filter((r) => r >= 5);
    for (const r of rows) {
      const g = (c: string) => getCellText(s3, `${c}${r}`, shared).trim();
      const finding = g("E");
      const action = g("I");
      if (!finding && !action) continue;
      const code = g("C");
      const row: ActionRow = {
        id: `imp-${r}-${Math.random().toString(36).slice(2, 7)}`,
        hospital: /bursa/i.test(g("A")) ? "bursa" : "basaksehir",
        areaCode: areaByCode(code) ? code : "R-01",
        finding,
        financialImpact: g("F"),
        operationalImpact: g("G"),
        priority: (["Kritik", "Yüksek", "Orta", "Düşük"].includes(g("H")) ? g("H") : "Orta") as ActionRow["priority"],
        action,
        owner: g("J"),
        due: isoFromTr(g("K")),
        status: (["Açık", "Devam Ediyor", "Beklemede", "Tamamlandı"].includes(g("L")) ? g("L") : "Açık") as ActionRow["status"],
        managementNote: g("M"),
        createdAt: new Date().toISOString(),
      };
      data.actions.push(row);
    }
  }
  return normalizePeriod(data);
}
