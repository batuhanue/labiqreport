import { handle } from "@/lib/api";
import { brainRaw } from "@/lib/brain";
import { buildOrg } from "@/lib/org";

export const dynamic = "force-dynamic";

/** Ajan ağı: departmanlar, ajanların canlı durumu ve ölçümleri, süreç analitiği */
export async function GET() {
  return handle(async () => buildOrg(await brainRaw()));
}
