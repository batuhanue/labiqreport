import "server-only";
import webpush from "web-push";
import { store, type StoredSub } from "./db";
import { buildMessages, DEFAULT_PREFS, type NotifyMessage, type NotifyPrefs } from "./notify";
import type { TodoStore } from "./todo";
import { getSnapshot, status as googleStatus, sync as googleSync } from "./google";

const pub = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const priv = process.env.VAPID_PRIVATE_KEY || "";

/**
 * VAPID "sub": Apple (iPhone/iPad) yalnızca düz `mailto:ad@alan` ya da https adresi kabul eder; boşluk, <> ya da
 * yer tutucu/yerel adres görürse 403 BadJwtToken döner (masaüstü Chrome/Firefox umursamaz). Yazılanı düzeltir,
 * geçersizse sitenin kendi adresine düşer.
 */
export function vapidSubject(raw = process.env.VAPID_SUBJECT, site = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL) {
  const fallback = site ? `https://${site.replace(/^https?:\/\//, "")}` : "mailto:admin@example.com";
  let v = (raw ?? "").trim().replace(/[<>\s]/g, "");
  if (!v) return fallback;
  if (/^[^@:/]+@[^@]+$/.test(v)) v = `mailto:${v}`;
  const bad = /localhost|\.local\b|example\.(com|org|net)|127\.0\.0\.1/i.test(v);
  if (bad || !/^(mailto:[^@]+@[^@]+\.[a-z]{2,}|https:\/\/[^/]+\.[a-z]{2,})/i.test(v)) return fallback;
  return v;
}
const subject = vapidSubject();

export const pushConfigured = () => !!(pub && priv);
export const publicKey = () => pub;

let configured = false;
function ensure() {
  if (!pushConfigured()) throw new Error("Push anahtarları tanımlı değil (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).");
  if (!configured) {
    webpush.setVapidDetails(subject, pub, priv);
    configured = true;
  }
}

export async function getPrefs(): Promise<NotifyPrefs> {
  return { ...DEFAULT_PREFS, ...((await store().getKV<NotifyPrefs>("notify")) ?? {}) };
}

/** Push servisinin adı (uç noktadan) */
export function pushService(endpoint: string) {
  const h = (() => {
    try {
      return new URL(endpoint).host;
    } catch {
      return "";
    }
  })();
  return /apple\.com$/.test(h) ? "Apple" : /googleapis\.com$|google\.com$/.test(h) ? "Google" : /mozilla/.test(h) ? "Mozilla" : /windows|microsoft/.test(h) ? "Microsoft" : h || "?";
}

/** Servisin döndürdüğü hatayı okunur kısa cümleye çevirir (ör. Apple: {"reason":"BadJwtToken"}) */
function pushError(e: unknown) {
  const x = e as { statusCode?: number; body?: string; message?: string };
  let reason = "";
  try {
    reason = JSON.parse(x.body ?? "").reason ?? "";
  } catch {
    reason = (x.body ?? "").trim().slice(0, 120);
  }
  const hint = /BadJwtToken/i.test(reason) ? " — VAPID_SUBJECT geçerli bir mailto: ya da https adresi olmalı" : /VapidPkHashMismatch|mismatch/i.test(reason) ? " — VAPID anahtarı değişmiş; bu cihazda bildirimleri kapatıp yeniden aç" : "";
  return `${x.statusCode ?? ""} ${reason || x.message || "bilinmeyen hata"}${hint}`.trim();
}

/**
 * Kayıtlı cihazlara gönderir; geçersizleşen abonelikleri siler, her cihazın son gönderim sonucunu saklar.
 * Bildirimler her zaman "high": telefonlar (iOS/Android) normal öncelikli push'u uyku modunda saatlerce bekletebiliyor.
 */
export async function sendToAll(messages: NotifyMessage[], only?: string) {
  ensure();
  const s = store();
  const subs = (await s.listSubs()).filter((x) => !only || x.endpoint === only);
  if (only && !subs.length) throw new Error("Bu cihazın aboneliği sunucuda yok; bildirimleri kapatıp yeniden aç.");
  let sent = 0;
  const failed: string[] = [];
  for (const sub of subs) {
    let error: string | null = null;
    for (const m of messages) {
      try {
        await webpush.sendNotification(sub as StoredSub, JSON.stringify(m), { TTL: 60 * 60 * 12, urgency: "high" });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await s.removeSub(sub.endpoint);
          error = "gone";
        } else {
          error = pushError(e);
          failed.push(`${sub.device}: ${error}`);
        }
        break;
      }
    }
    if (error !== "gone" && messages.length) {
      const at = new Date().toISOString();
      await s.addSub(error ? { ...sub, lastError: error, lastErrorAt: at } : { ...sub, lastOk: at, lastError: undefined, lastErrorAt: undefined }).catch(() => {});
    }
  }
  return { devices: subs.length, sent, failed };
}

/** Günlük cron: aktif dönem için bugünün hatırlatmalarını gönderir. */
export async function runDaily(opts: { dry?: boolean; today?: Date; extra?: NotifyMessage[] } = {}) {
  const s = store();
  const prefs = await getPrefs();
  const { activePeriod } = await s.getState();
  const data = activePeriod ? await s.getPeriod(activePeriod) : null;
  const todos = (await s.getKV<TodoStore>("todos"))?.todos ?? [];
  // Google bağlıysa önce senkronla (sabah verisi taze olsun); hata bildirimleri engellemez
  let events = (await getSnapshot().catch(() => null))?.calendar.items;
  if ((await googleStatus("", false).catch(() => null))?.connected) {
    events = (await googleSync({ force: true }).catch(() => null))?.calendar.items ?? events;
  }
  // beynin sabah brifingi en üstte
  const messages = [...(opts.extra ?? []), ...buildMessages(data, prefs, { today: opts.today, activePeriod, todos, events })];
  if (opts.dry || messages.length === 0 || !pushConfigured()) return { messages, result: null };
  return { messages, result: await sendToAll(messages) };
}
