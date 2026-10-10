import { store } from "@/lib/db";
import { handle } from "@/lib/api";
import { getPrefs, publicKey, pushConfigured, pushService } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => ({
    configured: pushConfigured(),
    publicKey: publicKey(),
    prefs: await getPrefs(),
    devices: (await store().listSubs()).map((s) => ({
      device: s.device,
      createdAt: s.createdAt,
      endpointTail: s.endpoint.slice(-12),
      service: pushService(s.endpoint),
      lastOk: s.lastOk,
      lastError: s.lastError,
      lastErrorAt: s.lastErrorAt,
    })),
  }));
}
