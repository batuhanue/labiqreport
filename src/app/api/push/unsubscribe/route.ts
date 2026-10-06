import { store } from "@/lib/db";
import { bad, handle } from "@/lib/api";

export async function POST(req: Request) {
  const { endpoint } = ((await req.json().catch(() => ({}))) ?? {}) as { endpoint?: string };
  if (!endpoint) return bad("endpoint gerekli");
  return handle(async () => {
    await store().removeSub(endpoint);
    return { ok: true };
  });
}
