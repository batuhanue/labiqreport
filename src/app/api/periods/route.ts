import { store } from "@/lib/db";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => store().listPeriods());
}
