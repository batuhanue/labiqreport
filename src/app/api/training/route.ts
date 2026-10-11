import { after } from "next/server";
import { bad, handle } from "@/lib/api";
import { readPeople, setPerson } from "@/lib/people";
import { answerQuestion, trainStep, trainingView } from "@/lib/training";
import { importanceStats } from "@/lib/learning";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Beyni eğit.
 * GET → durum (aylar, kişi haritası, sorular, isabet) · ?people=1 → kişi listesi
 * POST { action: "step", force? } → bir eğitim adımı (≤55 sn; istemci bitene kadar tekrarlar)
 * POST { action: "background" } → gerekiyorsa arka planda bir adım
 * POST { action: "answer", id, answer|null } · { action: "person", key, override?, note? }
 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  if (p.has("people")) return handle(async () => readPeople());
  return handle(async () => ({ ...(await trainingView()), importance: await importanceStats() }));
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { action?: string; force?: boolean; id?: string; answer?: string | null; key?: string; override?: 1 | 2 | 3 | null; note?: string } | null;
  if (b?.action === "step") return handle(async () => trainStep({ budgetMs: 52000, force: b.force }));
  if (b?.action === "background")
    return handle(async () => {
      const v = await trainingView();
      if (v.due && !v.running) after(() => trainStep({ budgetMs: 45000 }).catch(() => null));
      return { started: v.due && !v.running };
    });
  if (b?.action === "answer" && b.id) return handle(async () => ({ question: await answerQuestion(b.id!, b.answer ?? null) }));
  if (b?.action === "person" && b.key) return handle(async () => ({ person: await setPerson(b.key!, { override: b.override, note: b.note }) }));
  return bad("Geçersiz istek");
}
