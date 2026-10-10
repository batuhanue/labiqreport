import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { getItem, search } from "./archive";
import { TOOLS as ARCHIVE_TOOLS, runTool, statusOf } from "./agent-tools";
import { listKnowledge, loadKnowledge, loadMemory, memoryPrompt, saveKnowledge } from "./assistant";
import { AREAS } from "./checklist";
import { ASSISTANT_MODEL, claude, claudeConfigured, costUsd, recordUsage } from "./claude";
import { store } from "./db";
import { getSnapshot } from "./google";
import { areaProgress, deadlineInfo, normalizePeriod, overallProgress, periodLabel } from "./period";
import { addWorkdays, buildPlan, checkFollowUps, daysSince, freeSlots, meetingsOn, ruleDecisions, trDay, trHM } from "./brain-plan";
import { emptyStore, type TodoStore } from "./todo";
import { brainSystem } from "./brain-prompt";
import { learn, learningState, readChoices, recentChoices, recordChoices } from "./learning";
import { createDraft } from "./gmail-draft";
import { pushConfigured, sendToAll } from "./push";
import { buildOrg, orgDigest, type BrainRaw } from "./org";
import type { NotifyMessage } from "./notify";
import { applyTrust, reviewTrust, trustView } from "./trust";
import { AGENTS, agentById, KIND_LABEL, type AgentId, type Choice, type AgentRun, type BrainFocus, type BrainItem, type Decision, type BrainRun, type BrainState, type ItemSource, type ItemWork, type Signal, type TeamPiece, type TeamRun } from "./brain-types";

/*
 * Beyin döngüsü (her "düşünme"):
 *  1) Topla  — kaynaklardan son turdan beri gelen yeni sinyaller (yapay zekâsız, ücretsiz)
 *  2) Anla   — her yan ajan kendi sinyallerini açık işlerle birlikte Claude'a verir; şemalı JSON ile
 *              yeni iş açar ya da var olanı günceller (aynı iş iki kez açılmaz)
 *  3) Dosya  — dosya ajanı her işe arşivden (Drive içerikleri dahil) ilgili dosyaları ekler
 *  4) Öncelik — beyin tüm açık işleri Batuhan'ın rolüne göre sıralar, "bugün odak" brifingini yazar
 * Ajanların açtığı işler "öneri" olarak gelir; Batuhan onaylayınca yapılacaklara geçer.
 */

const ITEMS_KEY = "brain-items";
const META_KEY = "brain-meta";

interface Meta {
  /** işlenmiş sinyaller: kimlik → işlenme zamanı (60 gün tutulur) */
  seen: Record<string, string>;
  focus: BrainFocus | null;
  runs: BrainRun[];
  lastRun?: string;
  lock?: number;
  /** elle yazılanlar (sonraki düşünmede işlenir) */
  captures: Signal[];
  /** son anlık bildirim (seyrek tutulur) */
  lastPush?: string;
}
const emptyMeta = (): Meta => ({ seen: {}, focus: null, runs: [], captures: [] });

const readItems = async () => (await store().getKV<BrainItem[]>(ITEMS_KEY)) ?? [];
const readMeta = async () => ({ ...emptyMeta(), ...((await store().getKV<Meta>(META_KEY)) ?? {}) });
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const istDay = (d = new Date()) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
const trTime = (s: string) => new Date(s).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const isOpen = (x: BrainItem) => x.status !== "done" && x.status !== "dismissed";

// ------------------------------------------------------------------ 1) sinyaller
async function collect(meta: Meta): Promise<Record<AgentId, Signal[]>> {
  const out: Record<AgentId, Signal[]> = { posta: [], sohbet: [], takvim: [], toplanti: [], denetim: [], dosya: [], gorev: [] };
  const fresh = (s: Signal) => !meta.seen[s.id];
  const now = Date.now();
  // ilk düşünmede son 3 gün; sonra son turdan (1 saat pay) beri
  const since = meta.lastRun ? Math.max(Date.parse(meta.lastRun) - 3600_000, now - 7 * 86400_000) : now - 3 * 86400_000;
  const snap = await getSnapshot().catch(() => null);

  if (snap) {
    // Posta: son gelenler (okunmamış/önemli işaretiyle); gövde arşivden
    for (const m of snap.gmail.items) {
      if (Date.parse(m.date) < since) continue;
      const s: Signal = {
        id: `gmail:${m.id}`,
        agent: "posta",
        ts: m.date,
        title: m.subject,
        who: `${m.from} <${m.fromEmail}>`,
        text: `${m.unread ? "[OKUNMADI] " : ""}${m.important ? "[ÖNEMLİ] " : ""}${m.snippet}`,
        link: m.link,
        ref: { source: "gmail", id: m.id },
      };
      if (fresh(s)) out.posta.push(s);
    }
    // Sohbet: başkalarının son mesajları (sohbet başına bir sinyal; son birkaç mesaj bağlamıyla)
    for (const sp of snap.chat.items) {
      const theirs = sp.messages.filter((x) => !x.mine && Date.parse(x.time) >= since);
      if (!theirs.length) continue;
      const last = theirs.at(-1)!;
      const s: Signal = {
        id: `chat:${sp.id}:${last.id}`,
        agent: "sohbet",
        ts: last.time,
        title: `${sp.kind === "DIRECT_MESSAGE" ? "DM" : "Alan"}: ${sp.title}`,
        who: [...new Set(theirs.map((x) => x.sender))].join(", "),
        text: sp.messages.slice(-6).map((x) => `${x.mine ? "Batuhan" : x.sender} (${trTime(x.time)}): ${x.text}`).join("\n"),
        link: sp.link,
      };
      if (fresh(s)) out.sohbet.push(s);
    }
    // Takvim: önümüzdeki 7 gün (etkinlik değişirse yeniden değerlendirilir)
    for (const e of snap.calendar.items) {
      const st = Date.parse(e.start);
      if (e.response === "declined" || st < now - 3600_000 || st > now + 7 * 86400_000) continue;
      const s: Signal = {
        id: `cal:${e.id}:${e.start}:${e.response ?? ""}`,
        agent: "takvim",
        ts: e.start,
        title: e.title,
        who: [e.organizer, ...e.attendees.map((a) => a.name)].filter(Boolean).slice(0, 8).join(", "),
        text: `${e.allDay ? `${e.start} (tüm gün)` : `${trTime(e.start)} – ${trTime(e.end)}`}${e.meet ? " · Google Meet" : ""}${e.location ? ` · ${e.location}` : ""}${e.response === "needsAction" ? " · DAVET YANITI BEKLİYOR" : ""}\n${clip(e.description ?? "", 800)}`,
        link: e.link,
        ref: { source: "calendar", id: e.id },
      };
      if (fresh(s)) out.takvim.push(s);
    }
    // Toplantı: transkripti olan son toplantılar
    for (const m of snap.meet.items) {
      if (Date.parse(m.end ?? m.start) < now - 7 * 86400_000) continue;
      const s: Signal = { id: `meet:${m.id}`, agent: "toplanti", ts: m.start, title: m.title ?? m.code ?? "Toplantı", who: m.participants.slice(0, 10).join(", "), text: m.transcriptText ?? "", ref: { source: "meet", id: m.id } };
      if (!fresh(s)) continue;
      const full = await getItem("meet", m.id).catch(() => null);
      if (full?.body) s.text = full.body;
      if (!s.text.trim()) continue; // transkript henüz hazır değil: sonra
      s.text = clip(s.text, 12000);
      out.toplanti.push(s);
    }
  }

  // e-posta gövdeleri arşivden (varsa)
  await Promise.all(
    out.posta.slice(0, 25).map(async (s) => {
      const full = await getItem("gmail", s.ref!.id).catch(() => null);
      if (full?.body) s.text = `${s.text}\n---\n${clip(full.body, 2500)}`;
    }),
  );

  // Denetim: terminine 3 gün kalan/geçen alanlar ve aksiyonu olmayan ✗ bulgular
  const { activePeriod } = await store().getState();
  const raw = activePeriod ? await store().getPeriod(activePeriod) : null;
  if (raw) {
    const p = normalizePeriod(raw);
    for (const a of AREAS) {
      const pr = areaProgress(p, a);
      const d = deadlineInfo(p.period, a);
      if (pr.both >= a.items.length || d.days == null || d.days > 3) continue;
      const missing = a.items.filter((it) => !["ok", "fail"].includes(String(p.items[it.id]?.bursa)) || !["ok", "fail"].includes(String(p.items[it.id]?.basaksehir)));
      const s: Signal = {
        id: `audit:${p.period}:${a.code}:${d.days < 0 ? "late" : d.days}`,
        agent: "denetim",
        ts: new Date().toISOString(),
        title: `${a.code} ${a.title} — ${d.days < 0 ? `termin ${-d.days} gün geçti` : d.days === 0 ? "termin bugün" : `termine ${d.days} gün`}`,
        text: `${periodLabel(p.period)} · ${a.deadlineLabel} · Bursa ${pr.bursa}/${pr.total}, Başakşehir ${pr.basaksehir}/${pr.total}\nEksik kontroller:\n${missing.map((it) => `- ${it.id} ${it.text.trim()}`).join("\n")}`,
      };
      if (fresh(s)) out.denetim.push(s);
    }
    for (const a of AREAS) {
      for (const it of a.items) {
        const st = p.items[it.id];
        for (const h of ["bursa", "basaksehir"] as const) {
          if (st?.[h] !== "fail" || p.actions.some((x) => x.itemId === it.id && x.hospital === h)) continue;
          const s: Signal = {
            id: `audit:${p.period}:fail:${it.id}:${h}`,
            agent: "denetim",
            ts: new Date().toISOString(),
            title: `✗ bulgu: ${it.id} (${h === "bursa" ? "Bursa" : "Başakşehir"}) — aksiyon kaydı yok`,
            text: `${a.code} ${a.title} · ${it.text.trim()}${st.note?.trim() ? `\nNot: ${st.note.trim()}` : ""}`,
          };
          if (fresh(s)) out.denetim.push(s);
        }
      }
    }
  }

  // Görev ajanı: beyne elle yazılanlar
  out.gorev.push(...meta.captures.filter(fresh));
  return out;
}

// ------------------------------------------------------------------ 2) ajanlar
const AGENT_RULES: Record<Exclude<AgentId, "dosya">, string> = {
  posta:
    "Sen Posta ajanısın. E-postaları oku; yalnızca Batuhan'dan bir şey isteyen, ona yanıt/onay/veri gerektiren, bir termini olan ya da rolü gereği takip etmesi gereken e-postalar için iş aç. Bülten, otomatik bildirim, bilgi amaçlı CC'ler için iş açma. Yanıt gerekiyorsa kind=yanit.",
  sohbet: "Sen Sohbet ajanısın. Google Chat mesajlarında Batuhan'a yöneltilen istekleri, sorulan soruları ve Batuhan'ın verdiği sözleri ('bakarım', 'gönderirim') iş olarak çıkar. Selamlaşma ve sohbet için iş açma.",
  takvim:
    "Sen Takvim ajanısın. Yaklaşan toplantılar için Batuhan'ın hazırlanması gereken bir şey varsa (veri, rapor, sunum, önceki toplantı aksiyonları) kind=toplanti hazırlık işi aç ve terminini toplantıdan önceye koy. Yanıt bekleyen davetler için kısa iş aç. Rutin/hazırlık gerektirmeyen toplantılar için iş açma.",
  toplanti:
    "Sen Toplantı ajanısın. Transkriptten alınan kararları ve Batuhan'a düşen (ya da Batuhan'ın takip etmesi gereken) aksiyonları çıkar; kim, ne, ne zaman. Başkasına verilen ama Batuhan'ın takip edeceği işler kind=takip.",
  denetim:
    "Sen Denetim ajanısın. Aylık kapanış kontrol listesindeki termin baskısı ve aksiyonu açılmamış ✗ bulgular için iş aç. Rol sınırını koru: düzeltmeyi sorumlu yapar, Batuhan kontrol eder ve takip eder. Adımlar kontrol yöntemine (bilgi dosyalarındaki yönteme) uygun olsun.",
  gorev:
    "Sen Görev ajanısın. Batuhan'ın beyne kendi yazdığı notları net, uygulanabilir işlere çevir: başlık, adımlar, termin, ilgili kişi. Yazılan işin şirketteki karşılığını bilgi dosyalarından ve bellekten tamamla.",
};

const ITEM_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["create", "update"], description: "create: yeni iş; update: açık işlerden birini (ref) güncelle" },
          ref: { type: "string", description: "update için açık işin kimliği, create için boş" },
          signal_ids: { type: "array", items: { type: "string" }, description: "bu işe kaynak olan sinyal kimlikleri" },
          title: { type: "string", description: "kısa, fiille başlayan iş başlığı" },
          summary: { type: "string", description: "ne isteniyor, kimden, hangi bağlamda (1-3 cümle)" },
          why: { type: "string", description: "neden Batuhan'ın işi ve rolüne göre önemi (1 cümle)" },
          kind: { type: "string", enum: ["gorev", "yanit", "toplanti", "takip", "bilgi"] },
          priority: { type: "integer", enum: [1, 2, 3, 4], description: "1 acil · 2 yüksek · 3 orta · 4 normal" },
          due: { type: "string", description: "YYYY-AA-GG ya da boş" },
          person: { type: "string", description: "ilgili kişi ya da boş" },
          area: { type: "string", description: "ilgili denetim başlığı (R-01…R-10) ya da boş" },
          steps: { type: "array", items: { type: "string" }, description: "2-6 somut adım" },
          file_query: { type: "string", description: "Drive/arşivde ilgili dosyayı bulmak için 2-5 anahtar kelime ya da boş" },
        },
        required: ["op", "ref", "signal_ids", "title", "summary", "why", "kind", "priority", "due", "person", "area", "steps", "file_query"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

const AGENT_ENUM = ["posta", "sohbet", "takvim", "toplanti", "denetim", "dosya", "gorev"] as const;
const STRATEGY_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "tek cümle: günün en önemli konusu ve neden (sayı yazma)" },
    brief: { type: "string", description: "2-4 maddelik markdown brifing (risk, fırsat, dikkat)" },
    decisions: {
      type: "array",
      description: "Batuhan'ın bugün vermesi gereken kararlar, en önemliden; en fazla 6",
      items: {
        type: "object",
        properties: {
          ref: { type: "string", description: "ilgili açık işin kimliği; yoksa boş (new_* ile iş açılır)" },
          type: { type: "string", enum: ["reply", "accept", "follow_up", "risk", "prep", "do"] },
          urgency: { type: "integer", enum: [1, 2, 3], description: "1 bugün mutlaka · 2 bugün · 3 bu hafta" },
          headline: { type: "string", description: "durum, tek cümle, kişi ve konu adıyla" },
          recommendation: { type: "string", description: "emir kipinde tek cümle somut öneri (kim, ne, ne zaman)" },
          why: { type: "string", description: "kısa gerekçe (termin, rol, risk)" },
          prepare: { type: "boolean", description: "ajan teslimatı (yanıt/hatırlatma/hazırlık notu/özet) şimdiden hazırlasın mı" },
          new_title: { type: "string", description: "ref boşsa açılacak işin başlığı, değilse boş" },
          new_agent: { type: "string", enum: [...AGENT_ENUM, ""] },
          new_kind: { type: "string", enum: ["gorev", "yanit", "toplanti", "takip", "bilgi", ""] },
          new_summary: { type: "string" },
          new_due: { type: "string", description: "YYYY-AA-GG ya da boş" },
          new_steps: { type: "array", items: { type: "string" } },
        },
        required: ["ref", "type", "urgency", "headline", "recommendation", "why", "prepare", "new_title", "new_agent", "new_kind", "new_summary", "new_due", "new_steps"],
        additionalProperties: false,
      },
    },
    plan: {
      type: "array",
      description: "bugünkü boş saatlere yerleştirilen odak blokları (toplantılar hariç)",
      items: {
        type: "object",
        properties: {
          start: { type: "string", description: "HH:MM" },
          end: { type: "string", description: "HH:MM" },
          title: { type: "string" },
          ref: { type: "string", description: "ilgili iş kimliği ya da boş" },
        },
        required: ["start", "end", "title", "ref"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "brief", "decisions", "plan"],
  additionalProperties: false,
} as const;

interface AgentOut {
  op: "create" | "update";
  ref: string;
  signal_ids: string[];
  title: string;
  summary: string;
  why: string;
  kind: BrainItem["kind"];
  priority: number;
  due: string;
  person: string;
  area: string;
  steps: string[];
  file_query: string;
}

type Usage = { input: number; cacheRead: number; cacheWrite: number; cacheWrite1h: number; output: number };
const addUsage = (u: Usage, m: Anthropic.Message) => {
  u.input += m.usage.input_tokens ?? 0;
  u.cacheRead += m.usage.cache_read_input_tokens ?? 0;
  u.cacheWrite += m.usage.cache_creation_input_tokens ?? 0;
  u.cacheWrite1h += m.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  u.output += m.usage.output_tokens ?? 0;
};

const openList = (items: BrainItem[]) =>
  items
    .filter(isOpen)
    .slice(0, 80)
    .map((x) => `- [${x.id}] (${x.status}, P${x.priority}${x.due ? `, termin ${x.due}` : ""}) ${x.title} — kaynak: ${x.sources.map((s) => s.title).slice(0, 3).join(" | ")}`)
    .join("\n") || "(açık iş yok)";

async function runAgent(agent: Exclude<AgentId, "dosya">, signals: Signal[], items: BrainItem[], system: Anthropic.TextBlockParam[], usage: Usage, timeout: number) {
  const today = istDay();
  const choices = await recentChoices({ agent, limit: 25 }).catch(() => "");
  const content = `ŞU AN: ${AGENT_RULES[agent]}
Bugün: ${today} (${new Date().toLocaleDateString("tr-TR", { weekday: "long", timeZone: "Europe/Istanbul" })}).
${choices ? `\nBATUHAN'IN SON SEÇİMLERİ (önerilerine verdiği yanıtlar — bunlardan öğren: reddettiği türde iş açma, değiştirdiği önceliği/ajanı baştan öyle ver):\n${choices}\n` : ""}
AÇIK İŞLER (tekrar açma; gerekirse op=update ile güncelle):
${openList(items)}

YENİ SİNYALLER (${signals.length}):
${signals.map((s) => `### [${s.id}] ${s.title}\nZaman: ${trTime(s.ts)}${s.who ? `\nKimden/kimler: ${s.who}` : ""}\n${s.text}`).join("\n\n")}

Bu sinyallerden çıkan işleri döndür. İş gerektirmeyen sinyalleri atla (boş liste de geçerli).`;
  const res = await claude().messages.parse(
    {
      model: ASSISTANT_MODEL,
      max_tokens: 12000,
      system,
      output_config: { effort: "low", format: jsonSchemaOutputFormat(ITEM_SCHEMA) },
      messages: [{ role: "user", content }],
    },
    { timeout },
  );
  addUsage(usage, res);
  if (res.stop_reason === "refusal") return [];
  return (res.parsed_output?.items ?? []) as AgentOut[];
}

function apply(items: BrainItem[], agent: AgentId, outs: AgentOut[], signals: Signal[]) {
  const byId = new Map(signals.map((s) => [s.id, s]));
  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;
  const touched: BrainItem[] = [];
  const createdIds: string[] = [];
  for (const o of outs) {
    const srcs: ItemSource[] = o.signal_ids
      .map((id) => byId.get(id))
      .filter((s): s is Signal => !!s)
      .map((s) => ({ agent: s.agent, signalId: s.id, title: s.title, who: s.who, ts: s.ts, link: s.link, ref: s.ref }));
    const due = /^\d{4}-\d{2}-\d{2}$/.test(o.due) ? o.due : undefined;
    const prio = ([1, 2, 3, 4].includes(o.priority) ? o.priority : 3) as BrainItem["priority"];
    const existing = o.op === "update" ? items.find((x) => x.id === o.ref && isOpen(x)) : undefined;
    if (existing) {
      existing.summary = o.summary || existing.summary;
      existing.why = o.why || existing.why;
      existing.priority = Math.min(existing.priority, prio) as BrainItem["priority"];
      existing.due = due ?? existing.due;
      const have = new Set(existing.steps.map((s) => s.title));
      for (const st of o.steps) if (!have.has(st)) existing.steps.push({ title: st, done: false });
      for (const s of srcs) if (!existing.sources.some((x) => x.signalId === s.signalId)) existing.sources.push(s);
      existing.updatedAt = now;
      touched.push(existing);
      updated++;
      (existing as BrainItem & { _q?: string })._q = o.file_query;
      continue;
    }
    const it: BrainItem & { _q?: string } = {
      id: uid(),
      title: o.title,
      summary: o.summary,
      why: o.why,
      kind: o.kind,
      priority: prio,
      due,
      person: o.person || undefined,
      area: /^R-\d{2}$/.test(o.area) ? o.area : undefined,
      steps: o.steps.map((t) => ({ title: t, done: false })),
      files: [],
      sources: srcs,
      agent,
      // elle yazdığın iş doğrudan yapılacaklara; ajan önerileri onay bekler
      status: agent === "gorev" ? "todo" : "inbox",
      createdAt: now,
      updatedAt: now,
      _q: o.file_query,
    };
    items.unshift(it);
    touched.push(it);
    createdIds.push(it.id);
    created++;
  }
  return { created, updated, touched, createdIds };
}

// ------------------------------------------------------------------ 3) dosya ajanı
async function attachFiles(touched: (BrainItem & { _q?: string })[]) {
  let n = 0;
  await Promise.all(
    touched.map(async (it) => {
      const q = it._q?.trim();
      delete it._q;
      if (!q) return;
      const hits = await search({ query: q, source: "drive", limit: 3 }).catch(() => []);
      for (const h of hits) {
        if (it.files.some((f) => f.id === h.id)) continue;
        it.files.push({ id: h.id, name: h.title, link: h.link, excerpt: clip(h.excerpt.replace(/^Tür: [^\n]*\n*/, ""), 200) });
        n++;
      }
      it.files = it.files.slice(0, 5);
    }),
  );
  return n;
}

// ------------------------------------------------------------------ 4) strateji (şef yardımcısı)
/*
 * Bütün kaynakları birlikte okur: takvim (bugün/yarın, boş saatler), denetim terminleri, açık işler ve teslimat
 * durumları, yanıt beklenen gönderimler, kişisel görevler, son seçimler ve bellek. Çıktı: verilecek kararlar
 * (her biri tek cümle öneri + tek tuş), hiçbir işin karşılamadığı riskler için yeni işler, ve günün planı.
 */
interface StrategyOut {
  headline: string;
  brief: string;
  decisions: {
    ref: string;
    type: Decision["type"];
    urgency: number;
    headline: string;
    recommendation: string;
    why: string;
    prepare: boolean;
    new_title: string;
    new_agent: string;
    new_kind: string;
    new_summary: string;
    new_due: string;
    new_steps: string[];
  }[];
  plan: { start: string; end: string; title: string; ref: string }[];
}

const WORK_LABEL: Record<string, string> = { queued: "hazırlanıyor", running: "hazırlanıyor", ready: "teslimat hazır", waiting_ok: "taslak hazır, onay bekliyor", approved: "onaylandı", error: "hata" };
const STATUS_TR: Record<string, string> = { inbox: "öneri", todo: "yapılacak", doing: "sürüyor", waiting: "bekliyor" };

async function strategyContext(items: BrainItem[], overdueIds: Set<string>, now: Date, brain: BrainRaw) {
  const today = trDay(now);
  const tomorrow = trDay(new Date(+now + 86400_000));
  const snap = await getSnapshot().catch(() => null);
  const events = snap?.calendar.items ?? [];
  const fmtM = (day: string) =>
    meetingsOn(events, day)
      .map((m) => `- ${trHM(m.start)}–${trHM(m.end)} ${m.title}${m.who.length ? ` (${m.who.join(", ")})` : ""}`)
      .join("\n") || "(yok)";
  const invites = events.filter((e) => e.response === "needsAction" && Date.parse(e.start) > +now).slice(0, 5);
  const slots = freeSlots(events, now);

  // denetim
  const { activePeriod } = await store().getState();
  const raw = activePeriod ? await store().getPeriod(activePeriod) : null;
  let audit = "(aktif dönem yok)";
  if (raw) {
    const p = normalizePeriod(raw);
    const pr = overallProgress(p);
    const rows = AREAS.map((a) => ({ a, pr: areaProgress(p, a), d: deadlineInfo(p.period, a, now) }))
      .filter((x) => x.pr.both < x.a.items.length && x.d.days != null && x.d.days <= 5)
      .map((x) => `- ${x.a.code} ${x.a.title}: ${x.d.days! < 0 ? `termin ${-x.d.days!} gün geçti` : x.d.days === 0 ? "termin bugün" : `termine ${x.d.days} gün`} · Bursa ${x.pr.bursa}/${x.pr.total}, Başakşehir ${x.pr.basaksehir}/${x.pr.total}`);
    const openActs = p.actions.filter((x) => x.status !== "Tamamlandı");
    const lateActs = openActs.filter((x) => x.due && x.due < today);
    audit = `${periodLabel(p.period)} · %${Math.round(pr.overall * 100)} kontrol edildi · ${pr.fails} bulgu
Termini yakın/geçen alanlar:
${rows.join("\n") || "(yok)"}
Açık aksiyonlar: ${openActs.length}${lateActs.length ? ` (termini geçen ${lateActs.length}: ${lateActs.slice(0, 4).map((x) => `${x.areaCode} ${x.owner}`).join(", ")})` : ""}`;
  }

  const open = items.filter((x) => isOpen(x) && !(x.snoozeUntil && x.snoozeUntil > today));
  const waitingReplies = open.filter((x) => x.followUp && !x.followUp.replied && x.status === "waiting");
  const work = open.filter((x) => !(x.followUp && x.status === "waiting"));
  const todos = ((await store().getKV<TodoStore>("todos")) ?? emptyStore()).todos.filter((t) => !t.done && !t.source?.startsWith("brain:"));
  // ajan ağının ölçümleri: süreç tahminleri, darboğazlar, alan analistleri ve diğer ajanların uyarıları
  const analysis = await buildOrg(brain)
    .then(orgDigest)
    .catch(() => "(ölçülemedi)");
  return {
    events,
    text: `ŞU AN: Stratejistsin — Batuhan'ın şef yardımcısı. Onun yerine düşün: bütün kaynakları birlikte değerlendir, bugün vermesi gereken kararları çıkar, her biri için tek cümlelik net bir öneri yaz ve gününü planla. Batuhan her karara tek dokunuşla cevap verebilmeli; gerekli taslağı/notu ajanlar senin "prepare" işaretinle önden hazırlar.
Şu an: ${today} ${new Date(+now).toLocaleDateString("tr-TR", { weekday: "long", timeZone: "Europe/Istanbul" })} ${trHM(now)} (İstanbul).

TAKVİM — bugün:
${fmtM(today)}
Yarın:
${fmtM(tomorrow)}
Yanıt bekleyen davetler: ${invites.map((e) => `${e.title} (${trTime(e.start)})`).join(" · ") || "yok"}
Bugünkü boş saatler: ${slots.map((x) => `${trHM(x.start)}–${trHM(x.end)}`).join(", ") || "yok (gün bitti ya da dolu)"}

DENETİM: ${audit}

YANIT BEKLENEN GÖNDERİMLER (Batuhan gönderdi, karşı taraf yanıt vermedi):
${waitingReplies.map((x) => `- [${x.id}] ${x.followUp!.to.join(", ")} · "${x.title}" · ${daysSince(x.followUp!.since, now)} gündür yanıt yok${overdueIds.has(x.id) ? " · HATIRLATMA ZAMANI GELDİ" : ""} (hatırlatma: ${x.followUp!.nudges})`).join("\n") || "(yok)"}

BEYİNDEKİ AÇIK İŞLER:
${work
  .slice(0, 70)
  .map((x) => `- [${x.id}] (${STATUS_TR[x.status] ?? x.status}, P${x.priority}${x.due ? `, termin ${x.due}` : ""}, ${KIND_LABEL[x.kind]}, ${agentById(x.agent)?.name ?? x.agent}${x.work ? `, ${WORK_LABEL[x.work.status] ?? x.work.status}` : ""}) ${x.title} — ${clip(x.summary, 140)}`)
  .join("\n") || "(yok)"}

KİŞİSEL GÖREVLERİ:
${todos.slice(0, 40).map((t) => `- (P${t.priority}${t.due ? `, ${t.due}` : ""}) ${t.title}`).join("\n") || "(yok)"}

AJAN AĞININ ANALİZİ (ölçümler; kararlarını buna dayandır):
${analysis}

SON SEÇİMLERİ (neye evet/hayır dediği):
${(await recentChoices({ limit: 20 }).catch(() => "")) || "(henüz yok)"}

KURALLAR:
1. decisions en fazla 6, en önemliden. Karar = Batuhan'ın bugün vereceği bir evet/hayır ya da tek eylem. Bilgi amaçlı şeyleri karar yapma.
2. Mevcut bir işle ilgiliyse ref = o işin kimliği. Hiçbir işin karşılamadığı bir risk varsa (termini riskte denetim alanı, takvim çakışması, yanıtlanmamış davet, hazırlıksız toplantı) ref boş bırak, new_* ile iş aç (aynı konuda açık iş varsa onu kullan).
3. headline durumu kişi/konu adıyla tek cümlede söyler. recommendation emir kipinde, somut ve kısa: kime, ne, ne zaman ("Bumin Bey'e bugün 14:00'e kadar Başakşehir verisini sor"). "Kontrol et", "gözden geçir" gibi genel ifadeler yazma.
4. prepare=true: yanıt e-postası, hatırlatma, veri talebi, toplantı hazırlık notu ya da özet gerekiyorsa ve işin teslimatı henüz yoksa. Teslimatı hazır olan işte false.
5. type: reply (yanıt verilecek), accept (öneriyi üstlenmeli mi), follow_up (yanıt gelmeyen gönderim), risk (termin/çakışma), prep (toplantı hazırlığı), do (yapılacak iş).
6. Hatırlatma zamanı gelen gönderimleri follow_up kararı yap. Taslağı hazır işleri (onay bekliyor) mutlaka karar olarak sun.
   Süreç analizinde RİSK görünen yerleri (kapanış tahmini terminden geç, termini geçen alan, aksiyonsuz bulgu, notu olmayan yakın toplantı) mutlaka bir karara bağla; darboğazı çözen somut adımı öner.
7. Belleğe ve son seçimlerine uy: reddettiği türde işleri önerme; değiştirdiği önceliği esas al.
8. plan: bugünkü boş saatlere en önemli işleri yerleştir (30–90 dk, boş saatlerin dışına taşma, toplantıları yazma). Boş saat yoksa boş liste.
9. headline (en üst) tek cümle: günün en önemli konusu ve neden (karar sayısı yazma, uygulama gösteriyor). brief 2–4 madde: riskler, terminler, dikkat edilecekler.`,
  };
}

async function strategize(items: BrainItem[], overdueIds: Set<string>, system: Anthropic.TextBlockParam[], usage: Usage, timeout: number, raw: BrainRaw) {
  const now = new Date();
  const ctx = await strategyContext(items, overdueIds, now, raw);
  const res = await claude().messages.parse(
    { model: ASSISTANT_MODEL, max_tokens: 6000, system, output_config: { effort: "medium", format: jsonSchemaOutputFormat(STRATEGY_SCHEMA) }, messages: [{ role: "user", content: ctx.text }] },
    { timeout },
  );
  addUsage(usage, res);
  if (res.stop_reason === "refusal" || !res.parsed_output) return { out: null, events: ctx.events };
  return { out: res.parsed_output as StrategyOut, events: ctx.events };
}

/** En fazla bu kadar iş bir düşünmede önden hazırlığa alınır (maliyet sınırı). */
const PREP_PER_RUN = 3;

/** Strateji çıktısını uygula: yeni risk işleri, kararlar, önden hazırlık kuyruğu, gün planı. */
function applyStrategy(items: BrainItem[], out: StrategyOut | null, overdue: BrainItem[], events: Parameters<typeof buildPlan>[1]): BrainFocus {
  const now = new Date();
  const nowIso = now.toISOString();
  const today = trDay(now);
  const decisions: Decision[] = [];
  const prepare = new Set<string>();
  for (const d of out?.decisions ?? []) {
    let it = d.ref ? items.find((x) => x.id === d.ref && isOpen(x)) : undefined;
    if (!it && d.new_title.trim()) {
      const title = d.new_title.trim().slice(0, 200);
      it = items.find((x) => isOpen(x) && x.title.toLocaleLowerCase("tr") === title.toLocaleLowerCase("tr"));
      if (!it) {
        it = {
          id: uid(),
          title,
          summary: d.new_summary || d.headline,
          why: d.why,
          kind: (["gorev", "yanit", "toplanti", "takip", "bilgi"].includes(d.new_kind) ? d.new_kind : "takip") as BrainItem["kind"],
          priority: (d.urgency === 1 ? 1 : d.urgency === 2 ? 2 : 3) as BrainItem["priority"],
          due: /^\d{4}-\d{2}-\d{2}$/.test(d.new_due) ? d.new_due : undefined,
          steps: d.new_steps.slice(0, 6).map((t) => ({ title: t, done: false })),
          files: [],
          sources: [],
          agent: (agentById(d.new_agent) ? d.new_agent : "gorev") as AgentId,
          status: "inbox",
          origin: "strateji",
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        items.unshift(it);
      }
    }
    if (!it || decisions.some((x) => x.itemId === it!.id)) continue;
    decisions.push({ itemId: it.id, type: d.type, urgency: ([1, 2, 3].includes(d.urgency) ? d.urgency : 2) as Decision["urgency"], headline: d.headline, recommendation: d.recommendation, why: d.why });
    if (d.prepare && !it.work) prepare.add(it.id);
  }
  // yapay zekâ eksik bıraktıysa: hazır taslaklar ve yanıtı geciken gönderimler her zaman karar olur
  for (const r of ruleDecisions(items, now)) {
    if (decisions.length >= 7) break;
    if (decisions.some((x) => x.itemId === r.itemId)) continue;
    if (out && r.type !== "reply" && r.type !== "follow_up") continue;
    decisions.push(r);
  }
  // yanıtı geciken gönderimler: hatırlatma taslağı önden
  for (const it of overdue) if (it.work?.status !== "queued" && it.work?.status !== "running" && !(it.work?.purpose === "followup" && it.work.status === "waiting_ok")) prepare.add(it.id);
  // önden hazırlık kuyruğu (öneri hâlâ Batuhan'ın onayında; yalnızca taslak/not hazırlanır)
  let queued = 0;
  for (const id of prepare) {
    if (queued >= PREP_PER_RUN) break;
    const it = items.find((x) => x.id === id);
    if (!it) continue;
    const followup = overdue.includes(it);
    it.work = { status: "queued", output: it.work?.output ?? "", used: [], revisions: it.work?.revisions ?? [], at: nowIso, purpose: followup ? "followup" : undefined };
    if (it.status === "inbox") it.prep = true;
    it.updatedAt = nowIso;
    queued++;
  }
  const valid = new Set(items.filter(isOpen).map((x) => x.id));
  return {
    at: nowIso,
    day: today,
    headline: out?.headline || (decisions.length ? `${decisions.length} karar seni bekliyor.` : "Şu an senden karar bekleyen bir şey yok; izlemeye devam ediyorum."),
    brief: out?.brief || "",
    decisions,
    plan: buildPlan(out?.plan ?? [], events, valid, now),
    order: decisions.map((d) => ({ id: d.itemId, reason: d.recommendation })),
  };
}

// ------------------------------------------------------------------ sana ulaşma (anlık bildirim)
/** Gün içinde: yeni acil karar ya da gelen yanıt varsa telefona bildirim (2 saatte en fazla bir). Sabah brifingi cron'da. */
async function pushNews(prev: BrainFocus | null, next: BrainFocus, items: BrainItem[], trigger: BrainRun["trigger"], meta: Meta) {
  if (!pushConfigured() || trigger === "cron") return;
  if (meta.lastPush && Date.now() - Date.parse(meta.lastPush) < 2 * 3600_000) return;
  const seen = new Set((prev?.decisions ?? []).map((d) => d.itemId));
  const urgent = (next.decisions ?? []).filter((d) => d.urgency === 1 && !seen.has(d.itemId));
  const replied = items.filter((x) => x.followUp?.replied && Date.now() - Date.parse(x.followUp.replied.at) < 6 * 3600_000 && Date.parse(x.updatedAt) > Date.now() - 120_000);
  const msgs: NotifyMessage[] = [];
  if (urgent.length) msgs.push({ kind: "brain", title: `🧠 ${urgent[0].headline}`, body: `${urgent[0].recommendation}${urgent.length > 1 ? ` (+${urgent.length - 1} karar)` : ""}`, url: "/", tag: "brain-urgent", level: "alert" });
  if (replied.length) msgs.push({ kind: "brain", title: `↩ ${replied[0].followUp!.replied!.from} yanıt verdi`, body: `${replied[0].title}: ${replied[0].followUp!.replied!.snippet}`, url: "/gorevler", tag: "brain-reply", level: "info" });
  if (!msgs.length) return;
  await sendToAll(msgs);
  meta.lastPush = new Date().toISOString();
}

/** Sabah brifingi (cron): kararlar, hazır taslaklar, gün planının ilk bloğu. */
export async function morningBrief(): Promise<NotifyMessage | null> {
  const [meta, items] = await Promise.all([readMeta(), readItems()]);
  const f = meta.focus;
  if (!f?.decisions) return null;
  const byId = new Map(items.map((x) => [x.id, x]));
  const live = f.decisions.filter((d) => {
    const it = byId.get(d.itemId);
    return it && isOpen(it);
  });
  const ready = live.filter((d) => {
    const w = byId.get(d.itemId)?.work?.status;
    return w === "waiting_ok" || w === "ready";
  }).length;
  if (!live.length) return null;
  const first = f.plan?.find((b) => b.kind === "focus");
  return {
    kind: "brain",
    title: `Günaydın Batuhan — ${live.length} karar${ready ? `, ${ready} taslak hazır` : ""}`,
    body: `${f.headline ?? live[0].headline}${first ? ` İlk odak: ${first.start} ${first.title}.` : ""}`,
    url: "/",
    tag: `brain-morning-${istDay()}`,
    level: "info",
  };
}

// ------------------------------------------------------------------ çalıştır
export async function think(opts: { trigger: BrainRun["trigger"]; budgetMs?: number; only?: AgentId[] }): Promise<BrainRun | null> {
  if (!claudeConfigured()) throw new Error("ANTHROPIC_API_KEY tanımlı değil");
  const budget = opts.budgetMs ?? 52000;
  const t0 = Date.now();
  const left = () => budget - (Date.now() - t0);
  const meta = await readMeta();
  if (meta.lock && meta.lock > Date.now()) return null; // başka bir düşünme sürüyor
  meta.lock = Date.now() + budget + 10000;
  await store().setKV(META_KEY, meta);

  const usage: Usage = { input: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0 };
  const run: BrainRun = { id: uid(), at: new Date().toISOString(), trigger: opts.trigger, ms: 0, agents: [], files: 0, tokens: 0, cost: 0 };
  let calls = 0;
  try {
    const [signals, knowledge, memory, items] = await Promise.all([collect(meta), loadKnowledge(), loadMemory(), readItems()]);
    const system: Anthropic.TextBlockParam[] = [
      { type: "text", text: brainSystem(knowledge), cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: memoryPrompt(memory), cache_control: { type: "ephemeral", ttl: "1h" } },
    ];
    const agents = (Object.keys(signals) as AgentId[]).filter((a) => a !== "dosya" && signals[a].length && (!opts.only || opts.only.includes(a))) as Exclude<AgentId, "dosya">[];
    const touched: BrainItem[] = [];
    const createdIds: string[] = [];
    // ajanlar paralel çalışır; her biri en fazla 20 sinyal (kalanı sonraki düşünmede)
    const results = await Promise.all(
      agents.map(async (a) => {
        const batch = signals[a].slice(0, 20);
        const s0 = Date.now();
        try {
          calls++;
          const outs = await runAgent(a, batch, items, system, usage, Math.max(8000, left() - 12000));
          return { a, batch, outs, ms: Date.now() - s0 };
        } catch (e) {
          return { a, batch, outs: null, ms: Date.now() - s0, error: e instanceof Error ? e.message.slice(0, 200) : String(e) };
        }
      }),
    );
    const now = new Date().toISOString();
    for (const r of results) {
      const ar: AgentRun = { agent: r.a, signals: r.batch.length, created: 0, updated: 0, ms: r.ms, error: r.error };
      if (r.outs) {
        const x = apply(items, r.a, r.outs, r.batch);
        ar.created = x.created;
        ar.updated = x.updated;
        touched.push(...x.touched);
        createdIds.push(...x.createdIds);
        for (const s of r.batch) meta.seen[s.id] = now; // yalnızca başarılı ajanın sinyalleri işlenmiş sayılır
      }
      run.agents.push(ar);
    }
    meta.captures = meta.captures.filter((c) => !meta.seen[c.id]);
    run.createdIds = createdIds;
    // kazanılan güven: seviyesi yeten ajan kendi önerisini onaylar (2'de işi de sıraya koyar)
    const trust = createdIds.length ? await trustView().catch(() => null) : null;
    if (trust) {
      const auto = items.filter((x) => createdIds.includes(x.id) && applyTrust(x, trust) > 0).map((x) => x.id);
      if (auto.length) run.autoIds = auto;
    }
    run.files = await attachFiles(touched);
    run.agents.push({ agent: "dosya", signals: touched.length, created: 0, updated: run.files, ms: 0 });

    // tamamlanan işler 30 gün, reddedilenler 60 gün tutulur
    const keep = items.filter((x) => (x.status === "done" ? Date.now() - Date.parse(x.updatedAt) < 30 * 86400_000 : x.status === "dismissed" ? Date.now() - Date.parse(x.updatedAt) < 60 * 86400_000 : true));
    await store().setKV(ITEMS_KEY, keep);

    // gönderilenlerin yanıt takibi (yanıt geldiyse iş biter; gecikenler hatırlatma adayı)
    const snap = await getSnapshot().catch(() => null);
    const fu = checkFollowUps(keep, snap?.gmail.items ?? [], snap?.account?.email);
    run.replied = fu.replied.map((x) => x.id);
    // strateji: plan saatle değiştiği için 2 saatte bir de yenilenir
    const stale = !meta.focus?.decisions || meta.focus.day !== istDay() || Date.now() - Date.parse(meta.focus.at) > 2 * 3600_000;
    if (touched.length || fu.replied.length || fu.overdue.length || stale) {
      const prev = meta.focus;
      let out: StrategyOut | null = null;
      let events: Parameters<typeof buildPlan>[1] = snap?.calendar.items ?? [];
      if (left() > 9000) {
        calls++;
        const raw: BrainRaw = { items: keep, focus: meta.focus, runs: meta.runs, lastRun: meta.lastRun, running: false, captures: meta.captures.length };
        const r = await strategize(keep, new Set(fu.overdue.map((x) => x.id)), system, usage, Math.max(8000, left() - 2000), raw).catch((e) => {
          run.error = `Strateji: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`;
          return null;
        });
        out = r?.out ?? null;
        if (r) events = r.events;
      }
      meta.focus = applyStrategy(keep, out, fu.overdue, events);
      run.decisions = meta.focus.decisions?.length ?? 0;
      await store().setKV(ITEMS_KEY, keep);
      await pushNews(prev, meta.focus, keep, opts.trigger, meta).catch(() => null);
    } else if (fu.replied.length) await store().setKV(ITEMS_KEY, keep);
    // birikmiş seçimlerden öğren (sabah cron'unda da çalışır)
    if (left() > 10000) await learn({ force: true, timeout: left() - 3000 }).catch(() => null);
  } catch (e) {
    run.error = e instanceof Error ? e.message.slice(0, 300) : String(e);
  } finally {
    run.ms = Date.now() - t0;
    run.tokens = usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
    run.cost = costUsd(ASSISTANT_MODEL, usage);
    const cutoff = Date.now() - 60 * 86400_000;
    meta.seen = Object.fromEntries(Object.entries(meta.seen).filter(([, t]) => Date.parse(t) > cutoff));
    meta.runs = [run, ...meta.runs].slice(0, 30);
    meta.lastRun = run.at;
    meta.lock = undefined;
    await store().setKV(META_KEY, meta);
    if (calls)
      await recordUsage({
        at: run.at,
        model: ASSISTANT_MODEL,
        rounds: calls,
        prompt: usage.input + usage.cacheRead + usage.cacheWrite,
        cached: usage.cacheRead,
        written: usage.cacheWrite,
        output: usage.output,
        cost: run.cost,
        ms: run.ms,
        error: run.error,
        label: "🧠 Beyin",
      });
  }
  return run;
}

/** Beyne elle yazılan not: görev ajanı bir sonraki düşünmede işe çevirir. */
export async function capture(text: string) {
  const meta = await readMeta();
  meta.captures.push({ id: `note:${uid()}`, agent: "gorev", ts: new Date().toISOString(), title: clip(text.replace(/\s+/g, " "), 80), who: "Batuhan", text });
  await store().setKV(META_KEY, meta);
}

export async function state(): Promise<BrainState> {
  const [items, meta, todos, choices] = await Promise.all([readItems(), readMeta(), store().getKV<TodoStore>("todos"), readChoices().catch(() => [])]);
  const [learning, trust] = await Promise.all([learningState().catch(() => undefined), trustView(choices).catch(() => undefined)]);
  // görev listesinde tamamlanan işler beyinde de biter
  const done = new Set((todos?.todos ?? []).filter((t) => t.done).map((t) => t.id));
  let changed = false;
  for (const it of items) {
    if (it.todoId && done.has(it.todoId) && it.status !== "done") {
      it.status = "done";
      it.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) await store().setKV(ITEMS_KEY, items);
  const pending: BrainState["pending"] = {};
  if (meta.captures.length) pending.gorev = meta.captures.length;
  return {
    items: items.filter((x) => x.status !== "dismissed" && (x.status !== "done" || Date.now() - Date.parse(x.updatedAt) < 7 * 86400_000)),
    focus: meta.focus,
    runs: meta.runs.slice(0, 15),
    lastRun: meta.lastRun,
    running: !!meta.lock && meta.lock > Date.now(),
    pending,
    learning,
    trust,
  };
}

/** Ajan ağı için beynin ham durumu */
export async function brainRaw(): Promise<BrainRaw> {
  const [items, meta] = await Promise.all([readItems(), readMeta()]);
  return { items, focus: meta.focus, runs: meta.runs, lastRun: meta.lastRun, running: !!meta.lock && meta.lock > Date.now(), captures: meta.captures.length };
}

/** Ajanın kendisi yapacağı (güven 2) sıradaki en eski iş. */
export async function nextQueued() {
  const items = await readItems();
  return items.filter((x) => x.work?.status === "queued" && isOpen(x)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.id ?? null;
}

const PRIO = ["", "acil", "yüksek", "orta", "normal"];
/** Seçimin bağlamı: öğrenen model işin türünü/kaynağını/kişisini görsün. */
const itemDetail = (it: BrainItem) =>
  [KIND_LABEL[it.kind], it.sources[0] && `kaynak: ${it.sources[0].title}${it.sources[0].who ? ` (${it.sources[0].who})` : ""}`, it.person && `kişi: ${it.person}`, it.area, `P${it.priority}`].filter(Boolean).join(" · ");

export async function updateItem(id: string, patch: Partial<Pick<BrainItem, "status" | "steps" | "priority" | "due" | "title" | "todoId" | "agent" | "snoozeUntil">>, opts: { reason?: string } = {}) {
  const items = await readItems();
  const it = items.find((x) => x.id === id);
  if (!it) return null;
  // Batuhan'ın seçimleri (öğrenme için)
  const choices: Omit<Choice, "id" | "at">[] = [];
  const base = { where: "beyin" as const, agent: it.agent, title: it.title, detail: itemDetail(it), itemKind: it.kind, auto: !!it.auto || undefined };
  const reason = opts.reason?.trim() || undefined;
  if (patch.todoId && !it.todoId) choices.push({ ...base, kind: "to_todo" });
  else if (patch.status && patch.status !== it.status) {
    const wasOpen = isOpen(it);
    if (patch.status === "dismissed") choices.push({ ...base, kind: "reject", reason });
    else if (patch.status === "done" && wasOpen) choices.push({ ...base, kind: "done" });
    else if (!wasOpen) choices.push({ ...base, kind: "reopen" });
    else if (it.status === "inbox") choices.push({ ...base, kind: "accept", reason });
  }
  if (patch.priority && patch.priority !== it.priority) choices.push({ ...base, kind: "priority", detail: `${base.detail} · ${PRIO[it.priority]} → ${PRIO[patch.priority]}` });
  if (patch.due !== undefined && (patch.due || undefined) !== it.due) choices.push({ ...base, kind: "due", detail: `${base.detail} · ${it.due ?? "tarihsiz"} → ${patch.due || "tarihsiz"}` });
  if (patch.agent && patch.agent !== it.agent && agentById(patch.agent)) choices.push({ ...base, kind: "reassign", detail: `${base.detail} · ${agentById(it.agent)?.name} → ${agentById(patch.agent)?.name}` });
  if (patch.title?.trim() && patch.title.trim() !== it.title) choices.push({ ...base, kind: "rename", detail: `eski: ${it.title} → yeni: ${patch.title.trim()}` });
  if (patch.snoozeUntil && patch.snoozeUntil !== it.snoozeUntil) choices.push({ ...base, kind: "snooze", detail: `${base.detail} · ${patch.snoozeUntil} tarihine` });

  if (patch.status) it.status = patch.status;
  if (patch.steps) it.steps = patch.steps.slice(0, 30).map((s) => ({ title: String(s.title).slice(0, 300), done: !!s.done }));
  if (patch.priority && [1, 2, 3, 4].includes(patch.priority)) it.priority = patch.priority;
  if (patch.due !== undefined) it.due = /^\d{4}-\d{2}-\d{2}$/.test(patch.due ?? "") ? patch.due : undefined;
  if (patch.title?.trim()) it.title = patch.title.trim().slice(0, 200);
  if (patch.todoId) it.todoId = patch.todoId;
  if (patch.agent && agentById(patch.agent)) it.agent = patch.agent;
  if (patch.snoozeUntil !== undefined) it.snoozeUntil = /^\d{4}-\d{2}-\d{2}$/.test(patch.snoozeUntil ?? "") ? patch.snoozeUntil : undefined;
  // öneri kabul edildiyse önden hazırlık işareti kalkar
  if (patch.status && patch.status !== "inbox") it.prep = undefined;
  it.updatedAt = new Date().toISOString();
  await store().setKV(ITEMS_KEY, items);
  const pending = choices.length ? await recordChoices(choices).catch(() => 0) : 0;
  // ajanın kendi onayladığı iş reddedildiyse güveni gözden geçir (2 yanlışta bir seviye düşer)
  const trustNote = it.auto && choices.some((c) => c.kind === "reject") ? await reviewTrust(it.agent).catch(() => null) : null;
  return { item: it, pending, explicit: choices.some((c) => c.reason), trustNote };
}

/** Otomatik tetikleme için: son düşünmeden bu yana yeterli süre geçti mi. */
export async function due(minMinutes: number) {
  const meta = await readMeta();
  if (meta.lock && meta.lock > Date.now()) return false;
  return !meta.lastRun || Date.now() - Date.parse(meta.lastRun) > minMinutes * 60_000 || meta.captures.length > 0;
}

// ------------------------------------------------------------------ ajan işi yapar (teslimat)
/*
 * "Ajana ver": ajan işin kaynaklarını (e-posta/sohbet/transkript gövdeleri), dosyaları ve arşivi araçlarla okuyup
 * teslimatı yazar: yanıt taslağı, özet, analiz, hazırlık notu. Kural: okumak serbest; dışarıya bir şey gidecekse
 * (e-posta, mesaj, paylaşım) yalnızca taslak hazırlar ve onaya bırakır.
 */
const WORK_HINT: Record<AgentId, string> = {
  posta: "E-posta işlerinde yanıt gerekiyorsa gönderilmeye hazır Türkçe yanıt taslağını (Konu/Kime dahil) yaz; gerekiyorsa önce eski yazışmaları arşivde ara.",
  sohbet: "Sohbetteki isteğe verilecek kısa ve net yanıt taslağını ya da istenen bilgiyi hazırla.",
  takvim: "Toplantı için bir sayfalık hazırlık notu yaz: amaç, katılımcılar, Batuhan'ın getirmesi gereken veri/dosya, sorulacaklar, önceki toplantılardan açık kalanlar.",
  toplanti: "Transkriptten kararlar, sorumlu-termin listesi ve takip edilmesi gerekenleri çıkar; gerekiyorsa katılımcılara gidecek özet e-posta taslağını yaz.",
  denetim: "Kontrol yöntemine uygun kontrol planı ve gerekirse sorumluya gidecek kısa, suçlamayan bilgi/talep metnini hazırla.",
  dosya: "İlgili dosyaları arşivde bul, içeriklerini oku ve işe yarayan kısımları özetle.",
  gorev: "İşi yap: gereken bilgiyi arşivden topla ve istenen çıktıyı (taslak, liste, özet, plan) yaz.",
};

const RULES_FILE = "ajan-kurallari.md";
/** Düzeltmeden çıkan kalıcı kuralı ajanın başlığı altına yazar (bilgi dosyaları panelinde görünür, her işte okunur). */
async function addRule(agent: AgentId, rule: string) {
  const name = agentById(agent)?.name ?? agent;
  const files = await listKnowledge();
  let md = files.find((f) => f.name === RULES_FILE)?.md?.trim() || "# Ajan kuralları\n\nBatuhan'ın düzeltmelerinden çıkan kalıcı kurallar. Her ajan kendi başlığındaki kurallara her işte uyar. Silersen unutulur.";
  const day = istDay();
  const line = `- (${day}) ${rule.replace(/\s+/g, " ").trim()}`;
  const lines = md.split("\n");
  const h = lines.findIndex((l) => l.trim() === `## ${name}`);
  if (h < 0) md = `${md.trimEnd()}\n\n## ${name}\n${line}`;
  else {
    let end = h + 1;
    while (end < lines.length && !/^##\s/.test(lines[end])) end++;
    while (end > h + 1 && !lines[end - 1].trim()) end--;
    lines.splice(end, 0, line);
    md = lines.join("\n");
  }
  await saveKnowledge(RULES_FILE, `${md.trim()}\n`);
}

const RULE_SCHEMA = {
  type: "object",
  properties: {
    standing: { type: "boolean", description: "kalıcı tercih/kural mı (true) yoksa yalnızca bu işe özel mi (false)" },
    rule: { type: "string", description: "kalıcıysa genel, tek cümlelik emir kipinde kural (kişi/proje adı olmadan); değilse boş" },
  },
  required: ["standing", "rule"],
  additionalProperties: false,
} as const;

async function classify(agent: AgentId, title: string, feedback: string, usage: Usage) {
  const res = await claude().messages.parse({
    model: ASSISTANT_MODEL,
    max_tokens: 1000,
    output_config: { effort: "low", format: jsonSchemaOutputFormat(RULE_SCHEMA) },
    messages: [
      {
        role: "user",
        content: `Batuhan, ${agentById(agent)?.name ?? agent} ajanının "${title}" işindeki teslimatını şu düzeltmeyle geri gönderdi: "${feedback}"\nBu düzeltme yalnızca bu işe mi özel (bu taslak, bu kişi, "bu sefer") yoksa bundan sonraki benzer işlerde de uygulanacak kalıcı bir tercih mi ("her zaman", "asla", biçim/ton tercihi, kırmızı çizgi)?`,
      },
    ],
  });
  addUsage(usage, res);
  const p = res.parsed_output;
  return p?.standing && p.rule.trim() ? p.rule.trim() : null;
}

/** Bir ajanın araçlarla (arşiv, Drive) çalışma döngüsü; son metni döndürür. */
async function agentLoop(system: Anthropic.TextBlockParam[], content: string, usage: Usage, deadline: number, used: string[], maxRounds = 6) {
  const left = () => deadline - Date.now();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content }];
  let text = "";
  for (let round = 0; round < maxRounds; round++) {
    const res = await claude().messages.create(
      { model: ASSISTANT_MODEL, max_tokens: 8000, system, tools: ARCHIVE_TOOLS, output_config: { effort: "medium" }, messages },
      { timeout: Math.max(6000, left() - 2000) },
    );
    addUsage(usage, res);
    text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim() || text;
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length || left() < 10000) break;
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const c of calls) {
      used.push(statusOf(c));
      try {
        results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(await runTool(c)) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: c.id, is_error: true, content: e instanceof Error ? e.message : String(e) });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return text;
}

const persona = (agent: AgentId) => {
  const a = agentById(agent);
  return `${a?.name ?? "Ajan"} olarak çalışıyorsun. ${WORK_HINT[agent]} Bilgi dosyalarındaki "${GUIDE_FILE}" ve "${RULES_FILE}" içinde kendi başlığın altındaki talimat, beceri ve kurallara mutlaka uy.`;
};

const DELIVER = `Teslimatın kendisini yaz, ne yapacağını anlatma. Türkçe, kısa başlık + kısa bölümler/maddeler; taslak metinler gönderilmeye hazır olsun. Eksik bilgi varsa (varsayım) diye işaretle; veri uydurma.
Dışarıya hiçbir şey gönderemezsin. Bir e-posta/mesaj gönderilmesi gerekiyorsa taslağını yaz ve EN SONA tek satır ekle: "GİDECEK: <kime, hangi kanaldan, ne>". Gerekmiyorsa bu satırı ekleme.
Kullandığın kaynak/dosyaları sonda tek satırda belirt ("Kaynak: …").`;

/** İşin bağlamı (başlık, özet, kaynakların tam metni, dosyalar) — tek ajan ve ekip aynı bağlamı okur. */
async function itemContext(it: BrainItem) {
  const bodies = await Promise.all(
    it.sources.slice(0, 6).map(async (s) => {
      const full = s.ref ? await getItem(s.ref.source as "gmail", s.ref.id).catch(() => null) : null;
      return `### ${s.title}${s.who ? ` — ${s.who}` : ""} (${trTime(s.ts)})\n${clip(full?.body ?? "", 5000) || "(metin arşivde yok; gerekirse ara)"}`;
    }),
  );
  return `Bugün: ${istDay()}.

İŞ: ${it.title}
Özet: ${it.summary}
Neden: ${it.why}
${it.due ? `Termin: ${it.due}\n` : ""}${it.person ? `İlgili kişi: ${it.person}\n` : ""}${it.area ? `Denetim başlığı: ${it.area}\n` : ""}Adımlar: ${it.steps.map((s) => `${s.done ? "✓" : "☐"} ${s.title}`).join(" · ")}

KAYNAKLAR:
${bodies.join("\n\n") || "(yok)"}

BULUNAN DOSYALAR:
${it.files.map((f) => `- [${f.id}] ${f.name}: ${f.excerpt ?? ""}`).join("\n") || "(yok — gerekirse arşivde source=drive ile ara, get_archive_item ile oku)"}`;
}

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    pieces: {
      type: "array",
      description: "2-4 bağımsız parça; her biri işine en uygun ajana",
      items: {
        type: "object",
        properties: {
          agent: { type: "string", enum: ["posta", "sohbet", "takvim", "toplanti", "denetim", "dosya", "gorev"] },
          task: { type: "string", description: "bu ajanın yapacağı parça: net, tek başına yapılabilir" },
        },
        required: ["agent", "task"],
        additionalProperties: false,
      },
    },
  },
  required: ["pieces"],
  additionalProperties: false,
} as const;

/** Ekip: lider (işin sahibi ajan) işi 2-4 parçaya böler; parçalar aynı anda çalışır; lider birleştirir. */
async function teamWork(it: BrainItem, system: Anthropic.TextBlockParam[], ctx: string, usage: Usage, deadline: number, w: ItemWork, save: () => Promise<void>) {
  const lead = it.agent;
  const roster = AGENTS.map((a) => `- ${a.id}: ${a.name} — ${a.role}`).join("\n");
  const plan = await claude().messages.parse(
    {
      model: ASSISTANT_MODEL,
      max_tokens: 3000,
      system,
      output_config: { effort: "low", format: jsonSchemaOutputFormat(PLAN_SCHEMA) },
      messages: [
        {
          role: "user",
          content: `ŞU AN: ${persona(lead)} Bu işin ekip lideri sensin. İşi birbirinden bağımsız 2-4 parçaya böl ve her parçayı işine en uygun ajana ver (bir parçayı kendin de alabilirsin). Tek doğrusal bir işse 2 parça yeter.\n\nAJANLAR:\n${roster}\n\n${ctx}`,
        },
      ],
    },
    { timeout: Math.max(6000, deadline - Date.now() - 30000) },
  );
  addUsage(usage, plan);
  const pieces = (plan.parsed_output?.pieces ?? []).filter((p) => agentById(p.agent)).slice(0, 4);
  if (pieces.length < 2) throw new Error("Lider işi parçalara bölemedi");
  const team: TeamRun = (w.team = { lead, pieces: pieces.map((p): TeamPiece => ({ agent: p.agent as AgentId, task: p.task, output: "", status: "running", used: [] })), notes: [] });
  await save();
  // parçalar aynı anda; her biri kendi persona ve araçlarıyla, son ~15 sn lidere kalır
  const pieceDeadline = deadline - 15000;
  await Promise.all(
    team.pieces.map(async (p) => {
      const t0 = Date.now();
      try {
        const others = team.pieces.filter((x) => x !== p).map((x) => `${agentById(x.agent)?.name}: ${x.task}`).join(" · ");
        const text = await agentLoop(
          system,
          `ŞU AN: ${persona(p.agent)} Bir ekipte çalışıyorsun; lider ${agentById(lead)?.name}. Senin parçan: "${p.task}". Diğerleri: ${others}.\n${ctx}\n\nYalnızca kendi parçanı yap; kısa ve somut yaz. Bir ekip arkadaşına ya da lidere söylemen gereken bir şey varsa sona "NOT @<ajan adı ya da lider>: …" satırı ekle. Dışarıya hiçbir şey gönderme.`,
          usage,
          pieceDeadline,
          p.used,
          4,
        );
        const notes = [...text.matchAll(/^\s*NOT\s+@([^:]+):\s*(.+)$/gim)];
        for (const n of notes) team.notes.push({ from: p.agent, to: n[1].trim(), text: n[2].trim() });
        p.output = text.replace(/^\s*NOT\s+@[^:]+:.*$/gim, "").trim();
        p.status = p.output ? "done" : "error";
      } catch (e) {
        p.status = "error";
        p.output = `(parça tamamlanamadı: ${e instanceof Error ? e.message.slice(0, 120) : e})`;
      }
      p.ms = Date.now() - t0;
    }),
  );
  await save();
  const final = await agentLoop(
    system,
    `ŞU AN: ${persona(lead)} Bu işin ekip liderisin. Ekip parçaları aşağıda; hepsini tek, bütünlüklü teslimatta birleştir (çelişkileri çöz, tekrarları at). Sona "Ekip: <kim ne yaptı>" tek satırı ekle.\n${ctx}\n\nEKİP PARÇALARI:\n${team.pieces.map((p) => `### ${agentById(p.agent)?.name} — ${p.task}\n${p.output}`).join("\n\n")}${team.notes.length ? `\n\nEKİP NOTLARI:\n${team.notes.map((n) => `- ${agentById(n.from)?.name} → ${n.to}: ${n.text}`).join("\n")}` : ""}\n\n${DELIVER}`,
    usage,
    deadline,
    w.used,
    2,
  );
  return final;
}

export async function work(id: string, opts: { feedback?: string; budgetMs?: number; team?: boolean; queued?: boolean; followup?: boolean } = {}): Promise<BrainItem | null> {
  if (!claudeConfigured()) throw new Error("ANTHROPIC_API_KEY tanımlı değil");
  const t0 = Date.now();
  const deadline = t0 + (opts.budgetMs ?? 56000);
  let items = await readItems();
  const it = items.find((x) => x.id === id);
  if (!it) return null;
  // sıradaki iş: başka biri (sekme ya da arka plan) başlattıysa ikinci kez çalıştırma
  if (opts.queued && it.work?.status !== "queued") return it;
  const prev = it.work;
  const followup = (opts.followup || prev?.purpose === "followup") && !opts.feedback && !!it.followUp;
  it.work = { status: "running", output: prev?.output ?? "", used: [], revisions: prev?.revisions ?? [], at: new Date().toISOString(), purpose: followup ? "followup" : undefined };
  // önden hazırlık: öneri senin onayında kalır, yalnızca teslimat hazırlanır
  const prepOnly = it.status === "inbox" && !!opts.queued && !!it.prep;
  if (!prepOnly && (it.status === "inbox" || it.status === "todo")) it.status = "doing";
  await store().setKV(ITEMS_KEY, items);

  const usage: Usage = { input: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0 };
  let rule: string | null = null;
  const w: ItemWork = it.work;
  // ara durum (ekip parçaları) panoda görünsün
  const save = async () => {
    const list = await readItems();
    const cur = list.find((x) => x.id === id);
    if (cur) {
      cur.work = { ...w, team: w.team && { ...w.team, pieces: w.team.pieces.map((p) => ({ ...p })) } };
      await store().setKV(ITEMS_KEY, list);
    }
  };
  try {
    const [knowledge, memory] = await Promise.all([loadKnowledge(), loadMemory()]);
    const system: Anthropic.TextBlockParam[] = [
      { type: "text", text: brainSystem(knowledge), cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: memoryPrompt(memory), cache_control: { type: "ephemeral", ttl: "1h" } },
    ];
    const ctx = await itemContext(it);
    const revise = opts.feedback && prev?.output
      ? `\nÖNCEKİ TESLİMATIN:\n${prev.output}\n\nBATUHAN'IN DÜZELTMESİ: "${opts.feedback}" — teslimatı buna göre yeniden yaz.`
      : followup && it.followUp
        ? `\nTAKİP: ${trTime(it.followUp.since)} tarihinde ${it.followUp.to.join(", ")} kişisine gönderilen e-postaya ${daysSince(it.followUp.since)} gündür yanıt gelmedi${it.followUp.nudges ? ` (daha önce ${it.followUp.nudges} kez hatırlatıldı)` : ""}.\nGÖNDERİLEN:\n${prev?.output ?? "(metin yok)"}\n\nŞimdi aynı kişiye, aynı yazışmaya yanıt olarak kısa ve nazik bir hatırlatma e-postası yaz (2-4 cümle; neyi, hangi tarihe kadar beklediğini net söyle; suçlayıcı olma). En sona GİDECEK satırını ekle.`
        : "";
    // düzeltme ekibi yeniden çalıştırmaz: lider aynı teslimatı düzeltir
    const text =
      opts.team && !revise
        ? await teamWork(it, system, ctx, usage, deadline, w, save)
        : await agentLoop(system, `ŞU AN: ${persona(it.agent)}\n${ctx}\n${revise}\n\n${DELIVER}`, usage, deadline, w.used);
    if (revise && prev?.team) w.team = prev.team;
    if (!text) throw new Error("Ajan boş teslimat döndürdü");
    const m = text.match(/\n?\s*GİDECEK:\s*(.+)\s*$/i);
    w.outbound = m?.[1].trim();
    w.output = m ? text.slice(0, m.index).trim() : text;
    w.status = w.outbound ? "waiting_ok" : "ready";
    if (opts.feedback) {
      rule = await classify(it.agent, it.title, opts.feedback, usage).catch(() => null);
      w.revisions.push({ at: new Date().toISOString(), feedback: opts.feedback, rule: rule ?? undefined });
      if (rule) await addRule(it.agent, rule);
      await recordChoices([{ where: "beyin", kind: "fix", agent: it.agent, title: it.title, detail: itemDetail(it), reason: opts.feedback, itemKind: it.kind, auto: !!it.auto || undefined }]).catch(() => 0);
      if (it.auto) await reviewTrust(it.agent).catch(() => null);
    }
  } catch (e) {
    w.status = "error";
    w.error = e instanceof Error ? e.message.slice(0, 300) : String(e);
  } finally {
    w.ms = Date.now() - t0;
    w.cost = costUsd(ASSISTANT_MODEL, usage);
    // çalışırken başka değişiklik olmuş olabilir: güncel listeye yaz
    items = await readItems();
    const cur = items.find((x) => x.id === id);
    if (cur) {
      cur.work = w;
      // önden hazırlanan öneri, onaylanana dek "öneri"de kalır
      if (w.status === "waiting_ok" && !(cur.status === "inbox" && cur.prep)) cur.status = "waiting";
      cur.updatedAt = new Date().toISOString();
      await store().setKV(ITEMS_KEY, items);
    }
    await recordUsage({
      at: new Date().toISOString(),
      model: ASSISTANT_MODEL,
      rounds: 1,
      prompt: usage.input + usage.cacheRead + usage.cacheWrite,
      cached: usage.cacheRead,
      written: usage.cacheWrite,
      output: usage.output,
      cost: w.cost ?? null,
      ms: w.ms ?? 0,
      error: w.error,
      label: `${agentById(it.agent)?.emoji ?? "🧠"} ${opts.team ? "Ekip işi" : followup ? "Hatırlatma" : prepOnly ? "Önden hazırlık" : "İş"}`,
    });
  }
  return (await readItems()).find((x) => x.id === id) ?? null;
}

// ------------------------------------------------------------------ lider görüşmesi
/*
 * Ajan Batuhan'a en fazla 5 soru sorar (bir seferde bir soru): bu işin burada ne olduğu, en sık yaptığı iş,
 * iyi sonucun neye benzediği, asla olmaması gereken, ilgili araç ve kişiler. Son cevaptan sonra
 * kendi çalışma talimatını ve bir becerisini (adım adım nasıl yapılır) "ajan-talimatlari.md"ye yazar.
 */
const GUIDE_FILE = "ajan-talimatlari.md";
const INTERVIEW_TOPICS = [
  "bu şirkette senin alanında (ajanın kaynağı) iş nasıl yürüyor, Batuhan'ın buradaki rolü ne",
  "en sık yapılan iş / en çok zaman alan iş hangisi",
  "iyi bir sonuç neye benzer (biçim, ton, uzunluk, örnek)",
  "asla olmaması gereken şey (kırmızı çizgiler)",
  "hangi kişiler, araçlar, dosyalar devrede; kime ne zaman danışılır",
];

const QUESTION_SCHEMA = {
  type: "object",
  properties: { question: { type: "string", description: "tek, kısa, somut soru (gerekirse kısa bir örnekle)" } },
  required: ["question"],
  additionalProperties: false,
} as const;

const GUIDE_SCHEMA = {
  type: "object",
  properties: {
    brief: { type: "string", description: "ajanın kalıcı çalışma talimatı: 3-6 madde (ton, kırmızı çizgiler, kime danışılır)" },
    skill_name: { type: "string", description: "becerinin kısa adı (ör. 'Hakediş hatırlatma yanıtı')" },
    skill_when: { type: "string", description: "bu beceri ne zaman kullanılır (tek cümle)" },
    skill_steps: { type: "array", items: { type: "string" }, description: "3-7 adım" },
    skill_format: { type: "string", description: "çıktının biçimi/şablonu (kısa)" },
    try_task: { type: "string", description: "Batuhan'ın denemesi için görev çubuğuna yazılacak tek bir örnek iş" },
  },
  required: ["brief", "skill_name", "skill_when", "skill_steps", "skill_format", "try_task"],
  additionalProperties: false,
} as const;

export type InterviewTurn = { q: string; a: string };

export async function interview(agent: AgentId, turns: InterviewTurn[]) {
  if (!claudeConfigured()) throw new Error("ANTHROPIC_API_KEY tanımlı değil");
  const a = agentById(agent);
  if (!a) throw new Error("Bilinmeyen ajan");
  const usage: Usage = { input: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0 };
  const [knowledge, memory] = await Promise.all([loadKnowledge(), loadMemory()]);
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: brainSystem(knowledge), cache_control: { type: "ephemeral", ttl: "1h" } },
    { type: "text", text: memoryPrompt(memory), cache_control: { type: "ephemeral", ttl: "1h" } },
  ];
  const transcript = turns.map((t, i) => `${i + 1}. Soru: ${t.q}\nCevap: ${t.a}`).join("\n");
  const done = turns.length >= INTERVIEW_TOPICS.length || /^(bitti|tamam|yeter)\b/i.test(turns.at(-1)?.a.trim() ?? "");
  try {
    if (!done) {
      const res = await claude().messages.parse({
        model: ASSISTANT_MODEL,
        max_tokens: 1500,
        system,
        output_config: { effort: "low", format: jsonSchemaOutputFormat(QUESTION_SCHEMA) },
        messages: [
          {
            role: "user",
            content: `ŞU AN: ${a.name} olarak (${a.role}) Batuhan'la kısa bir kurulum görüşmesi yapıyorsun; amacın onun bu işi nasıl yaptığını öğrenip kendi talimatını ve becerini yazmak. Bilgi dosyalarında zaten yazan şeyi sorma; onları bildiğini göster.
Şu ana kadar:
${transcript || "(henüz soru yok)"}

Sıradaki konu (${turns.length + 1}/${INTERVIEW_TOPICS.length}): ${INTERVIEW_TOPICS[turns.length]}.
Bu konuda tek bir soru sor. Türkçe, sıcak ama kısa.`,
          },
        ],
      });
      addUsage(usage, res);
      return { question: res.parsed_output?.question ?? INTERVIEW_TOPICS[turns.length], step: turns.length + 1, of: INTERVIEW_TOPICS.length };
    }
    const res = await claude().messages.parse({
      model: ASSISTANT_MODEL,
      max_tokens: 4000,
      system,
      output_config: { effort: "medium", format: jsonSchemaOutputFormat(GUIDE_SCHEMA) },
      messages: [
        {
          role: "user",
          content: `ŞU AN: ${a.name} olarak (${a.role}) Batuhan'la kurulum görüşmesini bitirdin. Cevaplarına dayanarak kendi kalıcı çalışma talimatını ve en sık yapılan iş için bir beceri yaz. Cevaplarda olmayanı uydurma; "atla" denen konuları boş geç.\n\nGÖRÜŞME:\n${transcript}`,
        },
      ],
    });
    addUsage(usage, res);
    const g = res.parsed_output;
    if (!g) throw new Error("Talimat yazılamadı");
    const section = `## ${a.name}
_Kurulum görüşmesi: ${istDay()}_

### Talimat
${g.brief.trim()}

### Beceri: ${g.skill_name.trim()}
Ne zaman: ${g.skill_when.trim()}
${g.skill_steps.map((s, i) => `${i + 1}. ${s.trim()}`).join("\n")}
Biçim: ${g.skill_format.trim()}`;
    const files = await listKnowledge();
    let md = files.find((f) => f.name === GUIDE_FILE)?.md?.trim() || "# Ajan talimatları\n\nHer ajanın kurulum görüşmesinden çıkan çalışma talimatı ve becerisi. Ajan kendi başlığındakine her işte uyar; elle düzenlenebilir.";
    // aynı ajanın eski bölümü yenisiyle değişir
    const re = new RegExp(`\\n## ${a.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n[\\s\\S]*?(?=\\n## |$)`);
    md = re.test(`\n${md}`) ? `\n${md}`.replace(re, `\n${section}\n`).trim() : `${md.trimEnd()}\n\n${section}`;
    await saveKnowledge(GUIDE_FILE, `${md.trim()}\n`);
    return { done: true, brief: g.brief, skill: { name: g.skill_name, when: g.skill_when, steps: g.skill_steps, format: g.skill_format }, tryTask: g.try_task };
  } finally {
    await recordUsage({
      at: new Date().toISOString(),
      model: ASSISTANT_MODEL,
      rounds: 1,
      prompt: usage.input + usage.cacheRead + usage.cacheWrite,
      cached: usage.cacheRead,
      written: usage.cacheWrite,
      output: usage.output,
      cost: costUsd(ASSISTANT_MODEL, usage),
      ms: 0,
      label: `${a.emoji} Görüşme`,
    });
  }
}

/** Ajanın bilgi dosyalarındaki talimatı ve öğrendiği kurallar (ajan kartı için). */
export async function agentProfile(agent: AgentId) {
  const a = agentById(agent);
  if (!a) return null;
  const files = await listKnowledge();
  const section = (file: string) => {
    const md = files.find((f) => f.name === file)?.md ?? "";
    const m = `\n${md}`.match(new RegExp(`\\n## ${a.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n([\\s\\S]*?)(?=\\n## |$)`));
    return m?.[1].trim() ?? "";
  };
  return { guide: section(GUIDE_FILE), rules: section(RULES_FILE) };
}

/**
 * Onay. mail: gidecek e-postayı Gmail taslaklarına yazar (yanıtsa aynı yazışmaya); gönderimi Batuhan yapar.
 * Taslak oluşturulamazsa DraftError fırlar ve iş onaylanmaz.
 */
export async function approve(id: string, opts: { mail?: boolean } = {}) {
  let items = await readItems();
  let it = items.find((x) => x.id === id);
  if (!it?.work) return null;
  if (opts.mail && it.work.outbound) {
    const draft = await createDraft(it);
    // taslak yazılırken liste değişmiş olabilir
    items = await readItems();
    it = items.find((x) => x.id === id);
    if (!it?.work) return null;
    it.work.draft = draft;
  }
  const wasInbox = it.status === "inbox";
  const nowIso = new Date().toISOString();
  it.work.status = "approved";
  if (it.work.outbound) {
    // gönderildi (ya da Gmail'de taslak): yanıt takibe alınır; 2 iş günü içinde yanıt gelmezse hatırlatma hazırlanır
    const snap = await getSnapshot().catch(() => null);
    const src = it.sources.find((s) => s.ref?.source === "gmail");
    const thread = it.work.draft?.threadId ?? (src ? snap?.gmail.items.find((m) => m.id === src.ref!.id)?.threadId : undefined) ?? it.followUp?.threadId;
    const to = it.work.draft?.to ?? it.followUp?.to ?? (src?.who ? [src.who.match(/<([^>]+)>/)?.[1] ?? src.who] : it.person ? [it.person] : []);
    const nudge = it.work.purpose === "followup";
    it.followUp = { to, threadId: thread, since: nowIso, due: addWorkdays(istDay(), 2), nudges: nudge ? (it.followUp?.nudges ?? 0) + 1 : 0 };
    it.status = "waiting";
  } else it.status = "done";
  it.prep = undefined;
  it.updatedAt = nowIso;
  await store().setKV(ITEMS_KEY, items);
  const base = { where: "beyin" as const, agent: it.agent, itemKind: it.kind, auto: !!it.auto || undefined, title: it.title };
  await recordChoices([
    ...(wasInbox ? [{ ...base, kind: "accept" as const, detail: itemDetail(it) }] : []),
    { ...base, kind: "approve", detail: `${itemDetail(it)}${it.work.outbound ? ` · gidecek: ${it.work.outbound}` : ""}${it.work.draft ? ` · Gmail taslağı: ${it.work.draft.to.join(", ")}` : ""}` },
  ]).catch(() => 0);
  return it;
}
