import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { store } from "./db";

/**
 * Asistanın model katmanı: Anthropic Claude (Messages API, resmi TypeScript SDK).
 * Model ANTHROPIC_MODEL ile değiştirilebilir (varsayılan Claude Haiku 5.5); ileride daha güçlü modele geçmek tek ayar.
 */
export const ASSISTANT_MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-5-5";

export const claudeConfigured = () => !!process.env.ANTHROPIC_API_KEY?.trim();

let client: Anthropic | null = null;
/**
 * SDK 429/529/5xx ve bağlantı hatalarını kendisi yeniden dener. Varsayılan süre 50 sn (rotalar 60 sn);
 * kısa sürmesi gereken çağrılar (ör. LabIQ ajanı) istek başına kendi `timeout`unu verir.
 * 12 sn varsayılan beyin, eğitim ve asistan çağrılarını yarıda kesiyordu.
 */
export function claude() {
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim(), maxRetries: 2, timeout: 50_000 });
  return client;
}

/** Geçici (yeniden denenebilir) hata mı: hız sınırı, aşırı yük, sunucu hatası, bağlantı. */
export const isTransient = (e: unknown) =>
  e instanceof Anthropic.APIConnectionError ||
  (e instanceof Anthropic.APIError && (e.status === 429 || e.status === 529 || (typeof e.status === "number" && e.status >= 500))) ||
  /overloaded|rate.?limit/i.test(String((e as Error)?.message ?? ""));

/** API hata gövdesindeki asıl açıklama ("400 {json}" yerine yalnızca mesaj). */
function apiMessage(e: InstanceType<typeof Anthropic.APIError>) {
  const body = e.error as { error?: { message?: string } } | undefined;
  return body?.error?.message || e.message;
}

/** Kullanıcıya gösterilecek kısa hata metni. */
export function friendlyError(e: unknown) {
  if (e instanceof Anthropic.AuthenticationError) return "Anthropic API anahtarı geçersiz (401). Vercel'de ANTHROPIC_API_KEY'i kontrol edip yeniden dağıt.";
  if (e instanceof Anthropic.PermissionDeniedError) return "Bu anahtarın modele erişim izni yok (403). Anthropic Console'da anahtarın çalışma alanını kontrol et.";
  if (e instanceof Anthropic.NotFoundError) return `Model bulunamadı (404): ${ASSISTANT_MODEL}. Vercel'de ANTHROPIC_MODEL'i kontrol et.`;
  if (e instanceof Anthropic.RateLimitError) return "Anthropic hız sınırına ulaşıldı (429). Biraz bekleyip “Tekrar dene”ye bas.";
  if (e instanceof Anthropic.APIConnectionError) return "Anthropic'e bağlanılamadı (ağ/zaman aşımı). Tekrar dene.";
  if (e instanceof Anthropic.APIError && (e.status === 529 || (e.status ?? 0) >= 500)) return `Claude şu an çok yoğun (${e.status}); birkaç deneme yanıt vermedi. Biraz sonra “Tekrar dene”ye bas.`;
  if (e instanceof Anthropic.BadRequestError) {
    const msg = apiMessage(e);
    if (/credit balance/i.test(msg)) return "Anthropic hesabında kredi yok (400). Console → Billing'den kredi yükleyip tekrar dene.";
    return `İstek reddedildi (400): ${msg.slice(0, 500)}`;
  }
  return `Claude hatası: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`;
}

// ------------------------------------------------------------------ fiyat (USD / 1M token, Anthropic birinci taraf API)
const PRICES: Record<string, { in: number; out: number; read: number }> = {
  "claude-3-5-haiku-20241022": { in: 0.8, out: 4.0, read: 0.08 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, read: 0.1 },
  "claude-sonnet-5-5": { in: 2, out: 10, read: 0.1 },
  "claude-3-5-sonnet-20241022": { in: 3, out: 15, read: 0.3 },
  "claude-opus-5-5": { in: 4, out: 20, read: 0.05 },
  "claude-fable-5-1": { in: 10, out: 50, read: 0.025 },
};
/** Tahmini maliyet: önbellek okuması ×read, önbellek yazımı 5 dk ×1.25 / 1 sa ×2. Bilinmeyen modelde null. */
export function costUsd(model: string, u: { input: number; cacheRead: number; cacheWrite: number; cacheWrite1h?: number; output: number }) {
  const p = PRICES[model];
  if (!p) return null;
  const w1h = Math.min(u.cacheWrite1h ?? 0, u.cacheWrite);
  return (u.input * p.in + u.cacheRead * p.in * p.read + (u.cacheWrite - w1h) * p.in * 1.25 + w1h * p.in * 2 + u.output * p.out) / 1_000_000;
}

// ------------------------------------------------------------------ kullanım kaydı
const USAGE_KV = "assistant-usage-claude";
export interface UsageEntry {
  at: string;
  model: string;
  rounds: number;
  /** toplam giriş = önbelleksiz + önbellekten okunan + önbelleğe yazılan */
  prompt: number;
  cached: number;
  written: number;
  output: number;
  cost: number | null;
  ms: number;
  error?: string;
  retries?: number;
  ctxChars?: number;
  /** asistan dışındaki kullanım (ör. "🧠 Beyin") */
  label?: string;
}
interface DayAgg {
  requests: number;
  prompt: number;
  cached: number;
  output: number;
  cost: number;
  errors: number;
}
export interface UsageLog {
  days: Record<string, DayAgg>;
  recent: UsageEntry[];
}

const istDay = (d = new Date()) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);

export async function recordUsage(e: UsageEntry) {
  try {
    const log = (await store().getKV<UsageLog>(USAGE_KV)) ?? { days: {}, recent: [] };
    const d = (log.days[istDay()] ??= { requests: 0, prompt: 0, cached: 0, output: 0, cost: 0, errors: 0 });
    d.requests++;
    d.prompt += e.prompt;
    d.cached += e.cached;
    d.output += e.output;
    d.cost += e.cost ?? 0;
    if (e.error) d.errors++;
    const keep = Object.keys(log.days).sort().slice(-60);
    log.days = Object.fromEntries(keep.map((x) => [x, log.days[x]]));
    log.recent = [e, ...log.recent].slice(0, 40);
    await store().setKV(USAGE_KV, log);
  } catch {}
}

export const getUsage = async () => (await store().getKV<UsageLog>(USAGE_KV)) ?? { days: {}, recent: [] };

// ------------------------------------------------------------------ ortak sayaç (beyin dışı işler: kişi haritası, eğitim, şirket verisi)
export type Usage = { input: number; cacheRead: number; cacheWrite: number; cacheWrite1h: number; output: number };
export const newUsage = (): Usage => ({ input: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0 });
export function addUsage(u: Usage, m: Anthropic.Message) {
  u.input += m.usage.input_tokens ?? 0;
  u.cacheRead += m.usage.cache_read_input_tokens ?? 0;
  u.cacheWrite += m.usage.cache_creation_input_tokens ?? 0;
  u.cacheWrite1h += m.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  u.output += m.usage.output_tokens ?? 0;
}
/** Kullanım günlüğüne yazar (çağrı yoksa yazmaz); tahmini maliyeti döndürür. */
export async function logUsage(label: string, u: Usage, o: { t0: number; rounds: number; error?: string }) {
  const cost = costUsd(ASSISTANT_MODEL, u);
  if (o.rounds)
    await recordUsage({
      at: new Date().toISOString(),
      model: ASSISTANT_MODEL,
      rounds: o.rounds,
      prompt: u.input + u.cacheRead + u.cacheWrite,
      cached: u.cacheRead,
      written: u.cacheWrite,
      output: u.output,
      cost,
      ms: Date.now() - o.t0,
      error: o.error,
      label,
    });
  return cost ?? 0;
}
