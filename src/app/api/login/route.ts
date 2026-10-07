import { NextResponse } from "next/server";
import { AUTH_COOKIE, COOKIE_MAX_AGE, tokenFor } from "@/lib/auth";

export async function POST(req: Request) {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  const pw = process.env.APP_PASSWORD;
  if (!pw) return NextResponse.json({ ok: true });
  if (password !== pw) return NextResponse.json({ error: "Şifre hatalı" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await tokenFor(pw), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
