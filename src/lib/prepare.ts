import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { mailWith, rowsIn } from "./archive";
import { TOOLS as ARCHIVE_TOOLS, runTool } from "./agent-tools";
import { brainBlocks } from "./brain-prompt";
import type { BrainItem } from "./brain-types";
import { AREAS } from "./checklist";
import { addUsage, ASSISTANT_MODEL, claude, claudeConfigured, logUsage, newUsage } from "./claude";
import { store } from "./db";
import { getSnapshot } from "./google";
import type { GEvent } from "./google-types";
import { findPerson, readPeople, statLine } from "./people";
import { areaProgress, deadlineInfo, normalizePeriod, periodLabel } from "./period";
import type { TodoStore } from "./todo";

/*
 * Hazırla: Batuhan tek cümleyle ("yarın patronla toplantım var, son mailler, chatler ve R-05 işiyle konuşulacakları
 * hazırla") ya da takvimdeki bir toplantıya tek dokunuşla not ister. Beyin kişilerle son yazışmaları, sohbetleri,
 * açık işleri, görevleri ve denetim durumunu kendisi toplar; gerekirse arşivde arar; kaynaklı, kısa bir not yazar.
 */

export interface Brief {
  id: string;
  request: string;
  title: string;
  md: string;
  at: string;
  meetingId?: string;
  sources: number;
  ms: number;
}
export interface MeetingChip {
  id: string;
  title: string;
  start: string;
  who: string[];
  label: string;
}

const KEY = "briefs";
const DAY = 86400_000;
export const listBriefs = async () => (await store().getKV<Brief[]>(KEY)) ?? [];
export async function removeBrief(id: string) {
  await store().setKV(KEY, (await listBriefs()).filter((b) => b.id !== id));
}

const norm = (t: string) => t.toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
const soon = (items: GEvent[], now = Date.now()) => items.filter((e) => !e.allDay && e.response !== "declined" && Date.parse(e.end) > now && Date.parse(e.start) < now + 2 * DAY).sort((a, b) => a.start.localeCompare(b.start));
const GENERIC = /^(toplanti\S*|gorusme\S*|haftalik|aylik|gunluk|hakkinda|icin|ile|bey|hanim|degerlendirme\S*|gozden|gecirme)$/;
/** Serbest istekte adı/başlığı geçen yaklaşan toplantı ("yarın Hakan Bey'le toplantım var…") */
function meetingIn(request: string, items: GEvent[], me?: string) {
  const q = norm(request);
  const hit = (w: string) => w.length >= 3 && !GENERIC.test(w) && q.includes(w);
  let best: { e: GEvent; score: number } | undefined;
  for (const e of soon(items)) {
    // katılımcı adı başlık kelimesinden ağır basar; eşitlikte en yakın toplantı
    const names = new Set(e.attendees.filter((a) => a.email.toLowerCase() !== me).flatMap((a) => norm(a.name || "").split(/\s+/)));
    const title = new Set(norm(e.title).split(/\s+/).filter((w) => w.length >= 4));
    const score = [...names].filter(hit).length * 2 + [...title].filter(hit).length;
    if (score >= 2 && (!best || score > best.score)) best = { e, score };
  }
  return best?.e;
}
const trWhen = (iso: string) => new Date(iso).toLocaleString("tr-TR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const short = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "Europe/Istanbul" });
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** Önümüzdeki 2 günün katılımcılı toplantıları (tek dokunuşla hazırlık) */
export async function upcomingMeetings(): Promise<MeetingChip[]> {
  const snap = await getSnapshot().catch(() => null);
  const now = Date.now();
  return soon(snap?.calendar.items ?? [], now)
    .filter((e) => e.attendees.length)
    .slice(0, 6)
    .map((e) => {
      const d = new Date(e.start);
      const today = new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
      const day = new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
      const when = day === today ? "Bugün" : "Yarın";
      const hm = d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
      return { id: e.id, title: e.title, start: e.start, who: e.attendees.map((a) => a.name || a.email).slice(0, 6), label: `${when} ${hm} · ${e.title}` };
    });
}

/** Deterministik bağlam: toplantı + katılımcılarla son yazışmalar, açık işler, görevler, denetim */
async function gather(request: string, meeting?: GEvent) {
  const [snap, items, todos, people, state] = await Promise.all([getSnapshot().catch(() => null), store().getKV<BrainItem[]>("brain-items"), store().getKV<TodoStore>("todos"), readPeople().catch(() => ({ at: "", people: [] })), store().getState()]);
  const L: string[] = [];
  let sources = 0;
  const me = snap?.account?.email?.toLowerCase();
  if (meeting) {
    L.push(`## TOPLANTI\n${meeting.title} — ${trWhen(meeting.start)}${meeting.location ? ` · ${meeting.location}` : ""}\nKatılımcılar: ${meeting.attendees.map((a) => `${a.name} <${a.email}>`).join(", ")}${meeting.description ? `\nAçıklama: ${clip(meeting.description, 600)}` : ""}`);
    const since = new Date(Date.now() - 30 * DAY).toISOString();
    for (const a of meeting.attendees.filter((x) => x.email.toLowerCase() !== me).slice(0, 5)) {
      const p = findPerson(people, { email: a.email, name: a.name });
      const rows = (await mailWith(a.email, since, 12).catch(() => [])).slice(0, 8);
      sources += rows.length;
      L.push(`### ${a.name}${p ? ` — ${[p.role, statLine(p)].filter(Boolean).join(" · ")}` : ""}\nSon 30 gün yazışmalar:\n${rows.map((r) => `- ${short(r.ts)} ${r.meta?.sent === true ? "Batuhan →" : "←"} ${r.title}`).join("\n") || "- (yok)"}`);
    }
  }
  // yaklaşan toplantılar (istek bir toplantıdan söz ediyorsa hangisi olduğunu bilsin)
  const next = soon(snap?.calendar.items ?? []).filter((e) => e.id !== meeting?.id).slice(0, 8);
  if (next.length) L.push(`## YAKLAŞAN TOPLANTILAR (48 saat)\n${next.map((e) => `- ${trWhen(e.start)} · ${e.title}${e.attendees.length ? ` · ${e.attendees.map((a) => a.name || a.email).slice(0, 6).join(", ")}` : ""}`).join("\n")}`);
  // son 7 günün e-posta ve sohbetleri (başlıklar) — ajan ayrıntı için arşivde arar
  const NOISE = /CATEGORY_PROMOTIONS|CATEGORY_SOCIAL|CATEGORY_FORUMS|SPAM|TRASH/;
  const recent = (await rowsIn(["gmail", "chat"], new Date(Date.now() - 7 * DAY).toISOString(), undefined, { limit: 200, bodyChars: 160 }).catch(() => [])).filter((r) => !NOISE.test(((r.meta?.labels as string[] | undefined) ?? []).join(" ")));
  sources += recent.length;
  if (recent.length)
    L.push(
      `## SON 7 GÜN (e-posta ve sohbet başlıkları; ayrıntı için search_archive / get_archive_item)\n${recent
        .slice(0, 60)
        .map((r) => `- ${short(r.ts)} [${r.source}/${r.id}] ${r.source === "gmail" ? `${r.meta?.sent === true ? "Batuhan →" : r.who.split(" <")[0] + " →"} ${r.title}` : `${r.title} · ${r.meta?.mine === true ? "Batuhan" : r.who}: ${clip(r.body, 120)}`}`)
        .join("\n")}`,
    );
  const open = (items ?? []).filter((x) => x.status !== "done" && x.status !== "dismissed");
  if (open.length) L.push(`## BEYİNDEKİ AÇIK İŞLER\n${open.slice(0, 30).map((x) => `- [${x.status}${x.due ? ` · ${x.due}` : ""}${x.person ? ` · ${x.person}` : ""}] ${x.title} — ${clip(x.summary, 140)}`).join("\n")}`);
  const td = (todos?.todos ?? []).filter((t) => !t.done);
  if (td.length) L.push(`## KİŞİSEL GÖREVLER\n${td.slice(0, 25).map((t) => `- ${t.title}${t.due ? ` (${t.due})` : ""}`).join("\n")}`);
  if (state.activePeriod) {
    const raw = await store().getPeriod(state.activePeriod).catch(() => null);
    if (raw) {
      const p = normalizePeriod(raw);
      L.push(
        `## DENETİM — ${periodLabel(p.period)}\n${AREAS.map((a) => {
          const pr = areaProgress(p, a);
          const d = deadlineInfo(p.period, a);
          const fails = a.items.filter((it) => p.items[it.id]?.bursa === "fail" || p.items[it.id]?.basaksehir === "fail").length;
          return `- ${a.code} ${a.title}: Bursa ${pr.bursa}/${pr.total}, Başakşehir ${pr.basaksehir}/${pr.total}${fails ? `, ${fails} bulgu` : ""}${d.days != null ? ` · ${d.days < 0 ? `termin ${-d.days} gün geçti` : `termine ${d.days} gün`}` : ""}`;
        }).join("\n")}${p.actions.length ? `\nAçık aksiyonlar: ${p.actions.filter((x) => x.status !== "Tamamlandı").length}` : ""}`,
      );
    }
  }
  void request;
  return { text: L.join("\n\n"), sources };
}

/** Notu hazırlar (≈50 sn bütçe; gerekirse arşivde arar) */
export async function prepare(input: { request: string; meetingId?: string }): Promise<Brief> {
  if (!claudeConfigured()) throw new Error("ANTHROPIC_API_KEY tanımlı değil");
  const t0 = Date.now();
  const deadline = t0 + 50_000;
  const u = newUsage();
  let rounds = 0;
  let error: string | undefined;
  const snap = await getSnapshot().catch(() => null);
  const meeting = input.meetingId ? snap?.calendar.items.find((e) => e.id === input.meetingId) : meetingIn(input.request, snap?.calendar.items ?? [], snap?.account?.email?.toLowerCase());
  const request = input.request.trim() || (meeting ? `${meeting.title} toplantısı için konuşulacakları hazırla` : "");
  if (!request) throw new Error("Ne hazırlayayım?");
  try {
    const ctx = await gather(request, meeting);
    const system = await brainBlocks();
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `ŞU AN: Hazırlık notu. Batuhan şunu istiyor: "${request}"
Bugün: ${trWhen(new Date().toISOString())}.

Aşağıda toplanmış bağlam var. Eksik kalan ayrıntı için (ör. bir e-postanın tamamı, bir kişiyle son konuşma, bir rakam) search_archive / get_archive_item kullan; en çok birkaç arama yap, hızlı ol.
Notu Batuhan'ın ağzından, kısa ve kullanıma hazır yaz (toplantıda göz atacağı bir sayfa). Uydurma; her önemli maddenin sonunda kaynağını kısaca ver (ör. "— Hakan Bey'in 12 Eki e-postası").
Biçim (Markdown):
# <kısa başlık>
## Özet (en çok 3 madde)
## Konuşulacaklar (önem sırasıyla; her madde: durum + rakam/tarih + ne isteyeceğim/söyleyeceğim)
## Benden beklenenler ve verdiğim sözler
## Karşı taraftan isteyeceklerim
## Riskler / dikkat
## Kaynaklar (e-posta, sohbet, toplantı, iş — tarih ile)

${ctx.text}`,
      },
    ];
    let text = "";
    for (let i = 0; i < 6; i++) {
      const left = deadline - Date.now();
      if (left < 6000) break;
      const res = await claude().messages.create({ model: ASSISTANT_MODEL, max_tokens: 6000, system, tools: ARCHIVE_TOOLS, output_config: { effort: "medium" }, messages }, { timeout: Math.min(40_000, left), maxRetries: 1 });
      rounds++;
      addUsage(u, res);
      text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim() || text;
      const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !calls.length) break;
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const c of calls) {
        try {
          results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(await runTool(c)).slice(0, 12000) });
        } catch (e) {
          results.push({ type: "tool_result", tool_use_id: c.id, is_error: true, content: (e as Error).message });
        }
      }
      messages.push({ role: "user", content: results });
      // süre azaldıysa son tur: araçsız yazdır
      if (deadline - Date.now() < 20000) messages.push({ role: "user", content: "Süre az: aramayı bırak, eldekiyle notu şimdi yaz." });
    }
    if (!text.trim()) throw new Error("Not yazılamadı (süre doldu). Daha dar bir istekle tekrar dene.");
    const md = text.replace(/^[\s\S]*?(?=^# )/m, "").trim() || text.trim();
    const brief: Brief = { id: Math.random().toString(36).slice(2, 10), request, title: md.match(/^# (.+)$/m)?.[1]?.trim() ?? request.slice(0, 80), md, at: new Date().toISOString(), meetingId: meeting?.id, sources: ctx.sources, ms: Date.now() - t0 };
    await store().setKV(KEY, [brief, ...(await listBriefs())].slice(0, 30));
    return brief;
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 200) : String(e);
    throw e;
  } finally {
    await logUsage("📝 Hazırla", u, { t0, rounds, error });
  }
}
