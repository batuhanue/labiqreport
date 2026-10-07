import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { runDaily } from "@/lib/push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel Cron her sabah çağırır (vercel.json). CRON_SECRET ile korunur. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  return handle(() => runDaily({ dry }));
}
