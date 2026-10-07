import { store } from "@/lib/db";
import { bad, handle } from "@/lib/api";
import { loadKnowledge } from "@/lib/assistant";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => loadKnowledge());
}

/** Bilgi dosyasını günceller (uygulama içinden düzenleme / .md yükleme). */
export async function PUT(req: Request) {
  const { md } = ((await req.json().catch(() => ({}))) ?? {}) as { md?: string };
  if (typeof md !== "string" || !md.trim()) return bad("Boş içerik");
  if (md.length > 400_000) return bad("Dosya çok büyük (400 KB üstü)");
  return handle(async () => {
    await store().setKV("assistant-md", { md, updatedAt: new Date().toISOString() });
    return loadKnowledge();
  });
}

/** Varsayılan dosyaya (knowledge/asistan.md) döner. */
export async function DELETE() {
  return handle(async () => {
    await store().setKV("assistant-md", { md: "", updatedAt: new Date().toISOString() });
    return loadKnowledge();
  });
}
