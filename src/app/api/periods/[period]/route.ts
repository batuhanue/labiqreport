import { store } from "@/lib/db";
import { bad, handle } from "@/lib/api";
import { normalizePeriod, PERIOD_RE } from "@/lib/period";
import type { PeriodData } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/periods/[period]">) {
  const { period } = await ctx.params;
  if (!PERIOD_RE.test(period)) return bad("Geçersiz dönem");
  return handle(async () => {
    const d = await store().getPeriod(period);
    return d ?? bad("Dönem bulunamadı", 404);
  });
}

export async function PUT(req: Request, ctx: RouteContext<"/api/periods/[period]">) {
  const { period } = await ctx.params;
  if (!PERIOD_RE.test(period)) return bad("Geçersiz dönem");
  const body = (await req.json()) as PeriodData;
  if (body.period !== period) return bad("Dönem uyuşmuyor");
  return handle(async () => {
    const data = normalizePeriod({ ...body, updatedAt: new Date().toISOString() });
    await store().savePeriod(data);
    return { ok: true, updatedAt: data.updatedAt };
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/periods/[period]">) {
  const { period } = await ctx.params;
  if (!PERIOD_RE.test(period)) return bad("Geçersiz dönem");
  return handle(async () => {
    const s = store();
    await s.deletePeriod(period);
    const st = await s.getState();
    if (st.activePeriod === period) await s.setState({ ...st, activePeriod: null });
    return { ok: true };
  });
}
