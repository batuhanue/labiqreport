import { bad, handle } from "@/lib/api";
import { listKnowledge, removeKnowledge, safeName, saveKnowledge } from "@/lib/assistant";

export const dynamic = "force-dynamic";

/** Asistanın okuduğu tüm bilgi dosyaları. */
export async function GET() {
  return handle(async () => ({ files: await listKnowledge() }));
}

/** Dosya kaydet / yeni dosya ekle: { name, md } */
export async function PUT(req: Request) {
  const { name, md } = ((await req.json().catch(() => ({}))) ?? {}) as { name?: string; md?: string };
  if (!name || !safeName(name).replace(/\.md$/, "")) return bad("Dosya adı gerekli");
  if (typeof md !== "string" || !md.trim()) return bad("Boş içerik");
  if (md.length > 400_000) return bad("Dosya çok büyük (400 KB üstü)");
  return handle(async () => {
    await saveKnowledge(name, md);
    return { files: await listKnowledge() };
  });
}

/** ?name=… — düzenlenmiş varsayılanı sıfırlar ya da eklenen dosyayı siler */
export async function DELETE(req: Request) {
  const name = new URL(req.url).searchParams.get("name");
  if (!name) return bad("Dosya adı gerekli");
  return handle(async () => {
    await removeKnowledge(name);
    return { files: await listKnowledge() };
  });
}
