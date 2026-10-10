import { store } from "@/lib/db";
import { bad, handle } from "@/lib/api";

/**
 * Aboneliği kaydeder (aynı uç nokta varsa günceller, durum geçmişini korur). Uygulama her açılışta bunu
 * tekrarlar; servis çalışanı abonelik yenilendiğinde `oldEndpoint` ile çağırır (eski kayıt silinir, ad korunur).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    device?: string;
    oldEndpoint?: string;
  } | null;
  const sub = body?.subscription;
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return bad("Geçersiz abonelik");
  return handle(async () => {
    const s = store();
    const all = await s.listSubs();
    const prev = all.find((x) => x.endpoint === sub.endpoint) ?? (body?.oldEndpoint ? all.find((x) => x.endpoint === body.oldEndpoint) : undefined);
    const keys = { p256dh: sub.keys!.p256dh!, auth: sub.keys!.auth! };
    const same = !!prev && prev.endpoint === sub.endpoint && prev.keys.p256dh === keys.p256dh && prev.keys.auth === keys.auth;
    await s.addSub({
      ...(same ? prev : {}),
      endpoint: sub.endpoint!,
      keys,
      device: String(body?.device ?? prev?.device ?? "Cihaz").slice(0, 80),
      createdAt: same ? prev!.createdAt : new Date().toISOString(),
    });
    if (body?.oldEndpoint && body.oldEndpoint !== sub.endpoint) await s.removeSub(body.oldEndpoint);
    return { ok: true, known: !!prev };
  });
}
