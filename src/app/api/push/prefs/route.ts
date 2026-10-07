import { store } from "@/lib/db";
import { handle } from "@/lib/api";
import { DEFAULT_PREFS, type NotifyPrefs } from "@/lib/notify";

export async function PUT(req: Request) {
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Partial<NotifyPrefs>;
  const prefs: NotifyPrefs = {
    deadlines: body.deadlines ?? DEFAULT_PREFS.deadlines,
    daysBefore: Math.min(7, Math.max(0, Number(body.daysBefore ?? DEFAULT_PREFS.daysBefore) || 0)),
    actions: body.actions ?? DEFAULT_PREFS.actions,
    friday: body.friday ?? DEFAULT_PREFS.friday,
    monthStart: body.monthStart ?? DEFAULT_PREFS.monthStart,
    todos: body.todos ?? DEFAULT_PREFS.todos,
  };
  return handle(async () => {
    await store().setKV("notify", prefs);
    return prefs;
  });
}
