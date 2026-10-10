import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { status as googleStatus, sync as googleSync } from "@/lib/google";
import { archiveStep } from "@/lib/google-archive";
import { think } from "@/lib/brain";
import { claudeConfigured } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sabah düşünmesi (07:30 İstanbul): Google'ı senkronla, arşive yeni gelenleri ekle, beyin düşünsün
 * (ajanlar → strateji: kararlar, risk işleri, gün planı, önden hazırlık kuyruğu). CRON_SECRET ile korunur.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }
  return handle(async () => {
    const t0 = Date.now();
    const connected = !!(await googleStatus("", false).catch(() => null))?.connected;
    if (connected) await googleSync({ force: true }).catch(() => null);
    const archive = connected ? await archiveStep({ budgetMs: 9000 }).catch((e) => ({ error: String(e) })) : undefined;
    const brain = claudeConfigured() ? await think({ trigger: "cron", budgetMs: Math.max(20000, 56000 - (Date.now() - t0)) }).catch((e) => ({ error: String(e) })) : undefined;
    return { archive, brain };
  });
}
