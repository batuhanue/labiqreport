import { bad, handle } from "@/lib/api";
import { parseWorkbook } from "@/lib/excel";

export const dynamic = "force-dynamic";

/** Mevcut Excel formunu okuyup dönem verisi olarak döndürür (kaydetmez). */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const period = String(form.get("period") ?? "");
  if (!(file instanceof File)) return bad("Dosya seçilmedi");
  if (file.size > 10 * 1024 * 1024) return bad("Dosya çok büyük");
  return handle(async () => parseWorkbook(new Uint8Array(await file.arrayBuffer()), period || undefined));
}
