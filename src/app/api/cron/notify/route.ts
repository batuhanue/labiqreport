import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { runDaily } from "@/lib/push";
import { status as googleStatus } from "@/lib/google";
import { archiveStep } from "@/lib/google-archive";
import { think } from "@/lib/brain";
import { claudeConfigured } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel Cron her sabah çağırır (vercel.json). CRON_SECRET ile korunur. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  return handle(async () => {
    const t0 = Date.now();
    const out = await runDaily({ dry });
    if (dry) return out;
    // Google arşivine yeni gelenleri ekle, sonra beyin sabah düşünmesini yapar (gece gelenler → öneriler + bugün odak)
    const connected = !!(await googleStatus("", false).catch(() => null))?.connected;
    const archive = connected ? await archiveStep({ budgetMs: 15000 }).catch((e) => ({ error: String(e) })) : undefined;
    const brain = claudeConfigured() ? await think({ trigger: "cron", budgetMs: Math.max(15000, 55000 - (Date.now() - t0)) }).catch((e) => ({ error: String(e) })) : undefined;
    return { ...out, archive, brain };
  });
}
