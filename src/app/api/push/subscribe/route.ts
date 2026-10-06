import { store } from "@/lib/db";
import { bad, handle } from "@/lib/api";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    device?: string;
  } | null;
  const sub = body?.subscription;
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return bad("Geçersiz abonelik");
  return handle(async () => {
    await store().addSub({
      endpoint: sub.endpoint!,
      keys: { p256dh: sub.keys!.p256dh!, auth: sub.keys!.auth! },
      device: String(body?.device ?? "Cihaz").slice(0, 80),
      createdAt: new Date().toISOString(),
    });
    return { ok: true };
  });
}
