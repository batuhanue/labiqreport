import { bad, handle } from "@/lib/api";
import { addBinary, addText, deleteCategory, kurumView, moveFile, removeFile, saveCategory } from "@/lib/kurum";
import { forgetKurum, trainKurum } from "@/lib/kurum-training";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Şirket verisi (dosya yöneticisi).
 * GET → dosyalar, kategoriler, eğitim birimleri
 * POST { action: "text", name, text, id?, size?, hospital, period, category } — metin (büyükse parça parça, aynı id ile)
 * POST { action: "category", id?, name, description } · { action: "category-delete", id }
 * POST { action: "move", id, hospital?, period?, category? }
 * POST { action: "train", hospital, period, category?, force? } — seçilen klasör(ler)i öğren · { action: "forget", key }
 * PUT ?name=&hospital=&period=&category= ham dosya (docx/xlsx/pptx/pdf) · DELETE ?id=
 */
export async function GET() {
  return handle(kurumView);
}

type Body = { action?: string; name?: string; text?: string; id?: string; size?: number; hospital?: string; period?: string; category?: string; description?: string; force?: boolean; key?: string };

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b) return bad("Geçersiz istek");
  const action = b.action ?? (typeof b.text === "string" ? "text" : "");
  if (action === "text") {
    if (!b.name || typeof b.text !== "string" || !b.text.trim()) return bad("name ve text gerekli");
    return handle(async () => ({ file: await addText(b.name!, b.text!, { id: b.id, size: b.size, hospital: b.hospital, period: b.period, category: b.category }) }));
  }
  if (action === "category") {
    if (!b.name?.trim()) return bad("Kategori adı gerekli");
    return handle(async () => ({ category: await saveCategory({ id: b.id, name: b.name!, description: b.description }) }));
  }
  if (action === "category-delete" && b.id) return handle(async () => (await deleteCategory(b.id!), { ok: true }));
  if (action === "move" && b.id) return handle(async () => ({ file: await moveFile(b.id!, { hospital: b.hospital, period: b.period, category: b.category }) }));
  if (action === "train") {
    if (!b.hospital || b.period == null) return bad("Hastane ve dönem seçilmeli");
    return handle(() => trainKurum({ hospital: b.hospital!, period: b.period!, category: b.category ?? undefined }, { budgetMs: 50000, force: b.force }));
  }
  if (action === "forget" && b.key) return handle(async () => (await forgetKurum(b.key!), { ok: true }));
  return bad("Bilinmeyen işlem");
}

export async function PUT(req: Request) {
  const p = new URL(req.url).searchParams;
  const name = p.get("name");
  if (!name) return bad("name gerekli");
  return handle(async () => ({ file: await addBinary(name, Buffer.from(await req.arrayBuffer()), { hospital: p.get("hospital") ?? undefined, period: p.get("period") ?? "", category: p.get("category") ?? "" }, 50000) }));
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id gerekli");
  return handle(async () => {
    await removeFile(id);
    return { ok: true };
  });
}
