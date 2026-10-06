import { handle } from "@/lib/api";
import { runDaily, sendToAll } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Test bildirimi (body.endpoint verilirse yalnızca o cihaza). mode="today": bugünün gerçek hatırlatmaları. */
export async function POST(req: Request) {
  const { endpoint, mode } = ((await req.json().catch(() => ({}))) ?? {}) as { endpoint?: string; mode?: string };
  return handle(async () => {
    if (mode === "today") {
      const { messages } = await runDaily({ dry: true });
      if (!messages.length) return { messages, result: null };
      return { messages, result: await sendToAll(messages, endpoint) };
    }
    const result = await sendToAll(
      [{ kind: "deadline", title: "🔔 Bildirimler açık", body: "LabIQ Kontrol hatırlatmaları bu cihaza gelecek.", url: "/", tag: "test", level: "info" }],
      endpoint,
    );
    return { result };
  });
}
