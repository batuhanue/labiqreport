import { after } from "next/server";
import { bad, handle } from "@/lib/api";
import { CHOICE_LABEL, type Choice } from "@/lib/brain-types";
import { LEARN_EVERY, learn, learningState, recordChoices } from "@/lib/learning";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Öğrenme durumu: bekleyen seçim sayısı, son öğrenilenler */
export async function GET() {
  return handle(learningState);
}

/**
 * { action: "record", choices: [...] } — uygulamadaki seçimleri kaydet (görevler, asistan önerileri)
 * { action: "learn" }                   — bekleyenlerden şimdi öğren
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { action?: string; choices?: Omit<Choice, "id" | "at">[] } | null;
  if (b?.action === "record") {
    const list = (b.choices ?? []).filter((c) => c && CHOICE_LABEL[c.kind] && typeof c.title === "string" && ["beyin", "gorevler", "asistan"].includes(c.where)).slice(0, 20);
    if (!list.length) return bad("Seçim yok");
    return handle(async () => {
      const pending = await recordChoices(list);
      if (list.some((c) => c.reason?.trim())) return { pending, learned: (await learn({ force: true, timeout: 25000 }).catch(() => null)) ?? [] };
      if (pending >= LEARN_EVERY) after(() => learn().catch(() => null));
      return { pending };
    });
  }
  if (b?.action === "learn") {
    return handle(async () => ({ learned: (await learn({ force: true })) ?? [], state: await learningState() }));
  }
  return bad("Bilinmeyen işlem");
}
