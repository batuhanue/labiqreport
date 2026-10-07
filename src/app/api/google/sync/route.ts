import { handle } from "@/lib/api";
import { sync } from "@/lib/google";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Takvim, Gmail, Chat ve Meet verisini Google'dan çekip kaydeder. */
export async function POST(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  return handle(() => sync({ force }));
}
