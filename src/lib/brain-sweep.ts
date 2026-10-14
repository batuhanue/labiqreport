import "server-only";
import { getItem, listByLink, mailThread } from "./archive";
import type { BrainItem } from "./brain-types";

/*
 * Beyin temizliği — kullanıcı uygulamayı kontrol etmek zorunda kalmasın:
 *  1) Yarıda kalan iş: "çalışıyor" 5 dk'yı geçtiyse (sunucu zaman aşımına uğradı) bir kez yeniden sıraya alınır,
 *     yine kalırsa açıkça "yarıda kaldı" hatası olur. 36 saattir sırada bekleyen hazırlık düşer.
 *  2) Bitenler kendiliğinden kapanır (gerekçesiyle, geri açılabilir):
 *     kaynak e-posta yazışmasına Batuhan yanıt yazdı · kaynak sohbete yazdı · hazırlık yapılan toplantı geçti ·
 *     onaylanan teslimat · 7 gündür dokunulmayan öneri (eskidi).
 * Arşiv sorguları pahalı olduğundan kanıt taraması en çok 10 dakikada bir yapılır.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const isOpen = (x: BrainItem) => x.status !== "done" && x.status !== "dismissed";
const short = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "Europe/Istanbul" });

export interface SweepOut {
  changed: boolean;
  closed: { id: string; title: string; reason: string }[];
  recovered: number;
}

function close(it: BrainItem, reason: string, now: Date, out: SweepOut) {
  it.status = "done";
  it.closed = { at: now.toISOString(), reason };
  if (it.work && (it.work.status === "queued" || it.work.status === "running")) it.work = it.work.output ? { ...it.work, status: "ready" } : undefined;
  it.updatedAt = now.toISOString();
  out.closed.push({ id: it.id, title: it.title, reason });
  out.changed = true;
}

/** Yarıda kalan / takılan işler (ucuz, her çağrıda) */
export function sweepWork(items: BrainItem[], now = new Date(), out: SweepOut = { changed: false, closed: [], recovered: 0 }) {
  for (const it of items) {
    const w = it.work;
    if (!w) continue;
    const age = now.getTime() - Date.parse(w.at);
    if (!isOpen(it) && (w.status === "queued" || w.status === "running")) {
      it.work = w.output ? { ...w, status: "ready" } : undefined;
      out.changed = true;
    } else if (w.status === "running" && age > 5 * MIN) {
      if ((w.attempts ?? 0) < 1) {
        it.work = { ...w, status: "queued", attempts: (w.attempts ?? 0) + 1, at: now.toISOString() };
      } else {
        it.work = { ...w, status: "error", error: "Yarıda kaldı (sunucu süresi doldu). Tekrar dene ya da gerek yok de." };
      }
      out.recovered++;
      out.changed = true;
    } else if (w.status === "queued" && age > 36 * HOUR) {
      it.work = w.output ? { ...w, status: "ready" } : undefined;
      out.recovered++;
      out.changed = true;
    }
  }
  return out;
}

/** Bitenleri kanıta göre kapatır (arşiv sorguları) */
export async function sweepDone(items: BrainItem[], opts: { now?: Date; budgetMs?: number } = {}) {
  const now = opts.now ?? new Date();
  const deadline = Date.now() + (opts.budgetMs ?? 4000);
  const out = sweepWork(items, now);
  const threadCache = new Map<string, string | undefined>();
  for (const it of items) {
    if (!isOpen(it) || Date.now() > deadline) continue;
    const created = it.createdAt;
    // onaylanan teslimat 3 gün sonra kapanır
    if (it.work?.status === "approved" && now.getTime() - Date.parse(it.work.at) > 3 * DAY) {
      close(it, "Teslimatı onaylamıştın", now, out);
      continue;
    }
    // hazırlık yapılan toplantı geçti
    const cal = it.sources.find((s) => s.agent === "takvim" || s.signalId.startsWith("cal:"));
    if (it.kind === "toplanti" && cal && Date.parse(cal.ts) + 2 * HOUR < now.getTime()) {
      close(it, `Toplantı geçti (${short(cal.ts)})`, now, out);
      continue;
    }
    // yanıt bekleyen gönderimler zaten takipte (checkFollowUps)
    if (it.followUp) continue;
    // kaynak e-posta yazışmasına Batuhan yanıt yazdı
    const mail = it.sources.find((s) => s.ref?.source === "gmail");
    if (mail?.ref) {
      let th = threadCache.get(mail.ref.id);
      if (!threadCache.has(mail.ref.id)) {
        th = String((await getItem("gmail", mail.ref.id).catch(() => null))?.meta?.threadId ?? "") || undefined;
        threadCache.set(mail.ref.id, th);
      }
      if (th) {
        const sent = (await mailThread(th, 20, 0).catch(() => [])).filter((x) => x.meta?.sent === true && x.ts > created);
        if (sent.length) {
          close(it, `E-postayı yanıtladın (${short(sent[0].ts)})`, now, out);
          continue;
        }
      }
    }
    // kaynak sohbete Batuhan yazdı
    const chat = it.sources.find((s) => s.agent === "sohbet" && s.link);
    if (chat?.link) {
      const mine = (await listByLink("chat", chat.link, undefined, 30).catch(() => [])).filter((x) => x.meta?.mine === true && x.ts > created);
      if (mine.length) {
        close(it, `Sohbette yanıtladın (${short(mine[0].ts)})`, now, out);
        continue;
      }
    }
    // dokunulmayan öneri eskidi
    if (it.status === "inbox" && !it.snoozeUntil && now.getTime() - Date.parse(it.updatedAt) > 7 * DAY) {
      it.status = "dismissed";
      it.closed = { at: now.toISOString(), reason: "7 gündür bekleyen öneri eskidi" };
      it.updatedAt = now.toISOString();
      out.closed.push({ id: it.id, title: it.title, reason: it.closed.reason });
      out.changed = true;
    }
  }
  return out;
}
