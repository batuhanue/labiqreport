import { AREAS, ALL_ITEMS, HOSPITALS, TOTAL_ITEMS, type Area, type Hospital } from "./checklist";
import type { ItemState, Mark, PeriodData, PeriodSummary } from "./types";

export const MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];
export const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const periodLabel = (p: string) => {
  const [y, m] = p.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};
export const periodShort = (p: string) => {
  const [y, m] = p.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
};

export const toPeriod = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Kapanışı yapılan dönem genelde bir önceki aydır. */
export const defaultPeriod = (now = new Date()) => toPeriod(new Date(now.getFullYear(), now.getMonth() - 1, 1));

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const emptyItem = (): ItemState => ({ bursa: null, basaksehir: null, note: "" });

export function newPeriod(period: string): PeriodData {
  const now = new Date().toISOString();
  const items: Record<string, ItemState> = {};
  for (const it of ALL_ITEMS) items[it.id] = emptyItem();
  const blank = { name: "", date: "" };
  return {
    period,
    status: "Taslak",
    version: "v1.0",
    preparedAt: todayISO(),
    signoffs: { preparer: { name: "Batuhan Başar", date: "" }, control: blank, preApproval: blank, finalApproval: blank, closing: blank },
    items,
    actions: [],
    notes: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Eksik alanları tamamlar (eski kayıtlar / içe aktarım için). */
export function normalizePeriod(p: Partial<PeriodData> & { period: string }): PeriodData {
  const base = newPeriod(p.period);
  const items = { ...base.items };
  for (const [k, v] of Object.entries(p.items ?? {})) if (items[k]) items[k] = { ...emptyItem(), ...v };
  return {
    ...base,
    ...p,
    signoffs: { ...base.signoffs, ...(p.signoffs ?? {}) },
    items,
    actions: p.actions ?? [],
    notes: p.notes ?? [],
  } as PeriodData;
}

export const itemDone = (s: ItemState | undefined, h: Hospital) => !!s && (s[h] === "ok" || s[h] === "na");
export const itemTouched = (s: ItemState | undefined, h: Hospital) => !!s && s[h] !== null;

export function areaProgress(p: PeriodData, area: Area) {
  const res = { total: area.items.length, bursa: 0, basaksehir: 0, fails: 0, both: 0 };
  for (const it of area.items) {
    const s = p.items[it.id];
    if (itemDone(s, "bursa")) res.bursa++;
    if (itemDone(s, "basaksehir")) res.basaksehir++;
    if (itemDone(s, "bursa") && itemDone(s, "basaksehir")) res.both++;
    if (s?.bursa === "fail") res.fails++;
    if (s?.basaksehir === "fail") res.fails++;
  }
  return res;
}

export function countMarks(p: PeriodData, h: Hospital) {
  const c: Record<"ok" | "fail" | "na" | "pending", number> = { ok: 0, fail: 0, na: 0, pending: 0 };
  for (const it of ALL_ITEMS) {
    const m: Mark = p.items[it.id]?.[h] ?? null;
    c[m ?? "pending"]++;
  }
  return c;
}

export function overallProgress(p: PeriodData) {
  const b = countMarks(p, "bursa");
  const k = countMarks(p, "basaksehir");
  const done = b.ok + b.na + k.ok + k.na;
  return {
    bursa: (b.ok + b.na) / TOTAL_ITEMS,
    basaksehir: (k.ok + k.na) / TOTAL_ITEMS,
    overall: done / (TOTAL_ITEMS * 2),
    remaining: TOTAL_ITEMS * 2 - done,
    fails: b.fail + k.fail,
    b,
    k,
  };
}

export function summarize(p: PeriodData): PeriodSummary {
  const b = countMarks(p, "bursa");
  const k = countMarks(p, "basaksehir");
  return {
    period: p.period,
    status: p.status,
    updatedAt: p.updatedAt,
    bursaOk: b.ok + b.na,
    basaksehirOk: k.ok + k.na,
    fails: b.fail + k.fail,
    openActions: p.actions.filter((a) => a.status !== "Tamamlandı").length,
  };
}

/** Rapor alanı termin tarihi: dönem ayının son günü + N gün. */
export function areaDeadline(period: string, area: Area): Date | null {
  if (area.deadlineDays == null) return null;
  const [y, m] = period.split("-").map(Number);
  const end = new Date(y, m, 0); // ayın son günü
  return new Date(end.getFullYear(), end.getMonth(), end.getDate() + area.deadlineDays);
}

export function deadlineInfo(period: string, area: Area, now = new Date()) {
  const d = areaDeadline(period, area);
  if (!d) return { date: null, days: null, text: "Ayda 2 kez" };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  const dateText = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  const text = days < 0 ? `${-days} gün gecikti` : days === 0 ? "Bugün" : `${days} gün kaldı`;
  return { date: d, days, text, dateText };
}

export const hospitalLabel = (h: Hospital) => HOSPITALS.find((x) => x.id === h)!.label;
export { AREAS };
