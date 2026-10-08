import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { getItem, search } from "./archive";
import { loadKnowledge, loadMemory, memoryPrompt } from "./assistant";
import { AREAS } from "./checklist";
import { ASSISTANT_MODEL, claude, claudeConfigured, costUsd, recordUsage } from "./claude";
import { store } from "./db";
import { getSnapshot } from "./google";
import { areaProgress, deadlineInfo, normalizePeriod, periodLabel } from "./period";
import { emptyStore, type TodoStore } from "./todo";
import type { AgentId, AgentRun, BrainFocus, BrainItem, BrainRun, BrainState, ItemSource, Signal } from "./brain-types";

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

const FOCUS_SCHEMA = {
  type: "object",
  properties: {
    brief: { type: "string", description: "Batuhan'a 3-5 satırlık Türkçe günlük brifing (markdown, madde işaretli olabilir)" },
    order: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, reason: { type: "string", description: "neden bu sırada (kısa)" } },
        required: ["id", "reason"],
        additionalProperties: false,
      },
      description: "bugün odaklanılacak en fazla 7 iş, en önemliden",
    },
  },
  required: ["brief", "order"],
  additionalProperties: false,
} as const;

function brainSystem(knowledge: string) {
  return `Sen Batuhan Başar'ın iş beynisin. Ona gelen her şeyi (e-posta, sohbet, takvim, toplantı, denetim listesi, kendi notları) okuyup onun işinin ne olduğunu anlayan, işi rolüne göre önceliklendiren ve somut, uygulanabilir işlere çeviren merkezsin. Yan ajanların her biri bir kaynaktan sorumludur; şu an hangi ajan olarak çalıştığın kullanıcı mesajında yazar.
Batuhan'ı ve şirketi aşağıdaki BİLGİ DOSYALARI ve BELLEK'ten tanıyorsun: rolü, sınırı, iş tanımı, kişiler, takvim ve kontrol yöntemleri. Önceliği her zaman bu role göre ver.
Kurallar:
- Yalnızca gerçekten bir aksiyon gerektiren işleri çıkar; gürültü üretme. Emin değilsen iş açma.
- Aynı konu açık işlerde zaten varsa yeni iş açma, op=update ile o işi güncelle (ref = açık işin kimliği) ve yeni bilgiyi ekle.
- Başlık kısa ve fiille başlasın ("Tuğrul'a R-02 sayım farkı verisini gönder"). Adımlar somut olsun; ilgili kişi, dosya ve sistem adlarını yaz.
- Terminleri bugünün tarihine göre gerçek tarihe çevir. Veride olmayan bilgiyi uydurma.
- Kimseyi zan altında bırakan dil kullanma; düzeltmeyi sorumlu yapar, Batuhan kontrol eder ve takip eder.

=============== BİLGİ DOSYALARI ===============
${knowledge}`;
}

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
  const content = `ŞU AN: ${AGENT_RULES[agent]}
Bugün: ${today} (${new Date().toLocaleDateString("tr-TR", { weekday: "long", timeZone: "Europe/Istanbul" })}).

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
    created++;
  }
  return { created, updated, touched };
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

// ------------------------------------------------------------------ 4) önceliklendirme
async function prioritize(items: BrainItem[], system: Anthropic.TextBlockParam[], usage: Usage, timeout: number): Promise<BrainFocus | null> {
  const todos = ((await store().getKV<TodoStore>("todos")) ?? emptyStore()).todos.filter((t) => !t.done && !t.source?.startsWith("brain:"));
  const open = items.filter((x) => isOpen(x) && x.status !== "waiting");
  if (!open.length && !todos.length) return { at: new Date().toISOString(), brief: "Açık iş yok. Yeni bir şey geldiğinde ajanlar burada önerecek.", order: [] };
  const snap = await getSnapshot().catch(() => null);
  const todayKey = istDay();
  const meetings = (snap?.calendar.items ?? []).filter((e) => e.response !== "declined" && (e.allDay ? e.start : istDay(new Date(e.start))) === todayKey);
  const content = `ŞU AN: Beyinsin. Bütün açık işleri ve Batuhan'ın kendi görevlerini rolüne, terminlere ve bugünkü takvime göre önceliklendir; bugün odaklanması gereken en fazla 7 işi sırala ve kısa bir brifing yaz.
Bugün: ${todayKey}.
Bugünkü toplantılar: ${meetings.map((e) => `${e.allDay ? "tüm gün" : trTime(e.start)} ${e.title}`).join(" · ") || "yok"}

BEYİNDEKİ İŞLER:
${open.map((x) => `- [${x.id}] (${x.status === "inbox" ? "öneri" : x.status}, P${x.priority}${x.due ? `, termin ${x.due}` : ""}, ${x.kind}) ${x.title} — ${clip(x.summary, 160)}`).join("\n") || "(yok)"}

BATUHAN'IN GÖREVLERİ (kimlik todo:…):
${todos.slice(0, 60).map((t) => `- [todo:${t.id}] (P${t.priority}${t.due ? `, ${t.due}` : ""}) ${t.title}`).join("\n") || "(yok)"}`;
  const res = await claude().messages.parse(
    { model: ASSISTANT_MODEL, max_tokens: 4000, system, output_config: { effort: "low", format: jsonSchemaOutputFormat(FOCUS_SCHEMA) }, messages: [{ role: "user", content }] },
    { timeout },
  );
  addUsage(usage, res);
  const p = res.parsed_output;
  if (!p) return null;
  const valid = new Set([...open.map((x) => x.id), ...todos.map((t) => `todo:${t.id}`)]);
  return { at: new Date().toISOString(), brief: p.brief, order: p.order.filter((o) => valid.has(o.id)).slice(0, 7) };
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
        for (const s of r.batch) meta.seen[s.id] = now; // yalnızca başarılı ajanın sinyalleri işlenmiş sayılır
      }
      run.agents.push(ar);
    }
    meta.captures = meta.captures.filter((c) => !meta.seen[c.id]);
    run.files = await attachFiles(touched);
    run.agents.push({ agent: "dosya", signals: touched.length, created: 0, updated: run.files, ms: 0 });

    // tamamlanan işler 30 gün, reddedilenler 60 gün tutulur
    const keep = items.filter((x) => (x.status === "done" ? Date.now() - Date.parse(x.updatedAt) < 30 * 86400_000 : x.status === "dismissed" ? Date.now() - Date.parse(x.updatedAt) < 60 * 86400_000 : true));
    await store().setKV(ITEMS_KEY, keep);

    if (left() > 9000 && (touched.length || !meta.focus || istDay(new Date(meta.focus.at)) !== istDay())) {
      calls++;
      meta.focus = (await prioritize(keep, system, usage, Math.max(6000, left() - 2000)).catch(() => null)) ?? meta.focus;
    }
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
  const [items, meta, todos] = await Promise.all([readItems(), readMeta(), store().getKV<TodoStore>("todos")]);
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
  };
}

export async function updateItem(id: string, patch: Partial<Pick<BrainItem, "status" | "steps" | "priority" | "due" | "title" | "todoId">>) {
  const items = await readItems();
  const it = items.find((x) => x.id === id);
  if (!it) return null;
  if (patch.status) it.status = patch.status;
  if (patch.steps) it.steps = patch.steps.slice(0, 30).map((s) => ({ title: String(s.title).slice(0, 300), done: !!s.done }));
  if (patch.priority && [1, 2, 3, 4].includes(patch.priority)) it.priority = patch.priority;
  if (patch.due !== undefined) it.due = /^\d{4}-\d{2}-\d{2}$/.test(patch.due ?? "") ? patch.due : undefined;
  if (patch.title?.trim()) it.title = patch.title.trim().slice(0, 200);
  if (patch.todoId) it.todoId = patch.todoId;
  it.updatedAt = new Date().toISOString();
  await store().setKV(ITEMS_KEY, items);
  return it;
}

/** Otomatik tetikleme için: son düşünmeden bu yana yeterli süre geçti mi. */
export async function due(minMinutes: number) {
  const meta = await readMeta();
  if (meta.lock && meta.lock > Date.now()) return false;
  return !meta.lastRun || Date.now() - Date.parse(meta.lastRun) > minMinutes * 60_000 || meta.captures.length > 0;
}
