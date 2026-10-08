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

function xlsx(files: Map<string, string>) {
  const shared = tags(files.get("xl/sharedStrings.xml") ?? "", "si").map((si) => xmlText(tags(si, "t").join("")));
  const wb = files.get("xl/workbook.xml") ?? "";
  const names = [...wb.matchAll(/<sheet\b[^>]*name="([^"]*)"/g)].map((m) => xmlText(m[1]));
  const sheets = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return sheets
    .map((k, i) => {
      const rows = tags(files.get(k)!, "row").map((row) => {
        const cells: string[] = [];
        for (const c of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const t = c[1].match(/\bt="(\w+)"/)?.[1];
          const v = c[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          const val = t === "s" && v != null ? (shared[Number(v)] ?? "") : t === "inlineStr" ? xmlText(tags(c[2] ?? "", "t").join("")) : v != null ? xmlText(v) : "";
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
    kind === "docx" ? (n: string) => n === "word/document.xml" : kind === "pptx" ? (n: string) => /^ppt\/slides\/slide\d+\.xml$/.test(n) : (n: string) => n === "xl/sharedStrings.xml" || n === "xl/workbook.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n);
  const files = unzip(buf, want);
  return kind === "docx" ? docx(files) : kind === "pptx" ? pptx(files) : xlsx(files);
}
