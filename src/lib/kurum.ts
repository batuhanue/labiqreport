import "server-only";
import { itemsByPrefix, removeByPrefix, upsertItems } from "./archive";
import { saveKnowledge } from "./assistant";
import { addUsage, ASSISTANT_MODEL, claude, claudeConfigured, logUsage, newUsage } from "./claude";
import { UserError } from "./api";
import { store } from "./db";
import type { ArchiveItem } from "./google-types";
import { coverageOf } from "./tables";
import { KURUM_HOSPITALS, coverageInfo, folderText, hospitalLabel, periodText, unitKey, validPeriod, type KurumCategory, type KurumFile, type KurumUnit } from "./kurum-types";
import { officeText } from "./officetext";

/*
 * Şirket verisi — dosya yöneticisi: Batuhan'ın izinli olarak yüklediği dosyalar hastane → dönem → kategori
 * klasörlerinde durur. Kategoriler ad + açıklama ile tanımlanır; beyin dosyanın ne olduğunu klasöründen anlar.
 * Metin parçalara bölünüp arşivde `kurum` kaynağı olarak tam metin aranır (kayıtta klasör bilgisi de aranır);
 * asistan ve ajanlar `search_archive` ile okur. Dosyanın kendisi saklanmaz; yalnızca metni.
 * Bilgi dosyası `sirket-verisi.md` (her düşünmede okunur): kategoriler, klasörler, öğrenilen özetler.
 */

const KEY = "kurum-files";
const CAT_KEY = "kurum-categories";
export const NOTES_KEY = "kurum-training";
export const DATA_FILE = "sirket-verisi.md";
const CHUNK = 8000;
export const MAX_BYTES = 4 * 1024 * 1024;
export const TEXT_EXT = ["md", "txt", "csv", "tsv", "json", "xml", "html", "htm", "log"];
export const BIN_EXT = ["docx", "xlsx", "pptx", "pdf"];

export interface UnitNotes {
  at: string;
  /** öğrenildiği andaki dosyaların imzası (değişirse "güncellenmeli") */
  sig: string;
  summary: string;
  facts: string[];
  risks: string[];
  /** çok aylı dönemde ay ay notlar */
  months?: { month: string; note: string }[];
  partial?: boolean;
}
export interface KurumNotes {
  units: Record<string, UnitNotes>;
  running?: number;
  log: { at: string; did: string[]; ms: number; cost: number; error?: string }[];
}

const extOf = (name: string) => name.toLowerCase().split(".").pop() ?? "";
const uid = () => Math.random().toString(36).slice(2, 10);

/** eski kayıtlar (klasörsüz) şirket geneli · dönemsiz · kategorisiz sayılır */
const norm = (f: KurumFile): KurumFile => ({ ...f, hospital: f.hospital || "genel", period: f.period ?? "", category: f.category ?? "" });
export const listFiles = async () => ((await store().getKV<KurumFile[]>(KEY)) ?? []).map(norm);
const saveFiles = (xs: KurumFile[]) => store().setKV(KEY, xs);
export const listCategories = async () => (await store().getKV<KurumCategory[]>(CAT_KEY)) ?? [];
const saveCategories = (xs: KurumCategory[]) => store().setKV(CAT_KEY, xs);
export const readNotes = async (): Promise<KurumNotes> => ({ units: {}, log: [], ...((await store().getKV<KurumNotes>(NOTES_KEY)) ?? {}) });
export const saveNotes = (n: KurumNotes) => store().setKV(NOTES_KEY, n);

function checkFolder(o: { hospital?: string; period?: string; category?: string }, cats: KurumCategory[]) {
  const hospital = o.hospital || "genel";
  if (!KURUM_HOSPITALS.some((h) => h.id === hospital)) throw new UserError("Geçersiz hastane");
  const period = o.period ?? "";
  if (!validPeriod(period)) throw new UserError("Dönem YYYY-AA ya da YYYY-AA..YYYY-AA (en çok 36 ay) olmalı");
  const category = o.category ?? "";
  if (category && !cats.some((c) => c.id === category)) throw new UserError("Kategori bulunamadı");
  return { hospital, period, category };
}

const catName = (cats: KurumCategory[], id: string) => cats.find((c) => c.id === id)?.name ?? "";
/** arşiv kaydının "kim" alanı: aramada klasör bilgisi de bulunsun */
const whoOf = (f: KurumFile, cats: KurumCategory[]) => `Şirket verisi · ${folderText(f.hospital, f.period, catName(cats, f.category))}`;
const metaOf = (f: KurumFile, cats: KurumCategory[], part: number) => ({ fileId: f.id, name: f.name, part, kind: f.kind, hospital: f.hospital, period: f.period, category: f.category, categoryName: catName(cats, f.category) });

/** Dosyaların imzası: öğrenildikten sonra değişti mi */
export const sigOf = (files: KurumFile[]) =>
  files
    .map((f) => `${f.id}:${f.chars}`)
    .sort()
    .join(",");

/** Eğitim birimleri (hastane · dönem · kategori) ve öğrenme durumları */
export function unitsOf(files: KurumFile[], notes: KurumNotes): KurumUnit[] {
  const by = new Map<string, KurumFile[]>();
  for (const f of files) {
    const k = unitKey(f.hospital, f.period, f.category);
    by.set(k, [...(by.get(k) ?? []), f]);
  }
  const out: KurumUnit[] = [...by.entries()].map(([key, fs]) => {
    const n = notes.units[key];
    return {
      key,
      hospital: fs[0].hospital,
      period: fs[0].period,
      category: fs[0].category,
      files: fs.length,
      chars: fs.reduce((a, f) => a + f.chars, 0),
      trainedAt: n?.at,
      stale: !!n && n.sig !== sigOf(fs),
      summary: n?.summary,
    };
  });
  return out.sort((a, b) => a.hospital.localeCompare(b.hospital) || b.period.localeCompare(a.period) || a.category.localeCompare(b.category));
}

// ------------------------------------------------------------------ bilgi dosyası
/** sirket-verisi.md: kategoriler (tanımlarıyla), klasörler ve öğrenilenler — her düşünmede okunur */
export async function writeDataFile() {
  const [files, cats, notes] = await Promise.all([listFiles(), listCategories(), readNotes()]);
  const units = unitsOf(files, notes);
  const L: string[] = [
    "# Şirket verisi (otomatik)",
    "",
    "> Batuhan'ın yüklediği şirket dosyaları hastane → dönem → kategori klasörlerinde. Bir dosyanın ne olduğunu klasörünün kategorisinden anla.",
    "> Dönem \"Ocak–Temmuz 2026\" gibi çok aylıysa klasördeki dosya o ayların hepsini birlikte içerir: tek bir ay sorulduğunda o klasörün \"Ay ay\" notlarına bak, arşivde ararken satırların tarih sütununa göre o ayı ayır; dönem toplamını tek aya yazma. \"EKSİK\" yazan ayın verisi yüklenmemiştir.",
    '> İçerik için search_archive(source="kurum", query="<hastane> <dönem> <kategori> <konu>") kullan; kayıtların "kim" alanında klasör yazar.',
    "",
    "## Kategoriler",
    ...(cats.length ? cats.map((c) => `- **${c.name}**${c.description ? ` — ${c.description}` : ""}`) : ["- (henüz tanımlı kategori yok)"]),
    "",
    "## Klasörler",
    ...(units.length
      ? units.map((u) => {
          const fs = files.filter((f) => unitKey(f.hospital, f.period, f.category) === u.key);
          const names = fs.slice(0, 6).map((f) => f.name).join(", ") + (fs.length > 6 ? ` +${fs.length - 6}` : "");
          const cov = coverageInfo([...new Set(fs.flatMap((f) => f.coverage?.months ?? []))].sort(), u.period);
          const covText = cov ? ` · veride bulunan aylar: ${cov.span}${cov.missing.length ? ` (EKSİK: ${cov.missing.map(periodText).join(", ")})` : ""}${cov.outside.length ? ` (dönem dışı: ${cov.outside.map(periodText).join(", ")})` : ""}` : "";
          return `- ${folderText(u.hospital, u.period, catName(cats, u.category))}: ${u.files} dosya (${names})${covText} — ${u.trainedAt ? (u.stale ? "öğrenildi, sonra değişti" : `öğrenildi ${u.trainedAt.slice(0, 10)}`) : "henüz öğrenilmedi"}`;
        })
      : ["- (dosya yok)"]),
  ];
  const learned = units.filter((u) => u.trainedAt);
  if (learned.length) {
    L.push("", "## Öğrenilenler");
    let budget = 30000;
    for (const u of learned.sort((a, b) => (b.trainedAt ?? "").localeCompare(a.trainedAt ?? ""))) {
      const n = notes.units[u.key];
      const block = [`### ${folderText(u.hospital, u.period, catName(cats, u.category))}${n.partial ? " (dosyaların bir kısmı okundu)" : ""}`, n.summary, ...n.facts.map((x) => `- ${x}`), ...(n.months?.length ? ["Ay ay:", ...n.months.map((m) => `- ${periodText(m.month)}: ${m.note}`)] : []), ...(n.risks.length ? ["Dikkat:", ...n.risks.map((x) => `- ${x}`)] : [])].join("\n");
      // dosya çok büyümesin: eski birimlerde yalnızca özet
      const text = budget > block.length ? block : `### ${folderText(u.hospital, u.period, catName(cats, u.category))}\n${n.summary}`;
      budget -= text.length;
      if (budget < 0) break;
      L.push("", text);
    }
  }
  await saveKnowledge(DATA_FILE, L.join("\n") + "\n");
}

// ------------------------------------------------------------------ kategoriler
export async function saveCategory(input: { id?: string; name: string; description?: string }) {
  const cats = await listCategories();
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new UserError("Kategori adı gerekli");
  if (cats.some((c) => c.id !== input.id && c.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"))) throw new UserError("Bu adda kategori var");
  let c = input.id ? cats.find((x) => x.id === input.id) : undefined;
  const renamed = !!c && c.name !== name;
  if (c) Object.assign(c, { name, description: (input.description ?? c.description).trim().slice(0, 600) });
  else cats.push((c = { id: uid(), name, description: (input.description ?? "").trim().slice(0, 600), createdAt: new Date().toISOString() }));
  await saveCategories(cats);
  // ad değiştiyse arşiv kayıtlarındaki klasör bilgisi de güncellensin
  if (renamed) for (const f of (await listFiles()).filter((x) => x.category === c!.id)) await retag(f, cats);
  await writeDataFile();
  return c;
}

/** Kategoriyi siler; dosyaları kategorisiz kalır */
export async function deleteCategory(id: string) {
  const cats = (await listCategories()).filter((c) => c.id !== id);
  await saveCategories(cats);
  const files = await listFiles();
  for (const f of files.filter((x) => x.category === id)) {
    f.category = "";
    await retag(f, cats);
  }
  await saveFiles(files);
  await writeDataFile();
}

// ------------------------------------------------------------------ dosyalar
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

async function store_(f: KurumFile, cats: KurumCategory[], text: string, startPart: number, header?: string) {
  const chunks = chunkText(text, f.kind, CHUNK, header);
  const items: ArchiveItem[] = chunks.map((c, i) => ({
    source: "kurum",
    id: `${f.id}#${startPart + i + 1}`,
    ts: f.uploadedAt,
    title: f.name,
    who: whoOf(f, cats),
    body: c,
    meta: metaOf(f, cats, startPart + i + 1),
  }));
  await upsertItems(items);
  return chunks.length;
}

/** Arşiv kayıtlarındaki klasör bilgisini yeniler (taşıma, kategori adı değişimi) */
async function retag(f: KurumFile, cats: KurumCategory[]) {
  const items = await itemsByPrefix("kurum", `${f.id}#`);
  if (!items.length) return;
  await upsertItems(items.map((x) => ({ ...x, who: whoOf(f, cats), meta: metaOf(f, cats, Number(x.meta?.part ?? 0)) })));
}

export interface Folder {
  hospital?: string;
  period?: string;
  category?: string;
}

/**
 * Metin ekler. `id` verilirse aynı dosyanın devamıdır (büyük metin dosyaları parça parça gelir).
 */
export async function addText(name: string, text: string, opts: { id?: string; size?: number } & Folder = {}) {
  const [files, cats] = await Promise.all([listFiles(), listCategories()]);
  let f = opts.id ? files.find((x) => x.id === opts.id) : undefined;
  // devam parçası: tablonun başlığı ilk parçadan gelir
  const header = f?.header;
  if (!f) {
    const folder = checkFolder(opts, cats);
    f = { id: uid(), name: name.slice(0, 160), kind: extOf(name), size: opts.size ?? text.length, chars: 0, parts: 0, uploadedAt: new Date().toISOString(), ...folder };
    if (f.kind === "csv" || f.kind === "tsv") f.header = text.replace(/\r\n?/g, "\n").split("\n")[0].slice(0, 2000);
    files.unshift(f);
  }
  const n = await store_(f, cats, text, f.parts, header);
  f.parts += n;
  f.chars += text.length;
  await saveFiles(files);
  await writeDataFile();
  return f;
}

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
export async function addBinary(name: string, buf: Buffer, folder: Folder, budgetMs = 50000) {
  const kind = extOf(name);
  if (!BIN_EXT.includes(kind)) throw new UserError(`Desteklenmeyen dosya türü: .${kind}. Desteklenenler: ${[...TEXT_EXT, ...BIN_EXT].join(", ")} (eski .xls/.doc dosyalarını yeni biçimde kaydet).`);
  if (buf.length > MAX_BYTES) throw new UserError("Dosya 4 MB'tan büyük. Google Drive'a koy (arşiv okur) ya da Excel'i CSV olarak kaydedip yükle.");
  checkFolder(folder, await listCategories());
  let text = "";
  let partial = false;
  if (kind === "pdf") ({ text, partial } = await pdfText(buf, budgetMs));
  else text = officeText(buf, kind as "docx" | "xlsx" | "pptx");
  if (!text.trim()) throw new UserError("Dosyadan metin çıkarılamadı (boş ya da taranmış görüntü olabilir).");
  const f = await addText(name, text, { size: buf.length, ...folder });
  if (partial) {
    const files = await listFiles();
    const x = files.find((y) => y.id === f.id);
    if (x) {
      x.partial = true;
      await saveFiles(files);
    }
    f.partial = true;
  }
  if (TABLE_KINDS.includes(kind)) return profileFile(f.id).catch(() => f);
  return f;
}

const TABLE_KINDS = ["csv", "tsv", "xlsx"];
/** Dosyanın arşivdeki tam metni (parçalar sırayla) */
export async function fileText(f: KurumFile) {
  const items = (await itemsByPrefix("kurum", `${f.id}#`)).sort((a, b) => Number(a.meta?.part ?? 0) - Number(b.meta?.part ?? 0));
  return items.map((x) => x.body).join("\n");
}
/** Tablo dosyasında hangi ayların olduğunu kodla sayar (yükleme bitince bir kez; klasörde ve beyinde görünür) */
export async function profileFile(id: string) {
  const files = await listFiles();
  const f = files.find((x) => x.id === id);
  if (!f) throw new UserError("Dosya bulunamadı");
  if (!TABLE_KINDS.includes(f.kind)) return f;
  const c = coverageOf(await fileText(f), f.kind, f.name);
  f.coverage = { months: c.months, rows: c.rows, dated: c.dated };
  await saveFiles(files);
  await writeDataFile();
  return f;
}

/** Dosyayı başka klasöre taşır */
export async function moveFile(id: string, folder: Folder) {
  const [files, cats] = await Promise.all([listFiles(), listCategories()]);
  const f = files.find((x) => x.id === id);
  if (!f) throw new UserError("Dosya bulunamadı");
  Object.assign(f, checkFolder({ hospital: folder.hospital ?? f.hospital, period: folder.period ?? f.period, category: folder.category ?? f.category }, cats));
  await saveFiles(files);
  await retag(f, cats);
  await writeDataFile();
  return f;
}

export async function removeFile(id: string) {
  await removeByPrefix("kurum", `${id}#`);
  await saveFiles((await listFiles()).filter((x) => x.id !== id));
  await writeDataFile();
}

/** Arayüz için: dosyalar, kategoriler, eğitim birimleri */
export async function kurumView() {
  const [files, categories, notes] = await Promise.all([listFiles(), listCategories(), readNotes()]);
  return { files, categories, units: unitsOf(files, notes), running: !!(notes.running && notes.running > Date.now()), log: notes.log.slice(0, 6), hospitals: KURUM_HOSPITALS };
}

export { hospitalLabel, periodText };
