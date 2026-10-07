import { NextResponse } from "next/server";
import { authUrl, googleConfigured } from "@/lib/google";

export const dynamic = "force-dynamic";

/** Google izin ekranına yönlendirir. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!googleConfigured()) return NextResponse.redirect(new URL("/google?error=not-configured", url));
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(authUrl(url.origin, state, url.searchParams.get("hint") ?? undefined));
  res.cookies.set("lq_gstate", state, { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
