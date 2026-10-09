"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui";
import { AGENTS, agentById } from "@/lib/brain-types";
import { ItemSheet } from "@/components/brain/BrainView";
import { TaskListView } from "@/components/brain/TaskRow";
import { useBrainState } from "@/components/brain/useBrain";
import type { ArchiveProgress, GoogleSnapshot } from "@/lib/google-types";
import { OFFICE_DARK, OFFICE_LIGHT, type OfficePal } from "./Furniture";
import { STATUS_COLOR, STATUS_LABEL, ZONE_AGENT, ZONES, zoneById, zoneStats, type ZoneId, type ZoneStat } from "./layout";
import { OfficeScene, type CameraApi, type Screen } from "./OfficeScene";

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

const glass = "border border-white/60 bg-white/75 shadow-[0_10px_40px_-12px_rgba(31,35,48,.25)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1b1e27]/80";

function ago(s: string) {
  const m = Math.round((Date.now() - Date.parse(s)) / 60000);
  return m < 1 ? "az önce" : m < 60 ? `${m} dk önce` : `${Math.round(m / 60)} sa önce`;
}

/**
 * Google sayfası: 3B sanal ofis. Her Google kaynağı ayrı bir oda; bekleyen işler masalarda
 * zarf, not, balon, klasör ve sunucu ışıkları olarak görünür. Odaya tıklayınca sağ panelde o kaynağın içeriği açılır.
 * Koltuklar boş: ileride agent'lar masalara atanacak.
 */
export default function OfficeView({
  snap,
  archive,
  archiving,
  syncing,
  onSync,
  renderZone,
}: {
  snap: GoogleSnapshot;
  archive: ArchiveProgress | null;
  archiving: boolean;
  syncing: boolean;
  onSync: () => void;
  /** seçilen odanın içeriği (Google sekmesindeki ilgili bölüm) */
  renderZone: (id: ZoneId) => React.ReactNode;
}) {
  const pal = usePal();
  const [focus, setFocus] = useState<ZoneId | null>(null);
  const [hover, setHover] = useState<ZoneId | null>(null);
  // dar ekranda (tablet) sahne görünsün diye panel kapalı başlar; odaya tıklayınca açılır
  const [panelOpen, setPanelOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 1280);
  const api = useRef<CameraApi | null>(null);
  const labels = useRef<Record<string, HTMLDivElement | null>>({});
  const screen: Screen = useRef({});
  const brain = useBrainState();
  // ofis açıkken beyin durumu yarım dakikada bir tazelenir (ajanlar arka planda çalışabilir)
  useEffect(() => {
    const t = setInterval(brain.load, 30000);
    return () => clearInterval(t);
  }, [brain.load]);
  const wiresRef = useRef<SVGSVGElement>(null);
  const chips = useRef<Record<string, HTMLElement | null>>({});
  // servis şeridinden pod kartlarına kablolar (her karede, kart konumları sahneden gelir)
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
          path.setAttribute("d", `M${x0},${y0} C${x0},${y0 + 90} ${end.x},${y1 - 120} ${end.x},${y1}`);
          path.style.opacity = end.on ? "" : "0";
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPx, setPanelPx] = useState(0);
  // durumlar dakikada bir yeniden hesaplanır (canlı toplantı, "1 saat içinde" gibi zamanlı kurallar)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stats = useMemo(() => zoneStats(snap, archive, archiving), [snap, archive, archiving, tick]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPanelPx(panelOpen ? el.offsetWidth + 16 : 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, [panelOpen]);

  const onSelect = useCallback((id: ZoneId | null) => {
    setFocus(id);
    if (id) setPanelOpen(true);
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog]") && !(e.target as HTMLElement)?.closest?.("input,textarea")) onSelect(null);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onSelect]);

  const zone = zoneById(focus);
  const brainBusy = !!brain.st?.running || brain.thinking || !!brain.st?.items.some((x) => x.work?.status === "running");
  const agentWork = useMemo(() => {
    const m: Record<string, { doing: number; next: number; done: number; open: number; running: boolean }> = {};
    for (const a of AGENTS) m[a.id] = { doing: 0, next: 0, done: 0, open: 0, running: false };
    for (const x of brain.st?.items ?? []) {
      const c = m[x.agent];
      if (x.status === "doing" || x.status === "waiting") c.doing++;
      else if (x.status === "inbox" || x.status === "todo") c.next++;
      else if (x.status === "done") c.done++;
      if (x.status !== "done" && x.status !== "dismissed") c.open++;
      if (x.work?.status === "running") {
        c.running = true;
        // ekip parçalarındaki ajanlar da çalışıyor sayılır (kabloları ışır)
        for (const p of x.work.team?.pieces ?? []) if (p.status === "running" && m[p.agent]) m[p.agent].running = true;
      }
    }
    return m;
  }, [brain.st]);
  const counts = useMemo(() => {
    const v = Object.values(stats);
    return { busy: v.filter((s) => s.status === "busy").length, waiting: v.filter((s) => s.status === "waiting").length, idle: v.filter((s) => s.status === "idle").length, error: v.filter((s) => s.status === "error").length };
  }, [stats]);

  return (
    <div
      onScroll={(e) => {
        e.currentTarget.scrollLeft = 0;
        e.currentTarget.scrollTop = 0;
      }}
      className={`relative h-[calc(100dvh-14rem)] min-h-[540px] overflow-hidden rounded-[30px] lg:h-[calc(100dvh-12rem)] lg:min-h-[600px] ${pal.dark ? "bg-[#121620]" : "bg-[#f3f0e9]"}`}
    >
      <OfficeScene pal={pal} snap={snap} stats={stats} archive={archive} archiving={archiving} focus={focus} onSelect={onSelect} api={api} panelPx={panelPx} labels={labels} screen={screen} onHover={setHover} busy={brainBusy} />

      {/* servis kabloları */}
      <svg ref={wiresRef} className="pointer-events-none absolute inset-0 z-[5] h-full w-full" aria-hidden>
        {CONNECTORS.map((c) => {
          const agent = ZONE_AGENT[c.to as ZoneId];
          const live = c.to === "hub" ? brainBusy : !!(agent && agentWork[agent]?.running) || (c.to === "archive" && archiving);
          return <path key={c.id} data-wire={c.id} fill="none" stroke={c.color} strokeWidth={live ? 2.2 : 1.4} strokeOpacity={live ? 0.95 : 0.45} strokeDasharray="3 6" className={live ? "office-wire-live" : "office-wire"} />;
        })}
      </svg>

      {/* pod kartları */}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {ZONES.map((z) => {
          const s = stats[z.id];
          const agent = ZONE_AGENT[z.id];
          const w = agent ? agentWork[agent] : null;
          const on = focus === z.id || hover === z.id;
          const big = agent ? w!.open : archive?.stats.total ?? 0;
          return (
            <div key={z.id} ref={(el) => void (labels.current[z.id] = el)} className="absolute left-0 top-0 will-change-transform" style={{ opacity: 0 }}>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(focus === z.id ? null : z.id);
                }}
                className={`pointer-events-auto mb-2 rounded-2xl px-3 pb-2 pt-2 text-left transition-all ${glass} ${on ? "w-[172px] scale-[1.03]" : "w-[132px]"}`}
                style={{ boxShadow: focus === z.id ? `0 0 0 2px ${z.color}, 0 14px 34px -12px ${z.color}` : s.status === "error" ? `0 0 0 1.5px ${STATUS_COLOR.error}` : undefined }}
              >
                <div className="flex items-center gap-1.5 whitespace-nowrap text-[9.5px] font-extrabold uppercase tracking-[0.12em]">
                  <span className={`h-2 w-2 rounded-full ${w?.running || s.status === "busy" ? "animate-pulse" : ""}`} style={{ background: z.color }} />
                  {z.title}
                  <span className="ml-auto text-sm leading-none">{z.emoji}</span>
                </div>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="font-serif text-[24px] font-bold leading-none tabular-nums">{big > 9999 ? `${Math.round(big / 1000)}k` : big.toLocaleString("tr-TR")}</span>
                  <span className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-ink-3">{agent ? "açık iş" : "kayıt"}</span>
                </div>
                {on && <div className="mt-1.5 space-y-0.5 border-t border-black/5 pt-1.5 text-[10.5px] dark:border-white/10">
                  <div className="flex justify-between gap-2">
                    <span className="truncate text-ink-3">{STATUS_LABEL[s.status]}</span>
                    <span className="shrink-0 font-bold tabular-nums">{s.count}</span>
                  </div>
                  <div className="truncate font-semibold text-ink-2">{s.headline}</div>
                </div>}
                {w && (
                  <div className="mt-1 flex gap-1.5 border-t border-black/5 pt-1 text-[8.5px] font-extrabold uppercase tracking-wider text-ink-3 dark:border-white/10" title="yapılıyor · sırada · bitti">
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
                )}
              </button>
            </div>
          );
        })}
        <div ref={(el) => void (labels.current.hub = el)} className="absolute left-0 top-0" style={{ opacity: 0 }}>
          <Link href="/gorevler" onPointerDown={(e) => e.stopPropagation()} className={`pointer-events-auto mb-1 flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-extrabold ${glass}`}>
            <span className={`h-2 w-2 rounded-full bg-[#8b5cf6] ${brainBusy ? "animate-pulse" : ""}`} />
            BEYİN
            <span className="font-bold text-ink-3">{brain.st ? `${brain.st.items.filter((x) => x.status !== "done").length} açık iş` : "…"}</span>
            {brainBusy && <span className="text-[#8b5cf6]">düşünüyor…</span>}
          </Link>
        </div>
      </div>

      {/* üst: bağlı servisler */}
      <div className={`absolute top-4 z-20 flex justify-center transition-[right] duration-300 ${panelOpen ? "left-[230px] right-[calc(min(440px,42%)+80px)]" : "left-[230px] right-[80px]"}`}>
        <div className={`flex items-center gap-1.5 rounded-2xl px-2.5 py-1.5 ${glass}`}>
          <span className="mr-1 hidden items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-ink-3 xl:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Bağlı
          </span>
          {CONNECTORS.map((c) => {
            const err = c.source && (snap[c.source]?.error ?? (c.source === "drive" && !snap.drive ? "izin yok" : undefined));
            const agent = ZONE_AGENT[c.to as ZoneId];
            const live = c.to === "hub" ? brainBusy : !!(agent && agentWork[agent]?.running);
            return (
              <button
                key={c.id}
                ref={(el) => void (chips.current[c.id] = el)}
                onClick={() => (c.to === "hub" ? onSelect(null) : onSelect(c.to as ZoneId))}
                title={err ? `${c.label}: ${err}` : `${c.label}: bağlı`}
                className={`relative grid h-8 w-8 place-items-center rounded-xl text-base transition-transform hover:scale-110 ${live ? "scale-110" : ""} ${err ? "opacity-45 grayscale" : ""}`}
                style={{ background: `${c.color}1f`, boxShadow: live ? `0 0 0 2px ${c.color}, 0 0 16px ${c.color}` : undefined }}
              >
                {c.icon}
                {!err && <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-white bg-ok dark:border-[#1b1e27]" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* sol üst: başlık + senkron */}
      <div className={`absolute left-4 top-4 z-20 flex items-center gap-3 rounded-2xl px-4 py-2.5 ${glass}`}>
        <div>
          <div className="font-serif text-[15px] font-bold tracking-[0.08em]">
            LABIQ OFİS <span className="text-[10px] text-ink-3">v2</span>
          </div>
          <div className="text-[11px] font-semibold text-ink-3">Son senkron {ago(snap.syncedAt)}</div>
        </div>
        <motion.button whileTap={{ scale: 0.88 }} onClick={onSync} disabled={syncing} title="Şimdi senkronla" aria-label="Senkronla" className="grid h-9 w-9 place-items-center rounded-xl bg-blue text-white disabled:opacity-60">
          <motion.span animate={syncing ? { rotate: 360 } : { rotate: 0 }} transition={syncing ? { repeat: Infinity, duration: 1, ease: "linear" } : {}}>
            <Icon name="refresh" size={16} />
          </motion.span>
        </motion.button>
      </div>

      {/* kamera araç çubuğu */}
      <div className={`absolute bottom-4 z-20 flex flex-col gap-1 rounded-2xl p-1 transition-[right] duration-300 ${panelOpen ? "right-[calc(min(440px,42%)+28px)]" : "right-4"} ${glass}`}>
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

      {/* sağ panel */}
      <div ref={panelRef} className={`pointer-events-none absolute bottom-4 right-4 top-4 z-20 flex w-[min(440px,42%)] flex-col transition-[transform,opacity] duration-300 ${panelOpen ? "" : "translate-x-[110%] opacity-0"}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={zone?.id ?? "overview"}
            initial={{ opacity: 0, x: 24, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            data-panel-scroll
            className={`pointer-events-auto min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-[24px] p-4 ${glass}`}
          >
            {zone ? (
              <>
                <div className="mb-4 flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-xl" style={{ background: `${zone.color}1f` }}>
                    {zone.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[17px] font-extrabold leading-tight">{zone.title}</div>
                    <div className="truncate text-xs text-ink-3">
                      {zone.role}
                      {stats[zone.id].sub ? ` · ${stats[zone.id].sub}` : ""}
                    </div>
                  </div>
                  <button onClick={() => onSelect(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Kapat">
                    <Icon name="close" size={16} />
                  </button>
                </div>
                {ZONE_AGENT[zone.id] && (() => {
                  const mine = (brain.st?.items ?? []).filter((x) => x.agent === ZONE_AGENT[zone.id] && x.status !== "done" && x.status !== "dismissed");
                  return mine.length ? (
                    <section className="mb-4">
                      <div className="mb-1 px-1 text-xs font-bold text-ink-3">Beyindeki işler</div>
                      <TaskListView items={mine} onOpen={brain.setOpen} filters={false} showAgent={false} limit={3} />
                    </section>
                  ) : null;
                })()}
                <div className="@container">{renderZone(zone.id)}</div>
              </>
            ) : (
              <TaskStatus brain={brain} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* alt sol: durum çubuğu */}
      <div className={`absolute bottom-4 left-4 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-4 py-2 font-mono text-[11px] text-ink-2 ${panelOpen ? "max-w-[calc(100%-min(440px,42%)-110px)]" : "max-w-[calc(100%-110px)]"} ${glass}`}>
        <span style={{ color: STATUS_COLOR.busy }}>{counts.busy} çalışıyor</span>
        <span>·</span>
        <span style={{ color: STATUS_COLOR.waiting }}>{counts.waiting} iş bekliyor</span>
        <span>·</span>
        <span style={{ color: STATUS_COLOR.idle }}>{counts.idle} sakin</span>
        {counts.error > 0 && (
          <>
            <span>·</span>
            <span style={{ color: STATUS_COLOR.error }}>{counts.error} sorun</span>
          </>
        )}
        <span className="hidden text-ink-3 lg:inline">· sürükle: döndür · tekerlek: yakınlaştır · pod'a tıkla</span>
      </div>
      <ItemSheet x={brain.open} onClose={() => brain.setOpen(null)} onPatch={brain.patch} onWork={brain.runWork} onApprove={brain.approveWork} />
    </div>
  );
}

/* ------------------------------------------------------------------ bağlı servisler */
const CONNECTORS: { id: string; label: string; icon: string; color: string; to: ZoneId | "hub"; source?: "gmail" | "chat" | "calendar" | "meet" | "drive" }[] = [
  { id: "gmail", label: "Gmail", icon: "✉️", color: "#ff5e6c", to: "gmail", source: "gmail" },
  { id: "chat", label: "Google Chat", icon: "💬", color: "#2ec4b6", to: "chat", source: "chat" },
  { id: "calendar", label: "Takvim", icon: "📅", color: "#5b7cff", to: "calendar", source: "calendar" },
  { id: "meet", label: "Meet", icon: "🎥", color: "#8b5cf6", to: "meet", source: "meet" },
  { id: "drive", label: "Drive", icon: "📁", color: "#ffa53d", to: "drive", source: "drive" },
  { id: "claude", label: "Claude (Anthropic)", icon: "✳️", color: "#d97757", to: "hub" },
];


/* ------------------------------------------------------------------ beyin durumu */
type BrainHook = ReturnType<typeof useBrainState>;

/** Genel bakış: beynin kısa durumu ve tüm ofisin işleri. */
function TaskStatus({ brain }: { brain: BrainHook }) {
  const st = brain.st;
  const busy = brain.thinking || !!st?.running;
  return (
    <div className="space-y-4">
      <section className="flex items-center gap-2 px-1">
        <span className="text-sm font-extrabold">Beyin</span>
        <span className="truncate text-xs text-ink-3">{st?.lastRun ? `düşünme ${ago(st.lastRun)}` : "henüz düşünmedi"}</span>
        <button onClick={brain.think} disabled={busy} className="ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold text-ink-2 hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/10">
          <Icon name="refresh" size={13} className={busy ? "animate-spin" : ""} />
          {busy ? "Düşünüyor" : "Düşün"}
        </button>
        <Link href="/gorevler" className="rounded-full px-2.5 py-1 text-xs font-bold text-blue hover:bg-black/5 dark:hover:bg-white/10">
          Aç
        </Link>
      </section>
      <section>
        <div className="mb-2 px-1 text-sm font-extrabold">İşler</div>
        {st ? <TaskListView items={st.items} onOpen={brain.setOpen} /> : <div className="py-6 text-center text-xs text-ink-3">Yükleniyor…</div>}
      </section>
    </div>
  );
}
