"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAssistant } from "@/components/assistant/AssistantPanel";
import { ItemCard } from "@/components/ItemCard";
import { usePeriod } from "@/components/PeriodProvider";
import { Icon, Sheet } from "@/components/ui";
import { AnimatedNumber } from "@/components/fx";
import { AREAS, HOSPITALS, TOTAL_ITEMS, areaByCode, type Area, type Hospital } from "@/lib/checklist";
import { areaProgress, deadlineInfo, isChecked, overallProgress, periodLabel } from "@/lib/period";
import type { Mark, PeriodData } from "@/lib/types";
import type { ActionDraft } from "@/components/ActionEditor";
import type { BuildingStats } from "./Building";
import { DARK, FAIL, HOSPITAL_COLOR, LIGHT, OK, type Palette } from "./palette";
import { Scene, type CameraApi } from "./Scene";

/* ------------------------------------------------------------------ tema */
function usePalette(): Palette {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setDark(el.dataset.theme === "dark");
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return dark ? DARK : LIGHT;
}

const glass = "border border-white/60 bg-white/75 shadow-[0_10px_40px_-12px_rgba(31,35,48,.25)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1b1e27]/80";

/**
 * Denetim paneli: 3B kampüs. Her rapor alanı bir bina, her madde bir rampa; işaretler paletlerle görünür.
 * Üzerindeki cam paneller (videodaki gibi): üstte göstergeler, sağda seçili bina, altta akış ve iş kuyruğu.
 */
export default function WorldView({ data, onAddAction }: { data: PeriodData; onAddAction: (d: ActionDraft) => void }) {
  const pal = usePalette();
  const [focus, setFocus] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const api = useRef<CameraApi | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPx, setPanelPx] = useState(0);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPanelPx(panelOpen ? el.offsetWidth + 16 : 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, [panelOpen]);
  // bir bina seçilince panel kendiliğinden açılır
  useEffect(() => {
    if (focus) setPanelOpen(true);
  }, [focus]);

  const stats = useMemo(() => {
    const out: Record<string, BuildingStats> = {};
    for (const a of AREAS) {
      const p = areaProgress(data, a);
      const dl = deadlineInfo(data.period, a);
      const fails = a.items.reduce((s, it) => s + (["bursa", "basaksehir"] as const).filter((h) => data.items[it.id]?.[h] === "fail").length, 0);
      out[a.code] = { bursa: p.bursa, basaksehir: p.basaksehir, fails, n: a.items.length, overdue: dl.days != null && dl.days < 0, dueLabel: dl.text };
    }
    return out;
  }, [data]);

  const onSelect = useCallback((code: string | null) => {
    setFocus(code);
    setSelectedItem(null);
  }, []);
  const onSelectItem = useCallback((code: string, itemId: string) => {
    setFocus(code);
    setSelectedItem(itemId);
  }, []);

  // Esc: seçimi kaldır
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !detail && !(e.target as HTMLElement)?.closest?.("input,textarea")) onSelect(null);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [detail, onSelect]);

  const area = focus && focus !== "HQ" ? areaByCode(focus) ?? null : null;
  const detailArea = detail ? AREAS.find((a) => a.items.some((i) => i.id === detail)) : undefined;
  const detailItem = detailArea?.items.find((i) => i.id === detail);

  return (
    <div className={`relative h-[calc(100dvh-15rem)] min-h-[560px] overflow-hidden rounded-[30px] lg:h-[calc(100dvh-8.5rem)] lg:min-h-[620px] ${pal.dark ? "bg-[#151a25]" : "bg-[#eaf0f8]"}`}>
      <Scene pal={pal} items={data.items} stats={stats} focus={focus} selectedItem={selectedItem} onSelect={onSelect} onSelectItem={onSelectItem} api={api} panelPx={panelPx} />

      {/* üst göstergeler */}
      <TopStats data={data} stats={stats} onPick={(c) => onSelect(c)} panelOpen={panelOpen} />

      {/* kamera araç çubuğu */}
      <div className={`absolute top-4 z-20 flex flex-col gap-1 rounded-2xl p-1 transition-[right] duration-300 ${panelOpen ? "right-[calc(min(372px,40%)+28px)]" : "right-4"} ${glass}`}>
        {[
          { icon: "plus", t: "Yakınlaştır", f: () => api.current?.zoom(0.7) },
          { icon: "minus", t: "Uzaklaştır", f: () => api.current?.zoom(1.4) },
          { icon: "refresh", t: "Döndür", f: () => api.current?.rotate(Math.PI / 4) },
          { icon: "home", t: "Tüm kampüs", f: () => (onSelect(null), api.current?.reset()) },
          { icon: "sidebar", t: panelOpen ? "Paneli gizle" : "Paneli göster", f: () => setPanelOpen((v) => !v) },
        ].map((b) => (
          <motion.button key={b.t} whileTap={{ scale: 0.88 }} onClick={b.f} title={b.t} aria-label={b.t} className="grid h-9 w-9 place-items-center rounded-xl text-ink-2 hover:bg-black/5 dark:hover:bg-white/10">
            <Icon name={b.icon as "plus"} size={17} />
          </motion.button>
        ))}
      </div>

      {/* sağ panel */}
      <div
        ref={panelRef}
        className={`pointer-events-none absolute bottom-4 right-4 top-4 z-20 flex w-[min(372px,40%)] flex-col gap-3 transition-[transform,opacity] duration-300 ${panelOpen ? "" : "translate-x-[110%] opacity-0"}`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={area?.code ?? "hq"}
            initial={{ opacity: 0, x: 24, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className={`pointer-events-auto min-h-0 flex-1 overflow-y-auto rounded-[24px] p-4 ${glass}`}
          >
            {area ? (
              <AreaPanel area={area} data={data} selectedItem={selectedItem} onItem={(id) => setSelectedItem(id)} onDetail={setDetail} onClose={() => onSelect(null)} />
            ) : (
              <Overview data={data} stats={stats} onPick={(c) => onSelect(c)} />
            )}
          </motion.div>
        </AnimatePresence>
        <Queue data={data} onPick={onSelectItem} className="pointer-events-auto hidden h-[212px] shrink-0 lg:flex" />
      </div>

      {/* alt: kapanış akışı */}
      <FlowCard data={data} stats={stats} onPick={(c) => onSelect(c)} />

      {/* lejant */}
      <Legend />

      {/* madde ayrıntısı (not, aksiyon) */}
      <Sheet open={!!detail} onClose={() => setDetail(null)} wide title={detailArea ? `${detailArea.code} · ${detailArea.title}` : ""}>
        {detailArea && detailItem && (
          <ItemCard
            area={detailArea}
            item={detailItem}
            index={detailArea.items.indexOf(detailItem)}
            state={data.items[detailItem.id]}
            actionCount={data.actions.filter((a) => a.itemId === detailItem.id).length}
            onAddAction={() => {
              setDetail(null);
              onAddAction({ areaCode: detailArea.code, itemId: detailItem.id });
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------------------ üst göstergeler */
function TopStats({ data, stats, onPick, panelOpen }: { data: PeriodData; stats: Record<string, BuildingStats>; onPick: (code: string) => void; panelOpen: boolean }) {
  const prog = overallProgress(data);
  const fails = Object.values(stats).reduce((s, x) => s + x.fails, 0);
  const next = AREAS.map((a) => ({ a, d: deadlineInfo(data.period, a), s: stats[a.code] }))
    .filter((x) => x.d.days != null && x.s.bursa + x.s.basaksehir < x.s.n * 2)
    .sort((x, y) => x.d.days! - y.d.days!)[0];
  const cards = [
    { k: "bursa", icon: "🏥", label: "Bursa", value: prog.bursaDone, of: TOTAL_ITEMS, color: HOSPITAL_COLOR.bursa },
    { k: "bsk", icon: "🏥", label: "Başakşehir", value: prog.basaksehirDone, of: TOTAL_ITEMS, color: HOSPITAL_COLOR.basaksehir },
    { k: "fail", icon: "⚠️", label: "Bulgu (✗)", value: fails, color: FAIL },
  ];
  return (
    <div className={`pointer-events-none absolute left-4 top-4 z-20 flex flex-wrap gap-2.5 ${panelOpen ? "right-[calc(min(372px,40%)+84px)]" : "right-20"}`}>
      {cards.map((c, i) => (
        <motion.div key={c.k} initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.06 }} className={`pointer-events-auto flex min-w-[148px] items-center gap-3 rounded-2xl px-3.5 py-2.5 ${glass}`}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white" style={{ background: c.color }}>
            <span className="text-base">{c.icon}</span>
          </span>
          <div className="min-w-0">
            <div className="truncate text-[11px] font-bold text-ink-3">{c.label}</div>
            <div className="text-lg font-extrabold leading-tight tabular-nums">
              <AnimatedNumber value={c.value} />
              {c.of != null && <span className="text-xs font-bold text-ink-3"> / {c.of}</span>}
            </div>
            {c.of != null && (
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                <motion.div className="h-full rounded-full" style={{ background: c.color }} initial={{ width: 0 }} animate={{ width: `${(c.value / c.of) * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
              </div>
            )}
          </div>
        </motion.div>
      ))}
      {next && (
        <motion.button
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28 }}
          onClick={() => onPick(next.a.code)}
          className={`pointer-events-auto flex min-w-[170px] items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left ${glass}`}
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base text-white" style={{ background: next.d.days! < 0 ? FAIL : next.d.days! <= 2 ? "#ffa53d" : next.a.color }}>
            ⏰
          </span>
          <div className="min-w-0">
            <div className="truncate text-[11px] font-bold text-ink-3">Sıradaki termin</div>
            <div className="truncate text-sm font-extrabold">
              {next.a.code} · {next.d.days! < 0 ? `${-next.d.days!} gün geçti` : next.d.days === 0 ? "bugün" : `${next.d.days} gün`}
            </div>
            <div className="truncate text-[11px] text-ink-3">{next.a.title}</div>
          </div>
        </motion.button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ genel bakış (merkez bina) */
function Overview({ data, stats, onPick }: { data: PeriodData; stats: Record<string, BuildingStats>; onPick: (code: string) => void }) {
  const { exportExcel } = usePeriod();
  const { ask } = useAssistant();
  const prog = overallProgress(data);
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#2f5bd8] text-lg font-extrabold text-white">D</span>
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-3">Diacore Merkez</div>
          <div className="truncate text-lg font-extrabold">{periodLabel(data.period)} kapanışı</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {HOSPITALS.map((h) => {
          const v = h.id === "bursa" ? prog.bursaDone : prog.basaksehirDone;
          return (
            <div key={h.id} className="rounded-2xl bg-black/[.035] p-3 dark:bg-white/5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-ink-3">
                <span className="h-2 w-2 rounded-full" style={{ background: HOSPITAL_COLOR[h.id] }} />
                {h.label}
              </div>
              <div className="text-2xl font-extrabold tabular-nums">%{Math.round((v / TOTAL_ITEMS) * 100)}</div>
              <div className="text-[11px] text-ink-3">
                {v}/{TOTAL_ITEMS} madde kontrol edildi
              </div>
            </div>
          );
        })}
      </div>
      <div className="mb-1.5 mt-4 text-[11px] font-extrabold uppercase tracking-wider text-ink-3">Binalar</div>
      <div className="space-y-1">
        {AREAS.map((a) => {
          const s = stats[a.code];
          const pct = (s.bursa + s.basaksehir) / (s.n * 2);
          return (
            <button key={a.code} onClick={() => onPick(a.code)} className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-sm" style={{ background: pct === 1 ? OK : a.color }}>
                {pct === 1 ? "✓" : a.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs font-extrabold">{a.code}</span>
                  <span className="truncate text-xs text-ink-2">{a.title}</span>
                </div>
                <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                  <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct * 100}%`, background: pct === 1 ? OK : a.color }} />
                </div>
              </div>
              {s.fails > 0 && <span className="rounded-full px-1.5 text-[10px] font-bold text-white" style={{ background: FAIL }}>{s.fails}</span>}
              {s.overdue && pct < 1 && <span title="Termin geçti">⏰</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => exportExcel()} className="flex items-center gap-1.5 rounded-full bg-[#2f5bd8] px-3.5 py-2 text-xs font-bold text-white">
          <Icon name="download" size={14} /> Excel
        </button>
        <button onClick={() => ask(`${periodLabel(data.period)} kapanışının durumu ne? Hangi binalar (alanlar) geride, bugün neye odaklanmalıyım?`)} className="rounded-full bg-black/5 px-3.5 py-2 text-xs font-bold text-ink-2 dark:bg-white/10">
          ✨ Asistana sor
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ alan (bina) paneli */
const MARK_BTNS: { v: Exclude<Mark, null>; label: string; color: string }[] = [
  { v: "ok", label: "✓", color: OK },
  { v: "fail", label: "✗", color: FAIL },
  { v: "na", label: "N/A", color: "#9aa1b5" },
];

function AreaPanel({
  area,
  data,
  selectedItem,
  onItem,
  onDetail,
  onClose,
}: {
  area: Area;
  data: PeriodData;
  selectedItem: string | null;
  onItem: (id: string) => void;
  onDetail: (id: string) => void;
  onClose: () => void;
}) {
  const { update, toast } = usePeriod();
  const { ask } = useAssistant();
  const p = areaProgress(data, area);
  const dl = deadlineInfo(data.period, area);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    if (selectedItem) refs.current[selectedItem]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedItem]);

  const setMark = (id: string, h: Hospital, m: Mark) => {
    update((d) => ({ ...d, items: { ...d.items, [id]: { ...d.items[id], [h]: m, updatedAt: new Date().toISOString() } } }));
    if (m === "fail") toast("Bulgu işaretlendi — not veya aksiyon eklemek için maddeyi aç");
  };

  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl" style={{ background: area.color }}>
          {area.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-3">
            {area.code} · Rapor binası{area.priority ? " · öncelikli" : ""}
          </div>
          <div className="text-lg font-extrabold leading-tight">{area.title}</div>
        </div>
        <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Kapat">
          <Icon name="close" size={15} />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
        <span className={`rounded-full px-2 py-1 ${dl.days != null && dl.days < 0 ? "bg-[#ff5e6c] text-white" : "bg-black/5 text-ink-2 dark:bg-white/10"}`}>⏰ {dl.text}{dl.dateText ? ` · ${dl.dateText}` : ""}</span>
        <span className="rounded-full bg-black/5 px-2 py-1 text-ink-2 dark:bg-white/10">👤 {area.people.join(", ")}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {HOSPITALS.map((h) => {
          const v = h.id === "bursa" ? p.bursa : p.basaksehir;
          return (
            <div key={h.id} className="rounded-xl bg-black/[.035] px-3 py-2 dark:bg-white/5">
              <div className="flex items-center justify-between text-[11px] font-bold">
                <span className="flex items-center gap-1.5 text-ink-3">
                  <span className="h-2 w-2 rounded-full" style={{ background: HOSPITAL_COLOR[h.id] }} />
                  {h.label}
                </span>
                <span className="tabular-nums">
                  {v}/{area.items.length}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                <motion.div className="h-full rounded-full" style={{ background: HOSPITAL_COLOR[h.id] }} animate={{ width: `${(v / area.items.length) * 100}%` }} transition={{ type: "spring", stiffness: 140, damping: 20 }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-1.5 mt-4 flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-ink-3">
        <span>Rampalar · {area.items.length} iş</span>
        <span className="normal-case tracking-normal">B = Bursa · Ş = Başakşehir</span>
      </div>
      <div className="space-y-2">
        {area.items.map((it, i) => {
          const s = data.items[it.id];
          const sel = selectedItem === it.id;
          const both = isChecked(s?.bursa) && isChecked(s?.basaksehir);
          return (
            <motion.div
              key={it.id}
              ref={(el) => {
                refs.current[it.id] = el;
              }}
              layout
              onClick={() => onItem(it.id)}
              className={`cursor-pointer rounded-2xl p-2.5 transition-colors ${sel ? "bg-[#2f5bd8]/10 ring-2 ring-[#2f5bd8]/60" : "bg-black/[.03] hover:bg-black/[.05] dark:bg-white/[.04] dark:hover:bg-white/[.07]"}`}
            >
              <div className="flex items-start gap-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-extrabold text-white" style={{ background: both ? OK : area.color }}>
                  {both ? "✓" : i + 1}
                </span>
                <div className={`min-w-0 flex-1 text-[13px] font-semibold leading-snug ${sel ? "" : "line-clamp-2"}`}>{it.text}</div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDetail(it.id);
                  }}
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-[#2f5bd8] hover:bg-[#2f5bd8]/10"
                  title="Not, ipucu ve aksiyon"
                >
                  {s?.note ? "📝" : ""} Detay
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 pl-8">
                {HOSPITALS.map((h) => (
                  <div key={h.id} className="flex items-center gap-1">
                    <span className="w-4 text-[11px] font-extrabold" style={{ color: HOSPITAL_COLOR[h.id] }}>
                      {h.id === "bursa" ? "B" : "Ş"}
                    </span>
                    {MARK_BTNS.map((m) => {
                      const on = s?.[h.id] === m.v;
                      return (
                        <motion.button
                          key={m.v}
                          whileTap={{ scale: 0.85 }}
                                                    onClick={(e) => {
                            e.stopPropagation();
                            setMark(it.id, h.id, on ? null : m.v);
                          }}
                          className={`h-7 min-w-[34px] rounded-lg px-1.5 text-[12px] font-extrabold transition-colors ${on ? "text-white shadow-sm" : "bg-white/70 text-ink-3 hover:text-ink dark:bg-white/10"}`}
                          style={on ? { background: m.color } : undefined}
                          aria-pressed={on}
                          title={`${h.label}: ${m.v === "ok" ? "Tamam" : m.v === "fail" ? "Bulgu var" : "N/A"}`}
                        >
                          {m.label}
                        </motion.button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </motion.div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => ask(`${area.code} ${area.title} alanında hangi kontroller eksik, bulgular ve notlar neler? Neye dikkat etmeliyim, kime yazmalıyım?`)}
          className="rounded-full bg-black/5 px-3.5 py-2 text-xs font-bold text-ink-2 dark:bg-white/10"
        >
          ✨ Asistana sor
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ iş kuyruğu */
function Queue({ data, onPick, className }: { data: PeriodData; onPick: (code: string, itemId: string) => void; className?: string }) {
  const [tab, setTab] = useState<"pending" | "fail" | "action">("pending");
  const rows = useMemo(() => {
    const byDeadline = [...AREAS].sort((a, b) => (deadlineInfo(data.period, a).days ?? 99) - (deadlineInfo(data.period, b).days ?? 99));
    if (tab === "action") {
      return data.actions
        .filter((x) => x.status !== "Tamamlandı")
        .slice(0, 30)
        .map((x) => ({ key: x.id, code: x.areaCode, itemId: x.itemId ?? areaByCode(x.areaCode)?.items[0].id ?? "", title: x.finding || x.action || "Aksiyon", tag: x.status, h: x.hospital, tone: x.priority === "Kritik" ? FAIL : "#ffa53d" }));
    }
    const out: { key: string; code: string; itemId: string; title: string; tag: string; h: Hospital; tone: string }[] = [];
    for (const a of byDeadline)
      for (const it of a.items)
        for (const h of ["bursa", "basaksehir"] as const) {
          const m = data.items[it.id]?.[h] ?? null;
          if (tab === "pending" && (m === null || m === "na")) out.push({ key: `${it.id}${h}`, code: a.code, itemId: it.id, title: it.text, tag: m === "na" ? "N/A" : "Bekliyor", h, tone: m === "na" ? "#9aa1b5" : "#ffa53d" });
          if (tab === "fail" && m === "fail") out.push({ key: `${it.id}${h}`, code: a.code, itemId: it.id, title: data.items[it.id]?.note || it.text, tag: "Bulgu", h, tone: FAIL });
        }
    return out.slice(0, 40);
  }, [data, tab]);

  return (
    <div className={`flex-col rounded-[22px] p-3 ${glass} ${className ?? ""}`}>
      <div className="mb-2 flex items-center gap-1">
        {(
          [
            ["pending", "Bekleyen"],
            ["fail", "Bulgular"],
            ["action", "Aksiyonlar"],
          ] as const
        ).map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)} className={`relative rounded-full px-3 py-1 text-[11px] font-extrabold ${tab === v ? "text-white" : "text-ink-3"}`}>
            {tab === v && <motion.span layoutId="queue-tab" className="absolute inset-0 rounded-full bg-[#2f5bd8]" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <span className="relative">{l}</span>
          </button>
        ))}
        <span className="ml-auto pr-1 text-[11px] font-bold text-ink-3">{rows.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
        {!rows.length && <div className="py-6 text-center text-xs font-semibold text-ink-3">{tab === "pending" ? "Bekleyen iş yok 🎉" : tab === "fail" ? "Bulgu yok" : "Açık aksiyon yok"}</div>}
        {rows.map((r) => (
          <button key={r.key} onClick={() => r.itemId && onPick(r.code, r.itemId)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/5">
            <span className="w-[52px] shrink-0 text-[11px] font-extrabold tabular-nums">{r.itemId || r.code}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{r.title}</span>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: HOSPITAL_COLOR[r.h] }} title={r.h === "bursa" ? "Bursa" : "Başakşehir"} />
            <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold" style={{ background: `color-mix(in srgb, ${r.tone} 18%, transparent)`, color: r.tone }}>
              {r.tag}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ kapanış akışı */
function FlowCard({ data, stats, onPick }: { data: PeriodData; stats: Record<string, BuildingStats>; onPick: (code: string) => void }) {
  const prog = overallProgress(data);
  const checked = prog.bursaDone + prog.basaksehirDone;
  const total = TOTAL_ITEMS * 2;
  const fails = Object.values(stats).reduce((s, x) => s + x.fails, 0);
  const failItems = AREAS.flatMap((a) => a.items).filter((it) => data.items[it.id]?.bursa === "fail" || data.items[it.id]?.basaksehir === "fail");
  const covered = failItems.filter((it) => data.actions.some((x) => x.itemId === it.id)).length;
  const steps = [
    { label: "Dönem açıldı", sub: periodLabel(data.period), done: true },
    { label: "Kontroller", sub: `${checked}/${total}`, done: checked === total, pct: checked / total },
    { label: "Bulgular aksiyonda", sub: fails ? `${covered}/${failItems.length}` : "bulgu yok", done: checked === total && covered === failItems.length, pct: failItems.length ? covered / failItems.length : 1 },
    { label: "Ön onay", sub: data.status === "Taslak" ? "bekliyor" : "tamam", done: data.status !== "Taslak" },
    { label: "Son onay", sub: data.status === "Son Onay" ? "tamam" : "bekliyor", done: data.status === "Son Onay" },
  ];
  const current = steps.findIndex((s) => !s.done);
  const next = [...AREAS]
    .map((a) => ({ a, d: deadlineInfo(data.period, a), s: stats[a.code] }))
    .filter((x) => x.s.bursa + x.s.basaksehir < x.s.n * 2)
    .sort((x, y) => (x.d.days ?? 99) - (y.d.days ?? 99))[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className={`absolute bottom-4 left-4 z-20 hidden w-[calc(100%-min(372px,40%)-3rem)] max-w-[760px] items-center gap-4 rounded-[22px] p-4 lg:flex ${glass}`}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-extrabold">
          <span className="grid h-6 w-6 place-items-center rounded-lg bg-[#2f5bd8] text-white">
            <Icon name="flag" size={13} />
          </span>
          Kapanış akışı
          <span className="ml-auto text-[11px] font-bold text-ink-3">%{Math.round((checked / total) * 100)} kontrol edildi</span>
        </div>
        <div className="flex items-start">
          {steps.map((s, i) => (
            <div key={s.label} className="relative flex flex-1 flex-col items-center text-center">
              {i > 0 && (
                <div className="absolute right-1/2 top-[13px] h-[3px] w-full -translate-y-1/2 overflow-hidden bg-black/10 dark:bg-white/10">
                  <motion.div className="h-full bg-[#2f5bd8]" initial={{ width: 0 }} animate={{ width: steps[i - 1].done ? "100%" : "0%" }} transition={{ duration: 0.6 }} />
                </div>
              )}
              <motion.div
                className={`relative z-10 grid h-[26px] w-[26px] place-items-center rounded-full text-[11px] font-extrabold ${
                  s.done ? "bg-[#2f5bd8] text-white" : i === current ? "border-2 border-[#2f5bd8] bg-white text-[#2f5bd8] dark:bg-[#1b1e27]" : "border-2 border-black/10 bg-white text-ink-3 dark:border-white/15 dark:bg-[#1b1e27]"
                }`}
                animate={i === current ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                transition={i === current ? { repeat: Infinity, duration: 1.8 } : {}}
              >
                {s.done ? "✓" : i + 1}
              </motion.div>
              <div className="mt-1.5 text-[11px] font-extrabold leading-tight">{s.label}</div>
              <div className="text-[10px] text-ink-3">{s.sub}</div>
            </div>
          ))}
        </div>
      </div>
      {next && (
        <button onClick={() => onPick(next.a.code)} className="hidden w-[200px] shrink-0 items-center gap-3 rounded-2xl xl:flex bg-black/[.035] p-3 text-left hover:bg-black/[.06] dark:bg-white/5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg" style={{ background: next.a.color }}>
            {next.a.emoji}
          </span>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Sıradaki bina</div>
            <div className="truncate text-[13px] font-extrabold">
              {next.a.code} · {next.a.title}
            </div>
            <div className="text-[11px] text-ink-3">
              {next.s.n * 2 - next.s.bursa - next.s.basaksehir} iş kaldı · {next.d.text}
            </div>
          </div>
        </button>
      )}
    </motion.div>
  );
}

function Legend() {
  const items = [
    { c: "#e2bd8e", t: "✓ Tamam (koliler)" },
    { c: FAIL, t: "✗ Bulgu (kırmızı sandık)" },
    { c: "#b9c2d1", t: "N/A (brandalı)" },
    { c: "#f5c443", t: "Boş yer = bekliyor" },
  ];
  return (
    <div className={`absolute bottom-[150px] left-4 z-20 hidden flex-col gap-1 rounded-2xl px-3 py-2 text-[10px] font-bold text-ink-2 xl:flex ${glass}`}>
      {items.map((x) => (
        <span key={x.t} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: x.c }} />
          {x.t}
        </span>
      ))}
      <span className="mt-0.5 flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: HOSPITAL_COLOR.bursa }} /> Sol palet: Bursa
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: HOSPITAL_COLOR.basaksehir }} /> Sağ palet: Başakşehir
      </span>
    </div>
  );
}
