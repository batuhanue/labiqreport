"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAssistant } from "@/components/assistant/AssistantPanel";
import { usePeriod } from "@/components/PeriodProvider";
import { useTodos } from "@/components/todos/TodoProvider";
import { Skeleton } from "@/components/fx";
import { Icon, Sheet } from "@/components/ui";
import { AGENTS, KIND_LABEL, STATUS_META, agentById, type AgentId, type BrainItem, type BrainRun, type BrainState, type ItemStatus } from "@/lib/brain-types";
import { dueLabel, newTodo, PRIORITY, uid } from "@/lib/todo";

type Col = Exclude<ItemStatus, "dismissed">;
const COLS: Col[] = ["inbox", "todo", "doing", "waiting", "done"];

function ago(s?: string) {
  if (!s) return "henüz düşünmedi";
  const m = Math.round((Date.now() - Date.parse(s)) / 60000);
  return m < 1 ? "az önce" : m < 60 ? `${m} dk önce` : m < 1440 ? `${Math.round(m / 60)} sa önce` : `${Math.round(m / 1440)} gün önce`;
}

/** **kalın** ve satır başı madde işaretleri için küçük, güvenli işleyici. */
function Brief({ text }: { text: string }) {
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
  const [st, setSt] = useState<BrainState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [open, setOpen] = useState<BrainItem | null>(null);
  const [agent, setAgent] = useState<AgentId | null>(null);
  const [mobileCol, setMobileCol] = useState<Col>("inbox");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/brain", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setSt(j);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
    // açılışta (son düşünmeden 30 dk geçtiyse) arka planda düşünmeyi tetikle
    fetch("/api/brain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "auto" }) })
      .then((r) => r.json())
      .then((j) => j.started && setSt((s) => (s ? { ...s, running: true } : s)))
      .catch(() => {});
  }, [load]);
  // düşünürken durumu izle
  useEffect(() => {
    if (!st?.running || thinking) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [st?.running, thinking, load]);

  const think = async () => {
    setThinking(true);
    try {
      const r = await fetch("/api/brain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "think" }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setSt(j.state);
      const run = j.run as BrainRun;
      const created = run.agents.reduce((s, a) => s + a.created, 0);
      toast(run.error ? `Düşünme hatası: ${run.error}` : created ? `${created} yeni iş önerildi` : "Yeni bir iş çıkmadı");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setThinking(false);
    }
  };

  const patch = async (id: string, p: Partial<BrainItem>) => {
    setSt((s) => (s ? { ...s, items: s.items.map((x) => (x.id === id ? { ...x, ...p } : x)) } : s));
    setOpen((o) => (o && o.id === id ? { ...o, ...p } : o));
    const r = await fetch("/api/brain", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, patch: p }) });
    if (!r.ok) {
      toast("Kaydedilemedi");
      load();
    }
  };

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
      <Capture
        onDone={(s) => {
          setSt(s);
          toast("Beyin notu işe çevirdi");
        }}
      />
      {st.focus && <Focus st={st} onOpen={setOpen} />}

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
                  <Card key={x.id} x={x} onOpen={() => setOpen(x)} onApprove={() => patch(x.id, { status: "todo" })} onDismiss={() => patch(x.id, { status: "dismissed" })} />
                ))}
              </AnimatePresence>
              {!byCol[c].length && <div className="px-2 py-6 text-center text-xs font-semibold text-ink-3">{c === "inbox" ? (busy ? "Ajanlar çalışıyor…" : "Öneri yok") : "Boş"}</div>}
            </div>
          </div>
        ))}
      </div>

      <Runs runs={st.runs} />
      <ItemSheet x={open} onClose={() => setOpen(null)} onPatch={patch} />
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
                {busy && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-ping rounded-full" style={{ background: a.color }} />}
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

// ------------------------------------------------------------------ beyne yaz
function Capture({ onDone }: { onDone: (s: BrainState) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/brain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "capture", text: t }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setText("");
      onDone(j.state);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <div className="clay-pressed flex items-end gap-2 rounded-[24px] p-2 pl-4">
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
          placeholder="Beyne yaz: bir iş, not ya da istek…"
          className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[15px] outline-none placeholder:text-ink-3"
        />
        <motion.button whileTap={{ scale: 0.92 }} disabled={busy || !text.trim()} className="clay-color grid h-11 shrink-0 place-items-center rounded-full bg-blue px-4 text-sm font-extrabold text-white disabled:opacity-50">
          {busy ? "Anlıyor…" : "Beyne yaz"}
        </motion.button>
      </div>
      {err && <div className="mt-1 px-3 text-xs font-semibold text-fail">{err}</div>}
    </form>
  );
}

// ------------------------------------------------------------------ bugün odak
function Focus({ st, onOpen }: { st: BrainState; onOpen: (x: BrainItem) => void }) {
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
function Card({ x, onOpen, onApprove, onDismiss }: { x: BrainItem; onOpen: () => void; onApprove: () => void; onDismiss: () => void }) {
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
        </div>
      </button>
      {x.status === "inbox" && (
        <div className="flex border-t border-line text-xs font-extrabold">
          <button onClick={onApprove} className="flex-1 py-2 text-ok hover:bg-ok/10">
            ✓ Onayla
          </button>
          <button onClick={onDismiss} className="flex-1 border-l border-line py-2 text-ink-3 hover:bg-track">
            ✕ Gerek yok
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ------------------------------------------------------------------ ayrıntı
function ItemSheet({ x, onClose, onPatch }: { x: BrainItem | null; onClose: () => void; onPatch: (id: string, p: Partial<BrainItem>) => void }) {
  const { add } = useTodos();
  const { toast } = usePeriod();
  const { ask } = useAssistant();
  const a = x ? agentById(x.agent) : null;
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
            <button
              onClick={() => {
                onPatch(x.id, { status: "dismissed" });
                onClose();
              }}
              className="rounded-full bg-track px-4 py-2 text-sm font-bold text-ink-2"
            >
              Gerek yok
            </button>
          </div>
        </div>
      )}
    </Sheet>
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
