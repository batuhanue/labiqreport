import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, COOKIE_MAX_AGE, tokenFor } from "@/lib/auth";

/** APP_PASSWORD tanımlıysa uygulamayı basit bir şifreyle korur. */
export async function proxy(req: NextRequest) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname === "/giris" || pathname === "/api/login" || pathname.startsWith("/api/cron/")) return NextResponse.next();
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && cookie === (await tokenFor(pw))) {
    // kayan süre: uygulama her açıldığında giriş 400 gün uzar (cihazda bir kez giriş yeterli)
    const res = NextResponse.next();
    if (!pathname.startsWith("/api/")) {
      res.cookies.set(AUTH_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: COOKIE_MAX_AGE });
    }
    return res;
  }
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Giriş gerekli" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/giris";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js|icons/).*)"],
};
