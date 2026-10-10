import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { runDaily } from "@/lib/push";
import { morningBrief, nextQueued, work } from "@/lib/brain";
import { claudeConfigured } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron her sabah 08:00'de (İstanbul) çağırır; /api/cron/brain 07:30'da düşünmüş olur.
 * Önce beynin önden hazırlık kuyruğundan taslakları hazırlar (zaman yettiğince), sonra sabah brifingini
 * ve denetim/takvim hatırlatmalarını telefona gönderir. CRON_SECRET ile korunur.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  return handle(async () => {
    const t0 = Date.now();
    const prepared: string[] = [];
    if (!dry && claudeConfigured()) {
      while (Date.now() - t0 < 28000) {
        const id = await nextQueued();
        if (!id) break;
        await work(id, { queued: true, budgetMs: Math.max(12000, 40000 - (Date.now() - t0)) }).catch(() => null);
        prepared.push(id);
      }
    }
    const brief = await morningBrief().catch(() => null);
    const out = await runDaily({ dry, extra: brief ? [brief] : [] });
    return { ...out, prepared };
  });
}
