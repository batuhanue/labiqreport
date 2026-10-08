import { after } from "next/server";
import { bad, handle } from "@/lib/api";
import { agentProfile, approve, capture, due, interview, state, think, updateItem, work, type InterviewTurn } from "@/lib/brain";
import { agentById, type AgentId, type BrainItem, type ItemStatus } from "@/lib/brain-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUSES: ItemStatus[] = ["inbox", "todo", "doing", "waiting", "done", "dismissed"];

/** Beyin durumu: işler, odak, son düşünmeler. ?agent=… : ajanın talimatı ve öğrendiği kurallar */
export async function GET(req: Request) {
  const agent = new URL(req.url).searchParams.get("agent");
  if (agent) {
    if (!agentById(agent)) return bad("Bilinmeyen ajan");
    return handle(async () => ({ profile: await agentProfile(agent as AgentId) }));
  }
  return handle(state);
}

/**
 * { action: "think" }            — şimdi düşün (tüm ajanlar)
 * { action: "auto" }             — otomatik: son düşünmeden 30 dk geçtiyse arka planda düşün
 * { action: "capture", text }    — beyne not yaz; görev ajanı hemen işe çevirir
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { action?: string; text?: string; id?: string; feedback?: string; agent?: string; team?: boolean; turns?: InterviewTurn[] } | null;
  if (b?.action === "capture") {
    const text = b.text?.trim();
    if (!text) return bad("Boş not");
    if (text.length > 4000) return bad("Not çok uzun");
    return handle(async () => {
      await capture(text);
      const run = await think({ trigger: "capture", only: ["gorev"], budgetMs: 25000 });
      // seçilen ajan işi üstlenir
      const pick = b.agent && agentById(b.agent) ? (b.agent as AgentId) : undefined;
      if (pick) for (const id of run?.createdIds ?? []) await updateItem(id, { agent: pick });
      return { run, state: await state() };
    });
  }
  // ajan işi yapar (teslimat); feedback verilirse önceki teslimatı düzeltir ve kalıcıysa kuralı öğrenir
  if (b?.action === "work") {
    if (!b.id) return bad("İş seçilmedi");
    const id = b.id;
    return handle(async () => {
      const item = await work(id, { feedback: b.feedback?.trim() || undefined, team: !!b.team });
      if (!item) return bad("İş bulunamadı", 404);
      return { item };
    });
  }
  // lider görüşmesi: sıradaki soru ya da (bitince) yazılan talimat + beceri
  if (b?.action === "interview") {
    if (!b.agent || !agentById(b.agent)) return bad("Ajan seçilmedi");
    const turns = (b.turns ?? []).slice(0, 5).map((t) => ({ q: String(t.q ?? "").slice(0, 500), a: String(t.a ?? "").slice(0, 2000) }));
    return handle(() => interview(b.agent as AgentId, turns));
  }
  if (b?.action === "approve") {
    if (!b.id) return bad("İş seçilmedi");
    const id = b.id;
    return handle(async () => ({ item: await approve(id) }));
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
