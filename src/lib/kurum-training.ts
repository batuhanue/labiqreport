import "server-only";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { brainBlocks } from "./brain-prompt";
import { addUsage, ASSISTANT_MODEL, claude, claudeConfigured, logUsage, newUsage, type Usage } from "./claude";
import { fileText, listCategories, listFiles, readNotes, saveNotes, sigOf, writeDataFile, type UnitNotes } from "./kurum";
import { folderText, periodMonths, periodText, rangeMonths, unitKey, type KurumCategory, type KurumFile } from "./kurum-types";
import { profileTable, profileText, tablesFromText } from "./tables";
import { addQuestions } from "./training";
import { UserError } from "./api";

/*
 * Şirket verisinden seçmeli eğitim: Batuhan "Başakşehir · 2026 Ekim'i öğren" ya da "Başakşehir · 2026 Ekim ·
 * Arıza'yı öğren" der; beyin yalnızca o klasör(ler)deki dosyaları okur, her klasör (hastane · dönem · kategori)
 * için ne anlattığını, önemli bulguları ve dikkat noktalarını çıkarır. Öğrenilen klasör ✓ olur; dosyaları sonra
 * değişirse "güncellenmeli"ye döner. Öğrenilenler bilgi dosyası sirket-verisi.md'ye yazılır.
 */

const CORPUS = 150_000;

const UNIT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "bu klasördeki dosyalar ne anlatıyor (2-4 cümle; ne tür kayıt, hangi dönem/hastane, genel tablo)" },
    facts: { type: "array", items: { type: "string" }, description: "Batuhan'ın işine yarayacak somut bulgular, rakamlar, örüntüler, tekrarlayan kalemler (en çok 12)" },
    risks: { type: "array", items: { type: "string" }, description: "dikkat edilmesi gereken sorunlar, sapmalar, eksikler (en çok 6)" },
    months: {
      type: "array",
      description: "ÇOK AYLI dönemde her ay için bir kısa not (o ayın rakamlarıyla; verisi yoksa 'veri yok'). Tek aylık ya da dönemsiz klasörde boş dizi.",
      items: { type: "object", properties: { month: { type: "string", description: "YYYY-AA" }, note: { type: "string" } }, required: ["month", "note"], additionalProperties: false },
    },
    questions: {
      type: "array",
      description: "dosyalardan anlaşılamayan, Batuhan'a sorulması gereken önemli noktalar (en çok 2)",
      items: { type: "object", properties: { q: { type: "string" }, why: { type: "string" } }, required: ["q", "why"], additionalProperties: false },
    },
  },
  required: ["summary", "facts", "risks", "months", "questions"],
  additionalProperties: false,
} as const;

/** Uzun metinden baş, orta ve son kısımlardan satır sınırında örnek (yalnızca baştan kesmek son ayları hiç göstermez) */
function spread(text: string, max: number, header?: string) {
  if (text.length <= max) return { text, cut: false };
  const k = 4;
  const w = Math.floor(max / k);
  const parts: string[] = [];
  let last = 0;
  for (let i = 0; i < k; i++) {
    let a = Math.floor(((text.length - w) * i) / (k - 1));
    if (i) a = text.indexOf("\n", a) + 1 || a;
    let b = Math.min(text.length, a + w);
    if (b < text.length) b = text.lastIndexOf("\n", b) > a ? text.lastIndexOf("\n", b) : b;
    if (a > last) parts.push(`…(arada ${(a - last).toLocaleString("tr-TR")} karakter atlandı; satır sayısı ve toplamlar ÖN HESAP'ta)…${header && i ? `\n${header}` : ""}`);
    parts.push(text.slice(a, b));
    last = b;
  }
  if (last < text.length) parts.push(`…(son ${(text.length - last).toLocaleString("tr-TR")} karakter atlandı)…`);
  return { text: parts.join("\n"), cut: true };
}

/** Klasörün okunacak metni: önce kodla hesaplanan ÖN HESAP (tablolar), sonra dosyaların metni */
async function corpus(files: KurumFile[], period: string) {
  const per = Math.max(8000, Math.floor(CORPUS / Math.max(1, files.length)));
  const expected = periodMonths(period);
  let partial = false;
  const pre: string[] = [];
  const parts: string[] = [];
  for (const f of files) {
    const full = await fileText(f);
    const tables = tablesFromText(full, f.kind, f.name).slice(0, 8);
    if (tables.length) pre.push(`### ÖN HESAP — ${f.name}\n${tables.map((t) => profileText(profileTable(t), expected)).join("\n\n")}`);
    const { text, cut } = spread(full, per, f.kind === "csv" || f.kind === "tsv" ? full.split("\n", 1)[0] : undefined);
    if (cut) partial = true;
    parts.push(`### DOSYA: ${f.name} (${f.kind}, ${f.chars.toLocaleString("tr-TR")} karakter${cut ? ", uzun: baş/orta/son bölümleri" : ""})\n${text}`);
  }
  return { text: [pre.length ? `## ÖN HESAP (kodla tüm satırlardan kesin hesaplandı — satır sayısı, aylar ve toplamlarda buna güven)\n${pre.join("\n\n")}` : "", `## DOSYALAR\n${parts.join("\n\n")}`].filter(Boolean).join("\n\n"), partial };
}

async function learnUnit(files: KurumFile[], cats: KurumCategory[], u: Usage, timeout: number) {
  const f0 = files[0];
  const cat = cats.find((c) => c.id === f0.category);
  const folder = folderText(f0.hospital, f0.period, cat?.name ?? "");
  const c = await corpus(files, f0.period);
  const n = rangeMonths(f0.period);
  const res = await claude().messages.parse(
    {
      model: ASSISTANT_MODEL,
      max_tokens: 6000,
      system: await brainBlocks(),
      output_config: { effort: "medium", format: jsonSchemaOutputFormat(UNIT_SCHEMA) },
      messages: [
        {
          role: "user",
          content: `ŞU AN: Şirket verisi eğitimi — ${folder}.
Kategori: ${cat ? `${cat.name}${cat.description ? ` — ${cat.description.replace(/[.\s]+$/, "")}` : ""}` : "kategorisiz"}.
${
            n
              ? `DÖNEM ÇOK AYLI: ${periodText(f0.period)} — ${n} ay (${periodMonths(f0.period).join(", ")}). Dosyalar bu ayların verisini BİRLİKTE içerir.
- Ayları tarih/ay sütunundan ayır (ÖN HESAP'taki ay tablosu hazır); bir rakamı hangi aya ait olduğunu bilmeden tek aya yazma, dönem toplamını tek ay sanma.
- "months" alanına dönemin HER ayı için bir not yaz (o ayın satır sayısı/toplamları, öne çıkan şey); verisi olmayan ay için "veri yok" yaz ve risks'e ekle.
- Aylar arası farkı, artış/azalışı ve sıra dışı ayı facts'te belirt.`
              : `Dönem: ${periodText(f0.period)}.`
          }
Aşağıda bu klasördeki ${files.length} dosya var. Batuhan'ın işi açısından ne anlattıklarını öğren: genel tablo, somut bulgular ve rakamlar, tekrarlayan örüntüler, dikkat edilmesi gereken sapmalar. Kategori tanımını ve bilgi dosyalarını (iş tanımı, kontrol yöntemleri, iş bilgisi) kullanarak yorumla.
DİKKATLİ OKU: önce her dosyanın yapısını anla (sayfalar/sekmeler, başlık satırı, her sütunun anlamı ve birimi, toplam ve ara toplam satırları), sonra rakamlara geç. Toplam satırlarını yeniden toplama; adet, TL, test sayısı gibi birimleri karıştırma; kod/barkod/protokol sütunlarını miktar sanma. Satır sayısı, aylar ve toplamlarda ÖN HESAP'a güven (dosya metninin yalnızca bir kısmını görüyor olabilirsin); ön hesapla dosya metni çelişirse bunu risks'e yaz. Dosyada olmayan ayı ya da rakamı tahmin etme.
Kurallar: yalnızca dosyada olanı yaz, uydurma; rakamları dosyadaki gibi aktar; kişileri zan altında bırakma; kişisel veri yerine iş bilgisini yaz.

${c.text}`,
        },
      ],
    },
    { timeout },
  );
  addUsage(u, res);
  if (res.stop_reason === "refusal" || !res.parsed_output) return null;
  const o = res.parsed_output;
  const months = n ? (o.months ?? []).filter((m) => /^\d{4}-\d{2}$/.test(m.month) && m.note.trim()).slice(0, 36) : [];
  const notes: UnitNotes = { at: new Date().toISOString(), sig: sigOf(files), summary: o.summary.trim(), facts: o.facts.slice(0, 12), risks: o.risks.slice(0, 6), months: months.length ? months : undefined, partial: c.partial || undefined };
  return { notes, questions: o.questions.slice(0, 2), folder };
}

/**
 * Seçilen kapsamdaki öğrenilmemiş/değişmiş klasörleri sırayla öğrenir (süre bütçeli, kaldığı yerden devam).
 * category verilmezse o hastanenin o dönemindeki tüm kategoriler.
 */
export async function trainKurum(scope: { hospital: string; period: string; category?: string }, opts: { budgetMs?: number; force?: boolean } = {}) {
  if (!claudeConfigured()) throw new Error("ANTHROPIC_API_KEY tanımlı değil");
  const budget = opts.budgetMs ?? 50000;
  const t0 = Date.now();
  const left = () => budget - (Date.now() - t0);
  const [files, cats, notes] = await Promise.all([listFiles(), listCategories(), readNotes()]);
  if (notes.running && notes.running > Date.now()) return { busy: true as const, did: [], remaining: 0 };
  const inScope = files.filter((f) => f.hospital === scope.hospital && f.period === scope.period && (scope.category == null || f.category === scope.category));
  if (!inScope.length) throw new UserError("Bu klasörde dosya yok");
  const groups = new Map<string, KurumFile[]>();
  for (const f of inScope) {
    const k = unitKey(f.hospital, f.period, f.category);
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const todo = [...groups.entries()].filter(([k, fs]) => opts.force || !notes.units[k] || notes.units[k].sig !== sigOf(fs));
  notes.running = Date.now() + budget + 15000;
  await saveNotes(notes);
  const u = newUsage();
  let rounds = 0;
  const did: string[] = [];
  let error: string | undefined;
  let done = 0;
  try {
    for (const [k, fs] of todo) {
      if (left() < 20000) break;
      const r = await learnUnit(fs, cats, u, Math.min(55000, left() - 4000));
      rounds++;
      if (!r) continue;
      notes.units[k] = r.notes;
      done++;
      did.push(r.folder);
      if (r.questions.length) await addQuestions(r.questions.map((q) => ({ ...q, why: `${r.folder}: ${q.why}` }))).catch(() => {});
      await saveNotes({ ...(await readNotes()), units: { ...(await readNotes()).units, [k]: r.notes } });
    }
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 240) : String(e);
  } finally {
    const cost = await logUsage("🏢 Şirket verisi eğitimi", u, { t0, rounds, error });
    const cur = await readNotes();
    cur.units = { ...cur.units, ...notes.units };
    cur.running = undefined;
    cur.log = [{ at: new Date().toISOString(), did, ms: Date.now() - t0, cost, error }, ...cur.log].slice(0, 20);
    await saveNotes(cur);
    if (did.length) await writeDataFile().catch(() => {});
  }
  return { did, remaining: todo.length - done, error };
}

/** Öğrenileni unut (klasör "öğrenilmedi"ye döner) */
export async function forgetKurum(key: string) {
  const notes = await readNotes();
  delete notes.units[key];
  await saveNotes(notes);
  await writeDataFile();
}
