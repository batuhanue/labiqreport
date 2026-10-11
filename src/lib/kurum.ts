import "server-only";
import { removeByPrefix, upsertItems } from "./archive";
import { addUsage, ASSISTANT_MODEL, claude, claudeConfigured, logUsage, newUsage } from "./claude";
import { store } from "./db";
import type { ArchiveItem } from "./google-types";
import { officeText } from "./officetext";

/*
 * Şirket verisi: Batuhan'ın izinli olarak yüklediği dosyalar (prosedür, rapor, tablo, sistem dökümü).
 * Metne çevrilir, parçalara bölünür ve arşivde `kurum` kaynağı olarak tam metin aranır:
 * asistan ve ajanlar `search_archive` ile okur, önem değerlendirmesinde ilgili kayıt bağlama eklenir.
 * Dosyanın kendisi saklanmaz; yalnızca metni.
 */

export interface KurumFile {
  id: string;
  name: string;
  kind: string;
  size: number;
  chars: number;
  parts: number;
  uploadedAt: string;
  /** PDF metni süre dolduğu için yarım kaldıysa */
  partial?: boolean;
  /** tablo (csv/tsv) başlık satırı: parça parça gelen dosyada her parçaya eklenir */
  header?: string;
}

const KEY = "kurum-files";
const CHUNK = 8000;
export const MAX_BYTES = 4 * 1024 * 1024;
export const TEXT_EXT = ["md", "txt", "csv", "tsv", "json", "xml", "html", "htm", "log"];
export const BIN_EXT = ["docx", "xlsx", "pptx", "pdf"];

export const listFiles = async () => (await store().getKV<KurumFile[]>(KEY)) ?? [];
const saveFiles = (xs: KurumFile[]) => store().setKV(KEY, xs);
const extOf = (name: string) => name.toLowerCase().split(".").pop() ?? "";

/** Metni satır sınırlarından parçalar; tabloda (csv/tsv) her parçanın başına başlık satırı eklenir */
export function chunkText(text: string, kind: string, size = CHUNK, header?: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const table = kind === "csv" || kind === "tsv";
  const head = table ? (header ?? lines[0]) : "";
  const out: string[] = [];
  let cur: string[] = [];
  let len = 0;
  for (const raw of lines.slice(head && header == null ? 1 : 0)) {
    // tek satır parçadan uzunsa böl
    for (let i = 0; i < Math.max(1, raw.length); i += size) {
      const line = raw.slice(i, i + size);
      if (len + line.length + 1 > size && cur.length) {
        out.push((head ? `${head}\n` : "") + cur.join("\n"));
        cur = [];
        len = 0;
      }
      cur.push(line);
      len += line.length + 1;
    }
  }
  if (cur.join("").trim()) out.push((head ? `${head}\n` : "") + cur.join("\n"));
  return out;
}

async function store_(f: KurumFile, text: string, startPart: number, header?: string) {
  const chunks = chunkText(text, f.kind, CHUNK, header);
  const items: ArchiveItem[] = chunks.map((c, i) => ({
    source: "kurum",
    id: `${f.id}#${startPart + i + 1}`,
    ts: f.uploadedAt,
    title: f.name,
    who: "Şirket verisi",
    body: c,
    meta: { fileId: f.id, name: f.name, part: startPart + i + 1, kind: f.kind },
  }));
  await upsertItems(items);
  return chunks.length;
}

/**
 * Metin ekler. `id` verilirse aynı dosyanın devamıdır (büyük metin dosyaları parça parça gelir).
 */
export async function addText(name: string, text: string, opts: { id?: string; size?: number } = {}) {
  const files = await listFiles();
  let f = opts.id ? files.find((x) => x.id === opts.id) : undefined;
  // devam parçası: tablonun başlığı ilk parçadan gelir
  const header = f?.header;
  if (!f) {
    f = { id: Math.random().toString(36).slice(2, 10), name: name.slice(0, 160), kind: extOf(name), size: opts.size ?? text.length, chars: 0, parts: 0, uploadedAt: new Date().toISOString() };
    if (f.kind === "csv" || f.kind === "tsv") f.header = text.replace(/\r\n?/g, "\n").split("\n")[0].slice(0, 2000);
    files.unshift(f);
  }
  const n = await store_(f, text, f.parts, header);
  f.parts += n;
  f.chars += text.length;
  await saveFiles(files);
  return f;
}

/** PDF metni: Claude belgeyi okur (akışla; süre dolarsa o ana kadarki metin kaydedilir) */
async function pdfText(buf: Buffer, budgetMs: number) {
  if (!claudeConfigured()) throw new Error("PDF okumak için ANTHROPIC_API_KEY gerekli");
  const t0 = Date.now();
  const u = newUsage();
  let text = "";
  let partial = false;
  let error: string | undefined;
  const stream = claude().messages.stream({
    model: ASSISTANT_MODEL,
    max_tokens: 32000,
    output_config: { effort: "low" },
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } },
          { type: "text", text: "Bu PDF'in metnini sayfa sırasıyla eksiksiz çıkar. Tabloları Markdown tablo olarak yaz, başlıkları # ile koru. Yorum, özet ya da açıklama ekleme; yalnızca belgenin içeriği." },
        ],
      },
    ],
  });
  const timer = setTimeout(() => {
    partial = true;
    stream.abort();
  }, budgetMs);
  stream.on("text", (d) => (text += d));
  try {
    const m = await stream.finalMessage();
    addUsage(u, m);
    if (m.stop_reason === "max_tokens") partial = true;
  } catch (e) {
    if (!partial) error = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(timer);
    await logUsage("🏢 Şirket verisi (PDF)", u, { t0, rounds: 1, error });
  }
  if (error && !text.trim()) throw new Error(error);
  return { text, partial };
}

/** İkili dosya (docx/xlsx/pptx/pdf) → metin → arşiv */
export async function addBinary(name: string, buf: Buffer, budgetMs = 50000) {
  const kind = extOf(name);
  if (!BIN_EXT.includes(kind)) throw new Error(`Desteklenmeyen dosya türü: .${kind}. Desteklenenler: ${[...TEXT_EXT, ...BIN_EXT].join(", ")} (eski .xls/.doc dosyalarını yeni biçimde kaydet).`);
  if (buf.length > MAX_BYTES) throw new Error("Dosya 4 MB'tan büyük. Google Drive'a koy (arşiv okur) ya da Excel'i CSV olarak kaydedip yükle.");
  let text = "";
  let partial = false;
  if (kind === "pdf") ({ text, partial } = await pdfText(buf, budgetMs));
  else text = officeText(buf, kind as "docx" | "xlsx" | "pptx");
  if (!text.trim()) throw new Error("Dosyadan metin çıkarılamadı (boş ya da taranmış görüntü olabilir).");
  const f = await addText(name, text, { size: buf.length });
  if (partial) {
    const files = await listFiles();
    const x = files.find((y) => y.id === f.id);
    if (x) {
      x.partial = true;
      await saveFiles(files);
    }
    f.partial = true;
  }
  return f;
}

export async function removeFile(id: string) {
  await removeByPrefix("kurum", `${id}#`);
  await saveFiles((await listFiles()).filter((x) => x.id !== id));
}
