/**
 * Beynin saf yardımcıları (sunucu ve istemci): İstanbul saati, boş saatler, iş günü hesabı,
 * gönderilen işlerin yanıt takibi ve kural tabanlı kararlar (yapay zekâ yokken ya da eksik bıraktığında).
 */
import type { BrainItem, Decision, PlanBlock } from "./brain-types";
import type { GEvent, GMail } from "./google-types";

const TZ = 3 * 3600_000; // TR: UTC+3, yaz saati yok

export const trDay = (d = new Date()) => new Date(d.getTime() + TZ).toISOString().slice(0, 10);
export const trHM = (d: Date) => new Date(d.getTime() + TZ).toISOString().slice(11, 16);
/** İstanbul günündeki saat → Date */
export const trAt = (day: string, hm: string) => new Date(`${day}T${hm}:00+03:00`);
export const addDays = (day: string, n: number) => trDay(new Date(trAt(day, "12:00").getTime() + n * 86400_000));

/** n iş günü sonrası (Cumartesi/Pazar atlanır) */
export function addWorkdays(day: string, n: number) {
  let d = day;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    const wd = trAt(d, "12:00").getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

export interface Meeting {
  id: string;
  title: string;
  start: Date;
  end: Date;
  who: string[];
}

/** O günün (İstanbul) kabul edilmiş/yanıtsız saatli toplantıları */
export function meetingsOn(events: GEvent[], day: string): Meeting[] {
  return events
    .filter((e) => !e.allDay && e.response !== "declined" && trDay(new Date(e.start)) === day)
    .map((e) => ({ id: e.id, title: e.title, start: new Date(e.start), end: new Date(e.end), who: e.attendees.map((a) => a.name || a.email).slice(0, 6) }))
    .sort((a, b) => +a.start - +b.start);
}

/** Mesai içindeki boş aralıklar (şu andan sonrası, en az `min` dakika) */
export function freeSlots(events: GEvent[], now = new Date(), opts: { from?: string; to?: string; min?: number } = {}) {
  const day = trDay(now);
  const dayStart = trAt(day, opts.from ?? "08:30");
  const dayEnd = trAt(day, opts.to ?? "18:30");
  const min = (opts.min ?? 30) * 60_000;
  let cursor = new Date(Math.max(+dayStart, Math.ceil(+now / (15 * 60_000)) * 15 * 60_000));
  const out: { start: Date; end: Date }[] = [];
  for (const m of meetingsOn(events, day)) {
    if (m.end <= cursor) continue;
    if (+m.start - +cursor >= min) out.push({ start: cursor, end: new Date(Math.min(+m.start, +dayEnd)) });
    if (m.end > cursor) cursor = m.end;
    if (cursor >= dayEnd) break;
  }
  if (+dayEnd - +cursor >= min) out.push({ start: cursor, end: dayEnd });
  return out.filter((s) => +s.end - +s.start >= min);
}

/** Plan bloklarını doğrula: boş aralıkların içine kırp, toplantıları ekle, sırala */
export function buildPlan(raw: { start: string; end: string; title: string; ref: string }[], events: GEvent[], validIds: Set<string>, now = new Date()): PlanBlock[] {
  const day = trDay(now);
  const slots = freeSlots(events, now, { min: 15 });
  const out: PlanBlock[] = meetingsOn(events, day)
    .filter((m) => m.end > now)
    .map((m) => ({ start: trHM(m.start), end: trHM(m.end), title: m.title, kind: "meeting" as const }));
  for (const b of raw) {
    if (!/^\d\d:\d\d$/.test(b.start) || !/^\d\d:\d\d$/.test(b.end) || !b.title.trim()) continue;
    let s = trAt(day, b.start);
    let e = trAt(day, b.end);
    const slot = slots.find((x) => s < x.end && e > x.start);
    if (!slot) continue;
    s = new Date(Math.max(+s, +slot.start));
    e = new Date(Math.min(+e, +slot.end));
    if (+e - +s < 15 * 60_000) continue;
    if (out.some((o) => o.kind === "focus" && trAt(day, o.start) < e && trAt(day, o.end) > s)) continue;
    out.push({ start: trHM(s), end: trHM(e), title: b.title.trim().slice(0, 120), kind: "focus", itemId: validIds.has(b.ref) ? b.ref : undefined });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Gönderilen işlerin yanıt takibi: aynı yazışmada (ya da yazışma bilinmiyorsa alıcıdan) yeni e-posta geldiyse
 * "yanıt geldi" (iş biter); termini geçtiyse hatırlatma adayı.
 */
export function checkFollowUps(items: BrainItem[], mails: GMail[], selfEmail?: string, now = new Date()) {
  const replied: BrainItem[] = [];
  const overdue: BrainItem[] = [];
  const self = selfEmail?.toLowerCase();
  for (const it of items) {
    const f = it.followUp;
    if (!f || f.replied || it.status !== "waiting") continue;
    const since = Date.parse(f.since);
    const to = f.to.map((x) => x.toLowerCase());
    const reply = mails
      .filter((m) => Date.parse(m.date) > since && m.fromEmail.toLowerCase() !== self)
      .filter((m) => (f.threadId ? m.threadId === f.threadId : to.includes(m.fromEmail.toLowerCase())))
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    if (reply) {
      f.replied = { at: reply.date, from: reply.from, snippet: reply.snippet.slice(0, 200) };
      it.status = "done";
      it.updatedAt = now.toISOString();
      replied.push(it);
    } else if (trDay(now) >= f.due && f.nudges < 2) overdue.push(it);
  }
  return { replied, overdue };
}

export const daysSince = (iso: string, now = new Date()) => Math.max(0, Math.round((+now - Date.parse(iso)) / 86400_000));

const isOpen = (x: BrainItem) => x.status !== "done" && x.status !== "dismissed";
const snoozed = (x: BrainItem, today: string) => !!x.snoozeUntil && x.snoozeUntil > today;

/** Kural tabanlı kararlar: hazır taslaklar, yanıtı geciken gönderimler, acil öneriler, bugün terminli işler */
export function ruleDecisions(items: BrainItem[], now = new Date()): Decision[] {
  const today = trDay(now);
  const out: Decision[] = [];
  for (const x of items) {
    if (!isOpen(x) || snoozed(x, today)) continue;
    const w = x.work?.status;
    const u = (x.priority <= 1 ? 1 : x.priority === 2 ? 2 : 3) as Decision["urgency"];
    if (x.followUp && !x.followUp.replied && today >= x.followUp.due && x.followUp.nudges < 2) {
      const who = x.person ?? x.followUp.to[0] ?? "Karşı taraf";
      out.push({ itemId: x.id, type: "follow_up", urgency: Math.min(2, u) as Decision["urgency"], headline: `${who} ${daysSince(x.followUp.since, now)} gündür yanıt vermedi`, recommendation: "Kısa bir hatırlatma gönder; taslağını hazırlıyorum.", why: x.title });
    } else if (w === "waiting_ok" && !x.followUp) {
      out.push({ itemId: x.id, type: "reply", urgency: u, headline: x.title, recommendation: "Hazırladığım taslağı gözden geçir ve gönder.", why: x.summary });
    } else if (w === "ready") {
      out.push({ itemId: x.id, type: "do", urgency: u, headline: x.title, recommendation: "Teslimat hazır; bak ve onayla.", why: x.summary });
    } else if (x.status === "inbox" && x.priority <= 2) {
      out.push({ itemId: x.id, type: "accept", urgency: u, headline: x.title, recommendation: "Bu iş senin mi? Evet dersen hemen hazırlarım.", why: x.why || x.summary });
    } else if ((x.status === "todo" || x.status === "doing") && x.due && x.due <= today && !w) {
      out.push({ itemId: x.id, type: "do", urgency: 1, headline: x.title, recommendation: "Termini bugün; ajana yaptırabilirim.", why: x.summary });
    }
  }
  return out.sort((a, b) => a.urgency - b.urgency).slice(0, 7);
}

/** Karar hâlâ geçerli mi (iş bitti/ertelendi/durumu değiştiyse gösterilmez) */
export function liveDecision(d: Decision, it: BrainItem | undefined, today = trDay()) {
  if (!it || !isOpen(it) || snoozed(it, today)) return false;
  if (it.followUp && !it.followUp.replied && it.status === "waiting") {
    // gönderildi: yalnızca hatırlatma zamanı geldiyse karar
    return today >= it.followUp.due && it.followUp.nudges < 2;
  }
  return true;
}
