// .xlsx içindeki sayfa XML'ini biçimi bozmadan yamalamak için küçük yardımcılar.
// Hücrenin stil (s=) özniteliği korunur; yalnızca değer değişir.

export const esc = (s: string) =>
  s
    // XML 1.0'da geçersiz kontrol karakterlerini at
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const unesc = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

export const colIndex = (col: string) => col.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const splitRef = (ref: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  return { col: m[1], row: Number(m[2]) };
};

const cellRe = (ref: string) =>
  new RegExp(`<c r="${ref}"((?:\\s+[\\w:]+="[^"]*")*)\\s*(?:/>|>([\\s\\S]*?)</c>)`);

const stripAttr = (attrs: string, name: string) => attrs.replace(new RegExp(`\\s+${name}="[^"]*"`, "g"), "");

export type CellValue = string | number | null;

function buildCell(ref: string, attrs: string, value: CellValue) {
  const a = stripAttr(attrs, "t");
  if (value === null || value === "") return `<c r="${ref}"${a}/>`;
  if (typeof value === "number") return `<c r="${ref}"${a}><v>${value}</v></c>`;
  return `<c r="${ref}"${a} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

/** Hücre değerini yazar (stil korunur). Hücre yoksa satıra doğru sırada eklenir. */
export function setCell(xml: string, ref: string, value: CellValue): string {
  const re = cellRe(ref);
  const m = re.exec(xml);
  if (m) return xml.slice(0, m.index) + buildCell(ref, m[1] ?? "", value) + xml.slice(m.index + m[0].length);

  const { col, row } = splitRef(ref);
  const rowRe = new RegExp(`<row r="${row}"[^>]*?(/>|>([\\s\\S]*?)</row>)`);
  const rm = rowRe.exec(xml);
  const newCell = buildCell(ref, "", value);
  if (!rm) {
    // satır yok: sheetData içine doğru konuma ekle
    const rows = [...xml.matchAll(/<row r="(\d+)"/g)];
    const after = rows.find((r) => Number(r[1]) > row);
    const rowXml = `<row r="${row}">${newCell}</row>`;
    if (after) return xml.slice(0, after.index) + rowXml + xml.slice(after.index);
    return xml.replace("</sheetData>", `${rowXml}</sheetData>`);
  }
  if (rm[1] === "/>") {
    const open = rm[0].slice(0, -2) + ">";
    return xml.slice(0, rm.index) + open + newCell + "</row>" + xml.slice(rm.index + rm[0].length);
  }
  const inner = rm[2] ?? "";
  const target = colIndex(col);
  const cells = [...inner.matchAll(/<c r="([A-Z]+)\d+"/g)];
  const next = cells.find((c) => colIndex(c[1]) > target);
  const innerStart = rm.index + rm[0].indexOf(">") + 1;
  const pos = next ? innerStart + next.index! : innerStart + inner.length;
  return xml.slice(0, pos) + newCell + xml.slice(pos);
}

/** Formül hücresinin önbellek değerini günceller (formül korunur). */
export function setCached(xml: string, ref: string, value: string | number): string {
  const m = cellRe(ref).exec(xml);
  if (!m || !m[2]) return xml;
  const f = /<f[\s\S]*?(?:\/>|<\/f>)/.exec(m[2]);
  if (!f) return xml;
  let attrs = stripAttr(m[1] ?? "", "t");
  if (typeof value === "string") attrs += ' t="str"';
  const v = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "0") : esc(value);
  const cell = `<c r="${ref}"${attrs}>${f[0]}<v>${v}</v></c>`;
  return xml.slice(0, m.index) + cell + xml.slice(m.index + m[0].length);
}

export function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) =>
    unesc([...si[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );
}

/** Hücrenin görünen metnini okur. */
export function getCellText(xml: string, ref: string, shared: string[]): string {
  const m = cellRe(ref).exec(xml);
  if (!m || !m[2]) return "";
  const attrs = m[1] ?? "";
  const t = /\st="([^"]*)"/.exec(attrs)?.[1];
  if (t === "inlineStr") {
    return unesc([...m[2].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
  }
  const v = /<v>([\s\S]*?)<\/v>/.exec(m[2])?.[1];
  if (v == null) return "";
  if (t === "s") return shared[Number(v)] ?? "";
  return unesc(v);
}
