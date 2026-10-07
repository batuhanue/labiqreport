// Kişisel görevler (dönemden bağımsız) — model, Türkçe doğal dil ayrıştırma, gruplama, istatistik, asistan önerileri.
import { AREAS } from "./checklist";
import { areaProgress, deadlineInfo, MONTHS_SHORT } from "./period";
import type { PeriodData } from "./types";

export type Priority = 1 | 2 | 3 | 4;
export type Recur = "daily" | "weekdays" | "weekly" | "monthly";

export interface SubTask {
  id: string;
  title: string;
  done: boolean;
}

export interface Todo {
  id: string;
  title: string;
  notes: string;
  due?: string; // YYYY-MM-DD
  time?: string; // HH:MM
  priority: Priority;
  tags: string[];
  person?: string;
  recur?: Recur;
  subtasks: SubTask[];
  areaCode?: string;
  /** asistan önerisinden geldiyse önerinin anahtarı (tekrar önerilmesin) */
  source?: string;
  focus?: boolean;
  done: boolean;
  doneAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TodoStore {
  todos: Todo[];
  dismissed: string[];
  updatedAt: string;
}

export const emptyStore = (): TodoStore => ({ todos: [], dismissed: [], updatedAt: new Date(0).toISOString() });

export const PRIORITY: Record<Priority, { label: string; short: string; color: string }> = {
  1: { label: "Acil", short: "P1", color: "#FF5E6C" },
  2: { label: "Yüksek", short: "P2", color: "#FF9F43" },
  3: { label: "Orta", short: "P3", color: "#5B7CFF" },
  4: { label: "Normal", short: "P4", color: "#9AA1B5" },
};

export const RECUR_LABEL: Record<Recur, string> = {
  daily: "Her gün",
  weekdays: "Hafta içi",
  weekly: "Her hafta",
  monthly: "Her ay",
};

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

/* ------------------------------------------------------------------ tarih yardımcıları */
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const fromIso = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000);

const WEEKDAYS = ["pazar", "pazartesi", "salı", "çarşamba", "perşembe", "cuma", "cumartesi"];
const WD_SHORT = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const MONTH_KEYS = ["oca", "şub", "mar", "nis", "may", "haz", "tem", "ağu", "eyl", "eki", "kas", "ara"];

export function dueLabel(due?: string, time?: string, today = startOfDay()) {
  if (!due) return "";
  const d = fromIso(due);
  const diff = daysBetween(today, d);
  const base =
    diff === 0 ? "Bugün" : diff === 1 ? "Yarın" : diff === -1 ? "Dün" : diff > 1 && diff < 7 ? WEEKDAYS[d.getDay()][0].toLocaleUpperCase("tr") + WEEKDAYS[d.getDay()].slice(1) : `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return time ? `${base} ${time}` : base;
}
export const weekdayShort = (d: Date) => WD_SHORT[d.getDay()];

/* ------------------------------------------------------------------ doğal dil ayrıştırma */
export interface Parsed {
  title: string;
  due?: string;
  time?: string;
  priority: Priority;
  tags: string[];
  person?: string;
  recur?: Recur;
  areaCode?: string;
}

const nextWeekday = (from: Date, wd: number) => {
  const diff = (wd - from.getDay() + 7) % 7;
  return addDays(from, diff);
};

/**
 * "yarın 14:00 Tuğrul'u ara #sayım !!" → { title: "Tuğrul'u ara", due: yarın, time: "14:00", tags: ["sayım"], priority: 2 }
 * Desteklenen: bugün, yarın, öbür gün, haftaya, N gün sonra, ay sonu, gün adları (cuma/cumaya…), 15.10, 15/10/2026,
 * 15 ekim, saat 14:00 / 14.30, !, !!, !!!, !acil/!yüksek/!orta, #etiket, @kişi, her gün/hafta içi/her hafta/her ay/her cuma, R-02.
 */
export function parseQuick(input: string, now = new Date()): Parsed {
  const today = startOfDay(now);
  let s = ` ${input} `;
  const out: Parsed = { title: "", priority: 4, tags: [] };
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = s.match(re);
    if (m) {
      fn(m);
      s = s.replace(m[0], " ");
    }
  };
  const lower = () => s.toLocaleLowerCase("tr");
  const takeCI = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = lower().match(re);
    if (m && m.index != null) {
      fn(m);
      s = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
    }
  };

  // tekrar
  takeCI(/\s(her gün|hergün)\s/, () => (out.recur = "daily"));
  takeCI(/\s(hafta içi|haftaiçi)\s/, () => (out.recur = "weekdays"));
  takeCI(/\s(her hafta)\s/, () => (out.recur = "weekly"));
  takeCI(/\s(her ay)\s/, () => (out.recur = "monthly"));
  takeCI(/\sher (pazartesi|salı|çarşamba|perşembe|cumartesi|cuma|pazar)\s/, (m) => {
    out.recur = "weekly";
    out.due = iso(nextWeekday(today, WEEKDAYS.indexOf(m[1])));
  });

  // öncelik
  takeCI(/\s(!!!|!acil|!1)(?=\s)/, () => (out.priority = 1));
  takeCI(/\s(!!|!yüksek|!2)(?=\s)/, () => (out.priority = 2));
  takeCI(/\s(!orta|!3|!)(?=\s)/, () => (out.priority = 3));

  // etiket, kişi, rapor alanı
  for (let i = 0; i < 6; i++) take(/\s#([\p{L}\p{N}_-]+)/u, (m) => out.tags.push(m[1]));
  take(/\s@([\p{L}\p{N}_.-]+)/u, (m) => (out.person = m[1]));
  takeCI(/\s(r-?(0[1-9]|10))\b/, (m) => (out.areaCode = `R-${m[2]}`));

  // saat (14:00, saat 9, 14.30 [dakika > 12 ise saat sayılır])
  takeCI(/\s(?:saat\s*)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (m) => (out.time = `${m[1].padStart(2, "0")}:${m[2]}`));
  if (!out.time) takeCI(/\ssaat\s*([01]?\d|2[0-3])(?:[.]([0-5]\d))?(?=\s)/, (m) => (out.time = `${m[1].padStart(2, "0")}:${m[2] ?? "00"}`));
  if (!out.time) {
    // 14.30 → saat; 15.10 → tarih (dakika kısmı ≤ 12 ise tarih kabul edilir, aşağıda işlenir)
    const m = lower().match(/\s([01]?\d|2[0-3])\.([0-5]\d)(?=\s)/);
    if (m && m.index != null && Number(m[2]) > 12) {
      out.time = `${m[1].padStart(2, "0")}:${m[2]}`;
      s = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
    }
  }

  // tarih
  if (!out.due) {
    takeCI(/\s(bugün)\s/, () => (out.due = iso(today)));
    takeCI(/\s(yarın)\s/, () => (out.due = iso(addDays(today, 1))));
    takeCI(/\s(öbür gün|öbürgün|ertesi gün)\s/, () => (out.due = iso(addDays(today, 2))));
    takeCI(/\s(haftaya)\s/, () => (out.due = iso(addDays(today, 7))));
    takeCI(/\s(\d{1,2})\s*gün\s*sonra\s/, (m) => (out.due = iso(addDays(today, Number(m[1])))));
    takeCI(/\s(ay sonu|ay sonuna)\s/, () => (out.due = iso(new Date(today.getFullYear(), today.getMonth() + 1, 0))));
    takeCI(/\s(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?=\s)/, (m) => {
      const d = Number(m[1]), mo = Number(m[2]);
      if (d < 1 || d > 31 || mo < 1 || mo > 12) return;
      let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : today.getFullYear();
      let dt = new Date(y, mo - 1, d);
      // yıl yazılmadıysa: yakın geçmiş (60 gün) bu yıl kalır (gecikmiş), daha eskisi gelecek yıla
      if (!m[3] && daysBetween(dt, today) > 60) dt = new Date(++y, mo - 1, d);
      out.due = iso(dt);
    });
    takeCI(/\s(\d{1,2})\s+(oca|şub|mar|nis|may|haz|tem|ağu|eyl|eki|kas|ara)[\p{L}']*\s/u, (m) => {
      const mo = MONTH_KEYS.indexOf(m[2]);
      let dt = new Date(today.getFullYear(), mo, Number(m[1]));
      if (daysBetween(dt, today) > 60) dt = new Date(today.getFullYear() + 1, mo, Number(m[1]));
      out.due = iso(dt);
    });
    takeCI(/\s(pazartesi|salı|çarşamba|perşembe|cumartesi|cuma|pazar)(ya|ye|a|e|'ya|'ye|'a|'e)?\s/, (m) => (out.due = iso(nextWeekday(today, WEEKDAYS.indexOf(m[1])))));
  }
  if (out.recur && !out.due) out.due = iso(today);
  if (out.due) takeCI(/\s(kadar|'a kadar|'e kadar|tarihine kadar)\s/, () => {});

  out.title = s.replace(/\s+/g, " ").trim();
  return out;
}

export function newTodo(p: Partial<Todo> & { title: string }): Todo {
  const now = new Date().toISOString();
  return { id: uid(), notes: "", priority: 4, tags: [], subtasks: [], done: false, createdAt: now, updatedAt: now, ...p };
}

/** Tekrarlayan görev tamamlanınca bir sonraki tarih */
export function nextDue(t: Todo): string | undefined {
  if (!t.recur) return undefined;
  const base = t.due ? fromIso(t.due) : startOfDay();
  const from = base < startOfDay() ? startOfDay() : base;
  if (t.recur === "daily") return iso(addDays(from, 1));
  if (t.recur === "weekly") return iso(addDays(from, 7));
  if (t.recur === "monthly") return iso(new Date(from.getFullYear(), from.getMonth() + 1, from.getDate()));
  let d = addDays(from, 1);
  while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
  return iso(d);
}

/* ------------------------------------------------------------------ görünümler */
export type View = "today" | "upcoming" | "overdue" | "all" | "done";

export const isOverdue = (t: Todo, today = startOfDay()) => !t.done && !!t.due && fromIso(t.due) < today;

export function sortTodos(a: Todo, b: Todo) {
  if (!!a.focus !== !!b.focus) return a.focus ? -1 : 1;
  const ad = a.due ? a.due + (a.time ?? "99") : "9999";
  const bd = b.due ? b.due + (b.time ?? "99") : "9999";
  if (ad !== bd) return ad.localeCompare(bd);
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.createdAt.localeCompare(b.createdAt);
}

export function filterView(todos: Todo[], view: View, today = startOfDay()) {
  const t = iso(today);
  const week = iso(addDays(today, 7));
  switch (view) {
    case "today":
      return todos.filter((x) => !x.done && x.due && x.due <= t);
    case "upcoming":
      return todos.filter((x) => !x.done && x.due && x.due > t && x.due <= week);
    case "overdue":
      return todos.filter((x) => isOverdue(x, today));
    case "done":
      return todos.filter((x) => x.done).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
    default:
      return todos.filter((x) => !x.done);
  }
}

export function groupTodos(list: Todo[], today = startOfDay()) {
  const groups: { key: string; label: string; items: Todo[] }[] = [];
  const push = (key: string, label: string, t: Todo) => {
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, label, items: [] }));
    g.items.push(t);
  };
  for (const t of [...list].sort(sortTodos)) {
    if (t.done) {
      push("done", "Tamamlananlar", t);
      continue;
    }
    if (!t.due) push("z-nodate", "Tarihsiz", t);
    else {
      const diff = daysBetween(today, fromIso(t.due));
      if (diff < 0) push("a-overdue", "Gecikmiş", t);
      else if (diff === 0) push("b-today", "Bugün", t);
      else if (diff === 1) push("c-tomorrow", "Yarın", t);
      else if (diff < 7) push("d-week", "Bu hafta", t);
      else push("e-later", "Daha sonra", t);
    }
  }
  return groups.sort((a, b) => a.key.localeCompare(b.key));
}

/* ------------------------------------------------------------------ istatistik */
export function todoStats(todos: Todo[], today = startOfDay()) {
  const t = iso(today);
  const open = todos.filter((x) => !x.done);
  const done = todos.filter((x) => x.done && x.doneAt);
  const doneOn = (d: string) => done.filter((x) => x.doneAt!.slice(0, 10) === d).length;
  const last14 = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(today, i - 13);
    return { date: iso(d), label: `${d.getDate()}`, wd: weekdayShort(d), count: doneOn(iso(d)) };
  });
  const withDue = done.filter((x) => x.due);
  const onTime = withDue.filter((x) => x.doneAt!.slice(0, 10) <= x.due!).length;
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const c = doneOn(iso(addDays(today, -i)));
    if (c > 0) streak++;
    else if (i > 0) break;
  }
  const dueToday = todos.filter((x) => x.due === t);
  const weekStart = addDays(today, -((today.getDay() + 6) % 7));
  const tags = new Map<string, number>();
  for (const x of open) for (const g of x.tags) tags.set(g, (tags.get(g) ?? 0) + 1);
  return {
    open: open.length,
    overdue: open.filter((x) => isOverdue(x, today)).length,
    todayTotal: dueToday.length + open.filter((x) => isOverdue(x, today)).length,
    todayDone: dueToday.filter((x) => x.done).length,
    doneToday: doneOn(t),
    doneWeek: done.filter((x) => fromIso(x.doneAt!.slice(0, 10)) >= weekStart).length,
    onTimeRate: withDue.length ? onTime / withDue.length : null,
    streak,
    last14,
    byPriority: ([1, 2, 3, 4] as Priority[]).map((p) => ({ p, n: open.filter((x) => x.priority === p).length })),
    tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    noDate: open.filter((x) => !x.due).length,
  };
}

/* ------------------------------------------------------------------ asistan önerileri */
export interface Suggestion {
  key: string;
  icon: string;
  title: string;
  body: string;
  cta?: string;
  /** önerilen görev (oluştur düğmesi) */
  todo?: Partial<Todo> & { title: string };
  /** özel eylem */
  action?: "reschedule-overdue" | "plan-nodate";
  tone: "info" | "warn" | "alert";
}

export function suggestions(store: TodoStore, period: PeriodData | null, now = new Date()): Suggestion[] {
  const today = startOfDay(now);
  const out: Suggestion[] = [];
  const has = (key: string) => store.dismissed.includes(key) || store.todos.some((t) => t.source === key);
  const open = store.todos.filter((t) => !t.done);

  const overdue = open.filter((t) => isOverdue(t, today));
  if (overdue.length) {
    out.push({
      key: `overdue-${iso(today)}`,
      icon: "⏰",
      title: `${overdue.length} gecikmiş görev`,
      body: "Bugüne taşıyıp yeniden planlayabilirim.",
      cta: "Hepsini bugüne taşı",
      action: "reschedule-overdue",
      tone: "alert",
    });
  }

  if (period) {
    for (const a of AREAS) {
      const d = deadlineInfo(period.period, a, today);
      const p = areaProgress(period, a);
      if (d.days == null || p.both >= a.items.length || d.days > 2) continue;
      const key = `area-${period.period}-${a.code}`;
      if (has(key)) continue;
      const rem = a.items.length * 2 - p.bursa - p.basaksehir;
      out.push({
        key,
        icon: a.emoji,
        title: d.days < 0 ? `${a.code} termini ${-d.days} gün geçti` : d.days === 0 ? `${a.code} termini bugün` : `${a.code} termini ${d.days} gün sonra`,
        body: `${a.title}: ${rem} kontrol kaldı. Göreve çevireyim mi?`,
        cta: "Görev oluştur",
        todo: { title: `${a.code} ${a.title} kontrollerini tamamla`, due: iso(d.days < 0 ? today : d.date!), priority: d.days <= 0 ? 1 : 2, areaCode: a.code, tags: ["kapanış"], source: key },
        tone: d.days < 0 ? "alert" : "warn",
      });
    }
    const followups = period.actions.filter((x) => x.status !== "Tamamlandı" && x.owner && x.due && daysBetween(today, fromIso(x.due)) <= 1);
    for (const x of followups.slice(0, 3)) {
      const key = `action-${x.id}`;
      if (has(key)) continue;
      out.push({
        key,
        icon: "🚩",
        title: `Takip: ${x.owner}`,
        body: `${x.areaCode} · ${x.finding.slice(0, 80)}`,
        cta: "Takip görevi ekle",
        todo: { title: `${x.owner} ile ${x.areaCode} bulgusunu görüş`, notes: x.finding, due: iso(today), priority: 2, person: x.owner, areaCode: x.areaCode, tags: ["takip"], source: key },
        tone: "warn",
      });
    }
  }

  const wd = today.getDay();
  if (wd === 4 || wd === 5) {
    const friday = addDays(today, wd === 4 ? 1 : 0);
    const key = `friday-${iso(friday)}`;
    if (!has(key))
      out.push({
        key,
        icon: "📋",
        title: wd === 5 ? "Bugün 12:00 Cuma toplantısı" : "Yarın Cuma toplantısı",
        body: "Bu hafta kapananlar · açık kalanlar · kimden ne bekleniyor — tek sayfa hazırla.",
        cta: "Hazırlık görevi ekle",
        todo: { title: "Cuma toplantısı tek sayfa özeti hazırla", due: iso(wd === 5 ? today : today), time: "11:00", priority: 2, tags: ["toplantı"], source: key },
        tone: "info",
      });
  }

  const noDate = open.filter((t) => !t.due);
  if (noDate.length >= 4 && !has(`nodate-${iso(today)}`)) {
    out.push({
      key: `nodate-${iso(today)}`,
      icon: "🗂️",
      title: `${noDate.length} tarihsiz görev`,
      body: "Önceliğe göre bu haftaya yayabilirim.",
      cta: "Bu haftaya planla",
      action: "plan-nodate",
      tone: "info",
    });
  }
  return out.filter((x) => !store.dismissed.includes(x.key));
}

/** Tarihsiz görevleri önceliğe göre önümüzdeki iş günlerine dağıtır (günde en fazla 3). */
export function planNoDate(todos: Todo[], today = startOfDay()): Todo[] {
  const list = todos.filter((t) => !t.done && !t.due).sort((a, b) => a.priority - b.priority);
  const load = new Map<string, number>();
  for (const t of todos) if (!t.done && t.due) load.set(t.due, (load.get(t.due) ?? 0) + 1);
  let d = today;
  const assigned = new Map<string, string>();
  for (const t of list) {
    while (d.getDay() === 0 || d.getDay() === 6 || (load.get(iso(d)) ?? 0) >= 3) d = addDays(d, 1);
    assigned.set(t.id, iso(d));
    load.set(iso(d), (load.get(iso(d)) ?? 0) + 1);
  }
  return todos.map((t) => (assigned.has(t.id) ? { ...t, due: assigned.get(t.id), updatedAt: new Date().toISOString() } : t));
}

/** Günün selamı + asistan özeti */
export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 6 ? "İyi geceler" : h < 12 ? "Günaydın" : h < 18 ? "İyi günler" : "İyi akşamlar";
}
