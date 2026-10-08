import { after } from "next/server";
import { bad, handle } from "@/lib/api";
import { LEARN_EVERY, learn } from "@/lib/learning";
import { agentProfile, approve, capture, due, interview, nextQueued, state, think, updateItem, work, type InterviewTurn } from "@/lib/brain";
import { DraftError } from "@/lib/gmail-draft";
import { setTrust } from "@/lib/trust";
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
  const b = (await req.json().catch(() => null)) as { action?: string; text?: string; id?: string; feedback?: string; agent?: string; team?: boolean; turns?: InterviewTurn[]; mail?: boolean; queued?: boolean; level?: number } | null;
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
      const item = await work(id, { feedback: b.feedback?.trim() || undefined, team: !!b.team, queued: !!b.queued });
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
    return handle(async () => {
      try {
        return { item: await approve(id, { mail: !!b.mail }) };
      } catch (e) {
        if (e instanceof DraftError) return Response.json({ error: e.message, code: e.code }, { status: e.code === "scope" ? 403 : 422 });
        throw e;
      }
    });
  }
  // ajanın güven seviyesi (0 Öner · 1 Kendisi onaylasın · 2 Teslimatı da hazırlasın)
  if (b?.action === "trust") {
    if (!b.agent || !agentById(b.agent)) return bad("Ajan seçilmedi");
    if (![0, 1, 2].includes(b.level as number)) return bad("Geçersiz seviye");
    return handle(async () => {
      await setTrust(b.agent as AgentId, b.level as 0 | 1 | 2);
      return { state: await state() };
    });
  }
  if (b?.action === "auto") {
    return handle(async () => {
      if (!(await due(30))) {
        // düşünme zamanı değilse, ajanın kendisi yapacağı sıradaki işi arka planda yap
        const q = await nextQueued();
        if (q) after(() => work(q, { queued: true }).catch(() => null));
        return { started: false, working: q };
      }
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
  const b = (await req.json().catch(() => null)) as { id?: string; patch?: Partial<BrainItem>; reason?: string } | null;
  if (!b?.id || !b.patch) return bad("Eksik bilgi");
  if (b.patch.status && !STATUSES.includes(b.patch.status)) return bad("Geçersiz durum");
  return handle(async () => {
    const r = await updateItem(b.id!, b.patch!, { reason: b.reason?.slice(0, 400) });
    if (!r) return bad("İş bulunamadı", 404);
    // sebep verildiyse hemen öğren (yanıtta ne öğrendiğini göster); yoksa birikince arka planda
    if (r.explicit) return { item: r.item, trustNote: r.trustNote, learned: (await learn({ force: true, timeout: 25000 }).catch(() => null)) ?? [] };
    if (r.pending >= LEARN_EVERY) after(() => learn().catch(() => null));
    return { item: r.item, trustNote: r.trustNote };
  });
}
