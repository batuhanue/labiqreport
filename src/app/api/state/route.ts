import { store } from "@/lib/db";
import { bad, handle } from "@/lib/api";
import { PERIOD_RE } from "@/lib/period";
import type { AppState } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => store().getState());
}

export async function PUT(req: Request) {
  const body = (await req.json()) as AppState;
  if (body.activePeriod !== null && !PERIOD_RE.test(body.activePeriod)) return bad("Geçersiz dönem");
  return handle(async () => {
    await store().setState({ activePeriod: body.activePeriod });
    return { ok: true };
  });
}
