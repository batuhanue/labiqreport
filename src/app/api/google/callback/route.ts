import { NextResponse, type NextRequest } from "next/server";
import { completeAuth } from "@/lib/google";

export const dynamic = "force-dynamic";

/** Google izin ekranından dönüş: kodu belirtece çevirip kaydeder, sonra /google sayfasına döner. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/google?${q}`, url));
    res.cookies.delete("lq_gstate");
    return res;
  };
  const err = url.searchParams.get("error");
  if (err) return back(`error=${encodeURIComponent(err === "access_denied" ? "İzin verilmedi" : err)}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== req.cookies.get("lq_gstate")?.value) return back("error=" + encodeURIComponent("Oturum doğrulanamadı, tekrar dene"));
  try {
    await completeAuth(code, url.origin);
    return back("connected=1");
  } catch (e) {
    return back(`error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
}
