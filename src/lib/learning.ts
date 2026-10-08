import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { loadKnowledge, loadMemory, memoryPrompt, remember } from "./assistant";
import { brainSystem } from "./brain-prompt";
import { agentById, CHOICE_LABEL, type AgentId, type Choice, type LearningState, type LearnLog, type Lesson } from "./brain-types";
import { ASSISTANT_MODEL, claude, claudeConfigured, costUsd, recordUsage } from "./claude";
import { store } from "./db";

/*
 * Seçimlerden öğrenme:
 *  1) Kaydet — Batuhan'ın her seçimi (öneriye evet/hayır + sebep, öncelik/ajan/termin değişikliği, teslimat onayı
 *     ya da düzeltmesi, görev tamamlama/silme, asistan önerisini uygulama/gizleme) "choices" listesine düşer.
 *  2) Hemen kullan — ajanlar ve asistan son seçimleri her istekte görür (öğrenme beklemeden).
 *  3) Öğren — birkaç seçim birikince (sebep verilen seçimde hemen) Claude seçimlerden kalıcı tercihleri çıkarır
 *     ve belleğe (gelistirme.md) yazar; eskiyen tercihi günceller. Bellek elle düzenlenebilir.
 */

const CHOICES_KEY = "choices";
const LOG_KEY = "learning-log";
const LOCK_KEY = "learning-lock";
/** bu kadar öğrenilmemiş seçim birikince arka planda öğrenir */
export const LEARN_EVERY = 5;

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const one = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export const readChoices = async () => (await store().getKV<Choice[]>(CHOICES_KEY)) ?? [];

/** Seçimleri kaydeder; öğrenilmemiş seçim sayısını döndürür. */
export async function recordChoices(input: Omit<Choice, "id" | "at">[]) {
  const list = await readChoices();
  const at = new Date().toISOString();
  for (const c of input) {
    if (!c.title?.trim() || !CHOICE_LABEL[c.kind]) continue;
    const x: Choice = { id: uid(), at, kind: c.kind, where: c.where, title: one(c.title, 200) };
    if (c.agent && agentById(c.agent)) x.agent = c.agent;
    if (c.itemKind) x.itemKind = c.itemKind;
    if (c.auto) x.auto = true;
    if (c.detail?.trim()) x.detail = one(c.detail, 400);
    if (c.reason?.trim()) x.reason = one(c.reason, 400);
    // aynı şeyin hemen tekrarı (ör. çift tıklama) tek seçim sayılır
    const last = list[0];
    if (last && last.kind === x.kind && last.title === x.title && last.detail === x.detail && Date.now() - Date.parse(last.at) < 5000) {
      if (x.reason && !last.reason) last.reason = x.reason;
      continue;
    }
    list.unshift(x);
  }
  // öğrenilmişler 400'e kadar tutulur (ajanlara bağlam), öğrenilmemişler silinmez
  const pending = list.filter((c) => !c.learned);
  const learned = list.filter((c) => c.learned).slice(0, Math.max(0, 400 - pending.length));
  await store().setKV(CHOICES_KEY, [...pending, ...learned].sort((a, b) => b.at.localeCompare(a.at)));
  return pending.length;
}

const line = (c: Choice) =>
  `- ${c.at.slice(0, 10)} · ${c.where}${c.agent ? `/${agentById(c.agent)?.name ?? c.agent}` : ""} · ${CHOICE_LABEL[c.kind]}${c.auto ? " (ajanın kendi onayladığı iş)" : ""}: "${c.title}"${c.detail ? ` (${c.detail})` : ""}${c.reason ? ` — SEBEP: "${c.reason}"` : ""}`;

/** Ajanlara ve asistana verilen son seçimler (öğrenme beklemeden etkili olsun diye). */
export async function recentChoices(opts: { agent?: AgentId; limit?: number } = {}) {
  const list = await readChoices();
  const pick = (opts.agent ? list.filter((c) => c.agent === opts.agent || c.reason) : list).slice(0, opts.limit ?? 20);
  return pick.length ? pick.map(line).join("\n") : "";
}

export async function learningState(): Promise<LearningState> {
  const [list, log] = await Promise.all([readChoices(), store().getKV<LearnLog[]>(LOG_KEY)]);
  return { pending: list.filter((c) => !c.learned).length, total: list.length, log: (log ?? []).slice(0, 10) };
}

const LESSON_SCHEMA = {
  type: "object",
  properties: {
    lessons: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: 'Bellekteki başlık. Tercihen: "Benim işim / değil", "Öncelik ve zamanlama", "Ajanlar ve iş dağılımı", "Teslimat ve yazım tercihleri", "Çalışma biçimi" ya da BELLEK\'te zaten olan uygun başlık',
          },
          entry: { type: "string", description: "tek cümlelik, kendi başına anlaşılır, genelleştirilmiş tercih (ne + neden/ne zaman)" },
          replaces: { type: "string", description: "bu tercih BELLEK'teki bir maddeyi güncelliyor ya da onunla çelişiyorsa o maddenin metni; yoksa boş" },
        },
        required: ["topic", "entry", "replaces"],
        additionalProperties: false,
      },
    },
  },
  required: ["lessons"],
  additionalProperties: false,
} as const;

/**
 * Bekleyen seçimlerden kalıcı tercihleri çıkarıp belleğe yazar.
 * force: eşiği beklemeden (sebep verilen seçimde ya da "Şimdi öğren" ile).
 */
export async function learn(opts: { force?: boolean; timeout?: number } = {}): Promise<Lesson[] | null> {
  if (!claudeConfigured()) return null;
  const list = await readChoices();
  const pending = list.filter((c) => !c.learned);
  if (!pending.length || (!opts.force && pending.length < LEARN_EVERY)) return null;
  const lock = await store().getKV<number>(LOCK_KEY);
  if (lock && lock > Date.now()) return null;
  await store().setKV(LOCK_KEY, Date.now() + 60_000);
  const t0 = Date.now();
  const usage = { input: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0 };
  let lessons: Lesson[] = [];
  let error: string | undefined;
  try {
    const [knowledge, memory] = await Promise.all([loadKnowledge(), loadMemory()]);
    const system: Anthropic.TextBlockParam[] = [
      { type: "text", text: brainSystem(knowledge), cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: memoryPrompt(memory), cache_control: { type: "ephemeral", ttl: "1h" } },
    ];
    const batch = pending.slice(0, 40);
    const earlier = list.filter((c) => c.learned).slice(0, 40);
    const content = `ŞU AN: Öğrenme zamanı. Batuhan'ın uygulamadaki seçimlerinden onu tanı: hangi işler gerçekten onun işi, hangileri değil; neye öncelik veriyor; işleri hangi ajana/kime veriyor; teslimatlarda neyi beğenip neyi düzeltiyor; nasıl çalışıyor.

YENİ SEÇİMLER (değerlendirilecek):
${batch.map(line).join("\n")}

ÖNCEKİ SEÇİMLER (zaten değerlendirildi; örüntü görmek için):
${earlier.map(line).join("\n") || "(yok)"}

Kurallar:
- SEBEP yazılmış seçim güçlü sinyaldir: ondan genel bir tercih çıkar ("Benim işim değil" → bu tür işin kimin işi olduğunu/neden Batuhan'ın işi olmadığını genelleştir: kaynak, gönderen, konu türü).
- Sebepsiz tek bir seçimden tercih çıkarma; ancak aynı yönde en az 2 seçim (yeni + önceki) bir örüntü oluşturuyorsa ya da BELLEK'teki bir maddeyi doğruluyor/çürütüyorsa yaz.
- Maddeler genel olsun: tek bir e-postanın başlığını değil, işin türünü/kaynağını/kişisini anlat ("Muhasebe'nin CC'de olduğu fatura onay e-postaları Batuhan'ın işi değil; iş açma."). Kişi adı yalnızca tercihin parçasıysa yazılır.
- BELLEK'te ya da bilgi dosyalarındaki ajan-kurallari.md'de aynısı varsa yazma; değişmişse replaces ile güncelle; çelişiyorsa yeni seçimi esas al.
- Anlık durum (bu ayın rakamları, tek seferlik termin) yazma. Çıkarılacak kalıcı tercih yoksa boş liste döndür.`;
    const res = await claude().messages.parse(
      { model: ASSISTANT_MODEL, max_tokens: 3000, system, output_config: { effort: "low", format: jsonSchemaOutputFormat(LESSON_SCHEMA) }, messages: [{ role: "user", content }] },
      { timeout: opts.timeout ?? 40000 },
    );
    usage.input += res.usage.input_tokens ?? 0;
    usage.cacheRead += res.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += res.usage.cache_creation_input_tokens ?? 0;
    usage.cacheWrite1h += res.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    usage.output += res.usage.output_tokens ?? 0;
    const out = (res.parsed_output?.lessons ?? []).filter((l) => l.entry.trim()).slice(0, 8);
    for (const l of out) {
      const r = await remember({ topic: l.topic, entries: [l.entry], replaces: l.replaces.trim() ? [l.replaces] : [] });
      if (r.eklenen || r.degistirilen) lessons.push({ topic: r.topic, entry: l.entry.trim() });
    }
    // değerlendirilen seçimler öğrenildi sayılır (ham hâlleri ajanlara bağlam olarak kalır)
    const ids = new Set(batch.map((c) => c.id));
    const cur = await readChoices();
    for (const c of cur) if (ids.has(c.id)) c.learned = true;
    await store().setKV(CHOICES_KEY, cur);
    const log = (await store().getKV<LearnLog[]>(LOG_KEY)) ?? [];
    await store().setKV(LOG_KEY, [{ at: new Date().toISOString(), choices: batch.length, lessons }, ...log].slice(0, 30));
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 200) : String(e);
    lessons = [];
  } finally {
    await store().setKV(LOCK_KEY, 0);
    await recordUsage({
      at: new Date().toISOString(),
      model: ASSISTANT_MODEL,
      rounds: 1,
      prompt: usage.input + usage.cacheRead + usage.cacheWrite,
      cached: usage.cacheRead,
      written: usage.cacheWrite,
      output: usage.output,
      cost: costUsd(ASSISTANT_MODEL, usage),
      ms: Date.now() - t0,
      error,
      label: "🎓 Öğrenme",
    });
  }
  return error ? null : lessons;
}
