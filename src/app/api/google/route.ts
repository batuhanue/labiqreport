import { handle } from "@/lib/api";
import { disconnect, status } from "@/lib/google";

export const dynamic = "force-dynamic";

/** Bağlantı durumu + son senkron görüntüsü. */
export async function GET(req: Request) {
  return handle(() => status(new URL(req.url).origin));
}

/** Bağlantıyı kaldırır (Google'daki izni de iptal eder). */
export async function DELETE() {
  return handle(async () => {
    await disconnect();
    return { ok: true };
  });
}
