import { after } from "next/server";
import { bad, handle } from "@/lib/api";
import { capture, due, state, think, updateItem } from "@/lib/brain";
import type { BrainItem, ItemStatus } from "@/lib/brain-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUSES: ItemStatus[] = ["inbox", "todo", "doing", "waiting", "done", "dismissed"];

/** Beyin durumu: işler, odak, son düşünmeler. */
export async function GET() {
  return handle(state);
}

/**
 * { action: "think" }            — şimdi düşün (tüm ajanlar)
 * { action: "auto" }             — otomatik: son düşünmeden 30 dk geçtiyse arka planda düşün
 * { action: "capture", text }    — beyne not yaz; görev ajanı hemen işe çevirir
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { action?: string; text?: string } | null;
  if (b?.action === "capture") {
    const text = b.text?.trim();
    if (!text) return bad("Boş not");
    if (text.length > 4000) return bad("Not çok uzun");
    return handle(async () => {
      await capture(text);
      const run = await think({ trigger: "capture", only: ["gorev"], budgetMs: 45000 });
      return { run, state: await state() };
    });
  }
  if (b?.action === "auto") {
    return handle(async () => {
      if (!(await due(30))) return { started: false };
      after(() => think({ trigger: "auto" }).catch(() => null));
      return { started: true };
    });
  }
  if (b?.action === "think") {
    return handle(async () => {
      const run = await think({ trigger: "manual" });
      if (!run) return bad("Beyin şu an zaten düşünüyor; biraz sonra tekrar dene.", 409);
      return { run, state: await state() };
    });
  }
  return bad("Bilinmeyen işlem");
}

/** { id, patch } — iş durumunu/adımlarını güncelle */
export async function PATCH(req: Request) {
  const b = (await req.json().catch(() => null)) as { id?: string; patch?: Partial<BrainItem> } | null;
  if (!b?.id || !b.patch) return bad("Eksik bilgi");
  if (b.patch.status && !STATUSES.includes(b.patch.status)) return bad("Geçersiz durum");
  return handle(async () => {
    const it = await updateItem(b.id!, b.patch!);
    if (!it) return bad("İş bulunamadı", 404);
    return { item: it };
  });
}
