import "server-only";
import { inflateRawSync } from "zlib";

/**
 * Office dosyalarından (docx / xlsx / pptx) düz metin çıkarır — bağımlılıksız küçük bir zip okuyucu.
 * Asistanın Drive'daki Word/Excel/PowerPoint dosyalarını okuyabilmesi için yeterli; biçim kaybolur.
 */
function unzip(buf: Buffer, want: (name: string) => boolean) {
  const out = new Map<string, string>();
  // merkezi dizinin sonu (EOCD) kaydını sondan ara
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return out;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (!want(name) || local + 30 > buf.length) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    try {
      out.set(name, (method === 8 ? inflateRawSync(data) : data).toString("utf8"));
    } catch {}
  }
  return out;
}

const xmlText = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

const tags = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);

function docx(files: Map<string, string>) {
  const doc = files.get("word/document.xml") ?? "";
  return tags(doc, "w:p")
    .map((p) => xmlText(tags(p, "w:t").join("")))
    .filter((l) => l.trim())
    .join("\n");
}

function pptx(files: Map<string, string>) {
  const slides = [...files.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return slides
    .map((k, i) => `--- Slayt ${i + 1} ---\n${tags(files.get(k)!, "a:p").map((p) => xmlText(tags(p, "a:t").join(""))).filter((l) => l.trim()).join("\n")}`)
    .join("\n\n");
}

/**
 * Excel tarihleri hücrede seri sayı olarak durur (45658 = 1 Ocak 2025); hücrenin biçimi (styles.xml) tarihse
 * gg.aa.yyyy [ss:dd] metnine çevrilir — yoksa beyin tarih sütununu sayı sanar ve ayları ayıramaz.
 */
function dateStyles(styles: string) {
  const custom = new Map([...styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), xmlText(m[2])]));
  const isDate = (id: number) => {
    // yerleşik biçimler: 14–17, 22 tarih · 18–21, 45–47 saat/süre · 27–36, 50–58 yerel tarih
    if ((id >= 18 && id <= 21) || (id >= 45 && id <= 47)) return "time";
    if ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 50 && id <= 58)) return true;
    const code = custom.get(id);
    if (!code) return false;
    const c = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "");
    return /[dy]/i.test(c) ? true : /[hs]/i.test(c) ? "time" : false;
  };
  const xfs = (styles.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] ?? "").match(/<xf\b[^>]*>/g) ?? [];
  return xfs.map((xf) => isDate(Number(xf.match(/numFmtId="(\d+)"/)?.[1] ?? 0)));
}
function serialDate(v: string, kind: true | "time", d1904: boolean) {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (kind === "time") {
    const m = Math.round((n % 1) * 1440);
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }
  if (n < 1 || n > 2958465) return v;
  const ms = Math.round((n + (d1904 ? 1462 : 0)) * 86400_000) + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  const day = `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
  return n % 1 ? `${day} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}` : day;
}

/** Excel sayısı → Türkçe ondalık ("10.3" → "10,3"; 9.699999999999999 → "9,7"). Tam sayılar (barkod, kayıt no) aynen kalır.
 *  Böylece "1.234" her zaman binlik ayraçlı Türkçe sayı olarak okunur, ondalıkla karışmaz. */
function trNumber(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n) || Number.isInteger(n) || /e/i.test(v)) return v;
  return String(Number(n.toPrecision(12))).replace(".", ",");
}

function xlsx(files: Map<string, string>) {
  const shared = tags(files.get("xl/sharedStrings.xml") ?? "", "si").map((si) => xmlText(tags(si, "t").join("")));
  const wb = files.get("xl/workbook.xml") ?? "";
  const styles = dateStyles(files.get("xl/styles.xml") ?? "");
  const d1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(wb);
  const names = [...wb.matchAll(/<sheet\b[^>]*name="([^"]*)"/g)].map((m) => xmlText(m[1]));
  const sheets = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return sheets
    .map((k, i) => {
      const rows = tags(files.get(k)!, "row").map((row) => {
        const cells: string[] = [];
        for (const c of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const t = c[1].match(/\bt="(\w+)"/)?.[1];
          const v = c[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          const st = styles[Number(c[1].match(/\bs="(\d+)"/)?.[1] ?? -1)];
          const val =
            t === "s" && v != null
              ? (shared[Number(v)] ?? "")
              : t === "inlineStr"
                ? xmlText(tags(c[2] ?? "", "t").join(""))
                : v != null
                  ? st && (!t || t === "n")
                    ? serialDate(v, st, d1904)
                    : !t || t === "n"
                      ? trNumber(v)
                      : xmlText(v)
                  : "";
          // boş hücreler XML'de yazılmaz: sütun harfinden konumu bul (A=0, B=1, … AA=26)
          const col = c[1].match(/\br="([A-Z]+)\d+"/)?.[1];
          const at = col ? [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : cells.length;
          while (cells.length < at) cells.push("");
          cells[at] = val;
        }
        return cells.join("\t").replace(/\t+$/, "");
      });
      return `--- Sayfa: ${names[i] ?? i + 1} ---\n${rows.filter((r) => r.trim()).join("\n")}`;
    })
    .join("\n\n");
}

export const OFFICE_MIME: Record<string, "docx" | "xlsx" | "pptx"> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

export function officeText(buf: Buffer, kind: "docx" | "xlsx" | "pptx") {
  const want =
    kind === "docx" ? (n: string) => n === "word/document.xml" : kind === "pptx" ? (n: string) => /^ppt\/slides\/slide\d+\.xml$/.test(n) : (n: string) => n === "xl/sharedStrings.xml" || n === "xl/workbook.xml" || n === "xl/styles.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n);
  const files = unzip(buf, want);
  return kind === "docx" ? docx(files) : kind === "pptx" ? pptx(files) : xlsx(files);
}
