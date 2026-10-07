// Bildirim içeriği — saf fonksiyonlar (hem sunucu cron'u hem uygulama içi bildirim merkezi kullanır).
import { AREAS } from "./checklist";
import { areaProgress, deadlineInfo, defaultPeriod, periodLabel } from "./period";
import type { PeriodData } from "./types";
import type { Todo } from "./todo";

export interface NotifyPrefs {
  deadlines: boolean; // rapor alanı terminleri
  daysBefore: number; // kaç gün önceden hatırlat
  actions: boolean; // aksiyon terminleri
  friday: boolean; // Cuma 12:00 toplantı özeti
  monthStart: boolean; // ay başı: yeni kapanış hatırlatması
  todos: boolean; // kişisel görevler
}

export const DEFAULT_PREFS: NotifyPrefs = { deadlines: true, daysBefore: 2, actions: true, friday: true, monthStart: true, todos: true };

export interface NotifyMessage {
  kind: "deadline" | "overdue" | "action" | "friday" | "month" | "todo";
  title: string;
  body: string;
  url: string;
  tag: string;
  level: "info" | "warn" | "alert";
}

/** İstanbul saatine göre bugünün tarihi (yerel Date nesnesi olarak; sunucu UTC olsa da doğru gün). */
export function istanbulToday(now = new Date()) {
  const tr = new Date(now.getTime() + 3 * 3600 * 1000); // TR: UTC+3, yaz saati yok
  return new Date(tr.getUTCFullYear(), tr.getUTCMonth(), tr.getUTCDate());
}

const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function buildMessages(
  data: PeriodData | null,
  prefs: NotifyPrefs,
  opts: { today?: Date; activePeriod?: string | null; todos?: Todo[] } = {},
): NotifyMessage[] {
  const today = opts.today ?? istanbulToday();
  const out: NotifyMessage[] = [];

  // Ay başı: önceki ayın kapanışı başlatılmamışsa
  if (prefs.monthStart && today.getDate() <= 2) {
    const prev = defaultPeriod(today);
    if (!data || data.period !== prev) {
      out.push({
        kind: "month",
        title: `${periodLabel(prev)} kapanışı başladı`,
        body: "R-02 stok sayım analizleri ay bitiş + 2 gün terminli. Dönemi başlatmak için dokun.",
        url: "/",
        tag: `month-${prev}`,
        level: "info",
      });
    }
  }
  if (prefs.todos && opts.todos?.length) {
    const t = isoOf(today);
    const open = opts.todos.filter((x) => !x.done && x.due);
    const dueToday = open.filter((x) => x.due === t).sort((a, b) => a.priority - b.priority || (a.time ?? "99").localeCompare(b.time ?? "99"));
    const late = open.filter((x) => x.due! < t);
    if (dueToday.length || late.length) {
      const top = [...late, ...dueToday].slice(0, 3).map((x) => `${x.time ? x.time + " " : ""}${x.title}`);
      out.push({
        kind: "todo",
        title: `✅ Bugün ${dueToday.length} görev${late.length ? ` · ${late.length} gecikmiş` : ""}`,
        body: top.join(" · ") + (dueToday.length + late.length > 3 ? " …" : ""),
        url: "/gorevler",
        tag: `todo-${t}`,
        level: late.length ? "warn" : "info",
      });
    }
  }

  if (!data) return out;

  if (prefs.deadlines) {
    const rows = AREAS.map((a) => ({ a, d: deadlineInfo(data.period, a, today), p: areaProgress(data, a) })).filter(
      (x) => x.d.days != null && x.p.both < x.a.items.length,
    );
    const overdue = rows.filter((x) => x.d.days! < 0);
    const soon = rows.filter((x) => x.d.days! >= 0 && x.d.days! <= prefs.daysBefore).sort((x, y) => x.d.days! - y.d.days!);
    if (soon.length) {
      const parts = soon.map((x) => `${x.a.code} ${x.a.title} (${x.d.days === 0 ? "bugün" : x.d.days === 1 ? "yarın" : `${x.d.days} gün`})`);
      const first = soon[0];
      out.push({
        kind: "deadline",
        title: first.d.days === 0 ? `⏰ Bugün son gün: ${first.a.code}` : `🗓️ Yaklaşan termin: ${first.a.code}`,
        body: `${parts.join(" · ")}. Kalan madde: ${soon.map((x) => `${x.a.code} ${x.a.items.length * 2 - x.p.bursa - x.p.basaksehir}`).join(", ")}`,
        url: `/?alan=${first.a.code}`,
        tag: `deadline-${data.period}-${isoOf(today)}`,
        level: first.d.days === 0 ? "warn" : "info",
      });
    }
    if (overdue.length) {
      out.push({
        kind: "overdue",
        title: `⚠️ ${overdue.length} rapor alanı termini geçti`,
        body: `${overdue.map((x) => `${x.a.code} (${-x.d.days!} gün)`).join(", ")}. Yetişmeyecekse Cuma toplantısında söylenmeli.`,
        url: `/?alan=${overdue[0].a.code}`,
        tag: `overdue-${data.period}-${isoOf(today)}`,
        level: "alert",
      });
    }
  }

  if (prefs.actions) {
    const t = isoOf(today);
    const open = data.actions.filter((a) => a.status !== "Tamamlandı" && a.due);
    const late = open.filter((a) => a.due < t);
    const due = open.filter((a) => a.due === t);
    if (late.length || due.length) {
      const sample = [...due, ...late].slice(0, 3).map((a) => `${a.areaCode} · ${a.owner || "sorumlu yok"}`);
      out.push({
        kind: "action",
        title: `🚩 ${due.length ? `${due.length} aksiyonun termini bugün` : ""}${due.length && late.length ? ", " : ""}${late.length ? `${late.length} aksiyon gecikti` : ""}`,
        body: `${sample.join(" · ")}${due.length + late.length > 3 ? " …" : ""}. Sorumluya ulaş, çözülünce kapat.`,
        url: "/aksiyonlar",
        tag: `action-${data.period}-${t}`,
        level: late.length ? "alert" : "warn",
      });
    }
  }

  if (prefs.friday && today.getDay() === 5) {
    const open = data.actions.filter((a) => a.status !== "Tamamlandı").length;
    const done = data.actions.filter((a) => a.status === "Tamamlandı").length;
    const fails = Object.values(data.items).reduce((n, s) => n + (s.bursa === "fail" ? 1 : 0) + (s.basaksehir === "fail" ? 1 : 0), 0);
    out.push({
      kind: "friday",
      title: "📋 Bugün 12:00 Analiz ve Raporlama Toplantısı",
      body: `${periodLabel(data.period)}: ${done} aksiyon kapandı, ${open} açık, ${fails} sorunlu madde. Yetişmeyecek alanları söylemeyi unutma.`,
      url: "/analiz",
      tag: `friday-${isoOf(today)}`,
      level: "info",
    });
  }

  return out;
}
