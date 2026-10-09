"use client";

import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionEditor, type ActionDraft } from "@/components/ActionEditor";
import { Celebration } from "@/components/Celebration";
import { ItemCard } from "@/components/ItemCard";
import { PenGlyph, useNotes } from "@/components/notes/NotesPanel";
import { useAssistant } from "@/components/assistant/AssistantPanel";
import { usePeriod, type Focus } from "@/components/PeriodProvider";
import { Bar, Chip, Icon, Ring, Segmented } from "@/components/ui";
import { AnimatedNumber } from "@/components/fx";
import { TiltCard } from "@/components/TiltCard";
import { hoverLift, itemVariants, listVariants, spring, tapPress } from "@/lib/motion";
import { AREAS, TOTAL_ITEMS, areaByCode, tintOf, type Area } from "@/lib/checklist";
import { areaProgress, deadlineInfo, defaultPeriod, MONTHS_SHORT, overallProgress, periodLabel, toPeriod } from "@/lib/period";
import type { PeriodData } from "@/lib/types";

type Filter = "all" | "priority" | "pending" | "fail";

/** 3B kampüs yalnızca gerektiğinde (tablet/masaüstü) indirilir. */
const WorldView = dynamic(() => import("@/components/world/WorldView"), {
  ssr: false,
  loading: () => (
    <div className="clay grid h-[calc(100dvh-15rem)] min-h-[560px] place-items-center rounded-[30px] lg:h-[calc(100dvh-8.5rem)] lg:min-h-[620px]">
      <div className="flex flex-col items-center gap-3 text-sm font-bold text-ink-3">
        <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="inline-block h-8 w-8 rounded-full border-[3px] border-blue border-t-transparent" />
        Kampüs kuruluyor…
      </div>
    </div>
  ),
});

const VIEW_KEY = "lq:audit-view";
/** Görünüm tercihi (Dünya / Liste) ve ekranın tablet+ olup olmadığı. */
function useAuditView(): ["world" | "list", (m: "world" | "list") => void, boolean] {
  const [mode, setModeState] = useState<"world" | "list">("world");
  const [wide, setWide] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "list") setModeState("list");
    } catch {}
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const setMode = (m: "world" | "list") => {
    setModeState(m);
    try {
      localStorage.setItem(VIEW_KEY, m);
    } catch {}
  };
  return [mode, setMode, wide];
}

function ViewToggle({ mode, onChange }: { mode: "world" | "list"; onChange: (m: "world" | "list") => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="clay-pressed flex rounded-full p-1">
        {(
          [
            ["world", "🏙️ Kampüs"],
            ["list", "☰ Liste"],
          ] as const
        ).map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)} className={`relative rounded-full px-4 py-2 text-sm font-bold ${mode === v ? "text-white" : "text-ink-2"}`}>
            {mode === v && <motion.span layoutId="audit-view" className="absolute inset-0 rounded-full bg-blue" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <span className="relative">{l}</span>
          </button>
        ))}
      </div>
      {mode === "world" && <span className="hidden text-xs font-semibold text-ink-3 md:inline">Sürükle: döndür · Sağ tık/iki parmak: kaydır · Tekerlek/çimdik: yakınlaştır · Binaya tıkla</span>}
    </div>
  );
}

export default function DenetimPage() {
  const { data } = usePeriod();
  if (!data) return <StartScreen />;
  return <Audit data={data} />;
}

/* ------------------------------------------------------------------ Başlangıç */
function StartScreen() {
  const { openPeriod, summaries } = usePeriod();
  const p = defaultPeriod();
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-6">
      <MonthStrip current={null} />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="clay-color relative overflow-hidden p-6 text-white sm:p-8" style={{ background: "linear-gradient(135deg,#6d8bff,#4361ee)" }}>
        <HeroArt />
        <div className="relative max-w-md">
          <div className="text-sm font-bold uppercase tracking-wider text-white/70">Aylık kapanış</div>
          <div className="mt-1 text-3xl font-extrabold leading-tight sm:text-4xl">{periodLabel(p)} kontrolüne başla</div>
          <p className="mt-3 text-white/85">
            10 rapor alanı, 48 madde, 2 hastane. Büyük işaretlerle tikle, notunu yaz; Excel formun hazır olsun.
          </p>
          <motion.button
            whileTap={{ scale: 0.96 }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await openPeriod(p).finally(() => setBusy(false));
            }}
            className="clay-dark mt-6 flex items-center gap-3 rounded-full px-6 py-4 text-lg font-extrabold"
          >
            <Icon name="play" size={20} />
            {busy ? "Başlatılıyor…" : `${periodLabel(p)} dönemini başlat`}
          </motion.button>
          {summaries.length > 0 && <div className="mt-3 text-sm text-white/75">ya da üstten başka bir dönem seç</div>}
        </div>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ Ay şeridi */
function MonthStrip({ current }: { current: string | null }) {
  const { openPeriod, summaries, activePeriod } = usePeriod();
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => toPeriod(new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ left: ref.current.scrollWidth });
  }, []);
  return (
    <div ref={ref} className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 py-2 sm:mx-0 sm:px-0">
      {months.map((p) => {
        const sel = p === current;
        const exists = summaries.some((s) => s.period === p);
        const [y, m] = p.split("-").map(Number);
        return (
          <motion.button
            key={p}
            whileTap={{ scale: 0.92 }}
            onClick={() => openPeriod(p)}
            whileHover={{ y: -3 }}
            className={`clay-sm relative flex min-w-[68px] flex-1 flex-col items-center rounded-[22px] px-3 py-3 ${sel ? "text-white" : ""}`}
          >
            {sel && (
              <motion.span
                layoutId="month-pill"
                className="clay-color absolute inset-0 rounded-[22px] bg-blue"
                transition={spring.stiff}
              />
            )}
            <span className={`relative text-sm font-semibold ${sel ? "text-white/80" : "text-ink-3"}`}>{MONTHS_SHORT[m - 1]}</span>
            <span className="relative text-xl font-extrabold">{String(y).slice(2)}</span>
            {(exists || p === activePeriod) && (
              <span className={`absolute bottom-1.5 h-1.5 w-1.5 rounded-full ${p === activePeriod ? (sel ? "bg-white" : "bg-ok") : sel ? "bg-white/60" : "bg-blue"}`} />
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

function HeroArt() {
  return (
    <svg className="pointer-events-none absolute -right-6 bottom-0 h-24 opacity-60 sm:h-[85%] sm:max-h-56 sm:opacity-95" viewBox="0 0 260 180" fill="none">
      <defs>
        <radialGradient id="sun" cx="35%" cy="30%">
          <stop offset="0" stopColor="#ffd07a" />
          <stop offset="1" stopColor="#ff9f2e" />
        </radialGradient>
        <linearGradient id="m1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5fd38b" />
          <stop offset="1" stopColor="#1f9a57" />
        </linearGradient>
        <linearGradient id="m2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8be3a8" />
          <stop offset="1" stopColor="#34b56f" />
        </linearGradient>
      </defs>
      <circle cx="120" cy="52" r="30" fill="url(#sun)" />
      <path d="M60 180 150 60l40 50 25-25 55 95z" fill="url(#m1)" />
      <path d="M150 60l18 24-10 6-8-8-12 10-6-8z" fill="#fff" opacity=".9" />
      <path d="M0 180c40-60 80-70 120-40s70 40 140 40z" fill="url(#m2)" />
    </svg>
  );
}

/* ------------------------------------------------------------------ Denetim */
function Audit({ data }: { data: PeriodData }) {
  const { focus, setFocus, exportExcel } = usePeriod();
  const [filter, setFilter] = useState<Filter>("all");
  const [areaCode, setAreaCode] = useState<string | null>(null);
  const [actionDraft, setActionDraft] = useState<ActionDraft | null>(null);
  const [celebrate, setCelebrate] = useState<Area | null>(null);
  const [fullDone, setFullDone] = useState(false);
  const prog = overallProgress(data);
  const [mode, setMode, wide] = useAuditView();

  // URL ?alan= ile geri tuşu desteği
  useEffect(() => {
    const read = () => setAreaCode(new URLSearchParams(window.location.search).get("alan"));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const openArea = useCallback((code: string | null) => {
    setAreaCode(code);
    const url = code ? `/denetim?alan=${code}` : "/denetim";
    if (code && !new URLSearchParams(window.location.search).get("alan")) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
    if (code && window.innerWidth < 1024) window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // alan tamamlandığında kutlama
  const completeRef = useRef<{ period: string; set: Set<string> } | null>(null);
  useEffect(() => {
    const set = new Set(AREAS.filter((a) => areaProgress(data, a).both === a.items.length).map((a) => a.code));
    const prev = completeRef.current;
    if (prev && prev.period === data.period) {
      const newly = [...set].find((c) => !prev.set.has(c));
      if (newly) {
        setFullDone(set.size === AREAS.length);
        setCelebrate(areaByCode(newly)!);
      }
    }
    completeRef.current = { period: data.period, set };
  }, [data]);

  const visibleAreas = useMemo(
    () =>
      AREAS.filter((a) => {
        const p = areaProgress(data, a);
        if (filter === "priority") return a.priority;
        if (filter === "pending") return p.both < a.items.length;
        if (filter === "fail") return p.fails > 0;
        return true;
      }),
    [data, filter],
  );

  const nextDeadline = useMemo(() => {
    return AREAS.map((a) => ({ a, d: deadlineInfo(data.period, a), p: areaProgress(data, a) }))
      .filter((x) => x.d.days != null && x.p.both < x.a.items.length)
      .sort((x, y) => x.d.days! - y.d.days!)[0];
  }, [data]);

  const area = areaCode ? areaByCode(areaCode) ?? null : null;
  // 3B dünya: yalnızca tablet/masaüstü. Dünyada "alan açmak" = kamerayı o binaya uçurmak (liste açılmaz).
  const world = wide && mode === "world";
  const [worldFocus, setWorldFocus] = useState<{ code: string | null; n: number }>({ code: null, n: 0 });
  const focusWorld = (code: string | null) => setWorldFocus((f) => ({ code, n: f.n + 1 }));
  // dünyadayken URL'de ?alan= varsa (geri tuşu / bağlantı) o binaya uç ve URL'yi temizle
  useEffect(() => {
    if (world && areaCode) {
      focusWorld(areaCode);
      openArea(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, areaCode]);

  const nextIncomplete = (after?: string) => {
    const idx = after ? AREAS.findIndex((a) => a.code === after) : -1;
    const ordered = [...AREAS.slice(idx + 1), ...AREAS.slice(0, idx + 1)];
    return ordered.find((a) => areaProgress(data, a).both < a.items.length);
  };

  return (
    <div className="space-y-5">
      {wide && (
        <ViewToggle
          mode={mode}
          onChange={(m) => {
            setMode(m);
            if (m === "world") openArea(null);
          }}
        />
      )}
      {world ? (
        <WorldView
          data={data}
          onAddAction={(d) => setActionDraft(d)}
          focusRequest={worldFocus}
          celebration={celebrate ? { area: celebrate, full: fullDone } : null}
          onCelebrationClose={() => setCelebrate(null)}
          onCelebrationNext={() => {
            const done = celebrate?.code;
            setCelebrate(null);
            const n = nextIncomplete(done);
            focusWorld(n ? n.code : null);
          }}
        />
      ) : (
      <>
      <div className={`space-y-5 ${area ? "hidden lg:block" : ""}`}>
      <MonthStrip current={data.period} />

      {/* Hero */}
      <TiltCard
        key={data.period}
        className="clay-color relative overflow-hidden p-5 text-white sm:p-7"
        style={{ background: "linear-gradient(135deg,#6d8bff 0%,#4361ee 100%)" }}
      >
        <HeroArt />
        <div className="relative flex items-center gap-5">
          <Ring value={prog.overall} size={92} stroke={10} color="#fff" track="rgba(255,255,255,.22)">
            <div className="text-center leading-none">
              <AnimatedNumber value={Math.round(prog.overall * 100)} className="text-2xl font-extrabold" />
              <div className="text-[10px] font-bold text-white/70">%</div>
            </div>
          </Ring>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wider text-white/70">{data.status} · {data.version}</div>
            <div className="text-2xl font-extrabold leading-tight sm:text-3xl">{periodLabel(data.period)} Kapanışı</div>
            <div className="mt-1 text-sm text-white/85">
              {prog.remaining === 0 ? "Tüm maddeler tamamlandı 🎉" : `${prog.remaining} kontrol kaldı · ${prog.fails} bulgu (✗)`}
            </div>
          </div>
        </div>
        <div className="relative mt-5 grid max-w-md grid-cols-2 gap-3">
          {[
            { l: "Bursa", v: prog.bursa, n: prog.bursaDone },
            { l: "Başakşehir", v: prog.basaksehir, n: prog.basaksehirDone },
          ].map((x) => (
            <div key={x.l} className="glass-on-color rounded-2xl px-3 py-2.5">
              <div className="flex justify-between text-xs font-bold">
                <span>{x.l}</span>
                <span>
                  {x.n}/{TOTAL_ITEMS}
                </span>
              </div>
              <div className="mt-1.5">
                <Bar value={x.v} color="#fff" height={7} />
              </div>
            </div>
          ))}
        </div>
        {nextDeadline && (
          <button
            onClick={() => openArea(nextDeadline.a.code)}
            className="relative mt-4 flex max-w-md items-center gap-2 glass-on-color rounded-full py-2 pl-3 pr-2 text-left text-sm font-bold text-white"
          >
            <span>{nextDeadline.a.emoji}</span>
            <span className="min-w-0 flex-1 truncate">
              Sıradaki termin: {nextDeadline.a.code} · {nextDeadline.d.dateText}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs text-white ${nextDeadline.d.days! < 0 ? "bg-fail" : nextDeadline.d.days! <= 2 ? "bg-warn" : "bg-ok"}`}>
              {nextDeadline.d.text}
            </span>
          </button>
        )}
      </TiltCard>

      {/* Hastane odağı + filtreler */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="md:w-[380px]">
          <Segmented<Focus>
            value={focus}
            onChange={setFocus}
            options={[
              { value: "both", label: "İki hastane" },
              { value: "bursa", label: "Bursa" },
              { value: "basaksehir", label: "Başakşehir" },
            ]}
          />
        </div>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-2 md:mx-0 md:px-1">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>Tümü</Chip>
          <Chip active={filter === "priority"} onClick={() => setFilter("priority")}>🔥 Öncelikli</Chip>
          <Chip active={filter === "pending"} onClick={() => setFilter("pending")}>⏳ Eksikler</Chip>
          <Chip active={filter === "fail"} onClick={() => setFilter("fail")}>⚠️ Sorunlu</Chip>
        </div>
      </div>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] lg:items-start lg:gap-6">
        {/* Alan listesi */}
        <div className={`${area ? "hidden lg:block" : ""} lg:sticky lg:top-6`}>
          <motion.div
            key={`${filter}-${data.period}`}
            variants={listVariants}
            initial="hidden"
            animate="show"
            className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)]"
          >
            <AnimatePresence mode="popLayout">
              {visibleAreas.map((a, i) => (
                <AreaCard key={a.code} area={a} data={data} index={i} selected={a.code === areaCode} onClick={() => openArea(a.code)} />
              ))}
            </AnimatePresence>
            {visibleAreas.length === 0 && <div className="clay p-6 text-center text-ink-3">Bu filtrede alan yok 🎉</div>}
          </motion.div>
        </div>

        {/* Alan detayı */}
        <div className={area ? "" : "hidden lg:block"}>
          <AnimatePresence mode="wait">
            {area ? (
              <AreaDetail
                key={area.code}
                area={area}
                data={data}
                onBack={() => openArea(null)}
                onAddAction={(d) => setActionDraft(d)}
                onNext={() => {
                  const n = nextIncomplete(area.code);
                  if (n) openArea(n.code);
                }}
              />
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="clay grid place-items-center px-6 py-20 text-center">
                <div className="text-6xl">👈</div>
                <div className="mt-3 text-xl font-extrabold">Bir rapor alanı seç</div>
                <p className="mt-1 text-ink-2">Maddeleri iki hastane için tikle, sorunları not et.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      </>
      )}

      {/* Excel FAB */}
      {!world && (
      <motion.button
        initial={{ scale: 0, rotate: -30, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ ...spring.wobbly, delay: 0.35 }}
        whileTap={{ scale: 0.9 }}
        whileHover={{ y: -4, scale: 1.03 }}
        onClick={() => exportExcel()}
        className="clay-dark fixed bottom-28 right-5 z-30 flex h-16 items-center gap-2 rounded-full px-5 font-extrabold lg:bottom-8 lg:right-8"
        aria-label="Excel indir"
      >
        <Icon name="download" size={24} />
        <span className="hidden sm:inline">Excel çıktısı</span>
      </motion.button>
      )}

      <ActionEditor open={!!actionDraft} draft={actionDraft ?? undefined} onClose={() => setActionDraft(null)} />
      {/* kampüste kutlama sahnenin içinde (WorldView); burada yalnızca liste görünümü için */}
      <Celebration
        area={world ? null : celebrate}
        full={fullDone}
        data={data}
        onClose={() => setCelebrate(null)}
        onNext={() => {
          const done = celebrate?.code;
          setCelebrate(null);
          const n = nextIncomplete(done);
          if (world) focusWorld(n ? n.code : null);
          else openArea(n ? n.code : null);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ Alan kartı */
function AreaCard({ area, data, index, selected, onClick }: { area: Area; data: PeriodData; index: number; selected: boolean; onClick: () => void }) {
  const p = areaProgress(data, area);
  const dl = deadlineInfo(data.period, area);
  const complete = p.both === p.total;
  const dlColor = complete ? "bg-ok" : dl.days == null ? "bg-na" : dl.days < 0 ? "bg-fail" : dl.days <= 2 ? "bg-warn" : "bg-ink-3/60";
  return (
    <motion.button
      layout
      variants={itemVariants}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.18 } }}
      whileTap={tapPress}
      whileHover={hoverLift}
      data-index={index}
      onClick={onClick}
      className={`relative flex w-full items-center gap-4 p-4 text-left ${selected ? "clay-pressed rounded-[28px]" : "clay"}`}
    >
      <div
        className="clay-color grid h-14 w-14 shrink-0 place-items-center text-[28px]"
        style={{ background: `linear-gradient(145deg, ${tintOf(area.color)}, ${area.color}55)`, borderRadius: 20, ["--glow" as string]: area.color + "55" }}
      >
        {area.emoji}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-extrabold" style={{ color: area.color }}>
            {area.code}
          </span>
          {area.priority && <span title="Öncelikli alan" className="text-xs">🔥</span>}
          {p.fails > 0 && <span className="rounded-full bg-tint-fail px-1.5 text-[10px] font-extrabold text-fail">{p.fails} bulgu</span>}
        </div>
        <div className="line-clamp-2 font-extrabold leading-tight">{area.title}</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[
            { l: "BRS", v: p.bursa },
            { l: "BŞK", v: p.basaksehir },
          ].map((x) => (
            <div key={x.l} className="flex items-center gap-1.5">
              <span className="w-7 text-[10px] font-bold text-ink-3">{x.l}</span>
              <Bar value={x.v / p.total} color={x.v === p.total ? "var(--color-ok)" : area.color} height={6} />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5 self-start">
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-extrabold text-white ${dlColor}`}>
          {complete ? "Tamam" : dl.text}
        </span>
        {complete && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="grid h-7 w-7 place-items-center rounded-full bg-ok text-white shadow-md">
            <Icon name="check" size={16} stroke={3} />
          </motion.span>
        )}
      </div>
    </motion.button>
  );
}

/* ------------------------------------------------------------------ Alan detayı */
function AreaDetail({
  area,
  data,
  onBack,
  onAddAction,
  onNext,
}: {
  area: Area;
  data: PeriodData;
  onBack: () => void;
  onAddAction: (d: ActionDraft) => void;
  onNext: () => void;
}) {
  const { update, focus } = usePeriod();
  const { openNotes } = useNotes();
  const { ask: askAssistant } = useAssistant();
  const p = areaProgress(data, area);
  const dl = deadlineInfo(data.period, area);
  const [info, setInfo] = useState(false);

  const markAll = () => {
    if (!confirm("Bu alandaki boş maddeler 'Tamam' olarak işaretlensin mi?")) return;
    const hs = focus === "both" ? (["bursa", "basaksehir"] as const) : ([focus] as const);
    update((d) => {
      const items = { ...d.items };
      for (const it of area.items) {
        const s = { ...items[it.id] };
        for (const h of hs) if (s[h] === null) s[h] = "ok";
        items[it.id] = s;
      }
      return { ...d, items };
    });
  };

  return (
    <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ type: "spring", stiffness: 300, damping: 30 }} className="space-y-4">
      <div className="clay-color relative overflow-hidden p-5 sm:p-6" style={{ background: `linear-gradient(140deg, ${tintOf(area.color)} 0%, ${area.color}66 100%)`, ["--glow" as string]: area.color + "55" }}>
        <div className="pointer-events-none absolute -right-4 -top-6 select-none text-[120px] opacity-30">{area.emoji}</div>
        <div className="relative flex items-center gap-3">
          <button onClick={onBack} className="clay-sm grid h-11 w-11 place-items-center rounded-full lg:hidden" aria-label="Geri">
            <Icon name="back" size={20} />
          </button>
          <span className="rounded-full glass-chip px-3 py-1 text-sm font-extrabold" style={{ color: area.color }}>
            ● {area.code}
          </span>
          {area.priority && <span className="rounded-full glass-chip px-3 py-1 text-sm font-bold text-fail">🔥 Öncelikli</span>}
          <button onClick={() => setInfo((s) => !s)} className="clay-sm ml-auto grid h-11 w-11 place-items-center rounded-full" aria-label="Alan bilgisi">
            <Icon name="info" size={20} />
          </button>
        </div>
        <h2 className="relative mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">{area.title}</h2>
        <p className="relative mt-1 max-w-xl text-sm text-ink-2">{area.content}</p>
        <div className="relative mt-4 flex flex-wrap gap-2 text-sm">
          <span className="flex items-center gap-1.5 rounded-full glass-chip px-3 py-1.5 font-bold">
            <Icon name="calendar" size={16} /> {area.deadlineLabel}
            {dl.dateText && <span className="text-ink-3">· {dl.dateText}</span>}
          </span>
          {dl.days != null && p.both < p.total && (
            <span className={`rounded-full px-3 py-1.5 font-bold text-white ${dl.days < 0 ? "bg-fail" : dl.days <= 2 ? "bg-warn" : "bg-ok"}`}>{dl.text}</span>
          )}
          <span className="rounded-full glass-chip px-3 py-1.5 font-bold">
            BRS {p.bursa}/{p.total} · BŞK {p.basaksehir}/{p.total}
          </span>
        </div>
        <AnimatePresence>
          {info && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="relative overflow-hidden">
              <div className="mt-4 grid gap-2 rounded-2xl glass-chip p-4 text-sm sm:grid-cols-2">
                <div><b>Hazırlayan:</b> {area.preparer}</div>
                <div><b>Kontrol:</b> {area.control}</div>
                <div><b>Ön onay:</b> {area.preApproval}</div>
                <div><b>Son onay:</b> {area.finalApproval}</div>
                <div className="sm:col-span-2"><b>Kime:</b> {area.people.join(", ")}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {area.items.map((it, i) => (
        <ItemCard
          key={it.id}
          area={area}
          item={it}
          index={i}
          state={data.items[it.id]}
          actionCount={data.actions.filter((a) => a.itemId === it.id).length}
          onAddAction={() => onAddAction({ areaCode: area.code, itemId: it.id, hospital: focus === "both" ? undefined : focus })}
        />
      ))}

      <div className="flex flex-wrap gap-3 pt-1">
        <button
          onClick={() => askAssistant(`${area.code} ${area.title} alanının iki hastane için güncel durumunu, ✗ bulguları, N/A/boş kalan maddeleri ve anomali notlarını özetle; kime ne sormalıyım?`)}
          className="clay-sm flex items-center gap-2 rounded-full px-5 py-3 font-bold text-ink-2"
        >
          ✨ Asistana sor
        </button>
        <button onClick={() => openNotes({ areaCode: area.code })} className="clay-sm flex items-center gap-2 rounded-full px-5 py-3 font-bold text-ink-2">
          <PenGlyph /> {area.code} için not al
        </button>
        <button onClick={markAll} className="clay-sm flex items-center gap-2 rounded-full px-5 py-3 font-bold text-ink-2">
          <Icon name="check" size={18} /> Boşları tamam işaretle
        </button>
        <button onClick={onNext} className="clay-dark flex items-center gap-2 rounded-full px-5 py-3 font-bold">
          Sonraki alan <Icon name="chevron" size={18} />
        </button>
      </div>
    </motion.div>
  );
}
