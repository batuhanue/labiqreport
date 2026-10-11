import "server-only";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { itemsByPrefix } from "./archive";
import { brainBlocks } from "./brain-prompt";
import { addUsage, ASSISTANT_MODEL, claude, claudeConfigured, logUsage, newUsage, type Usage } from "./claude";
import { listCategories, listFiles, readNotes, saveNotes, sigOf, writeDataFile, type UnitNotes } from "./kurum";
import { folderText, unitKey, type KurumCategory, type KurumFile } from "./kurum-types";
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
    questions: {
      type: "array",
      description: "dosyalardan anlaşılamayan, Batuhan'a sorulması gereken önemli noktalar (en çok 2)",
      items: { type: "object", properties: { q: { type: "string" }, why: { type: "string" } }, required: ["q", "why"], additionalProperties: false },
    },
  },
  required: ["summary", "facts", "risks", "questions"],
  additionalProperties: false,
} as const;

async function corpus(files: KurumFile[]) {
  const per = Math.max(8000, Math.floor(CORPUS / Math.max(1, files.length)));
  let partial = false;
  const parts: string[] = [];
  for (const f of files) {
    const items = (await itemsByPrefix("kurum", `${f.id}#`)).sort((a, b) => Number(a.meta?.part ?? 0) - Number(b.meta?.part ?? 0));
    let text = items.map((x) => x.body).join("\n");
    if (text.length > per) {
      text = `${text.slice(0, per)}\n…(dosyanın devamı okunmadı)`;
      partial = true;
    }
    parts.push(`### DOSYA: ${f.name} (${f.kind}, ${f.chars.toLocaleString("tr-TR")} karakter)\n${text}`);
  }
  return { text: parts.join("\n\n"), partial };
}

async function learnUnit(files: KurumFile[], cats: KurumCategory[], u: Usage, timeout: number) {
  const f0 = files[0];
  const cat = cats.find((c) => c.id === f0.category);
  const folder = folderText(f0.hospital, f0.period, cat?.name ?? "");
  const c = await corpus(files);
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
Aşağıda bu klasördeki ${files.length} dosyanın metni var. Batuhan'ın işi açısından ne anlattıklarını öğren: genel tablo, somut bulgular ve rakamlar, tekrarlayan örüntüler, dikkat edilmesi gereken sapmalar. Kategori tanımını ve bilgi dosyalarını (iş tanımı, kontrol yöntemleri, iş bilgisi) kullanarak yorumla.
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
  const notes: UnitNotes = { at: new Date().toISOString(), sig: sigOf(files), summary: o.summary.trim(), facts: o.facts.slice(0, 12), risks: o.risks.slice(0, 6), partial: c.partial || undefined };
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
