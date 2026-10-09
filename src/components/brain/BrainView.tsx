"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAssistant } from "@/components/assistant/AssistantPanel";
import { usePeriod } from "@/components/PeriodProvider";
import { useTodos } from "@/components/todos/TodoProvider";
import { Skeleton } from "@/components/fx";
import { Icon, Menu, Sheet, Tabs } from "@/components/ui";
import { itemState } from "./TaskRow";
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
  const showOpts = !!text.trim() || !!agent;
  return (
    <form ref={ref} onSubmit={submit} className={compact ? "" : "clay p-2.5"}>
      <div className="flex items-end gap-2 rounded-[22px] border border-line bg-card p-1.5 pl-4 focus-within:border-ink-3">
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
          placeholder={compact ? "Beyne bir iş ver…" : "Bir iş ver: “Ceren Hanım'a Bursa dönem sonucu için hatırlatma taslağı yaz”"}
          className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-ink-3"
        />
        <motion.button whileTap={{ scale: 0.92 }} disabled={busy || !text.trim()} aria-label="Ver" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-paper disabled:opacity-30 dark:bg-white dark:text-[#1b1e27]">
          {busy ? <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="h-4 w-4 rounded-full border-2 border-current border-t-transparent" /> : <Icon name="send" size={16} />}
        </motion.button>
      </div>
      <AnimatePresence initial={false}>
        {showOpts && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pt-2 text-xs font-semibold text-ink-3">
              <label className="flex items-center gap-1.5">
                Kime
                <select value={agent} onChange={(e) => setAgent(e.target.value as AgentId | "")} className="rounded-md bg-transparent font-bold text-ink-2 outline-none" aria-label="Ajan">
                  <option value="">Beyin seçsin</option>
                  {AGENTS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={doNow} onChange={(e) => setDoNow(e.target.checked)} className="h-3.5 w-3.5 accent-[#5b7cff]" />
                Hemen yapsın
              </label>
              <label className={`flex cursor-pointer items-center gap-1.5 ${doNow ? "" : "opacity-40"}`}>
                <input type="checkbox" checked={team} disabled={!doNow} onChange={(e) => setTeam(e.target.checked)} className="h-3.5 w-3.5 accent-[#8b5cf6]" />
                Ekiple
              </label>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
          <button onClick={onApprove} className="flex-1 py-2 text-ink hover:bg-track">
            Üstlen
          </button>
          <button onClick={() => setAsking(true)} className="flex-1 border-l border-line py-2 text-ink-3 hover:bg-track">
            Gerek yok
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
  const [rejecting, setRejecting] = useState(false);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    setRejecting(false);
    setDetails(false);
  }, [x?.id]);
  if (!x || !a)
    return (
      <Sheet open={false} onClose={onClose}>
        {null}
      </Sheet>
    );

  const open = x.status !== "done" && x.status !== "dismissed";
  const toTodo = () => {
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
  const reject = (r?: string) => {
    onPatch(x.id, { status: "dismissed" }, r);
    onClose();
  };
  const src = x.sources[0];
  const meta = [a.name, KIND_LABEL[x.kind], x.due && dueLabel(x.due)].filter(Boolean).join(" · ");

  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-3">
            <span className="h-2 w-2 rounded-full" style={{ background: a.color }} />
            <span className="truncate">{meta}</span>
            {x.priority <= 2 && open && <span className="font-bold" style={{ color: PRIORITY[x.priority].color }}>· {PRIORITY[x.priority].label}</span>}
          </div>
          <div className="mt-1 text-[22px] font-extrabold leading-snug">{x.title}</div>
        </div>
      }
      actions={
        <Menu
          items={[
            { label: "Görevlerime ekle", icon: "todo", onClick: toTodo, hidden: !!x.todoId },
            {
              label: "Asistanla konuş",
              icon: "spark",
              onClick: () => {
                onClose();
                ask(`Beyindeki şu işi birlikte planlayalım: "${x.title}". Özet: ${x.summary} Adımlar: ${x.steps.map((s) => s.title).join("; ")}. Kaynaklar: ${x.sources.map((s) => s.title).join("; ")}. Gerekirse arşivde ilgili e-posta/dosyaları bul, ilk adımı benimle netleştir.`);
              },
            },
            { label: "Tamamlandı say", icon: "check", onClick: () => onPatch(x.id, { status: "done" }), hidden: !open || x.status === "inbox" },
            { label: "Gerek yok", icon: "x", onClick: () => setRejecting(true), hidden: !open, danger: true },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {/* ne isteniyor */}
        <div>
          <p className="text-[15px] leading-relaxed text-ink-2">{x.summary}</p>
          {src && (
            <a href={src.link} target="_blank" rel="noreferrer" className={`mt-2 inline-flex max-w-full items-center gap-2 text-xs font-semibold text-ink-3 ${src.link ? "hover:text-ink" : "pointer-events-none"}`}>
              <Icon name={src.agent === "posta" ? "mail" : src.agent === "sohbet" ? "chat" : src.agent === "takvim" ? "calendar" : src.agent === "toplanti" ? "video" : "note"} size={14} />
              <span className="truncate">
                {src.who ? `${src.who.replace(/\s*<[^>]+>/, "")} · ` : ""}
                {src.title}
              </span>
              {src.link && <Icon name="external" size={12} />}
            </a>
          )}
          {x.auto && open && (
            <div className="mt-2 text-xs text-ink-3">
              {a.name} bunu kendisi onayladı.{" "}
              <button onClick={() => setRejecting(true)} className="font-bold text-ink-2 underline-offset-2 hover:underline">
                Yanlış mı?
              </button>
            </div>
          )}
        </div>

        {rejecting ? (
          <RejectReasons onPick={reject} onCancel={() => setRejecting(false)} />
        ) : (
          <NextStep x={x} onPatch={onPatch} onWork={onWork} onApprove={onApprove} onReject={() => setRejecting(true)} />
        )}

        {/* ayrıntılar */}
        <div className="border-t border-line pt-3">
          <button onClick={() => setDetails((v) => !v)} className="flex w-full items-center gap-2 text-sm font-bold text-ink-2 hover:text-ink">
            Ayrıntılar
            <span className="text-xs font-semibold text-ink-3">
              {[x.steps.length && `${x.steps.filter((s) => s.done).length}/${x.steps.length} adım`, x.files.length && `${x.files.length} dosya`, `${x.sources.length} kaynak`].filter(Boolean).join(" · ")}
            </span>
            <Icon name="chevron" size={14} className={`ml-auto transition-transform ${details ? "rotate-90" : ""}`} />
          </button>
          <AnimatePresence initial={false}>
            {details && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <Details x={x} onPatch={onPatch} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Sheet>
  );
}

/** İşin ayrıntıları: neden, adımlar, dosyalar, kaynaklar, durum. */
function Details({ x, onPatch }: { x: BrainItem; onPatch: (id: string, p: Partial<BrainItem>) => void }) {
  const label = "mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-3";
  return (
    <div className="space-y-4 pt-3">
      {x.why && (
        <div>
          <div className={label}>Neden senin işin</div>
          <div className="text-sm text-ink-2">{x.why}</div>
        </div>
      )}
      {x.steps.length > 0 && (
        <div>
          <div className={label}>Adımlar</div>
          {x.steps.map((s, i) => (
            <label key={i} className="flex cursor-pointer items-start gap-2.5 rounded-lg py-1">
              <input
                type="checkbox"
                checked={s.done}
                onChange={() => onPatch(x.id, { steps: x.steps.map((y, k) => (k === i ? { ...y, done: !y.done } : y)) })}
                className="mt-0.5 h-4 w-4 accent-[#5b7cff]"
              />
              <span className={`text-sm ${s.done ? "text-ink-3 line-through" : ""}`}>{s.title}</span>
            </label>
          ))}
        </div>
      )}
      {x.files.length > 0 && (
        <div>
          <div className={label}>Dosyalar</div>
          {x.files.map((f) => (
            <a key={f.id} href={f.link} target="_blank" rel="noreferrer" className="flex items-center gap-2 py-1 text-sm hover:text-blue">
              <Icon name="folder" size={15} className="shrink-0 text-ink-3" />
              <span className="truncate">{f.name}</span>
            </a>
          ))}
        </div>
      )}
      <div>
        <div className={label}>Kaynaklar</div>
        {x.sources.map((s) => (
          <a key={s.signalId} href={s.link} target="_blank" rel="noreferrer" className={`flex items-center gap-2 py-1 text-sm ${s.link ? "hover:text-blue" : "pointer-events-none"}`}>
            <span className="min-w-0 flex-1 truncate">{s.title}</span>
            <span className="shrink-0 text-xs text-ink-3">
              {s.who ? `${s.who.replace(/\s*<[^>]+>/, "")} · ` : ""}
              {new Date(s.ts).toLocaleDateString("tr-TR", { day: "numeric", month: "short" })}
            </span>
          </a>
        ))}
      </div>
      {x.status !== "dismissed" && (
        <div>
          <div className={label}>Durum</div>
          <Tabs value={x.status as Col} onChange={(s) => onPatch(x.id, { status: s })} options={COLS.map((c) => ({ value: c, label: STATUS_META[c].label }))} />
        </div>
      )}
      {x.work && x.work.status !== "running" && x.work.status !== "queued" && (x.work.used.length > 0 || x.work.ms) ? (
        <div className="text-xs text-ink-3">
          Ajan çalışması: {x.work.ms ? `${Math.round(x.work.ms / 1000)} sn` : ""}
          {x.work.cost != null ? ` · $${x.work.cost.toFixed(3)}` : ""}
          {x.work.used.length ? ` · ${x.work.used.length} arama` : ""}
        </div>
      ) : null}
    </div>
  );
}

/** Teslimat metnini e-posta parçalarına ayırır: başlık, Kime, Konu, gövde, kaynak satırı. */
function splitDeliverable(md: string) {
  let body = md.trim();
  let to: string | undefined;
  let subject: string | undefined;
  let source: string | undefined;
  body = body.replace(/^#{1,3}\s+.*\n+/, "");
  body = body.replace(/^\s*\*{0,2}Kime:?\*{0,2}:?\s*(.+)$/im, (_, v: string) => ((to = v.replace(/\*/g, "").trim()), ""));
  body = body.replace(/^\s*\*{0,2}Konu:?\*{0,2}:?\s*(.+)$/im, (_, v: string) => ((subject = v.replace(/\*/g, "").trim()), ""));
  body = body.replace(/\n*\s*Kaynak:\s*(.+)\s*$/i, (_, v: string) => ((source = v.trim()), ""));
  return { to, subject, body: body.trim(), source };
}

/** İşin sıradaki adımı: her durumda tek ana eylem. */
function NextStep({ x, onPatch, onWork, onApprove, onReject }: { x: BrainItem; onPatch: (id: string, p: Partial<BrainItem>) => void; onWork: (id: string, feedback?: string, team?: boolean) => void; onApprove: (id: string, mail?: boolean) => Promise<{ error: string; code?: string } | null>; onReject: () => void }) {
  const { toast } = usePeriod();
  const a = agentById(x.agent)!;
  const w = x.work;
  const [fixing, setFixing] = useState(false);
  const [fb, setFb] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ error: string; code?: string } | null>(null);
  const parts = useMemo(() => (w?.output ? splitDeliverable(w.output) : null), [w?.output]);
  const html = useMemo(() => (parts ? renderMd(parts.body) : ""), [parts]);
  const primary = "inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-paper hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-[#1b1e27]";
  const secondary = "inline-flex items-center gap-2 rounded-full bg-track px-4 py-2.5 text-sm font-bold text-ink-2 hover:text-ink";

  // 1) öneri: senin işin mi?
  if (x.status === "inbox" && !w) {
    return (
      <div className="rounded-3xl bg-track/60 p-4">
        <div className="text-sm font-bold">Bu iş senin mi?</div>
        <div className="mt-0.5 text-xs text-ink-3">Cevabından öğrenirim; benzer işleri buna göre öneririm.</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => onPatch(x.id, { status: "todo" })} className={primary}>
            <Icon name="check" size={16} stroke={2.6} /> Evet, üstlen
          </button>
          <button onClick={onReject} className={secondary}>
            Hayır
          </button>
        </div>
      </div>
    );
  }
  // 2) henüz yapılmadı
  if (!w) {
    if (x.status === "done") return <div className="text-sm text-ink-3">Bu iş tamamlandı.</div>;
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => onWork(x.id)} className={primary}>
          <Icon name="play" size={14} /> {a.name.replace(" ajanı", "")} ajanına yaptır
        </button>
        <button onClick={() => onWork(x.id, undefined, true)} className="text-sm font-bold text-ink-3 hover:text-ink">
          Ekiple yaptır
        </button>
      </div>
    );
  }
  if (w.status === "queued" || w.status === "running") {
    return (
      <div className="rounded-3xl bg-track/60 p-4">
        <div className="flex items-center gap-2.5 text-sm font-bold">
          {w.status === "running" ? <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="inline-block h-4 w-4 rounded-full border-2 border-blue border-t-transparent" /> : <span className="h-2 w-2 rounded-full bg-blue" />}
          {w.status === "running" ? (w.team ? `Ekip çalışıyor — lider ${a.name}` : `${a.name} çalışıyor…`) : `Sırada — ${a.name} kendisi yapacak`}
          {w.status === "queued" && (
            <button onClick={() => onWork(x.id)} className="ml-auto text-xs font-bold text-blue">
              Şimdi yap
            </button>
          )}
        </div>
        {w.team && <TeamPieces team={w.team} />}
      </div>
    );
  }
  if (w.status === "error") {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-3xl bg-tint-fail p-4 text-sm">
        <span className="min-w-0 flex-1">{w.error ?? "Ajan bir hata verdi."}</span>
        <button onClick={() => onWork(x.id)} className={secondary}>
          Tekrar dene
        </button>
      </div>
    );
  }

  // 3) teslimat
  const toGmail = async () => {
    setBusy(true);
    setErr(await onApprove(x.id, true));
    setBusy(false);
  };
  const mailish = !!w.outbound;
  const lastRule = w.revisions.at(-1)?.rule;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink-3">
        <span>{mailish ? "Hazırlanan e-posta" : "Teslimat"}</span>
        <span style={{ color: itemState(x).color }}>· {itemState(x).label}</span>
        <Menu
          className="ml-auto"
          items={[
            {
              label: "Kopyala",
              icon: "copy",
              onClick: async () => {
                await navigator.clipboard.writeText(w.output).catch(() => {});
                toast("Kopyalandı");
              },
            },
            { label: "Yeniden yaz", icon: "refresh", onClick: () => onWork(x.id) },
            { label: "Kendim gönderdim, onayla", icon: "check", onClick: () => onApprove(x.id), hidden: w.status !== "waiting_ok" },
          ]}
        />
      </div>
      <div className="overflow-hidden rounded-3xl border border-line bg-card">
        {(parts?.to || parts?.subject) && (
          <div className="space-y-1 border-b border-line px-5 py-3 text-sm">
            {parts.to && (
              <div className="flex gap-3">
                <span className="w-10 shrink-0 text-ink-3">Kime</span>
                <span className="font-semibold">{w.draft ? w.draft.to.join(", ") : parts.to}</span>
              </div>
            )}
            {parts.subject && (
              <div className="flex gap-3">
                <span className="w-10 shrink-0 text-ink-3">Konu</span>
                <span className="font-semibold">{w.draft?.subject ?? parts.subject}</span>
              </div>
            )}
          </div>
        )}
        <div className="md max-h-[42vh] overflow-y-auto px-5 py-4 text-[14.5px] leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      {lastRule && <div className="mt-2 text-xs text-ink-3">Öğrendim: {lastRule}</div>}

      {w.draft ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-3xl bg-ok/10 p-4">
          <Icon name="check" size={18} stroke={2.6} className="text-ok" />
          <span className="min-w-0 flex-1 text-sm font-semibold">Gmail'de taslak olarak duruyor{w.draft.reply ? " (yazışmaya yanıt)" : ""}.</span>
          <a href={w.draft.link} target="_blank" rel="noreferrer" className={primary}>
            Aç ve gönder <Icon name="external" size={14} />
          </a>
        </div>
      ) : w.status === "approved" ? (
        <div className="mt-3 text-sm text-ink-3">Onaylandı.</div>
      ) : fixing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!fb.trim()) return;
            onWork(x.id, fb.trim());
            setFb("");
            setFixing(false);
          }}
          className="mt-3 flex gap-2"
        >
          <input autoFocus value={fb} onChange={(e) => setFb(e.target.value)} placeholder="Neyi değiştireyim? (ör. daha kısa, resmi hitap)" className="field min-w-0 flex-1 py-2.5 text-sm" />
          <button disabled={!fb.trim()} className={primary}>
            Gönder
          </button>
          <button type="button" onClick={() => setFixing(false)} className="px-2 text-sm font-bold text-ink-3 hover:text-ink">
            Vazgeç
          </button>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {mailish && w.status === "waiting_ok" ? (
            <button onClick={toGmail} disabled={busy} className={primary}>
              <Icon name="mail" size={16} /> {busy ? "Kaydediliyor…" : "Gmail'e taslak olarak kaydet"}
            </button>
          ) : (
            <button onClick={() => onApprove(x.id)} className={primary}>
              <Icon name="check" size={16} stroke={2.6} /> Onayla
            </button>
          )}
          <button onClick={() => setFixing(true)} className={secondary}>
            <Icon name="edit" size={15} /> Düzelt
          </button>
        </div>
      )}
      {err && (
        <div className="mt-2 text-xs font-semibold text-fail">
          {err.error}{" "}
          {err.code === "scope" && (
            <a href="/api/google/auth" className="text-blue underline">
              Google'ı yeniden bağla
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ seçimlerden öğrenme
/** "Gerek yok" denince neden: beyin bundan öğrenir (benim işim değil → bu tür iş bir daha açılmaz). */
export function RejectReasons({ onPick, onCancel, compact }: { onPick: (reason?: string) => void; onCancel: () => void; compact?: boolean }) {
  const [other, setOther] = useState("");
  return (
    <div className={compact ? "" : "rounded-3xl bg-track/60 p-4"}>
      <div className={`flex items-center ${compact ? "mb-1.5 text-[11px]" : "mb-2.5 text-sm"} font-bold`}>
        Neden gerek yok?
        <button onClick={onCancel} className="ml-auto text-xs font-semibold text-ink-3 hover:text-ink">
          Vazgeç
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {REJECT_REASONS.map((r) => (
          <button key={r} onClick={() => onPick(r)} className={`rounded-full border border-line bg-card font-semibold text-ink-2 hover:border-ink hover:text-ink ${compact ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-1.5 text-sm"}`}>
            {r}
          </button>
        ))}
      </div>
      <form
        className="mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          onPick(other.trim() || undefined);
        }}
      >
        <input value={other} onChange={(e) => setOther(e.target.value)} placeholder={compact ? "Başka bir sebep…" : "Başka bir sebep yaz, Enter'a bas"} className={`w-full bg-transparent text-ink-2 outline-none placeholder:text-ink-3 ${compact ? "py-1 text-xs" : "py-1.5 text-sm"}`} />
      </form>
    </div>
  );
}

/** Seni tanıyorum: seçimlerden öğrendikleri (belleğe yazılanlar) ve bekleyen seçimler. */
export function Learning({ learning, onLearned, compact }: { learning?: LearningState; onLearned?: () => void; compact?: boolean }) {
  const { toast } = usePeriod();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!compact);
  const lessons = (learning?.log ?? []).flatMap((g) => g.lessons.map((l) => ({ ...l, at: g.at })));
  const now = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "learn" }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      toast(lessonToast(j.learned as Lesson[]) ?? "Seçimlerini inceledim; yeni bir tercih çıkmadı");
      onLearned?.();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const summary = !learning?.total ? "seçimlerinden öğrenir" : `${lessons.length} tercih öğrendi${learning.pending ? ` · ${learning.pending} seçim sırada` : ""}`;
  return (
    <section className={compact ? "" : "clay p-5"}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-1 text-left">
        <span className={`${compact ? "text-sm" : "text-lg"} font-extrabold`}>Seni tanıyorum</span>
        <span className="truncate text-xs text-ink-3">{summary}</span>
        <Icon name="chevron" size={13} className={`ml-auto shrink-0 text-ink-3 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 px-1">
          {lessons.length ? (
            <ul className="space-y-1.5">
              {lessons.slice(0, compact ? 6 : 12).map((l, i) => (
                <li key={i} className="text-[13px] leading-snug text-ink-2">
                  {l.entry}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-ink-3">Önerilere verdiğin evet/hayır, öncelik ve düzeltmelerden tercihlerini çıkarıp belleğe yazarım.</div>
          )}
          {!!learning?.pending && (
            <button onClick={now} disabled={busy} className="mt-2 text-xs font-bold text-blue disabled:opacity-60">
              {busy ? "Öğreniyor…" : "Şimdi öğren"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ kazanılan güven
const pct = (a: number, b: number) => (a + b ? Math.round((a / (a + b)) * 100) : 0);

/** Ajanın güven seviyesi: Öner · Kendisi onaylasın · Teslimatı da hazırlasın + onay istatistiği. */
export function TrustControl({ trust, onTrust }: { trust: AgentTrustView; onTrust: (level: TrustLevel) => void }) {
  const s = trust.stats;
  const decided = s.accepted + s.rejected;
  return (
    <div className="px-4 pb-4">
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="font-bold text-ink-2">Ne kadar kendi başına?</span>
        {decided > 0 && <span className="text-ink-3">{decided} kararın %{pct(s.accepted, s.rejected)}'ini onayladın</span>}
      </div>
      <Tabs value={String(trust.level) as "0" | "1" | "2"} onChange={(v) => onTrust(Number(v) as TrustLevel)} options={TRUST_META.map((m, i) => ({ value: String(i) as "0" | "1" | "2", label: m.short }))} />
      <div className="mt-1.5 text-xs text-ink-3">
        {TRUST_META[trust.level].hint}.
        {trust.suggest != null && (
          <>
            {" "}
            <button onClick={() => onTrust(trust.suggest!)} className="font-bold text-[#8b5cf6] hover:underline">
              “{TRUST_META[trust.suggest].short}” seviyesine hazır →
            </button>
          </>
        )}
      </div>
      {trust.note && <div className="mt-1.5 text-xs font-semibold text-warn">{trust.note}</div>}
    </div>
  );
}

/** Ajanın bildikleri: talimat/beceri ve düzeltmelerden öğrendiği kurallar (katlanır). */
function AgentKnows({ profile, guideHtml, onIntro }: { profile: { guide: string; rules: string } | null; guideHtml: string; onIntro: () => void }) {
  const [open, setOpen] = useState(false);
  if (profile === null) return null;
  const rules = profile.rules ? profile.rules.split("\n").filter((l) => l.trim().startsWith("-")).length : 0;
  if (!profile.guide && !rules)
    return (
      <div className="flex items-center gap-3 border-t border-line px-4 py-3">
        <span className="min-w-0 flex-1 text-xs text-ink-3">Henüz seni tanımıyor. 5 kısa soruyla nasıl çalıştığını öğrensin.</span>
        <button onClick={onIntro} className="shrink-0 rounded-full bg-track px-3 py-1.5 text-xs font-bold text-ink-2 hover:text-ink">
          Tanıştır
        </button>
      </div>
    );
  return (
    <div className="border-t border-line px-4 py-3">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-xs font-bold text-ink-2 hover:text-ink">
        Ne biliyor
        <span className="font-semibold text-ink-3">{[profile.guide && "talimat", rules && `${rules} kural`].filter(Boolean).join(" · ")}</span>
        <Icon name="chevron" size={13} className={`ml-auto transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {profile.guide && <div className="md max-h-64 overflow-y-auto text-[13px] leading-relaxed" dangerouslySetInnerHTML={{ __html: guideHtml }} />}
          {profile.rules && <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{profile.rules}</div>}
        </div>
      )}
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
    <div className="space-y-2">
      {list.map(({ a, t }) => (
        <motion.div key={a.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className={`rounded-3xl bg-[#8b5cf6]/[0.08] ${compact ? "p-3" : "p-4"}`}>
          <div className="text-[13px] leading-snug">
            <b>{a.name}</b> daha fazla yetkiyi hak etti.{" "}
            <span className="text-ink-3">
              {t!.suggest === 1 ? `Önerilerinin %${pct(t!.stats.accepted, t!.stats.rejected)}'ini onayladın; yeni işleri sormadan üstlensin mi?` : `${t!.stats.delivered} teslimatını onayladın; işleri kendisi yapsın mı?`}
            </span>
          </div>
          <div className="mt-2 flex gap-2">
            <button onClick={() => onTrust(a.id, t!.suggest!)} className="rounded-full bg-[#8b5cf6] px-3.5 py-1.5 text-xs font-bold text-white">
              Evet
            </button>
            <button onClick={() => later(`${a.id}:${t!.suggest}`)} className="rounded-full px-3 py-1.5 text-xs font-bold text-ink-3 hover:text-ink">
              Sonra
            </button>
          </div>
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
export function AgentPanel({ agent, onTry, onClose, trust, onTrust, flat }: { agent: AgentId; onTry: (task: string) => void; onClose: () => void; trust?: AgentTrustView; onTrust?: (level: TrustLevel) => void; flat?: boolean }) {
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
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className={`@container ${flat ? "-mx-1 rounded-3xl bg-white/50 dark:bg-white/[0.04]" : "clay"}`}>
      <div className="flex items-start gap-3 p-4 pb-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl" style={{ background: `${a.color}1f` }}>
          {a.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-extrabold leading-tight">{a.name}</div>
          <div className="mt-0.5 line-clamp-2 text-xs text-ink-3">{a.role}</div>
        </div>
        <Menu items={[{ label: profile?.guide ? "Yeniden tanıştır" : "Ajanı tanıt (5 soru)", icon: "chat", onClick: () => ask([]), hidden: !!talk }]} />
        <button onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-track" aria-label="Kapat">
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
        <AgentKnows profile={profile} guideHtml={guideHtml} onIntro={() => ask([])} />
      )}
    </motion.div>
  );
}
