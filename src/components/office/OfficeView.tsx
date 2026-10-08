"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui";
import type { ArchiveProgress, GoogleSnapshot } from "@/lib/google-types";
import { OFFICE_DARK, OFFICE_LIGHT, type OfficePal } from "./Furniture";
import { STATUS_COLOR, STATUS_LABEL, ZONES, zoneById, zoneStats, type ZoneId, type ZoneStat } from "./layout";
import { OfficeScene, type CameraApi } from "./OfficeScene";

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
      className={`relative h-[calc(100dvh-14rem)] min-h-[540px] overflow-hidden rounded-[30px] lg:h-[calc(100dvh-12rem)] lg:min-h-[600px] ${pal.dark ? "bg-[#121620]" : "bg-[#e9edf3]"}`}
    >
      <OfficeScene pal={pal} snap={snap} stats={stats} archive={archive} archiving={archiving} focus={focus} onSelect={onSelect} api={api} panelPx={panelPx} labels={labels} onHover={setHover} />

      {/* oda rozetleri */}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {ZONES.map((z) => {
          const s = stats[z.id];
          const on = focus === z.id || hover === z.id;
          return (
            <div key={z.id} ref={(el) => void (labels.current[z.id] = el)} className="absolute left-0 top-0 will-change-transform" style={{ opacity: 0 }}>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(focus === z.id ? null : z.id);
                }}
                className={`pointer-events-auto flex items-center gap-2 rounded-2xl py-1.5 pl-1.5 pr-3 text-left transition-transform ${glass} ${on ? "scale-105" : ""}`}
                style={{ boxShadow: focus === z.id ? `0 0 0 2px ${z.color}, 0 10px 30px -10px ${z.color}` : undefined }}
              >
                <span className="relative grid h-9 w-9 place-items-center rounded-xl text-lg" style={{ background: `${z.color}26` }}>
                  {z.emoji}
                  {s.count > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full px-1 text-center text-[10px] font-extrabold leading-[18px] text-white" style={{ background: z.color }}>
                      {s.count > 99 ? "99+" : s.count}
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block whitespace-nowrap text-[13px] font-extrabold leading-tight">{z.title}</span>
                  <span className="flex items-center gap-1 whitespace-nowrap text-[10px] font-extrabold tracking-wide" style={{ color: STATUS_COLOR[s.status] }}>
                    <span className={`h-1.5 w-1.5 rounded-full ${s.status === "busy" ? "animate-pulse" : ""}`} style={{ background: STATUS_COLOR[s.status] }} />
                    {on ? <span className="font-bold text-ink-2">{s.headline}</span> : STATUS_LABEL[s.status]}
                  </span>
                </span>
              </button>
            </div>
          );
        })}
        <div ref={(el) => void (labels.current.hub = el)} className="absolute left-0 top-0" style={{ opacity: 0 }}>
          <div className={`whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-extrabold text-[#8b5cf6] ${glass}`}>🤖 Agent merkezi · yakında</div>
        </div>
      </div>

      {/* sol üst: başlık + senkron */}
      <div className={`absolute left-4 top-4 z-20 flex items-center gap-3 rounded-2xl px-4 py-2.5 ${glass}`}>
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-ink-3">LabIQ Ofis</div>
          <div className="text-sm font-extrabold">{snap.account.name}</div>
          <div className="text-[11px] font-semibold text-ink-3">Son senkron {ago(snap.syncedAt)}</div>
        </div>
        <motion.button whileTap={{ scale: 0.88 }} onClick={onSync} disabled={syncing} title="Şimdi senkronla" aria-label="Senkronla" className="grid h-9 w-9 place-items-center rounded-xl bg-blue text-white disabled:opacity-60">
          <motion.span animate={syncing ? { rotate: 360 } : { rotate: 0 }} transition={syncing ? { repeat: Infinity, duration: 1, ease: "linear" } : {}}>
            <Icon name="refresh" size={16} />
          </motion.span>
        </motion.button>
      </div>

      {/* üst orta: oda çipleri */}
      <div className={`absolute top-4 z-20 hidden justify-center transition-[right] duration-300 xl:flex ${panelOpen ? "left-[260px] right-[calc(min(440px,42%)+90px)]" : "left-[260px] right-[90px]"}`}>
        <div className={`flex flex-wrap justify-center gap-1 rounded-2xl p-1 ${glass}`}>
          {ZONES.map((z) => (
            <button key={z.id} onClick={() => onSelect(focus === z.id ? null : z.id)} className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-bold ${focus === z.id ? "bg-black/5 dark:bg-white/10" : ""}`}>
              <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[stats[z.id].status] }} />
              {z.role}
              {stats[z.id].count > 0 && <span className="tabular-nums text-ink-3">{stats[z.id].count}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* kamera araç çubuğu */}
      <div className={`absolute top-4 z-20 flex flex-col gap-1 rounded-2xl p-1 transition-[right] duration-300 ${panelOpen ? "right-[calc(min(440px,42%)+28px)]" : "right-4"} ${glass}`}>
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
                <div className="mb-4 flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: `${zone.color}26` }}>
                    {zone.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-extrabold leading-tight">{zone.title}</div>
                    <div className="text-xs font-bold" style={{ color: STATUS_COLOR[stats[zone.id].status] }}>
                      {zone.role} · {STATUS_LABEL[stats[zone.id].status]}
                    </div>
                    {stats[zone.id].sub && <div className="mt-0.5 line-clamp-2 text-xs text-ink-3">{stats[zone.id].sub}</div>}
                  </div>
                  <button onClick={() => onSelect(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-black/5 dark:hover:bg-white/10" aria-label="Kapat">
                    <Icon name="close" size={16} />
                  </button>
                </div>
                <div className="@container">{renderZone(zone.id)}</div>
              </>
            ) : (
              <Overview stats={stats} onPick={onSelect} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* alt sol: durum çubuğu */}
      <div className={`absolute bottom-4 left-4 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-4 py-2 font-mono text-[11px] text-ink-2 ${panelOpen ? "max-w-[calc(100%-min(440px,42%)-48px)]" : ""} ${glass}`}>
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
        <span className="hidden text-ink-3 lg:inline">· sürükle: döndür · tekerlek: yakınlaştır · odaya tıkla</span>
      </div>
    </div>
  );
}

function Overview({ stats, onPick }: { stats: Record<ZoneId, ZoneStat>; onPick: (id: ZoneId) => void }) {
  return (
    <div>
      <div className="text-lg font-extrabold">Ofis</div>
      <p className="mb-3 text-xs text-ink-3">Her oda bir Google kaynağı. Bekleyen işler masalarda görünür; bir odaya tıkla, içeriği burada açılsın. Koltuklar ileride agent'lara atanacak.</p>
      <div className="space-y-2">
        {ZONES.map((z, i) => {
          const s = stats[z.id];
          return (
            <motion.button
              key={z.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => onPick(z.id)}
              className="flex w-full items-center gap-3 rounded-2xl bg-white/60 p-3 text-left hover:bg-white dark:bg-white/5 dark:hover:bg-white/10"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl" style={{ background: `${z.color}26` }}>
                {z.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-extrabold">{z.title}</span>
                  <span className="shrink-0 rounded-full px-1.5 text-[9px] font-extrabold tracking-wide text-white" style={{ background: STATUS_COLOR[s.status] }}>
                    {STATUS_LABEL[s.status]}
                  </span>
                </span>
                <span className="block truncate text-xs font-semibold text-ink-2">{s.headline}</span>
                {s.sub && <span className="block truncate text-[11px] text-ink-3">{s.sub}</span>}
              </span>
              <Icon name="chevron" size={16} className="shrink-0 text-ink-3" />
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
