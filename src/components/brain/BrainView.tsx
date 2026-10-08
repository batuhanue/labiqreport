"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAssistant } from "@/components/assistant/AssistantPanel";
import { usePeriod } from "@/components/PeriodProvider";
import { useTodos } from "@/components/todos/TodoProvider";
import { Skeleton } from "@/components/fx";
import { Icon, Sheet } from "@/components/ui";
import { AGENTS, KIND_LABEL, REJECT_REASONS, STATUS_META, TRUST_META, agentById, type AgentTrustView, type Lesson, type LearningState, type TrustLevel, type AgentId, type BrainItem, type BrainRun, type BrainState, type ItemStatus } from "@/lib/brain-types";
import { renderMd } from "@/lib/markdown";
import { lessonToast } from "@/lib/learn-client";
import { useBrainState } from "./useBrain";
import { dueLabel, newTodo, PRIORITY, uid } from "@/lib/todo";

type Col = Exclude<ItemStatus, "dismissed">;
const COLS: Col[] = ["inbox", "todo", "doing", "waiting", "done"];

function ago(s?: string) {
  if (!s) return "henüz düşünmedi";
  const m = Math.round((Date.now() - Date.parse(s)) / 60000);
  return m < 1 ? "az önce" : m < 60 ? `${m} dk önce` : m < 1440 ? `${Math.round(m / 60)} sa önce` : `${Math.round(m / 1440)} gün önce`;
}

/** **kalın** ve satır başı madde işaretleri için küçük, güvenli işleyici. */
export function Brief({ text }: { text: string }) {
  return (
    <div className="space-y-1 text-[15px] leading-relaxed">
      {text.split("\n").filter((l) => l.trim()).map((l, i) => {
        const bullet = /^\s*[-*•]\s+/.test(l);
        const parts = l.replace(/^\s*[-*•]\s+/, "").split(/(\*\*[^*]+\*\*)/g);
        return (
          <div key={i} className={bullet ? "flex gap-2" : ""}>
            {bullet && <span className="text-blue">•</span>}
            <span>{parts.map((p, k) => (p.startsWith("**") && p.endsWith("**") ? <b key={k}>{p.slice(2, -2)}</b> : <span key={k}>{p}</span>))}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Beyin sayfası: merkez + yan ajanlar, beyne yaz, bugün odak, iş panosu. */
export default function BrainView() {
  const { toast } = usePeriod();
  const { st, err, thinking, think, patch, runWork, approveWork, setTrust, setSt, open, setOpen, load } = useBrainState();
  const [agent, setAgent] = useState<AgentId | null>(null);
  const [mobileCol, setMobileCol] = useState<Col>("inbox");
  const [seed, setSeed] = useState<{ text: string; agent: AgentId; n: number } | null>(null);

  const items = useMemo(() => (st?.items ?? []).filter((x) => !agent || x.agent === agent || x.sources.some((s) => s.agent === agent)), [st, agent]);
  const byCol = useMemo(() => {
    const m = Object.fromEntries(COLS.map((c) => [c, [] as BrainItem[]])) as Record<Col, BrainItem[]>;
    for (const x of items) if (x.status !== "dismissed") m[x.status].push(x);
    for (const c of COLS) m[c].sort((a, b) => a.priority - b.priority || (a.due ?? "9999").localeCompare(b.due ?? "9999") || b.updatedAt.localeCompare(a.updatedAt));
    return m;
  }, [items]);

  if (err && !st) return <div className="clay p-6 text-sm text-fail">Beyin okunamadı: {err}</div>;
  if (!st) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-72 rounded-[28px]" />
        <Skeleton className="h-14 rounded-full" />
        <Skeleton className="h-64 rounded-[28px]" />
      </div>
    );
  }
  const busy = thinking || !!st.running;

  return (
    <div className="space-y-5">
      <Hero st={st} busy={busy} onThink={think} agent={agent} onAgent={setAgent} />
      <AnimatePresence>{agent && <AgentPanel key={agent} agent={agent} trust={st.trust?.[agent]} onTrust={(l) => setTrust(agent, l)} onTry={(t) => setSeed((x) => ({ text: t, agent, n: (x?.n ?? 0) + 1 }))} onClose={() => setAgent(null)} />}</AnimatePresence>
      <Capture
        seed={seed}
        onDone={(s, newId, doNow, team) => {
          setSt(s);
          const it = newId ? s.items.find((x) => x.id === newId) : undefined;
          if (it && doNow) {
            toast(`${agentById(it.agent)?.name ?? "Ajan"} ${team ? "ekibi topladı" : "işe başladı"}`);
            runWork(it.id, undefined, team);
          } else toast(it ? "Beyin notu işe çevirdi" : "Not işlendi");
        }}
      />
      {st.focus && <Focus st={st} onOpen={setOpen} />}
      <TrustSuggest trust={st.trust} onTrust={setTrust} />
      <Learning learning={st.learning} onLearned={load} />

      {/* pano */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="text-lg font-extrabold">İş panosu {agent && <span className="text-sm font-bold text-ink-3">· {agentById(agent)?.name}</span>}</div>
        {agent && (
          <button onClick={() => setAgent(null)} className="text-xs font-bold text-blue">
            Filtreyi kaldır
          </button>
        )}
      </div>
      {/* telefon: sütun seçici */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 lg:hidden">
        {COLS.map((c) => (
          <button key={c} onClick={() => setMobileCol(c)} className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-bold ${mobileCol === c ? "text-white" : "clay-sm text-ink-2"}`} style={mobileCol === c ? { background: STATUS_META[c].color } : undefined}>
            {STATUS_META[c].label} {byCol[c].length}
          </button>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-5">
        {COLS.map((c) => (
          <div key={c} className={`${mobileCol === c ? "" : "hidden"} min-w-0 lg:block`}>
            <div className="mb-2 hidden items-center gap-2 px-1 lg:flex">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_META[c].color }} />
              <span className="text-sm font-extrabold">{STATUS_META[c].label}</span>
              <span className="text-xs font-bold text-ink-3">{byCol[c].length}</span>
            </div>
            <div className="space-y-2.5 lg:min-h-[120px] lg:rounded-[22px] lg:bg-track/40 lg:p-2">
              <AnimatePresence initial={false}>
                {byCol[c].map((x) => (
                  <Card key={x.id} x={x} onOpen={() => setOpen(x)} onApprove={() => patch(x.id, { status: "todo" })} onDismiss={(r) => patch(x.id, { status: "dismissed" }, r)} />
                ))}
              </AnimatePresence>
              {!byCol[c].length && <div className="px-2 py-6 text-center text-xs font-semibold text-ink-3">{c === "inbox" ? (busy ? "Ajanlar çalışıyor…" : "Öneri yok") : "Boş"}</div>}
            </div>
          </div>
        ))}
      </div>

      <Runs runs={st.runs} />
      <ItemSheet x={open} onClose={() => setOpen(null)} onPatch={patch} onWork={runWork} onApprove={approveWork} />
    </div>
  );
}

// ------------------------------------------------------------------ üst: beyin + ajanlar
function Hero({ st, busy, onThink, agent, onAgent }: { st: BrainState; busy: boolean; onThink: () => void; agent: AgentId | null; onAgent: (a: AgentId | null) => void }) {
  const counts = useMemo(() => {
    const c: Record<string, { open: number; inbox: number }> = {};
    for (const a of AGENTS) c[a.id] = { open: 0, inbox: 0 };
    for (const x of st.items) {
      if (x.status === "done") continue;
      c[x.agent].open++;
      if (x.status === "inbox") c[x.agent].inbox++;
    }
    return c;
  }, [st.items]);
  const last = st.runs[0];
  // şu an çalışan ajanlar (tek iş ya da ekip parçası)
  const active = new Set<string>();
  for (const x of st.items) {
    if (x.work?.status !== "running") continue;
    active.add(x.agent);
    for (const p of x.work.team?.pieces ?? []) if (p.status === "running") active.add(p.agent);
  }
  const inbox = st.items.filter((x) => x.status === "inbox").length;
  const todo = st.items.filter((x) => x.status === "todo" || x.status === "doing").length;
  const todayKey = new Date().toLocaleDateString("sv-SE");
  const dueToday = st.items.filter((x) => x.status !== "done" && x.due && x.due <= todayKey).length;

  // ajanlar beynin çevresinde bir halkada
  const W = 640;
  const H = 300;
  const cx = W / 2;
  const cy = H / 2;
  const pos = AGENTS.map((a, i) => {
    const ang = -Math.PI / 2 + (i / AGENTS.length) * Math.PI * 2;
    return { a, x: cx + Math.cos(ang) * 255, y: cy + Math.sin(ang) * 112 };
  });

  return (
    <div className="clay relative overflow-hidden p-4 sm:p-6" style={{ background: "radial-gradient(120% 90% at 50% 0%, rgba(139,92,246,.16), transparent 60%)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-ink-3">Beyin</div>
          <div className="text-2xl font-extrabold leading-tight">İşini anlayan merkez</div>
          <div className="mt-0.5 text-sm text-ink-2">
            Son düşünme {ago(st.lastRun)}
            {last && !last.error ? ` · ${last.agents.reduce((s, a) => s + a.signals, 0)} sinyal okundu` : ""}
            {last?.error ? <span className="text-fail"> · hata: {last.error}</span> : ""}
          </div>
        </div>
        <motion.button whileTap={{ scale: 0.95 }} onClick={onThink} disabled={busy} className="clay-color flex items-center gap-2 rounded-full px-5 py-3 font-extrabold text-white disabled:opacity-80" style={{ background: "linear-gradient(135deg,#8b5cf6,#5b7cff)", ["--glow" as string]: "rgba(139,92,246,.5)" }}>
          <motion.span animate={busy ? { rotate: 360 } : { rotate: 0 }} transition={busy ? { repeat: Infinity, duration: 1.4, ease: "linear" } : {}}>
            <Icon name="brain" size={18} />
          </motion.span>
          {busy ? "Düşünüyor…" : "Şimdi düşün"}
        </motion.button>
      </div>

      {/* ajan grafiği */}
      <div className="relative mx-auto mt-2 hidden aspect-[64/30] w-full max-w-[760px] sm:block">
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <radialGradient id="brainGlow">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity=".55" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx={cx} cy={cy} r={busy ? 92 : 70} fill="url(#brainGlow)">
            {busy && <animate attributeName="r" values="70;96;70" dur="1.8s" repeatCount="indefinite" />}
          </circle>
          {pos.map(({ a, x, y }, i) => (
            <g key={a.id} opacity={agent && agent !== a.id ? 0.25 : 1}>
              <path d={`M${x},${y} Q${(x + cx) / 2},${(y + cy) / 2 - 18} ${cx},${cy}`} fill="none" stroke={a.color} strokeOpacity=".45" strokeWidth="2" strokeDasharray="4 6">
                <animate attributeName="stroke-dashoffset" values="20;0" dur={busy ? "0.6s" : "2.4s"} repeatCount="indefinite" />
              </path>
              {busy && (
                <circle r="4" fill={a.color}>
                  <animateMotion dur={`${1.2 + (i % 3) * 0.3}s`} repeatCount="indefinite" path={`M${x},${y} Q${(x + cx) / 2},${(y + cy) / 2 - 18} ${cx},${cy}`} />
                </circle>
              )}
            </g>
          ))}
        </svg>
        {/* merkez */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <motion.div
            animate={busy ? { scale: [1, 1.08, 1] } : { scale: 1 }}
            transition={busy ? { repeat: Infinity, duration: 1.6 } : {}}
            className="clay-color mx-auto grid h-20 w-20 place-items-center rounded-full text-4xl"
            style={{ background: "radial-gradient(circle at 35% 30%, #c4b5fd, #8b5cf6 55%, #5b21b6)", ["--glow" as string]: "rgba(139,92,246,.6)" }}
          >
            🧠
          </motion.div>
          <div className="mt-1.5 text-xs font-extrabold">Beyin</div>
          <div className="text-[10px] font-bold text-ink-3">bilgi dosyaları + bellek</div>
        </div>
        {/* ajanlar */}
        {pos.map(({ a, x, y }) => {
          const n = counts[a.id];
          const run = st.runs[0]?.agents.find((r) => r.agent === a.id);
          return (
            <button
              key={a.id}
              onClick={() => onAgent(agent === a.id ? null : a.id)}
              title={a.role}
              className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-2xl bg-card/90 py-1.5 pl-1.5 pr-3 text-left shadow-[0_8px_24px_-12px_rgba(31,35,48,.35)] ring-1 ring-black/5 backdrop-blur transition-transform hover:scale-105 dark:ring-white/10 ${agent === a.id ? "scale-105" : ""}`}
              style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, boxShadow: agent === a.id ? `0 0 0 2px ${a.color}` : undefined }}
            >
              <span className="relative grid h-9 w-9 place-items-center rounded-xl text-lg" style={{ background: `${a.color}22` }}>
                {a.emoji}
                {(busy || active.has(a.id)) && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-ping rounded-full" style={{ background: a.color }} />}
              </span>
              <span>
                <span className="block whitespace-nowrap text-xs font-extrabold">{a.name}</span>
                <span className="block whitespace-nowrap text-[10px] font-bold text-ink-3">
                  {run?.error ? <span className="text-fail">hata</span> : a.id === "dosya" ? `${st.runs[0]?.files ?? 0} dosya ekledi` : `${n.open} açık${n.inbox ? ` · ${n.inbox} öneri` : ""}`}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {/* telefon: ajan şeridi */}
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1 sm:hidden">
        {AGENTS.map((a) => (
          <button key={a.id} onClick={() => onAgent(agent === a.id ? null : a.id)} className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${agent === a.id ? "text-white" : "clay-sm"}`} style={agent === a.id ? { background: a.color } : undefined}>
            {a.emoji} {a.source} <span className="opacity-70">{counts[a.id].open}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        {[
          { l: "Onay bekleyen öneri", v: inbox, c: STATUS_META.inbox.color },
          { l: "Yapılacak / devam", v: todo, c: STATUS_META.todo.color },
          { l: "Termini bugün / geçmiş", v: dueToday, c: "#ff5e6c" },
        ].map((s) => (
          <div key={s.l} className="clay-sm rounded-2xl p-3">
            <div className="text-2xl font-extrabold tabular-nums" style={{ color: s.c }}>
              {s.v}
            </div>
            <div className="text-[11px] font-bold text-ink-3">{s.l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ görev çubuğu
export function Capture({ onDone, seed, compact }: { onDone: (s: BrainState, newId: string | undefined, doNow: boolean, team: boolean) => void; seed: { text: string; agent: AgentId; n: number } | null; compact?: boolean }) {
  const [text, setText] = useState("");
  const [agent, setAgent] = useState<AgentId | "">("");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!seed) return;
    setText(seed.text);
    setAgent(seed.agent);
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [seed]);
  const [doNow, setDoNow] = useState(true);
  const [team, setTeam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/brain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "capture", text: t, agent: agent || undefined }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setText("");
      onDone(j.state, j.run?.createdIds?.[0], doNow, doNow && team);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form ref={ref} onSubmit={submit} className="clay p-2.5">
      <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
        <select value={agent} onChange={(e) => setAgent(e.target.value as AgentId | "")} className="clay-sm rounded-full bg-transparent px-3 py-1.5 text-xs font-extrabold outline-none" aria-label="Ajan">
          <option value="">🧠 Beyin seçsin</option>
          {AGENTS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.emoji} {a.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setDoNow((v) => !v)} className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${doNow ? "bg-blue text-white" : "bg-track text-ink-2"}`} title="Açık: ajan işi hemen yapıp teslimatı yazar. Kapalı: yalnızca iş olarak kaydedilir.">
          ⚡ Hemen yapsın {doNow ? "açık" : "kapalı"}
        </button>
        <button type="button" onClick={() => setTeam((v) => !v)} className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${team ? "bg-[#8b5cf6] text-white" : "bg-track text-ink-2"}`} title="Açık: departman lideri işi parçalara bölüp ekiple yapar">
          👥 Ekip
        </button>
        {!compact && <span className="hidden text-[11px] font-semibold text-ink-3 sm:inline">Okumak serbest; dışarıya bir şey gidecekse taslak hazırlar, onayını bekler.</span>}
      </div>
      <div className="clay-pressed flex items-end gap-2 rounded-[22px] p-2 pl-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit(e);
            }
          }}
          rows={1}
          placeholder={compact ? "Bir iş yaz…" : "Bir iş ver: “Ceren Hanım'a Bursa dönem sonucu için hatırlatma taslağı yaz”"}
          className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[15px] outline-none placeholder:text-ink-3"
        />
        <motion.button whileTap={{ scale: 0.92 }} disabled={busy || !text.trim()} className="clay-color grid h-11 shrink-0 place-items-center rounded-full bg-blue px-4 text-sm font-extrabold text-white disabled:opacity-50">
          {busy ? "Anlıyor…" : "Ver"}
        </motion.button>
      </div>
      {err && <div className="mt-1 px-3 text-xs font-semibold text-fail">{err}</div>}
    </form>
  );
}

// ------------------------------------------------------------------ bugün odak
export function Focus({ st, onOpen }: { st: BrainState; onOpen: (x: BrainItem) => void }) {
  const { store } = useTodos();
  const f = st.focus!;
  return (
    <div className="clay p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xl">🎯</span>
        <div className="text-lg font-extrabold">Bugün odak</div>
        <span className="ml-auto text-xs font-semibold text-ink-3">{ago(f.at)}</span>
      </div>
      <Brief text={f.brief} />
      {f.order.length > 0 && (
        <ol className="mt-3 space-y-1.5">
          {f.order.map((o, i) => {
            const it = st.items.find((x) => x.id === o.id);
            const todo = o.id.startsWith("todo:") ? store.todos.find((t) => t.id === o.id.slice(5)) : undefined;
            const title = it?.title ?? todo?.title;
            if (!title || it?.status === "done" || todo?.done) return null;
            const a = it ? agentById(it.agent) : null;
            return (
              <li key={o.id}>
                <button onClick={() => it && onOpen(it)} className="flex w-full items-start gap-3 rounded-2xl px-2 py-2 text-left hover:bg-track/60">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue text-xs font-extrabold text-white">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">
                      {a ? `${a.emoji} ` : "✅ "}
                      {title}
                    </span>
                    <span className="block text-xs text-ink-3">{o.reason}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ kart
function Card({ x, onOpen, onApprove, onDismiss }: { x: BrainItem; onOpen: () => void; onApprove: () => void; onDismiss: (reason?: string) => void }) {
  const [asking, setAsking] = useState(false);
  const a = agentById(x.agent)!;
  const done = x.steps.filter((s) => s.done).length;
  const overdue = x.due && x.status !== "done" && x.due < new Date().toLocaleDateString("sv-SE");
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} className="clay-sm overflow-hidden rounded-2xl">
      <button onClick={onOpen} className="block w-full p-3 text-left">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-ink-3">
          <span>{a.emoji}</span>
          <span>{KIND_LABEL[x.kind]}</span>
          <span className="ml-auto rounded-full px-1.5 text-[10px] font-extrabold text-white" style={{ background: PRIORITY[x.priority].color }}>
            {PRIORITY[x.priority].short}
          </span>
        </div>
        <div className="mt-1 line-clamp-3 text-sm font-extrabold leading-snug">{x.title}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold text-ink-3">
          {x.due && <span className={overdue ? "text-fail" : ""}>📅 {dueLabel(x.due)}</span>}
          {x.person && <span>👤 {x.person}</span>}
          {x.area && <span>{x.area}</span>}
          {x.steps.length > 0 && (
            <span>
              ☑ {done}/{x.steps.length}
            </span>
          )}
          {x.files.length > 0 && <span>📎 {x.files.length}</span>}
          {x.todoId && <span>✅ görevde</span>}
          {x.auto && <span className="text-[#8b5cf6]">🤖 kendisi onayladı</span>}
          {x.work?.status === "queued" && <span className="text-blue">⏳ sırada</span>}
          {x.work?.status === "running" && <span className="animate-pulse text-blue">⏳ ajan çalışıyor</span>}
          {x.work?.status === "ready" && <span className="text-ok">📝 teslimat hazır</span>}
          {x.work?.status === "waiting_ok" && <span className="text-warn">✋ onay bekliyor</span>}
          {x.work?.status === "error" && <span className="text-fail">⚠ hata</span>}
        </div>
      </button>
      {x.status === "inbox" && !asking && (
        <div className="flex border-t border-line text-xs font-extrabold">
          <button onClick={onApprove} className="flex-1 py-2 text-ok hover:bg-ok/10">
            ✓ Onayla
          </button>
          <button onClick={() => setAsking(true)} className="flex-1 border-l border-line py-2 text-ink-3 hover:bg-track">
            ✕ Gerek yok
          </button>
        </div>
      )}
      {x.status === "inbox" && asking && (
        <div className="border-t border-line p-2">
          <RejectReasons compact onPick={onDismiss} onCancel={() => setAsking(false)} />
        </div>
      )}
    </motion.div>
  );
}

// ------------------------------------------------------------------ ayrıntı
export function ItemSheet({ x, onClose, onPatch, onWork, onApprove }: { x: BrainItem | null; onClose: () => void; onPatch: (id: string, p: Partial<BrainItem>, reason?: string) => void; onWork: (id: string, feedback?: string, team?: boolean) => void; onApprove: (id: string, mail?: boolean) => Promise<{ error: string; code?: string } | null> }) {
  const { add } = useTodos();
  const { toast } = usePeriod();
  const { ask } = useAssistant();
  const a = x ? agentById(x.agent) : null;
  const [asking, setAsking] = useState(false);
  useEffect(() => setAsking(false), [x?.id]);
  const toTodo = () => {
    if (!x) return;
    const id = uid();
    add(
      newTodo({
        id,
        title: x.title,
        notes: [x.summary, x.why && `Neden: ${x.why}`, ...x.files.map((f) => `📎 ${f.name}${f.link ? ` — ${f.link}` : ""}`)].filter(Boolean).join("\n"),
        due: x.due,
        priority: x.priority,
        person: x.person,
        areaCode: x.area,
        tags: ["beyin"],
        source: `brain:${x.id}`,
        subtasks: x.steps.map((s) => ({ id: uid(), title: s.title, done: s.done })),
      }),
    );
    onPatch(x.id, { todoId: id, status: x.status === "inbox" ? "todo" : x.status });
    toast("Görevlerine eklendi");
  };
  return (
    <Sheet open={!!x} onClose={onClose} wide title={<span className="line-clamp-2 text-lg">{x?.title}</span>}>
      {x && a && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <span className="rounded-full px-2.5 py-1" style={{ background: `${a.color}22`, color: a.color }}>
              {a.emoji} {a.name}
            </span>
            <span className="rounded-full bg-track px-2.5 py-1">{KIND_LABEL[x.kind]}</span>
            <span className="rounded-full px-2.5 py-1 text-white" style={{ background: PRIORITY[x.priority].color }}>
              {PRIORITY[x.priority].label}
            </span>
            {x.due && <span className="rounded-full bg-track px-2.5 py-1">📅 {dueLabel(x.due)}</span>}
            {x.person && <span className="rounded-full bg-track px-2.5 py-1">👤 {x.person}</span>}
            {x.area && <span className="rounded-full bg-track px-2.5 py-1">{x.area}</span>}
          </div>

          <div className="rounded-2xl bg-card p-4">
            <div className="text-[15px] leading-relaxed">{x.summary}</div>
            {x.why && <div className="mt-2 text-sm text-ink-2">💡 {x.why}</div>}
          </div>

          {x.auto && x.status !== "dismissed" && (
            <div className="rounded-2xl bg-[#8b5cf6]/10 px-4 py-2.5 text-xs font-semibold text-ink-2">
              🤖 {a.name} bunu güven seviyesiyle (“{TRUST_META[x.auto.level].label}”) <b>kendisi onayladı</b>
              {x.auto.level === 2 ? " ve işi kendisi yapıyor" : ""}. Yanlışsa “Gerek yok” de; 14 günde 2 yanlışta seviyesi bir düşer.
            </div>
          )}

          <WorkSection x={x} onWork={onWork} onApprove={onApprove} />

          {/* durum */}
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(STATUS_META) as Col[]).map((s) => (
              <button key={s} onClick={() => onPatch(x.id, { status: s })} className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${x.status === s ? "text-white" : "bg-track text-ink-2"}`} style={x.status === s ? { background: STATUS_META[s].color } : undefined}>
                {STATUS_META[s].label}
              </button>
            ))}
          </div>

          {x.steps.length > 0 && (
            <div>
              <div className="mb-1.5 text-sm font-extrabold">Adımlar</div>
              <div className="space-y-1">
                {x.steps.map((s, i) => (
                  <label key={i} className="flex cursor-pointer items-start gap-2.5 rounded-xl px-2 py-1.5 hover:bg-track/60">
                    <input
                      type="checkbox"
                      checked={s.done}
                      onChange={() => onPatch(x.id, { steps: x.steps.map((y, k) => (k === i ? { ...y, done: !y.done } : y)) })}
                      className="mt-1 h-4 w-4 accent-[#5b7cff]"
                    />
                    <span className={`text-sm ${s.done ? "text-ink-3 line-through" : ""}`}>{s.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {x.files.length > 0 && (
            <div>
              <div className="mb-1.5 text-sm font-extrabold">📁 Dosya ajanının bulduğu dosyalar</div>
              <div className="space-y-1.5">
                {x.files.map((f) => (
                  <a key={f.id} href={f.link} target="_blank" rel="noreferrer" className="block rounded-xl bg-track/60 px-3 py-2 hover:bg-track">
                    <div className="truncate text-sm font-bold">{f.name}</div>
                    {f.excerpt && <div className="line-clamp-2 text-xs text-ink-3">{f.excerpt}</div>}
                  </a>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 text-sm font-extrabold">Kaynaklar</div>
            <div className="space-y-1.5">
              {x.sources.map((s) => {
                const sa = agentById(s.agent);
                const inner = (
                  <>
                    <span>{sa?.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{s.title}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {s.who ? `${s.who} · ` : ""}
                        {new Date(s.ts).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </span>
                    {s.link && <Icon name="external" size={14} className="shrink-0 text-ink-3" />}
                  </>
                );
                return s.link ? (
                  <a key={s.signalId} href={s.link} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-xl bg-track/60 px-3 py-2 hover:bg-track">
                    {inner}
                  </a>
                ) : (
                  <div key={s.signalId} className="flex items-center gap-2.5 rounded-xl bg-track/60 px-3 py-2">
                    {inner}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {x.status === "inbox" && (
              <button onClick={() => onPatch(x.id, { status: "todo" })} className="rounded-full bg-ok px-4 py-2 text-sm font-extrabold text-white">
                ✓ Onayla
              </button>
            )}
            {!x.todoId && (
              <button onClick={toTodo} className="clay-dark rounded-full px-4 py-2 text-sm font-extrabold">
                ✅ Görevlerime ekle
              </button>
            )}
            <button
              onClick={() => {
                onClose();
                ask(`Beyindeki şu işi birlikte planlayalım: "${x.title}". Özet: ${x.summary} Adımlar: ${x.steps.map((s) => s.title).join("; ")}. Kaynaklar: ${x.sources.map((s) => s.title).join("; ")}. Gerekirse arşivde ilgili e-posta/dosyaları bul, ilk adımı benimle netleştir.`);
              }}
              className="rounded-full bg-blue px-4 py-2 text-sm font-extrabold text-white"
            >
              ✨ Asistanla planla
            </button>
            {x.status !== "dismissed" && x.status !== "done" && (
              <button onClick={() => setAsking((v) => !v)} className="rounded-full bg-track px-4 py-2 text-sm font-bold text-ink-2">
                Gerek yok
              </button>
            )}
          </div>
          {asking && (
            <RejectReasons
              onPick={(r) => {
                onPatch(x.id, { status: "dismissed" }, r);
                onClose();
              }}
              onCancel={() => setAsking(false)}
            />
          )}
        </div>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ seçimlerden öğrenme
/** "Gerek yok" denince neden: beyin bundan öğrenir (benim işim değil → bu tür iş bir daha açılmaz). */
export function RejectReasons({ onPick, onCancel, compact }: { onPick: (reason?: string) => void; onCancel: () => void; compact?: boolean }) {
  const [other, setOther] = useState("");
  return (
    <div className={compact ? "" : "clay-sm rounded-2xl p-3"}>
      <div className="mb-1.5 text-[11px] font-extrabold text-ink-3">Neden? Bundan öğreneceğim</div>
      <div className="flex flex-wrap gap-1.5">
        {REJECT_REASONS.map((r) => (
          <button key={r} onClick={() => onPick(r)} className="rounded-full bg-track px-2.5 py-1 text-[11px] font-extrabold text-ink-2 hover:bg-blue hover:text-white">
            {r}
          </button>
        ))}
      </div>
      <form
        className="mt-1.5 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (other.trim()) onPick(other.trim());
        }}
      >
        <input value={other} onChange={(e) => setOther(e.target.value)} placeholder={compact ? "Başka sebep…" : "Başka bir sebep… (ör. bu Tuğrul'un işi)"} className="field min-w-0 flex-1 py-1.5 text-xs" />
        {other.trim() ? (
          <button className="rounded-full bg-blue px-3 text-[11px] font-extrabold text-white">Gönder</button>
        ) : (
          <button type="button" onClick={() => onPick()} className="rounded-full px-2 text-[11px] font-bold text-ink-3 hover:text-ink">
            Sebepsiz
          </button>
        )}
        <button type="button" onClick={onCancel} className="px-1 text-[11px] font-bold text-ink-3 hover:text-ink" aria-label="Vazgeç">
          ✕
        </button>
      </form>
    </div>
  );
}

/** Seni tanıyorum: seçimlerden öğrendikleri (belleğe yazılanlar) ve bekleyen seçimler. */
export function Learning({ learning, onLearned, compact }: { learning?: LearningState; onLearned?: () => void; compact?: boolean }) {
  const { toast } = usePeriod();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  if (!learning || (!learning.total && !learning.log.length)) {
    return (
      <div className={`clay-sm rounded-2xl ${compact ? "p-3 text-xs" : "p-4 text-sm"} text-ink-3`}>
        🎓 <b className="text-ink-2">Seni tanıyorum</b> — önerilere verdiğin her evet/hayır, öncelik ve ajan değişikliği, teslimat düzeltmesi buraya düşer; bunlardan
        tercihlerini öğrenip belleğe yazarım.
      </div>
    );
  }
  const lessons = learning.log.flatMap((g) => g.lessons.map((l) => ({ ...l, at: g.at })));
  const shown = open ? lessons.slice(0, 12) : lessons.slice(0, compact ? 2 : 3);
  const now = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "learn" }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      toast(lessonToast(j.learned as Lesson[]) ?? "Seçimleri inceledim; yeni bir kalıcı tercih çıkmadı");
      onLearned?.();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`clay-sm rounded-2xl ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-center gap-2">
        <span className={compact ? "text-lg" : "text-xl"}>🎓</span>
        <div className="min-w-0 flex-1">
          <div className={`${compact ? "text-[11px] uppercase tracking-[0.16em]" : "text-sm"} font-extrabold`}>Seni tanıyorum</div>
          <div className="text-[11px] font-semibold text-ink-3">
            {learning.total} seçim · {lessons.length} tercih öğrenildi{learning.pending ? ` · ${learning.pending} seçim sırada` : ""}
          </div>
        </div>
        {learning.pending > 0 && (
          <button onClick={now} disabled={busy} className="shrink-0 rounded-full bg-blue px-3 py-1 text-[11px] font-extrabold text-white disabled:opacity-60">
            {busy ? "Öğreniyor…" : "Şimdi öğren"}
          </button>
        )}
      </div>
      {shown.length > 0 && (
        <ul className="mt-2 space-y-1">
          {shown.map((l, i) => (
            <li key={i} className="flex gap-1.5 text-xs leading-snug text-ink-2">
              <span className="shrink-0 text-ink-3">•</span>
              <span>
                {l.entry} <span className="text-[10px] font-bold text-ink-3">· {l.topic}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {lessons.length > shown.length || open ? (
        <button onClick={() => setOpen((v) => !v)} className="mt-1.5 text-[11px] font-extrabold text-blue">
          {open ? "Daha az" : `Tümü (${lessons.length})`}
        </button>
      ) : null}
      {!compact && <div className="mt-1.5 text-[10px] font-semibold text-ink-3">Belleğe (gelistirme.md) yazılır; asistanın bilgi dosyalarından düzenleyip silebilirsin.</div>}
    </div>
  );
}

// ------------------------------------------------------------------ kazanılan güven
const pct = (a: number, b: number) => (a + b ? Math.round((a / (a + b)) * 100) : 0);

/** Ajanın güven seviyesi: Öner · Kendisi onaylasın · Teslimatı da hazırlasın + onay istatistiği. */
export function TrustControl({ trust, onTrust }: { trust: AgentTrustView; onTrust: (level: TrustLevel) => void }) {
  const s = trust.stats;
  const decided = s.accepted + s.rejected;
  return (
    <div className="border-b border-line px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-ink-3">Güven seviyesi</span>
        <span className="text-[11px] font-semibold text-ink-3">
          {decided ? `${decided} karar · %${pct(s.accepted, s.rejected)} onay` : "henüz karar yok"}
          {s.delivered + s.fixed ? ` · teslimat ${s.delivered}✓ ${s.fixed}✎` : ""}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-track p-1">
        {TRUST_META.map((m, i) => (
          <button
            key={m.label}
            onClick={() => i !== trust.level && onTrust(i as TrustLevel)}
            title={m.hint}
            className={`rounded-xl px-1.5 py-1.5 text-[11px] font-extrabold leading-tight ${trust.level === i ? "bg-card text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}
          >
            {["🙋", "✅", "🤖"][i]} {m.label}
          </button>
        ))}
      </div>
      <div className="mt-1.5 text-[11px] text-ink-3">
        {TRUST_META[trust.level].hint}
        {trust.level > 0 && trust.askKinds.length > 0 && <> · yine de sorar: {trust.askKinds.map((k) => KIND_LABEL[k]).join(", ")}</>}. Dışarıya giden hiçbir şey otomatik gitmez.
      </div>
      {trust.suggest != null && (
        <button onClick={() => onTrust(trust.suggest!)} className="mt-2 w-full rounded-xl bg-[#8b5cf6]/12 px-3 py-2 text-left text-xs font-bold text-[#8b5cf6] hover:bg-[#8b5cf6]/20">
          ⬆ Güveni hak etti — “{TRUST_META[trust.suggest].label}” seviyesine geçir
        </button>
      )}
      {trust.note && <div className="mt-2 rounded-xl bg-tint-warn px-3 py-2 text-[11px] font-semibold">⬇ {trust.note}</div>}
    </div>
  );
}

/** Güveni hak eden ajanlar için yükseltme önerisi ("Sonra" denince o seviye için bir daha sorulmaz). */
export function TrustSuggest({ trust, onTrust, compact }: { trust?: Record<AgentId, AgentTrustView>; onTrust: (agent: AgentId, level: TrustLevel) => void; compact?: boolean }) {
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    try {
      setHidden(JSON.parse(localStorage.getItem("lq:trust-later") || "[]"));
    } catch {}
  }, []);
  const later = (k: string) => {
    const next = [...hidden, k];
    setHidden(next);
    try {
      localStorage.setItem("lq:trust-later", JSON.stringify(next));
    } catch {}
  };
  const list = AGENTS.map((a) => ({ a, t: trust?.[a.id] })).filter(({ a, t }) => t?.suggest != null && !hidden.includes(`${a.id}:${t.suggest}`));
  if (!list.length) return null;
  return (
    <div className={`space-y-2 ${compact ? "" : ""}`}>
      {list.map(({ a, t }) => (
        <motion.div key={a.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className={`flex flex-wrap items-center gap-2 rounded-2xl border border-[#8b5cf6]/30 bg-[#8b5cf6]/8 ${compact ? "p-2.5" : "p-3"}`}>
          <span className="text-xl">{a.emoji}</span>
          <div className="min-w-0 flex-1 basis-40 text-xs">
            <div className="font-extrabold">
              {a.name} güveni hak etti → “{TRUST_META[t!.suggest!].label}”
            </div>
            <div className="text-ink-3">
              {t!.suggest === 1
                ? `${t!.stats.accepted + t!.stats.rejected} kararın %${pct(t!.stats.accepted, t!.stats.rejected)}'ini onayladın. Yeni işleri sormadan Yapılacak'a alsın mı?`
                : `${t!.stats.delivered} teslimatını onayladın, ${t!.stats.fixed} kez düzelttin. Onayladığı işi kendisi yapsın mı?`}
            </div>
          </div>
          <button onClick={() => onTrust(a.id, t!.suggest!)} className="rounded-full bg-[#8b5cf6] px-3 py-1.5 text-[11px] font-extrabold text-white">
            Yükselt
          </button>
          <button onClick={() => later(`${a.id}:${t!.suggest}`)} className="rounded-full px-2 py-1.5 text-[11px] font-bold text-ink-3 hover:text-ink">
            Sonra
          </button>
        </motion.div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ düşünme kayıtları
function Runs({ runs }: { runs: BrainRun[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  if (!runs.length) return null;
  const trig = { manual: "elle", auto: "otomatik", cron: "sabah", capture: "not" } as const;
  return (
    <div ref={ref} className="clay p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-extrabold">🧾 Düşünme kayıtları</span>
        <span className="text-xs font-bold text-ink-3">
          {runs.length} kayıt {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {runs.map((r) => (
            <div key={r.id} className="rounded-2xl bg-track/50 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-x-2 font-bold">
                <span>{new Date(r.at).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                <span className="text-ink-3">· {trig[r.trigger]}</span>
                <span className="text-ink-3">· {(r.ms / 1000).toFixed(1)} sn</span>
                <span className="text-ink-3">· {Math.round(r.tokens / 1000)}k token</span>
                {r.cost != null && <span className="text-blue">· ${r.cost.toFixed(4)}</span>}
                {r.error && <span className="text-fail">· {r.error}</span>}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {r.agents.map((a) => {
                  const m = agentById(a.agent)!;
                  return (
                    <span key={a.agent} className={`rounded-full px-2 py-0.5 font-semibold ${a.error ? "bg-tint-fail text-fail" : "bg-card"}`} title={a.error}>
                      {m.emoji} {a.agent === "dosya" ? `${a.updated} dosya` : `${a.signals} sinyal → ${a.created} yeni${a.updated ? `, ${a.updated} güncelleme` : ""}`}
                    </span>
                  );
                })}
                {!r.agents.length && <span className="text-ink-3">Yeni sinyal yoktu.</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ teslimat
function WorkSection({ x, onWork, onApprove }: { x: BrainItem; onWork: (id: string, feedback?: string, team?: boolean) => void; onApprove: (id: string, mail?: boolean) => Promise<{ error: string; code?: string } | null> }) {
  const { toast } = usePeriod();
  const [fb, setFb] = useState("");
  const [sending, setSending] = useState(false);
  const [mailErr, setMailErr] = useState<{ error: string; code?: string } | null>(null);
  const a = agentById(x.agent)!;
  const w = x.work;
  const toGmail = async () => {
    setSending(true);
    setMailErr(null);
    setMailErr(await onApprove(x.id, true));
    setSending(false);
  };
  const html = useMemo(() => (w?.output ? renderMd(w.output) : ""), [w?.output]);
  const mailLink = x.sources.find((s) => s.ref?.source === "gmail" && s.link)?.link;
  if (!w) {
    return (
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <button onClick={() => onWork(x.id)} className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-3 text-left hover:bg-track/50" style={{ borderColor: `${a.color}66` }}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl" style={{ background: `${a.color}22` }}>
            {a.emoji}
          </span>
          <span>
            <span className="block font-extrabold">🤖 {a.name} bu işi yapsın</span>
            <span className="block text-xs text-ink-3">Kaynakları ve arşivi okuyup teslimatı yazar (taslak, özet, hazırlık notu). Dışarıya bir şey göndermez.</span>
          </span>
        </button>
        <button onClick={() => onWork(x.id, undefined, true)} className="flex items-center gap-2 rounded-2xl border-2 border-dashed border-[#8b5cf6]/50 px-4 py-3 text-left hover:bg-track/50" title="Lider işi 2-4 parçaya böler, ajanlar aynı anda çalışır, lider birleştirir">
          <span className="text-xl">👥</span>
          <span>
            <span className="block whitespace-nowrap font-extrabold">Ekip olarak yap</span>
            <span className="block text-xs text-ink-3">2–4 ajan aynı anda</span>
          </span>
        </button>
      </div>
    );
  }
  if (w.status === "queued") {
    return (
      <div className="rounded-2xl p-4" style={{ background: `${a.color}14` }}>
        <div className="font-extrabold">⏳ Sırada — {a.name} bu işi kendisi yapacak</div>
        <div className="mt-1 text-xs text-ink-3">Güven seviyesi “{TRUST_META[2].label}”. Sıradaki işler sayfa açıkken (ya da arka planda) tek tek yapılır; gidecek bir şey olursa onayını bekler.</div>
        <button onClick={() => onWork(x.id)} className="mt-2 rounded-full bg-track px-3 py-1.5 text-xs font-extrabold">
          ▶ Şimdi yap
        </button>
      </div>
    );
  }
  if (w.status === "running") {
    return (
      <div className="rounded-2xl p-4" style={{ background: `${a.color}14` }}>
        <div className="flex items-center gap-2 font-extrabold">
          <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="inline-block h-4 w-4 rounded-full border-2 border-blue border-t-transparent" />
          {w.team ? `Ekip çalışıyor — lider ${a.name}` : `${a.name} çalışıyor…`}
        </div>
        {w.team ? <TeamPieces team={w.team} /> : <div className="mt-1 text-xs text-ink-3">Kaynakları okuyor, gerekirse arşivde arıyor. 15–40 sn sürebilir.</div>}
      </div>
    );
  }
  const lastRule = w.revisions.at(-1)?.rule;
  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs font-extrabold" style={{ background: `${a.color}18` }}>
        <span>
          {a.emoji} {a.name} teslimatı
        </span>
        <span className={w.status === "waiting_ok" ? "text-warn" : w.status === "approved" ? "text-ok" : w.status === "error" ? "text-fail" : "text-ink-3"}>
          · {w.status === "waiting_ok" ? "onayını bekliyor" : w.status === "approved" ? "onaylandı" : w.status === "error" ? "hata" : "hazır"}
        </span>
        <span className="ml-auto font-semibold text-ink-3">
          {w.ms ? `${Math.round(w.ms / 1000)} sn` : ""}
          {w.cost != null ? ` · $${w.cost.toFixed(4)}` : ""}
        </span>
      </div>
      {w.status === "error" ? (
        <div className="px-4 py-3 text-sm text-fail">⚠ {w.error}</div>
      ) : (
        <div className="md max-h-[50vh] overflow-y-auto bg-card px-4 py-3 text-[14.5px] leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
      )}
      {w.team && (
        <details className="border-t border-line bg-card px-4 py-2 text-xs">
          <summary className="cursor-pointer font-bold text-ink-2">👥 Ekip: {w.team.pieces.map((p) => agentById(p.agent)?.emoji).join(" ")} — parçalar ve notlar</summary>
          <TeamPieces team={w.team} full />
        </details>
      )}
      {w.used.length > 0 && (
        <details className="border-t border-line bg-card px-4 py-2 text-xs text-ink-3">
          <summary className="cursor-pointer font-bold">🔎 {w.used.length} araç kullanıldı</summary>
          <ul className="mt-1 space-y-0.5">
            {w.used.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </details>
      )}
      {w.outbound && w.status === "waiting_ok" && (
        <div className="border-t border-line bg-tint-warn px-4 py-3 text-sm">
          <div className="font-extrabold">✋ Onaylanınca gidecek</div>
          <div className="mt-0.5">{w.outbound}</div>
          <div className="mt-1 text-xs text-ink-3">“Onayla → Gmail taslağı” e-postayı Gmail taslaklarına yazar (kaynak bir e-postaysa aynı yazışmaya yanıt olarak); göndermek sende: Gmail'de açıp “Gönder”.</div>
          {mailErr && (
            <div className="mt-2 rounded-xl bg-card px-3 py-2 text-xs font-semibold text-fail">
              ⚠ {mailErr.error}{" "}
              {mailErr.code === "scope" && (
                <a href="/api/google/auth" className="font-extrabold text-blue underline">
                  Google'ı yeniden bağla
                </a>
              )}
            </div>
          )}
        </div>
      )}
      {w.draft && (
        <div className="border-t border-line bg-ok/10 px-4 py-3 text-sm">
          <div className="font-extrabold">✉️ Gmail'de taslak hazır{w.draft.reply ? " (yazışmaya yanıt)" : ""}</div>
          <div className="mt-0.5 text-xs text-ink-2">
            Kime: {w.draft.to.join(", ")}
            {w.draft.cc.length ? ` · Bilgi: ${w.draft.cc.join(", ")}` : ""} · Konu: {w.draft.subject}
          </div>
          <a href={w.draft.link} target="_blank" rel="noreferrer" className="mt-2 inline-block rounded-full bg-ok px-3 py-1.5 text-xs font-extrabold text-white">
            Gmail'de aç ve gönder ↗
          </a>
        </div>
      )}
      {lastRule && <div className="border-t border-line bg-tint-info px-4 py-2 text-xs font-semibold">📏 Kalıcı kural öğrenildi: {lastRule}</div>}
      <div className="flex flex-wrap gap-2 border-t border-line bg-card px-4 py-3">
        {w.output && (
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(w.output).catch(() => {});
              toast("Kopyalandı");
            }}
            className="rounded-full bg-track px-3 py-1.5 text-xs font-extrabold"
          >
            📋 Kopyala
          </button>
        )}
        {mailLink && (
          <a href={mailLink} target="_blank" rel="noreferrer" className="rounded-full bg-track px-3 py-1.5 text-xs font-extrabold">
            ✉️ Gmail'de aç
          </a>
        )}
        {w.status === "waiting_ok" && (
          <>
            <button onClick={toGmail} disabled={sending} className="rounded-full bg-ok px-3 py-1.5 text-xs font-extrabold text-white disabled:opacity-60">
              {sending ? "Taslak yazılıyor…" : "✉️ Onayla → Gmail taslağı"}
            </button>
            <button onClick={() => onApprove(x.id)} className="rounded-full bg-track px-3 py-1.5 text-xs font-extrabold">
              ✓ Gönderdim, onayla
            </button>
          </>
        )}
        <button onClick={() => onWork(x.id)} className="rounded-full bg-track px-3 py-1.5 text-xs font-extrabold">
          ↻ Yeniden yap
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!fb.trim()) return;
          onWork(x.id, fb.trim());
          setFb("");
        }}
        className="flex gap-2 border-t border-line bg-card px-3 py-2.5"
      >
        <input value={fb} onChange={(e) => setFb(e.target.value)} placeholder="Düzelt: “daha kısa yaz, resmi hitap kullan” — kalıcıysa ajan öğrenir" className="min-w-0 flex-1 rounded-full bg-track px-4 py-2 text-sm outline-none placeholder:text-ink-3" />
        <button disabled={!fb.trim()} className="rounded-full bg-blue px-4 py-2 text-xs font-extrabold text-white disabled:opacity-40">
          Düzelt
        </button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ ekip parçaları
function TeamPieces({ team, full }: { team: NonNullable<NonNullable<BrainItem["work"]>["team"]>; full?: boolean }) {
  return (
    <div className="mt-2 space-y-2">
      {team.pieces.map((p, i) => {
        const a = agentById(p.agent)!;
        return (
          <div key={i} className="rounded-xl bg-card/80 p-2.5">
            <div className="flex items-center gap-2 text-xs font-extrabold">
              <span>{a.emoji}</span>
              <span>{a.name}</span>
              {p.agent === team.lead && <span className="rounded-full bg-[#8b5cf6]/15 px-1.5 text-[10px] text-[#8b5cf6]">lider</span>}
              <span className={`ml-auto ${p.status === "running" ? "animate-pulse text-blue" : p.status === "error" ? "text-fail" : "text-ok"}`}>
                {p.status === "running" ? "çalışıyor…" : p.status === "error" ? "hata" : `✓ ${p.ms ? `${Math.round(p.ms / 1000)} sn` : ""}`}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-ink-2">{p.task}</div>
            {full && p.output && <div className="mt-1.5 whitespace-pre-wrap rounded-lg bg-track/60 p-2 text-xs leading-relaxed">{p.output}</div>}
          </div>
        );
      })}
      {full && team.notes.length > 0 && (
        <div className="space-y-1">
          {team.notes.map((n, i) => (
            <div key={i} className="text-xs">
              💬 <b>{agentById(n.from)?.name}</b> → {n.to}: {n.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ajan kartı + kurulum görüşmesi
export function AgentPanel({ agent, onTry, onClose, trust, onTrust }: { agent: AgentId; onTry: (task: string) => void; onClose: () => void; trust?: AgentTrustView; onTrust?: (level: TrustLevel) => void }) {
  const a = agentById(agent)!;
  const [profile, setProfile] = useState<{ guide: string; rules: string } | null>(null);
  const [talk, setTalk] = useState<{ turns: { q: string; a: string }[]; q: string | null; step: number; busy: boolean; result?: { brief: string; skill: { name: string; when: string; steps: string[]; format: string }; tryTask: string } } | null>(null);
  const [answer, setAnswer] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const loadProfile = useCallback(() => {
    fetch(`/api/brain?agent=${agent}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setProfile(j.profile ?? { guide: "", rules: "" }))
      .catch(() => setProfile({ guide: "", rules: "" }));
  }, [agent]);
  useEffect(loadProfile, [loadProfile]);

  const ask = async (turns: { q: string; a: string }[]) => {
    setErr(null);
    setTalk((t) => ({ turns, q: null, step: turns.length + 1, busy: true, result: t?.result }));
    try {
      const r = await fetch("/api/brain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "interview", agent, turns }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      if (j.done) {
        setTalk({ turns, q: null, step: turns.length, busy: false, result: j });
        loadProfile();
      } else setTalk({ turns, q: j.question, step: j.step, busy: false });
    } catch (e) {
      setErr((e as Error).message);
      setTalk((t) => (t ? { ...t, busy: false } : t));
    }
  };
  const reply = (text: string) => {
    if (!talk?.q) return;
    const turns = [...talk.turns, { q: talk.q, a: text }];
    setAnswer("");
    ask(turns);
  };
  const guideHtml = useMemo(() => (profile?.guide ? renderMd(profile.guide) : ""), [profile]);

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="clay @container overflow-hidden">
      <div className="flex flex-wrap items-start gap-3 p-4" style={{ background: `${a.color}14` }}>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: `${a.color}26` }}>
          {a.emoji}
        </span>
        <div className="min-w-0 flex-1 basis-[55%]">
          <div className="text-lg font-extrabold leading-tight">{a.name}</div>
          <div className="text-xs text-ink-2">
            {a.source} · {a.role}
          </div>
        </div>
        {!talk && (
          <button onClick={() => ask([])} className="shrink-0 rounded-full bg-blue px-4 py-2 text-xs font-extrabold text-white">
            🎤 {profile?.guide ? "Yeniden görüş" : "Kurulum görüşmesi"}
          </button>
        )}
        <button onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-black/5 dark:hover:bg-white/10" aria-label="Kapat">
          <Icon name="close" size={16} />
        </button>
      </div>
      {trust && onTrust && <TrustControl trust={trust} onTrust={onTrust} />}

      {talk ? (
        <div className="space-y-3 p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-ink-3">
            Kurulum görüşmesi · {talk.result ? "tamamlandı" : `soru ${Math.min(talk.step, 5)}/5`}
          </div>
          {talk.turns.map((t, i) => (
            <div key={i} className="space-y-1.5">
              <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-track px-3.5 py-2 text-sm">
                {a.emoji} {t.q}
              </div>
              <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-blue px-3.5 py-2 text-sm text-white">{t.a}</div>
            </div>
          ))}
          {talk.busy && <div className="animate-pulse text-sm text-ink-3">{a.emoji} {talk.turns.length >= 5 || /^(bitti|tamam|yeter)/i.test(talk.turns.at(-1)?.a ?? "") ? "talimatını ve becerisini yazıyor…" : "düşünüyor…"}</div>}
          {talk.q && !talk.busy && (
            <>
              <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-track px-3.5 py-2 text-sm">
                {a.emoji} {talk.q}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (answer.trim()) reply(answer.trim());
                }}
                className="flex gap-2"
              >
                <input autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Cevabın…" className="min-w-0 flex-1 rounded-full bg-track px-4 py-2 text-sm outline-none" />
                <button disabled={!answer.trim()} className="rounded-full bg-blue px-4 py-2 text-xs font-extrabold text-white disabled:opacity-40">
                  Gönder
                </button>
              </form>
              <div className="flex gap-2 text-xs font-bold">
                <button onClick={() => reply("(atla)")} className="rounded-full bg-track px-3 py-1.5">
                  Atla
                </button>
                {talk.turns.length > 0 && (
                  <button onClick={() => reply("bitti")} className="rounded-full bg-track px-3 py-1.5">
                    Bitti, yaz
                  </button>
                )}
                <button onClick={() => setTalk(null)} className="rounded-full px-3 py-1.5 text-ink-3">
                  İptal
                </button>
              </div>
            </>
          )}
          {talk.result && (
            <div className="space-y-2 rounded-2xl bg-tint-info p-3 text-sm">
              <div className="font-extrabold">✍️ Yazdım: talimatım ve “{talk.result.skill.name}” becerim (ajan-talimatlari.md)</div>
              <div className="text-xs text-ink-2">Bundan sonra her işte bunlara uyacağım. Bilgi dosyaları panelinden düzenleyebilirsin.</div>
              <button
                onClick={() => {
                  onTry(talk.result!.tryTask);
                  setTalk(null);
                }}
                className="rounded-full bg-blue px-3 py-1.5 text-xs font-extrabold text-white"
              >
                ▶ Dene: {talk.result.tryTask}
              </button>
            </div>
          )}
          {err && <div className="text-xs font-semibold text-fail">{err}</div>}
        </div>
      ) : (
        <div className="grid gap-3 p-4 @xl:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-ink-3">Talimat ve beceri</div>
            {profile === null ? (
              <div className="text-xs text-ink-3">Yükleniyor…</div>
            ) : profile.guide ? (
              <div className="md max-h-64 overflow-y-auto text-[13px] leading-relaxed" dangerouslySetInnerHTML={{ __html: guideHtml }} />
            ) : (
              <div className="text-xs text-ink-2">Henüz yok. “Kurulum görüşmesi” ile 5 kısa soruya cevap ver; ajan senin işini nasıl yaptığını öğrenip kendi talimatını ve becerisini yazar.</div>
            )}
          </div>
          <div>
            <div className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-ink-3">Düzeltmelerinden öğrendikleri</div>
            {profile?.rules ? <div className="whitespace-pre-wrap text-[13px] leading-relaxed">{profile.rules}</div> : <div className="text-xs text-ink-2">Henüz kural yok. Teslimatlarını “Düzelt: …” ile geri gönderdiğinde kalıcı tercihler burada birikir.</div>}
          </div>
        </div>
      )}
    </motion.div>
  );
}
