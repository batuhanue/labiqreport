import "server-only";
import webpush from "web-push";
import { store, type StoredSub } from "./db";
import { buildMessages, DEFAULT_PREFS, type NotifyMessage, type NotifyPrefs } from "./notify";
import type { TodoStore } from "./todo";
import { getSnapshot, status as googleStatus, sync as googleSync } from "./google";

const pub = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const priv = process.env.VAPID_PRIVATE_KEY || "";
const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

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

/** Tüm kayıtlı cihazlara gönderir; geçersizleşen abonelikleri siler. */
export async function sendToAll(messages: NotifyMessage[], only?: string) {
  ensure();
  const s = store();
  const subs = (await s.listSubs()).filter((x) => !only || x.endpoint === only);
  let sent = 0;
  const failed: string[] = [];
  for (const sub of subs) {
    for (const m of messages) {
      try {
        await webpush.sendNotification(sub as StoredSub, JSON.stringify(m), { TTL: 60 * 60 * 12, urgency: m.level === "alert" ? "high" : "normal" });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await s.removeSub(sub.endpoint);
        else failed.push(`${sub.device}: ${(e as Error).message}`);
        break;
      }
    }
  }
  return { devices: subs.length, sent, failed };
}

/** Günlük cron: aktif dönem için bugünün hatırlatmalarını gönderir. */
export async function runDaily(opts: { dry?: boolean; today?: Date } = {}) {
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
  const messages = buildMessages(data, prefs, { today: opts.today, activePeriod, todos, events });
  if (opts.dry || messages.length === 0 || !pushConfigured()) return { messages, result: null };
  return { messages, result: await sendToAll(messages) };
}
