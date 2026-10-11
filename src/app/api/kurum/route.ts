import { bad, handle } from "@/lib/api";
import { addBinary, addText, listFiles, removeFile } from "@/lib/kurum";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Şirket verisi: GET liste · POST {name, text, id?} metin (büyükse parça parça, aynı id ile) · PUT ?name= ham dosya (docx/xlsx/pptx/pdf) · DELETE ?id= */
export async function GET() {
  return handle(async () => ({ files: await listFiles() }));
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { name?: string; text?: string; id?: string; size?: number } | null;
  if (!b?.name || typeof b.text !== "string" || !b.text.trim()) return bad("name ve text gerekli");
  return handle(async () => ({ file: await addText(b.name!, b.text!, { id: b.id, size: b.size }) }));
}

export async function PUT(req: Request) {
  const name = new URL(req.url).searchParams.get("name");
  if (!name) return bad("name gerekli");
  return handle(async () => ({ file: await addBinary(name, Buffer.from(await req.arrayBuffer()), 50000) }));
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id gerekli");
  return handle(async () => {
    await removeFile(id);
    return { ok: true };
  });
}
