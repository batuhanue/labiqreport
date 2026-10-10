"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGoogle } from "@/components/google/GoogleProvider";
import { usePeriod } from "@/components/PeriodProvider";
import { useTodos } from "@/components/todos/TodoProvider";
import { Icon } from "@/components/ui";
import { AGENTS, agentById, STATUS_META, type AgentId, type BrainItem } from "@/lib/brain-types";
import { AREAS } from "@/lib/checklist";
import { areaProgress, deadlineInfo } from "@/lib/period";
import { OFFICE_DARK, OFFICE_LIGHT, type OfficePal } from "../office/Furniture";
import { AgentPanel, Capture, ItemSheet, Learning, TrustSuggest } from "./BrainView";
import { TaskListView } from "./TaskRow";
import { DayPlan, DecisionDeck } from "./DecisionDeck";
import { BrainScene, type CameraApi, type Screen } from "./BrainScene";
import { DEPTS, deptById } from "./layout";
import { useBrainState } from "./useBrain";

function usePal(): OfficePal {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setDark(el.dataset.theme === "dark");
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return dark ? OFFICE_DARK : OFFICE_LIGHT;
}

const glass = "border border-white/60 bg-white/80 shadow-[0_10px_40px_-12px_rgba(31,35,48,.25)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1b1e27]/85";
const serif = "font-serif tracking-wide";



/* bağlı servisler: kaynak → departman */
const CONNECTORS: { id: string; label: string; icon: string; color: string; to: AgentId | "hub"; source?: "gmail" | "chat" | "calendar" | "meet" | "drive" }[] = [
  { id: "gmail", label: "Gmail", icon: "✉️", color: "#ff5e6c", to: "posta", source: "gmail" },
  { id: "chat", label: "Google Chat", icon: "💬", color: "#2ec4b6", to: "sohbet", source: "chat" },
  { id: "calendar", label: "Takvim", icon: "📅", color: "#5b7cff", to: "takvim", source: "calendar" },
  { id: "meet", label: "Meet", icon: "🎥", color: "#8b5cf6", to: "toplanti", source: "meet" },
  { id: "drive", label: "Drive", icon: "📁", color: "#ffa53d", to: "dosya", source: "drive" },
  { id: "labiq", label: "LabIQ denetim listesi", icon: "✅", color: "#34c26b", to: "denetim" },
  { id: "notes", label: "Senin notların", icon: "✍️", color: "#9aa3b5", to: "gorev" },
  { id: "claude", label: "Claude (Anthropic)", icon: "✳️", color: "#d97757", to: "hub" },
];

/**
 * Beyin: asıl çalışma ekibi. Ortada Beyin, çevresinde her ajan bir departman; masalarda lider ve alt görevler.
 * Sağda görev durumu (iş ver, bugün odak, tüm işler); departmana tıklayınca o ajanın kartı ve işleri.
 */
export default function BrainOffice() {
  const pal = usePal();
  const { toast, data: period } = usePeriod();
  const google = useGoogle();
  const snap = google?.status?.snapshot ?? null;
  const { store: todos } = useTodos();
  const brain = useBrainState();
  const { st, open, setOpen } = brain;
  const [focus, setFocus] = useState<AgentId | null>(null);
  const [hover, setHover] = useState<AgentId | null>(null);
  const [panelOpen, setPanelOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 1180);
  const [seed, setSeed] = useState<{ text: string; agent: AgentId; n: number } | null>(null);
  const api = useRef<CameraApi | null>(null);
  const labels = useRef<Record<string, HTMLDivElement | null>>({});
  const screen: Screen = useRef({});
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPx, setPanelPx] = useState(0);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPanelPx(panelOpen ? el.offsetWidth + 16 : 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, [panelOpen]);

  const onSelect = useCallback((id: AgentId | null) => {
    setFocus(id);
    if (id) setPanelOpen(true);
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog]") && !(e.target as HTMLElement)?.closest?.("input,textarea,select")) onSelect(null);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onSelect]);

  // çalışan ajanlar (tek iş ya da ekip parçası)
  const busy = brain.thinking || !!st?.running;
  const active = useMemo(() => {
    const s = new Set<string>();
    for (const x of st?.items ?? []) {
      if (x.work?.status !== "running") continue;
      s.add(x.agent);
      for (const p of x.work.team?.pieces ?? []) if (p.status === "running") s.add(p.agent);
    }
    return s;
  }, [st]);
  const work = useMemo(() => {
    const m: Record<string, { doing: number; next: number; done: number; open: number; drafts: number; files: number }> = {};
    for (const a of AGENTS) m[a.id] = { doing: 0, next: 0, done: 0, open: 0, drafts: 0, files: 0 };
    for (const x of st?.items ?? []) {
      const c = m[x.agent];
      if (x.status === "doing" || x.status === "waiting") c.doing++;
      else if (x.status === "inbox" || x.status === "todo") c.next++;
      else if (x.status === "done") c.done++;
      if (x.status !== "done" && x.status !== "dismissed") c.open++;
      if (x.work?.status === "ready" || x.work?.status === "waiting_ok") c.drafts++;
      m.dosya.files += x.files.length;
    }
    return m;
  }, [st]);

  // departmana özgü iki gösterge
  const kpis = useMemo(() => {
    const t = Date.now();
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
    const dayOf = (s: string) => new Date(s).toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
    const ev = (snap?.calendar.items ?? []).filter((e) => e.response !== "declined");
    const overdue = period ? AREAS.filter((a) => areaProgress(period, a).both < a.items.length && (deadlineInfo(period.period, a).days ?? 1) < 0).length : 0;
    const fails = period ? Object.values(period.items).reduce((s, i) => s + (i.bursa === "fail" ? 1 : 0) + (i.basaksehir === "fail" ? 1 : 0), 0) : 0;
    const openTodos = todos.todos.filter((x) => !x.done);
    const k: Record<AgentId, [string, string | number][]> = {
      posta: [
        ["Okunmamış", snap?.gmail.unread ?? "—"],
        ["Taslak hazır", work.posta.drafts],
      ],
      sohbet: [
        ["Aktif sohbet", snap ? snap.chat.items.filter((s) => s.lastActive && t - Date.parse(s.lastActive) < 86400_000).length : "—"],
        ["Yanıt bekleyen", snap ? snap.chat.items.filter((s) => s.messages.at(-1) && !s.messages.at(-1)!.mine).length : "—"],
      ],
      takvim: [
        ["Bugün etkinlik", snap ? ev.filter((e) => (e.allDay ? e.start : dayOf(e.start)) === today).length : "—"],
        ["Davet bekleyen", snap ? ev.filter((e) => e.response === "needsAction" && Date.parse(e.end) > t).length : "—"],
      ],
      toplanti: [
        ["Toplantı kaydı", snap?.meet.items.length ?? "—"],
        ["Transkript", snap ? snap.meet.items.filter((m) => m.transcripts.length).length : "—"],
      ],
      denetim: [
        ["Geciken alan", period ? overdue : "—"],
        ["✗ bulgu", period ? fails : "—"],
      ],
      dosya: [
        ["Eklenen dosya", work.dosya.files],
        ["Drive bugün", snap?.drive ? snap.drive.items.filter((f) => dayOf(f.modified) === today).length : "—"],
      ],
      gorev: [
        ["Açık görev", openTodos.length],
        ["Bugün termin", openTodos.filter((x) => x.due && x.due <= today).length],
      ],
    };
    return k;
  }, [snap, period, todos, work]);

  // servislerden departman kartlarına kablolar
  const wiresRef = useRef<SVGSVGElement>(null);
  const chips = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const svg = wiresRef.current;
      if (svg) {
        const box = svg.getBoundingClientRect();
        for (const c of CONNECTORS) {
          const path = svg.querySelector<SVGPathElement>(`[data-wire="${c.id}"]`);
          const chip = chips.current[c.id];
          const end = screen.current?.[c.to];
          if (!path || !chip || !end) continue;
          const r = chip.getBoundingClientRect();
          const x0 = r.left + r.width / 2 - box.left;
          const y0 = r.bottom - box.top;
          const y1 = end.y - 4;
          path.setAttribute("d", `M${x0},${y0} C${x0},${y0 + 110} ${end.x},${y1 - 140} ${end.x},${y1}`);
          path.style.opacity = end.on ? "" : "0";
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const dept = deptById(focus);
  const openCount = (st?.items ?? []).filter((x) => x.status !== "done" && x.status !== "dismissed").length;

  return (
    <div
      onScroll={(e) => {
        e.currentTarget.scrollLeft = 0;
        e.currentTarget.scrollTop = 0;
      }}
      className={`relative h-[calc(100dvh-12rem)] min-h-[600px] overflow-hidden rounded-[30px] ${pal.dark ? "bg-[#121620]" : "bg-[#f3f0e9]"}`}
    >
      <BrainScene pal={pal} focus={focus} onSelect={onSelect} api={api} panelPx={panelPx} labels={labels} screen={screen} busy={busy} active={active} />

      {/* kablolar */}
      <svg ref={wiresRef} className="pointer-events-none absolute inset-0 z-[5] h-full w-full" aria-hidden>
        {CONNECTORS.map((c) => {
          const live = c.to === "hub" ? busy : active.has(c.to);
          return <path key={c.id} data-wire={c.id} fill="none" stroke={c.color} strokeWidth={live ? 2.2 : 1.3} strokeOpacity={live ? 0.95 : 0.4} strokeDasharray="3 6" className={live ? "office-wire-live" : "office-wire"} />;
        })}
      </svg>

      {/* departman kartları + masa adları + beyin */}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {DEPTS.map((d) => {
          const w = work[d.id];
          const on = focus === d.id;
          const isActive = active.has(d.id);
          const open = on || hover === d.id;
          return (
            <div key={d.id}>
              <div ref={(el) => void (labels.current[d.id] = el)} className="absolute left-0 top-0 will-change-transform" style={{ opacity: 0 }}>
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(on ? null : d.id);
                  }}
                  onMouseEnter={() => setHover(d.id)}
                  onMouseLeave={() => setHover((h) => (h === d.id ? null : h))}
                  className={`pointer-events-auto mb-3 rounded-2xl px-3 pb-2 pt-2 text-left transition-all ${open ? "w-[172px]" : "w-[124px]"} ${glass}`}
                  style={{ boxShadow: on || isActive ? `0 0 0 2px ${d.color}, 0 16px 36px -14px ${d.color}` : undefined }}
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em]">
                    <span className={`h-2 w-2 rounded-full ${isActive ? "animate-pulse" : ""}`} style={{ background: d.color }} />
                    {d.name}
                    {isActive && <span className="ml-auto animate-pulse text-[9px] normal-case tracking-normal" style={{ color: d.color }}>●</span>}
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-center gap-1.5">
                    <span className={`${serif} ${open ? "text-[32px]" : "text-[24px]"} font-bold leading-none tabular-nums`}>{w.open}</span>
                    <span className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-ink-3">açık iş</span>
                  </div>
                  {open && <div className="mt-1.5 space-y-0.5 border-t border-black/5 pt-1.5 text-[10px] dark:border-white/10">
                    {kpis[d.id].map(([l, v]) => (
                      <div key={l} className="flex justify-between gap-2">
                        <span className="truncate font-bold uppercase tracking-wider text-ink-3">{l}</span>
                        <span className={`${serif} font-bold tabular-nums`}>{v}</span>
                      </div>
                    ))}
                  </div>}
                  <div className="mt-1 flex justify-between gap-1 border-t border-black/5 pt-1 text-[8.5px] font-extrabold uppercase tracking-wider text-ink-3 dark:border-white/10">
                    <span>
                      yap <b className="text-ink">{w.doing}</b>
                    </span>
                    <span>
                      sıra <b className="text-ink">{w.next}</b>
                    </span>
                    <span>
                      bitti <b className="text-ink">{w.done}</b>
                    </span>
                  </div>
                </button>
              </div>
              {/* masa adları: odaklanılan departmanda */}
              {d.desks.map((desk, i) => (
                <div key={i} ref={(el) => void (labels.current[`${d.id}:${i}`] = el)} className={`absolute left-0 top-0 transition-opacity ${on ? "" : "!opacity-0"}`} style={{ opacity: 0 }}>
                  <span className={`mb-1 block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${glass}`}>
                    {desk.lead && <span className="text-[#ffb020]">★ </span>}
                    {desk.label}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
        <div ref={(el) => void (labels.current.hub = el)} className="absolute left-0 top-0" style={{ opacity: 0 }}>
          <button onPointerDown={(e) => e.stopPropagation()} onClick={() => onSelect(null)} className={`pointer-events-auto mb-2 flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.14em] ${glass}`}>
            <span className={`h-2 w-2 rounded-full bg-[#8b5cf6] ${busy ? "animate-pulse" : ""}`} />
            Beyin <span className={`${serif} text-sm normal-case tracking-normal`}>{openCount}</span>
            <span className="font-bold normal-case tracking-normal text-ink-3">açık iş</span>
            {busy && <span className="normal-case tracking-normal text-[#8b5cf6]">düşünüyor…</span>}
          </button>
        </div>
      </div>

      {/* üst şerit */}
      <div className={`absolute left-4 top-4 z-20 flex items-center gap-3 transition-[right] duration-300 ${panelOpen ? "right-[calc(min(420px,40%)+28px)]" : "right-4"}`}>
        <div className={`flex items-center gap-3 rounded-2xl px-4 py-2 ${glass}`}>
          <span className={`${serif} whitespace-nowrap text-[17px] font-bold`}>
            LABIQ BEYİN <span className="text-[10px] text-ink-3">v3</span>
          </span>
          <span className="hidden h-5 w-px bg-black/10 dark:bg-white/15 lg:block" />
          <span className="hidden items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-ink-3 xl:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Bağlı
          </span>
          <div className="flex items-center gap-1">
            {CONNECTORS.map((c) => {
              const err = c.source && (snap ? snap[c.source]?.error ?? (c.source === "drive" && !snap.drive ? "izin yok" : undefined) : "Google bağlı değil");
              const live = c.to === "hub" ? busy : active.has(c.to);
              return (
                <button
                  key={c.id}
                  ref={(el) => void (chips.current[c.id] = el)}
                  onClick={() => onSelect(c.to === "hub" ? null : c.to)}
                  title={err ? `${c.label}: ${err}` : `${c.label}: bağlı`}
                  className={`relative grid h-8 w-8 place-items-center rounded-xl text-[15px] transition-transform hover:scale-110 ${live ? "scale-110" : ""} ${err ? "opacity-45 grayscale" : ""}`}
                  style={{ background: `${c.color}1f`, boxShadow: live ? `0 0 0 2px ${c.color}, 0 0 16px ${c.color}` : undefined }}
                >
                  {c.icon}
                  {!err && <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-white bg-ok dark:border-[#1b1e27]" />}
                </button>
              );
            })}
          </div>
        </div>
        <div className={`ml-auto hidden shrink-0 items-center gap-3 rounded-2xl px-4 py-2 2xl:flex ${glass}`}>
          <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-ink-3">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Claude ile çalışır
          </span>
          <span className={`${serif} text-xl font-bold tabular-nums`}>{now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
        </div>
      </div>

      {/* kamera */}
      <div className={`absolute bottom-4 z-20 flex flex-col gap-1 rounded-2xl p-1 transition-[right] duration-300 ${panelOpen ? "right-[calc(min(420px,40%)+28px)]" : "right-4"} ${glass}`}>
        {[
          { icon: "plus", t: "Yakınlaştır", f: () => api.current?.zoom(0.7) },
          { icon: "minus", t: "Uzaklaştır", f: () => api.current?.zoom(1.4) },
          { icon: "refresh", t: "Döndür", f: () => api.current?.rotate(Math.PI / 4) },
          { icon: "home", t: "Tüm ofis", f: () => (onSelect(null), api.current?.reset()) },
          { icon: "sidebar", t: panelOpen ? "Paneli gizle" : "Paneli göster", f: () => setPanelOpen((v) => !v) },
        ].map((b) => (
          <motion.button key={b.t} whileTap={{ scale: 0.88 }} onClick={b.f} title={b.t} aria-label={b.t} className="grid h-9 w-9 place-items-center rounded-xl text-ink-2 hover:bg-black/5 dark:hover:bg-white/10">
            <Icon name={b.icon as "plus"} size={17} />
          </motion.button>
        ))}
      </div>

      {/* alt sol: durum */}
      <div className={`absolute bottom-4 left-4 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-4 py-2 font-mono text-[11px] text-ink-2 ${glass}`}>
        <span>{active.size} çalışıyor</span>
        <span>·</span>
        <span>{(st?.items ?? []).filter((x) => x.status === "inbox").length} öneri</span>
        <span>·</span>
        <span>{(st?.items ?? []).filter((x) => x.work?.status === "waiting_ok").length} onay bekliyor</span>
        <span className="hidden text-ink-3 xl:inline">· sürükle: döndür · tekerlek: yakınlaştır · departmana tıkla</span>
      </div>

      {/* sağ panel */}
      <div ref={panelRef} className={`pointer-events-none absolute bottom-4 right-4 top-4 z-30 flex w-[min(420px,40%)] flex-col transition-[transform,opacity] duration-300 ${panelOpen ? "" : "translate-x-[110%] opacity-0"}`}>
        <div data-panel-scroll className={`pointer-events-auto min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-[24px] p-4 ${glass}`}>
          <AnimatePresence mode="wait">
            <motion.div key={dept?.id ?? "all"} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.18 }} className="space-y-4">
              {/* görev çubuğu */}
              <Capture
                compact
                seed={seed}
                onDone={(s, newId, doNow, team) => {
                  brain.setSt(s);
                  const it = newId ? s.items.find((x) => x.id === newId) : undefined;
                  if (it && doNow) {
                    toast(`${agentById(it.agent)?.name ?? "Ajan"} ${team ? "ekibi topladı" : "işe başladı"}`);
                    onSelect(it.agent);
                    brain.runWork(it.id, undefined, team);
                  } else toast(it ? "İş kaydedildi" : "Not işlendi");
                }}
              />
              {dept ? (
                <>
                  <AgentPanel flat key={dept.id} agent={dept.id} trust={st?.trust?.[dept.id]} onTrust={(l) => brain.setTrust(dept.id, l)} onTry={(t) => setSeed((x) => ({ text: t, agent: dept.id, n: (x?.n ?? 0) + 1 }))} onClose={() => onSelect(null)} />
                  <section>
                    <div className="mb-2 px-1 text-sm font-extrabold">İşleri</div>
                    <TaskListView items={(st?.items ?? []).filter((x) => x.agent === dept.id || x.work?.team?.pieces.some((p) => p.agent === dept.id))} onOpen={setOpen} showAgent={false} empty="Bu departmanda iş yok." />
                  </section>
                </>
              ) : (
                <>
                  <DecisionDeck bare compact max={4} brain={brain} onOpen={setOpen} />
                  <DayPlan compact plan={st?.focus?.plan} items={st?.items ?? []} onOpen={setOpen} />
                  <TrustSuggest compact trust={st?.trust} onTrust={brain.setTrust} />
                  <section>
                    <div className="mb-2 px-1 text-sm font-extrabold">İşler</div>
                    {st ? <TaskListView items={st.items} onOpen={setOpen} /> : <div className="py-6 text-center text-xs text-ink-3">Yükleniyor…</div>}
                  </section>
                  <Learning compact learning={st?.learning} onLearned={brain.load} />
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <ItemSheet x={open} onClose={() => setOpen(null)} onPatch={brain.patch} onWork={brain.runWork} onApprove={brain.approveWork} />
    </div>
  );
}


