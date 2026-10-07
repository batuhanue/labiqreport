import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { runDaily } from "@/lib/push";
import { status as googleStatus } from "@/lib/google";
import { archiveStep } from "@/lib/google-archive";

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
    // kalan sürede Google arşivine yeni gelenleri ekle (geçmişi indirme işi de bir adım ilerler)
    if (!dry && (await googleStatus("", false).catch(() => null))?.connected) {
      const archive = await archiveStep({ budgetMs: Math.max(10000, 50000 - (Date.now() - t0)) }).catch((e) => ({ error: String(e) }));
      return { ...out, archive };
    }
    return out;
  });
}
