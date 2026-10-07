"use client";

import { AnimatePresence, motion, useAnimate, type PanInfo } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatedNumber, Burst } from "@/components/fx";
import { usePeriod } from "@/components/PeriodProvider";
import { TiltCard } from "@/components/TiltCard";
import { useTodos } from "@/components/todos/TodoProvider";
import { Icon, Ring, Segmented, Sheet } from "@/components/ui";
import { AREAS, PEOPLE, areaByCode } from "@/lib/checklist";
import { easeOutExpo, reveal, spring } from "@/lib/motion";
import {
  dueLabel,
  filterView,
  greeting,
  groupTodos,
  iso,
  isOverdue,
  newTodo,
  parseQuick,
  planNoDate,
  PRIORITY,
  RECUR_LABEL,
  startOfDay,
  suggestions,
  todoStats,
  uid,
  type Priority,
  type Recur,
  type Suggestion,
  type Todo,
  type View,
} from "@/lib/todo";

const VIEWS: { v: View; label: string }[] = [
  { v: "today", label: "Bugün" },
  { v: "upcoming", label: "Yaklaşan" },
  { v: "overdue", label: "Gecikmiş" },
  { v: "all", label: "Tümü" },
  { v: "done", label: "Biten" },
];

const EXAMPLES = [
  "yarın 14:00 Tuğrul'u ara #sayım !!",
  "cumaya kadar R-05 fire raporu !acil",
  "her cuma 11:00 toplantı hazırlığı",
  "15.10 Hakan Bey'e sunum @Hakan",
  "3 gün sonra stok farkını kontrol et",
];

export default function GorevlerPage() {
  const { store, loaded, add, mutate, toggle, remove, restore } = useTodos();
  const { data: period, toast } = usePeriod();
  const [tab, setTab] = useState<"list" | "stats">("list");
  const [view, setView] = useState<View>("today");
  const [editing, setEditing] = useState<Todo | null>(null);
  const [undo, setUndo] = useState<Todo | null>(null);
  const today = startOfDay();
  const stats = useMemo(() => todoStats(store.todos), [store.todos]);
  const sugg = useMemo(() => suggestions(store, period), [store, period]);
  const counts = useMemo(() => Object.fromEntries(VIEWS.map((x) => [x.v, filterView(store.todos, x.v).length])) as Record<View, number>, [store.todos]);
  const list = useMemo(() => filterView(store.todos, view), [store.todos, view]);
  const groups = useMemo(() => (view === "done" ? [{ key: "done", label: "Tamamlananlar", items: list }] : groupTodos(list)), [list, view]);

  // ilk açılışta bugün boşsa "Tümü"ye geç
  const viewInit = useRef(false);
  useEffect(() => {
    if (!loaded || viewInit.current) return;
    viewInit.current = true;
    if (!counts.today && counts.all) setView("all");
  }, [loaded, counts]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 5000);
    return () => clearTimeout(t);
  }, [undo]);

  const runSuggestion = (s: Suggestion) => {
    if (s.todo) {
      add(newTodo(s.todo));
      toast("Görev oluşturuldu");
    } else if (s.action === "reschedule-overdue") {
      const t = iso(today);
      mutate((st) => ({ ...st, todos: st.todos.map((x) => (isOverdue(x, today) ? { ...x, due: t, updatedAt: new Date().toISOString() } : x)) }));
      toast("Gecikmiş görevler bugüne taşındı");
      setView("today");
    } else if (s.action === "plan-nodate") {
      mutate((st) => ({ ...st, todos: planNoDate(st.todos, today) }));
      toast("Tarihsiz görevler bu haftaya dağıtıldı");
      setView("upcoming");
    }
  };
  const dismiss = (key: string) => mutate((st) => ({ ...st, dismissed: [...st.dismissed, key] }));

  const focusCount = store.todos.filter((t) => t.focus && !t.done).length;

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------ hero */}
      <TiltCard className="clay-color relative overflow-hidden p-5 text-white sm:p-7" style={{ background: "linear-gradient(135deg,#8b5cf6 0%,#5b7cff 55%,#2ec4b6 120%)", ["--glow" as string]: "rgba(139,92,246,.5)" }}>
        <svg className="pointer-events-none absolute -right-8 -top-8 h-56 w-56 opacity-[0.16]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <path d="m7.5 12 3 3 6-6.5" />
        </svg>
        <div className="relative flex items-center gap-5">
          <Ring value={stats.todayTotal ? stats.todayDone / Math.max(1, stats.todayTotal) : 0} size={92} stroke={10} color="#fff" track="rgba(255,255,255,.22)">
            <div className="text-center leading-none">
              <AnimatedNumber value={stats.doneToday} className="text-2xl font-extrabold" />
              <div className="text-[10px] font-bold text-white/75">bugün bitti</div>
            </div>
          </Ring>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wider text-white/75">Kişisel asistan</div>
            <div className="text-2xl font-extrabold leading-tight sm:text-3xl">{greeting()}, Batuhan</div>
            <div className="mt-1 text-sm text-white/90">
              {counts.today ? `Bugün ${counts.today} görevin var` : "Bugün için planlı görev yok"}
              {stats.overdue ? ` · ${stats.overdue} gecikmiş` : ""}
            </div>
          </div>
        </div>
        <div className="relative mt-5 flex flex-wrap gap-2.5">
          <span className="glass-on-color rounded-full px-3 py-1.5 text-sm font-bold">🔥 {stats.streak} gün seri</span>
          <span className="glass-on-color rounded-full px-3 py-1.5 text-sm font-bold">⭐ {focusCount} odak</span>
          <span className="glass-on-color rounded-full px-3 py-1.5 text-sm font-bold">📅 Bu hafta {stats.doneWeek} bitti</span>
          {stats.onTimeRate != null && <span className="glass-on-color rounded-full px-3 py-1.5 text-sm font-bold">⏱️ %{Math.round(stats.onTimeRate * 100)} zamanında</span>}
        </div>
      </TiltCard>

      {/* ------------------------------------------------ hızlı ekleme */}
      <QuickAdd onAdd={(t) => {
        add(t);
        if (t.due && t.due > iso(today) && view === "today") setView("upcoming");
      }} />

      {/* ------------------------------------------------ asistan önerileri */}
      <AnimatePresence initial={false}>
        {sugg.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mb-2 flex items-center gap-2 px-1 text-sm font-extrabold text-ink-2">
              <motion.span animate={{ rotate: [0, 15, -10, 0] }} transition={{ repeat: Infinity, repeatDelay: 4, duration: 0.8 }}>✨</motion.span>
              Asistan önerileri
            </div>
            <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-3 pt-1 sm:mx-0 sm:px-1">
              <AnimatePresence initial={false} mode="popLayout">
                {sugg.map((s, i) => (
                  <motion.div
                    key={s.key}
                    layout
                    initial={{ opacity: 0, x: 30, scale: 0.95 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8, y: -10 }}
                    transition={{ ...spring.enter, delay: i * 0.05 }}
                    className="clay relative flex w-[280px] shrink-0 snap-start flex-col p-4"
                    style={{ background: s.tone === "alert" ? "var(--color-tint-fail)" : s.tone === "warn" ? "var(--color-tint-warn)" : "var(--color-tint-info)" }}
                  >
                    <button onClick={() => dismiss(s.key)} className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full text-ink-3 hover:bg-track" aria-label="Gizle">
                      <Icon name="close" size={14} />
                    </button>
                    <div className="text-2xl">{s.icon}</div>
                    <div className="mt-1 pr-6 font-extrabold leading-snug">{s.title}</div>
                    <div className="mt-1 line-clamp-2 text-sm text-ink-2">{s.body}</div>
                    {s.cta && (
                      <motion.button whileTap={{ scale: 0.95 }} onClick={() => runSuggestion(s)} className="clay-dark mt-3 self-start rounded-full px-4 py-2 text-sm font-bold">
                        {s.cta}
                      </motion.button>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------ sekmeler */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="md:w-60">
          <Segmented value={tab} onChange={setTab} options={[{ value: "list", label: "Liste" }, { value: "stats", label: "Analiz" }]} />
        </div>
        {tab === "list" && (
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-2 md:mx-0 md:px-1">
            {VIEWS.map((x) => (
              <motion.button
                key={x.v}
                whileTap={{ scale: 0.93 }}
                whileHover={{ y: -2 }}
                onClick={() => setView(x.v)}
                className={`clay-sm relative flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold ${view === x.v ? "text-white dark:text-[#15171e]" : "text-ink-2"}`}
              >
                {view === x.v && <motion.span layoutId="todo-view" className="clay-dark absolute inset-0 rounded-full" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}
                <span className="relative">{x.label}</span>
                {counts[x.v] > 0 && (
                  <span className={`relative rounded-full px-1.5 text-[11px] ${x.v === "overdue" ? "bg-fail text-white" : view === x.v ? "bg-white/20" : "bg-track"}`}>{counts[x.v]}</span>
                )}
              </motion.button>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {tab === "list" ? (
          <motion.div key={`list-${view}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: easeOutExpo }} className="space-y-5">
            {!loaded ? (
              <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-16 rounded-[22px]" />)}</div>
            ) : list.length === 0 ? (
              <EmptyView view={view} />
            ) : (
              groups.map((g) => (
                <section key={g.key}>
                  <div className={`mb-2 flex items-center gap-2 px-1 text-sm font-extrabold ${g.key === "a-overdue" ? "text-fail" : "text-ink-2"}`}>
                    {g.label}
                    <span className="rounded-full bg-track px-2 text-xs">{g.items.length}</span>
                  </div>
                  <div className="space-y-2.5">
                    <AnimatePresence initial={false} mode="popLayout">
                      {g.items.map((t, i) => (
                        <TaskRow
                          key={t.id}
                          t={t}
                          index={i}
                          onToggle={() => toggle(t.id)}
                          onOpen={() => setEditing(t)}
                          onDelete={() => {
                            const r = remove(t.id);
                            if (r) setUndo(r);
                          }}
                          onFocus={() => mutate((st) => ({ ...st, todos: st.todos.map((x) => (x.id === t.id ? { ...x, focus: !x.focus } : x)) }))}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </section>
              ))
            )}
            <p className="px-1 text-center text-xs text-ink-3">İpucu: dokunmatikte sağa kaydır = tamamla, sola kaydır = sil · klavyede <b>A</b> hızlı ekleme</p>
          </motion.div>
        ) : (
          <motion.div key="stats" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: easeOutExpo }}>
            <Stats stats={stats} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* geri al çubuğu */}
      <AnimatePresence>
        {undo && (
          <motion.div
            initial={{ y: 80, opacity: 0, x: "-50%" }}
            animate={{ y: 0, opacity: 1, x: "-50%" }}
            exit={{ y: 80, opacity: 0, x: "-50%" }}
            transition={spring.lift}
            className="glass-strong fixed bottom-28 left-1/2 z-40 flex items-center gap-3 rounded-full py-2 pl-5 pr-2 text-sm font-bold lg:bottom-8"
          >
            <span className="max-w-[52vw] truncate">“{undo.title}” silindi</span>
            <button
              onClick={() => {
                restore(undo);
                setUndo(null);
              }}
              className="clay-dark rounded-full px-4 py-2"
            >
              Geri al
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <TaskSheet todo={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ hızlı ekleme */
function QuickAdd({ onAdd }: { onAdd: (t: Todo) => void }) {
  const [text, setText] = useState("");
  const [ex, setEx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => (text.trim() ? parseQuick(text) : null), [text]);
  const [scope, animate] = useAnimate();

  useEffect(() => {
    const t = setInterval(() => setEx((x) => (x + 1) % EXAMPLES.length), 3500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "a" || e.key === "A" || e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = () => {
    if (!parsed || !parsed.title) {
      animate(scope.current, { x: [0, -8, 8, -5, 5, 0] }, { duration: 0.4 });
      return;
    }
    onAdd(newTodo({ ...parsed }));
    setText("");
    animate(scope.current, { scale: [1, 1.02, 1] }, { type: "spring", stiffness: 500, damping: 18 });
  };

  const chips: { k: string; label: string; color?: string }[] = [];
  if (parsed) {
    if (parsed.due) chips.push({ k: "due", label: `📅 ${dueLabel(parsed.due)}` });
    if (parsed.time) chips.push({ k: "time", label: `🕒 ${parsed.time}` });
    if (parsed.priority < 4) chips.push({ k: "p", label: `● ${PRIORITY[parsed.priority].label}`, color: PRIORITY[parsed.priority].color });
    if (parsed.recur) chips.push({ k: "r", label: `🔁 ${RECUR_LABEL[parsed.recur]}` });
    if (parsed.areaCode) chips.push({ k: "a", label: `${areaByCode(parsed.areaCode)?.emoji ?? ""} ${parsed.areaCode}` });
    if (parsed.person) chips.push({ k: "u", label: `👤 ${parsed.person}` });
    for (const g of parsed.tags) chips.push({ k: `t-${g}`, label: `#${g}` });
  }

  return (
    <motion.div ref={scope} className="clay p-3 sm:p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-center gap-3"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue/15 text-blue">
          <Icon name="plus" size={22} stroke={2.6} />
        </span>
        <div className="relative min-w-0 flex-1">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full bg-transparent py-2 text-[16px] font-semibold outline-none"
            aria-label="Hızlı görev ekle"
          />
          {!text && (
            <AnimatePresence mode="wait">
              <motion.span
                key={ex}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="pointer-events-none absolute inset-0 block truncate py-2 text-[15px] leading-[1.6] text-ink-3"
              >
                Görev ekle… örn. “{EXAMPLES[ex]}”
              </motion.span>
            </AnimatePresence>
          )}
        </div>
        <motion.button whileTap={{ scale: 0.9 }} type="submit" disabled={!parsed?.title} className="clay-dark shrink-0 rounded-full px-4 py-2.5 text-sm font-bold disabled:opacity-40">
          Ekle
        </motion.button>
      </form>
      <AnimatePresence>
        {chips.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="flex flex-wrap gap-1.5 pl-14 pt-2">
              <AnimatePresence initial={false}>
                {chips.map((c) => (
                  <motion.span
                    key={c.k}
                    layout
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={spring.pop}
                    className="rounded-full bg-track px-2.5 py-1 text-xs font-bold"
                    style={c.color ? { color: c.color } : undefined}
                  >
                    {c.label}
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ görev satırı */
function TaskRow({ t, index, onToggle, onOpen, onDelete, onFocus }: { t: Todo; index: number; onToggle: () => void; onOpen: () => void; onDelete: () => void; onFocus: () => void }) {
  const [burst, setBurst] = useState(0);
  const [drag, setDrag] = useState(0);
  const dragged = useRef(false);
  const overdue = isOverdue(t);
  const area = t.areaCode ? areaByCode(t.areaCode) : null;
  const subDone = t.subtasks.filter((s) => s.done).length;
  const pr = PRIORITY[t.priority];

  const check = () => {
    if (!t.done) setBurst((b) => b + 1);
    setTimeout(onToggle, t.done ? 0 : 260);
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    setDrag(0);
    // sürüklemenin ardından gelen tıklama paneli açmasın
    setTimeout(() => (dragged.current = false), 50);
    if (info.offset.x > 110) check();
    else if (info.offset.x < -110) onDelete();
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: drag < 0 ? -320 : 60, scale: 0.9, transition: { duration: 0.25 } }}
      transition={{ ...spring.enter, delay: Math.min(index * 0.03, 0.2) }}
      className="relative"
    >
      {/* kaydırma arka planı */}
      <div className="absolute inset-0 flex items-center justify-between rounded-[22px] px-5 text-sm font-extrabold text-white" style={{ background: drag > 0 ? "#34C26B" : drag < 0 ? "#FF5E6C" : "transparent" }}>
        <span className={drag > 0 ? "opacity-100" : "opacity-0"}>✓ Tamamla</span>
        <span className={drag < 0 ? "opacity-100" : "opacity-0"}>Sil 🗑</span>
      </div>
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.55}
        dragDirectionLock
        onDragStart={() => (dragged.current = true)}
        onDrag={(_, info) => setDrag(info.offset.x)}
        onDragEnd={onDragEnd}
        whileHover={{ y: -2 }}
        className={`clay-sm relative flex cursor-pointer items-start gap-3 rounded-[22px] p-3.5 ${t.done ? "opacity-60" : ""}`}
        onClick={() => {
          if (!dragged.current) onOpen();
        }}
        style={{ touchAction: "pan-y" }}
      >
        {/* öncelik şeridi */}
        <span className="absolute inset-y-3 left-0 w-1 rounded-r-full" style={{ background: t.priority < 4 ? pr.color : "transparent" }} />
        <motion.button
          data-no-ripple
          onClick={(e) => {
            e.stopPropagation();
            check();
          }}
          whileTap={{ scale: 0.8 }}
          className="relative mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full"
          aria-label={t.done ? "Geri al" : "Tamamla"}
        >
          <motion.span
            className="absolute inset-0 rounded-full"
            animate={{
              background: t.done ? "#34C26B" : "transparent",
              boxShadow: t.done ? "0 6px 14px -6px #34C26Baa" : `inset 0 0 0 2.5px ${t.priority < 4 ? pr.color : "var(--color-line-strong)"}`,
            }}
          />
          {t.done && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" className="relative">
              <motion.path d="m5 12.5 4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3 }} />
            </svg>
          )}
          <Burst trigger={burst} color="#34C26B" radius={30} count={8} />
        </motion.button>
        <div className="min-w-0 flex-1">
          <div className={`font-bold leading-snug ${t.done ? "text-ink-3 line-through" : ""}`}>{t.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-semibold text-ink-3">
            {t.due && <span className={overdue ? "font-extrabold text-fail" : t.due === iso(startOfDay()) ? "text-blue" : ""}>📅 {dueLabel(t.due, t.time)}</span>}
            {!t.due && t.time && <span>🕒 {t.time}</span>}
            {t.recur && <span>🔁 {RECUR_LABEL[t.recur]}</span>}
            {t.subtasks.length > 0 && (
              <span>
                ☑ {subDone}/{t.subtasks.length}
              </span>
            )}
            {area && (
              <span className="rounded-full px-1.5 font-bold text-white" style={{ background: area.color }}>
                {area.code}
              </span>
            )}
            {t.person && <span>👤 {t.person}</span>}
            {t.tags.map((g) => (
              <span key={g} className="text-blue">#{g}</span>
            ))}
            {t.notes && <span>📝</span>}
          </div>
        </div>
        <motion.button
          data-no-ripple
          onClick={(e) => {
            e.stopPropagation();
            onFocus();
          }}
          whileTap={{ scale: 0.7, rotate: -30 }}
          animate={{ scale: t.focus ? [1, 1.3, 1] : 1 }}
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-lg ${t.focus ? "" : "opacity-25 grayscale hover:opacity-60"}`}
          aria-label="Odak"
          title="Odağa al"
        >
          ⭐
        </motion.button>
      </motion.div>
    </motion.div>
  );
}

function EmptyView({ view }: { view: View }) {
  const m: Record<View, [string, string]> = {
    today: ["🌤️", "Bugün için görev yok. Hızlı eklemeyle başla ya da Yaklaşan'a göz at."],
    upcoming: ["🗓️", "Önümüzdeki 7 gün boş görünüyor."],
    overdue: ["🎉", "Gecikmiş görev yok, harika!"],
    all: ["📭", "Henüz görev yok. Yukarıya yaz: “yarın 10:00 sayım raporunu kontrol et”"],
    done: ["🏁", "Henüz tamamlanan görev yok."],
  };
  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="clay flex flex-col items-center gap-2 px-6 py-12 text-center">
      <motion.div className="text-5xl" animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 2.4 }}>
        {m[view][0]}
      </motion.div>
      <p className="max-w-sm text-ink-2">{m[view][1]}</p>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ detay paneli */
function TaskSheet({ todo, onClose }: { todo: Todo | null; onClose: () => void }) {
  const { store, patch, remove, toggle } = useTodos();
  const t = todo ? store.todos.find((x) => x.id === todo.id) ?? todo : null;
  const [sub, setSub] = useState("");
  const [tag, setTag] = useState("");

  if (!t) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const set = (p: Partial<Todo>) => patch(t.id, p);
  const L = ({ children }: { children: React.ReactNode }) => <div className="mb-1.5 mt-4 text-xs font-bold uppercase tracking-wide text-ink-3">{children}</div>;
  const today = startOfDay();
  const quick = [
    { l: "Bugün", d: iso(today) },
    { l: "Yarın", d: iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)) },
    { l: "Haftaya", d: iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7)) },
  ];

  return (
    <Sheet open={!!todo} onClose={onClose} title="Görev" wide>
      <div className="flex items-start gap-3">
        <button onClick={() => toggle(t.id)} className={`mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full ${t.done ? "bg-ok text-white" : "clay-pressed"}`} aria-label="Tamamla">
          {t.done && <Icon name="check" size={18} stroke={3} />}
        </button>
        <textarea
          className="min-h-[44px] flex-1 resize-none bg-transparent text-xl font-extrabold leading-snug outline-none"
          value={t.title}
          rows={Math.min(4, Math.ceil(t.title.length / 40) || 1)}
          onChange={(e) => set({ title: e.target.value })}
        />
      </div>

      <L>Termin</L>
      <div className="flex flex-wrap items-center gap-2">
        {quick.map((q) => (
          <button key={q.l} onClick={() => set({ due: q.d })} className={`rounded-full px-3.5 py-2 text-sm font-bold ${t.due === q.d ? "clay-dark" : "clay-sm"}`}>
            {q.l}
          </button>
        ))}
        <input type="date" className="field w-auto py-2" value={t.due ?? ""} onChange={(e) => set({ due: e.target.value || undefined })} />
        <input type="time" className="field w-auto py-2" value={t.time ?? ""} onChange={(e) => set({ time: e.target.value || undefined })} />
        {t.due && (
          <button onClick={() => set({ due: undefined, time: undefined })} className="text-sm font-bold text-ink-3">
            Kaldır
          </button>
        )}
      </div>

      <div className="grid gap-x-4 sm:grid-cols-2">
        <div>
          <L>Öncelik</L>
          <div className="grid grid-cols-4 gap-2">
            {([1, 2, 3, 4] as Priority[]).map((p) => (
              <button
                key={p}
                onClick={() => set({ priority: p })}
                className={`rounded-2xl py-2.5 text-sm font-bold ${t.priority === p ? "clay-color text-white" : "clay-sm text-ink-2"}`}
                style={t.priority === p ? { background: PRIORITY[p].color, ["--glow" as string]: PRIORITY[p].color + "88" } : undefined}
              >
                {PRIORITY[p].label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <L>Tekrar</L>
          <select className="field" value={t.recur ?? ""} onChange={(e) => set({ recur: (e.target.value || undefined) as Recur | undefined, due: t.due ?? iso(today) })}>
            <option value="">Tekrarlama</option>
            {(Object.keys(RECUR_LABEL) as Recur[]).map((r) => (
              <option key={r} value={r}>{RECUR_LABEL[r]}</option>
            ))}
          </select>
        </div>
      </div>

      <L>Alt görevler</L>
      <div className="space-y-1.5">
        <AnimatePresence initial={false}>
          {t.subtasks.map((s) => (
            <motion.div key={s.id} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="flex items-center gap-2.5 rounded-xl px-1 py-1">
              <button
                onClick={() => set({ subtasks: t.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) })}
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${s.done ? "bg-ok text-white" : "shadow-[inset_0_0_0_2px_var(--color-line-strong)]"}`}
              >
                {s.done && <Icon name="check" size={13} stroke={3.2} />}
              </button>
              <span className={`flex-1 text-sm font-semibold ${s.done ? "text-ink-3 line-through" : ""}`}>{s.title}</span>
              <button onClick={() => set({ subtasks: t.subtasks.filter((x) => x.id !== s.id) })} className="text-ink-3 hover:text-fail" aria-label="Sil">
                <Icon name="close" size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!sub.trim()) return;
            set({ subtasks: [...t.subtasks, { id: uid(), title: sub.trim(), done: false }] });
            setSub("");
          }}
        >
          <input className="field py-2.5 text-sm" placeholder="+ Alt görev ekle (Enter)" value={sub} onChange={(e) => setSub(e.target.value)} />
        </form>
      </div>

      <L>Notlar</L>
      <textarea className="field min-h-[80px]" placeholder="Ayrıntı, bağlantı, telefon…" value={t.notes} onChange={(e) => set({ notes: e.target.value })} />

      <div className="grid gap-x-4 sm:grid-cols-2">
        <div>
          <L>Kişi</L>
          <input className="field" list="todo-people" value={t.person ?? ""} onChange={(e) => set({ person: e.target.value || undefined })} placeholder="İlgili kişi" />
          <datalist id="todo-people">
            {PEOPLE.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <div>
          <L>Rapor alanı</L>
          <select className="field" value={t.areaCode ?? ""} onChange={(e) => set({ areaCode: e.target.value || undefined })}>
            <option value="">Bağlı değil</option>
            {AREAS.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} · {a.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <L>Etiketler</L>
      <div className="flex flex-wrap items-center gap-2">
        {t.tags.map((g) => (
          <button key={g} onClick={() => set({ tags: t.tags.filter((x) => x !== g) })} className="rounded-full bg-track px-3 py-1.5 text-sm font-bold text-blue" title="Kaldır">
            #{g} ×
          </button>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = tag.trim().replace(/^#/, "");
            if (v && !t.tags.includes(v)) set({ tags: [...t.tags, v] });
            setTag("");
          }}
        >
          <input className="field w-40 py-2 text-sm" placeholder="+ etiket" value={tag} onChange={(e) => setTag(e.target.value)} />
        </form>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={() => {
            remove(t.id);
            onClose();
          }}
          className="clay-sm grid h-12 w-12 place-items-center rounded-full text-fail"
          aria-label="Sil"
        >
          <Icon name="trash" />
        </button>
        <div className="flex-1 text-xs text-ink-3">
          Oluşturuldu {new Date(t.createdAt).toLocaleDateString("tr-TR")}
          {t.doneAt ? ` · Tamamlandı ${new Date(t.doneAt).toLocaleDateString("tr-TR")}` : ""}
        </div>
        <button onClick={onClose} className="clay-dark rounded-full px-6 py-3 font-extrabold">
          Tamam
        </button>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ analiz */
function Stats({ stats }: { stats: ReturnType<typeof todoStats> }) {
  const max = Math.max(1, ...stats.last14.map((d) => d.count));
  const [hover, setHover] = useState<number | null>(null);
  const openTotal = stats.byPriority.reduce((a, b) => a + b.n, 0);
  const tiles = [
    { e: "✅", l: "Bugün biten", v: stats.doneToday, tint: "var(--color-tint-info)" },
    { e: "📅", l: "Bu hafta biten", v: stats.doneWeek, tint: "var(--color-tint-info)" },
    { e: "⏱️", l: "Zamanında", v: stats.onTimeRate == null ? null : Math.round(stats.onTimeRate * 100), pre: "%", tint: "var(--color-tint-yellow)" },
    { e: "⏰", l: "Gecikmiş", v: stats.overdue, tint: "var(--color-tint-fail)" },
    { e: "🔥", l: "Seri (gün)", v: stats.streak, tint: "var(--color-tint-coral)" },
    { e: "📭", l: "Açık görev", v: stats.open, tint: "var(--color-tint-warn)" },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-6">
        {tiles.map((x, i) => (
          <motion.div key={x.l} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, ...spring.enter }} className="clay flex items-center gap-3 p-4">
            <div className="clay-color grid h-12 w-12 shrink-0 place-items-center text-2xl" style={{ background: x.tint, borderRadius: 16, ["--glow" as string]: "rgba(0,0,0,.12)" }}>
              {x.e}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-ink-3">{x.l}</div>
              <div className="text-2xl font-extrabold">{x.v == null ? "—" : <AnimatedNumber value={x.v} prefix={x.pre ?? ""} />}</div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <motion.section {...reveal} className="clay p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h3 className="text-lg font-extrabold">Son 14 gün — tamamlanan görevler</h3>
            <span className="text-xs font-bold text-ink-3">toplam {stats.last14.reduce((a, b) => a + b.count, 0)}</span>
          </div>
          <div className="relative flex h-48 items-end gap-1.5 sm:gap-2.5">
            {stats.last14.map((d, i) => {
              const isToday = i === 13;
              return (
                <div key={d.date} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  {(d.count > 0 && (hover === i || isToday || d.count === max)) && <span className="mb-1 text-[11px] font-extrabold tabular-nums text-ink-2">{d.count}</span>}
                  <motion.div
                    className="w-full max-w-[26px]"
                    style={{ background: isToday ? "#4F6BED" : "color-mix(in srgb, #4F6BED 55%, var(--color-card))", borderRadius: "4px 4px 0 0" }}
                    initial={{ height: 0 }}
                    animate={{ height: `${Math.max((d.count / max) * 82, d.count ? 4 : 1.5)}%` }}
                    transition={{ ...spring.enter, delay: i * 0.025 }}
                  />
                  {hover === i && (
                    <div className="clay-dark pointer-events-none absolute -top-2 z-10 -translate-y-full whitespace-nowrap rounded-xl px-2.5 py-1.5 text-xs">
                      {d.wd} {d.label}: {d.count} görev
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex gap-1.5 sm:gap-2.5">
            {stats.last14.map((d, i) => (
              <div key={d.date} className={`min-w-0 flex-1 text-center text-[10px] font-bold ${i === 13 ? "text-ink" : "text-ink-3"}`}>
                {d.label}
              </div>
            ))}
          </div>
        </motion.section>

        <motion.section {...reveal} className="clay p-5">
          <h3 className="mb-4 text-lg font-extrabold">Açık görevler — öncelik</h3>
          {openTotal === 0 ? (
            <div className="py-6 text-center text-ink-3">Açık görev yok 🎉</div>
          ) : (
            <>
              <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-full">
                {stats.byPriority.filter((x) => x.n).map((x) => (
                  <motion.div key={x.p} initial={{ flexGrow: 0 }} animate={{ flexGrow: x.n }} transition={spring.gentle} style={{ background: PRIORITY[x.p].color, flexBasis: 0 }} title={`${PRIORITY[x.p].label}: ${x.n}`} />
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                {stats.byPriority.map((x) => (
                  <div key={x.p} className="clay-sm flex items-center gap-2 px-3 py-2.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: PRIORITY[x.p].color }} />
                    <span className="flex-1 text-sm font-bold">{PRIORITY[x.p].label}</span>
                    <span className="text-lg font-extrabold tabular-nums">{x.n}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {stats.tags.length > 0 && (
            <>
              <h4 className="mb-2 mt-5 text-sm font-extrabold text-ink-2">Etiketler</h4>
              <div className="flex flex-wrap gap-2">
                {stats.tags.map(([g, n]) => (
                  <span key={g} className="rounded-full bg-track px-3 py-1.5 text-sm font-bold">
                    <span className="text-blue">#{g}</span> <span className="text-ink-3">{n}</span>
                  </span>
                ))}
              </div>
            </>
          )}
          {stats.noDate > 0 && <p className="mt-4 text-sm text-ink-2">🗂️ {stats.noDate} görevin tarihi yok — asistan önerisiyle haftaya dağıtabilirsin.</p>}
        </motion.section>
      </div>
    </div>
  );
}

