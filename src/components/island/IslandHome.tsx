"use client";

import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAssistant } from "@/components/assistant/AssistantPanel";
import { useGoogle } from "@/components/google/GoogleProvider";
import { NotificationBell } from "@/components/Notifications";
import { usePeriod } from "@/components/PeriodProvider";
import { Icon } from "@/components/ui";
import { AnimatedNumber } from "@/components/fx";
import type { BrainState } from "@/lib/brain-types";
import { AREAS } from "@/lib/checklist";
import { areaProgress, deadlineInfo, overallProgress } from "@/lib/period";
import { DEFAULT_PLACE, TR_DAYS, TR_DAYS_SHORT, TR_MONTHS, fetchForecast, geocode, sampleForecast, wmo, type Forecast, type WxKind, type WxPlace } from "@/lib/weather";
import { TONE, type BuildingInfo } from "./Buildings";
import { DEFAULT_VIEW, computeEnv, seasonOf, type Env, type Quality, type Season, type ViewSettings } from "./env";
import { Ambience } from "./sound";
import { vtNavigate } from "@/lib/vt";
import { SPOTS, type BuildingId } from "./terrain";
import { WxIcon } from "./WxIcon";

const IslandScene = dynamic(() => import("./Scene"), { ssr: false });

const ROUTES: Record<BuildingId, string> = {
  denetim: "/denetim",
  beyin: "/gorevler",
  google: "/google",
  analiz: "/analiz",
  aksiyonlar: "/aksiyonlar",
  gecmis: "/gecmis",
};

const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

const hourOf = (s: string) => {
  const m = s.match(/T(\d\d):(\d\d)/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : 12;
};
const hm = (d: Date) => d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

/* ------------------------------------------------------------------ veriler */
function useForecast(place: WxPlace) {
  const [fc, setFc] = useState<Forecast | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    const load = () =>
      fetchForecast(place, ac.signal)
        .then(setFc)
        .catch((e) => {
          if ((e as Error).name !== "AbortError") setFc((cur) => cur ?? sampleForecast(place));
        });
    load();
    const t = setInterval(load, 15 * 60_000);
    return () => {
      ac.abort();
      clearInterval(t);
    };
  }, [place]);
  return fc;
}

function useBrainSummary() {
  const [st, setSt] = useState<BrainState | null>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/brain", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j && setSt(j))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  return st;
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/* ------------------------------------------------------------------ ana bileşen */
export default function IslandHome() {
  const router = useRouter();
  const { toggle: toggleAssistant } = useAssistant();
  const { data, summaries } = usePeriod();
  const { status: google } = useGoogle();
  const brain = useBrainSummary();
  const now = useNow();

  const [place, setPlace] = useState<WxPlace>(DEFAULT_PLACE);
  const [view, setView] = useState<ViewSettings>(DEFAULT_VIEW);
  const [sound, setSound] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setPlace(store.get("lq:wx-place", DEFAULT_PLACE));
    setView({ ...DEFAULT_VIEW, ...store.get<Partial<ViewSettings>>("lq:island-view", {}) });
    setReady(true);
  }, []);
  const fc = useForecast(place);

  const [day, setDay] = useState<number | null>(null);
  const [panel, setPanel] = useState<"settings" | "menu" | null>(null);
  const [hover, setHover] = useState<BuildingId | null>(null);
  const [fly, setFly] = useState<BuildingId | null>(null);
  const labels = useRef<Partial<Record<BuildingId, HTMLElement | null>>>({});

  const quality: Quality = useMemo(() => {
    if (view.quality !== "auto") return view.quality;
    if (typeof window === "undefined") return "mid";
    return window.innerWidth >= 1100 && window.devicePixelRatio <= 2 ? "high" : "mid";
  }, [view.quality]);

  // ------------------------------------------------ ortam (saat + hava + mevsim)
  const today = fc?.days[0];
  const preview = day != null && day > 0 ? fc?.days[day] : undefined;
  const liveKind: WxKind = preview ? wmo(preview.code).kind : fc ? wmo(fc.current.code).kind : "partly";
  const kind: WxKind = view.wx === "live" ? liveKind : view.wx;
  const season: Season = view.season === "live" ? seasonOf(now) : view.season;
  const sunrise = today ? hourOf(today.sunrise) : 7;
  const sunset = today ? hourOf(today.sunset) : 18.5;
  const liveHour = now.getHours() + now.getMinutes() / 60;
  const hour = view.tod === "live" ? liveHour : view.tod === "morning" ? sunrise + 1.2 : view.tod === "day" ? 13 : view.tod === "evening" ? sunset - 0.15 : 23;
  const windKmh = preview ? preview.windMax : (fc?.current.wind ?? 8);
  const envTarget = useRef<Env>(computeEnv({ hour, sunrise, sunset, kind, season, windKmh }));
  useEffect(() => {
    envTarget.current = computeEnv({ hour, sunrise, sunset, kind, season, windKmh });
  }, [hour, sunrise, sunset, kind, season, windKmh]);
  const night = envTarget.current.night > 0.55 || (kind === "storm" && envTarget.current.night > 0.2);

  // ------------------------------------------------ ses
  const amb = useRef<Ambience | null>(null);
  useEffect(() => {
    if (!sound) {
      amb.current?.stop();
      amb.current = null;
      return;
    }
    if (!amb.current) {
      amb.current = new Ambience();
      amb.current.start();
    }
  }, [sound]);
  useEffect(() => {
    amb.current?.set({ rain: envTarget.current.rain, wind: envTarget.current.wind, day: envTarget.current.night < 0.5 });
  }, [kind, hour, windKmh, sound]);
  useEffect(() => () => amb.current?.stop(), []);

  // ------------------------------------------------ binalar (canlı rozetler)
  const info = useMemo<Record<BuildingId, BuildingInfo>>(() => {
    const prog = data ? overallProgress(data) : null;
    const overdue = data ? AREAS.filter((a) => {
      const d = deadlineInfo(data.period, a);
      const p = areaProgress(data, a);
      return d.days != null && d.days < 0 && p.both < p.total;
    }).length : 0;
    const openActions = data ? data.actions.filter((a) => a.status !== "Tamamlandı").length : 0;
    const items = brain?.items ?? [];
    const inbox = items.filter((x) => x.status === "inbox").length;
    const waitingOk = items.filter((x) => x.work?.status === "waiting_ok").length;
    const unread = google?.snapshot?.gmail.unread ?? 0;
    return {
      denetim: { name: "Denetim", sub: overdue ? `${overdue} alan gecikti — kontrol listesine git` : "Kapanış kontrol listesi", badge: prog ? `%${Math.round(prog.overall * 100)}` : undefined, tone: overdue ? "alert" : prog && prog.overall >= 1 ? "ok" : "info", color: "#e0663d" },
      beyin: { name: "Beyin", sub: "Ajanlar, öneriler ve görevlerin", badge: waitingOk ? `${waitingOk} onay` : inbox ? `${inbox} öneri` : undefined, tone: waitingOk ? "warn" : "info", color: "#8b5cf6", busy: !!brain?.running || items.some((x) => x.work?.status === "running") },
      google: { name: "Google ofis", sub: "Gmail, takvim, sohbet ve Drive", badge: unread ? `${unread} okunmamış` : undefined, tone: "info", color: "#4f7fbf" },
      analiz: { name: "Analiz", sub: "Alanlar, bulgular, terminler", badge: prog?.fails ? `${prog.fails} bulgu` : undefined, tone: "warn", color: "#e9a23b" },
      aksiyonlar: { name: "Aksiyonlar", sub: "Bulgu → sorumlu → çözüm", badge: openActions ? `${openActions} açık` : undefined, tone: openActions ? "warn" : "ok", color: "#e05a4f" },
      gecmis: { name: "Geçmiş", sub: "Önceki dönemler ve arşiv", badge: summaries.length ? `${summaries.length} dönem` : undefined, color: "#b98257" },
    };
  }, [data, brain, google, summaries]);

  useEffect(() => {
    Object.values(ROUTES).forEach((r) => router.prefetch(r));
  }, [router]);
  const pick = useCallback((id: BuildingId) => setFly((f) => f ?? id), []);
  // kamera binaya varınca: sayfa ekran ortasından dairesel kapı gibi açılır
  const arrive = useCallback(
    (id: BuildingId) => {
      const s = document.documentElement.style;
      s.setProperty("--portal-x", "50%");
      s.setProperty("--portal-y", "48%");
      vtNavigate((h) => router.push(h), ROUTES[id], "portal");
    },
    [router],
  );

  // ------------------------------------------------ görünüm metinleri
  const shown = preview
    ? { temp: Math.round(preview.max), label: wmo(preview.code).label, max: preview.max, min: preview.min, wind: preview.windMax, rain: preview.rain, hum: null as number | null }
    : fc
      ? { temp: Math.round(fc.current.temp), label: wmo(fc.current.code).label, max: today?.max ?? fc.current.temp, min: today?.min ?? fc.current.temp, wind: fc.current.wind, rain: fc.current.rain, hum: fc.current.humidity }
      : null;
  const dateLine = preview
    ? `GÜN ÖNİZLEMESİ · ${TR_DAYS[new Date(preview.date).getDay()].toLocaleUpperCase("tr")}, ${new Date(preview.date).getDate()} ${TR_MONTHS[new Date(preview.date).getMonth()].toLocaleUpperCase("tr")}`
    : `${TR_DAYS[now.getDay()].toLocaleUpperCase("tr")}, ${now.getDate()} ${TR_MONTHS[now.getMonth()].toLocaleUpperCase("tr")}`;
  const ink = night ? "text-white" : "text-[#1d2433]";
  const sub = night ? "text-white/70" : "text-[#1d2433]/60";
  const tile = night ? "border-white/15 bg-white/10" : "border-white/60 bg-white/45";

  const saveView = (v: ViewSettings) => {
    setView(v);
    store.set("lq:island-view", v);
  };

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: night ? "#13224f" : "#dfeaf1" }}>
      {ready && (
        <motion.div className="absolute inset-0" initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}>
          <IslandScene env={envTarget} season={season} quality={quality} info={info} hover={hover} onHover={setHover} onPick={pick} fly={fly} onArrive={arrive} labels={labels} />
        </motion.div>
      )}

      {/* bina etiketleri (sahne her karede konumlar) */}
      <motion.div className="pointer-events-none absolute inset-0 isolate overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: fly ? 0 : 1 }} transition={{ delay: fly ? 0 : 1.5, duration: 0.5 }}>
        {SPOTS.map((sp) => {
          const b = info[sp.id];
          const on = hover === sp.id;
          return (
            <div key={sp.id} ref={(el) => void (labels.current[sp.id] = el)} className="absolute left-0 top-0 opacity-0 transition-opacity duration-300" style={{ willChange: "transform" }}>
              <button
                onPointerEnter={() => setHover(sp.id)}
                onPointerLeave={() => setHover(null)}
                onClick={() => pick(sp.id)}
                className={`pointer-events-auto flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/70 bg-white/85 py-1 pl-1.5 pr-2.5 text-[11px] font-bold sm:gap-2 sm:py-1.5 sm:pl-2 sm:pr-3 sm:text-[13px] text-[#1f2330] shadow-[0_8px_24px_-8px_rgba(20,30,60,.35)] backdrop-blur-md transition-transform duration-200 ${on ? "scale-110" : ""}`}
              >
                <span className="grid h-5 w-5 place-items-center rounded-full" style={{ background: `${b.color}26` }}>
                  <span className={`h-2 w-2 rounded-full ${b.busy ? "animate-pulse" : ""}`} style={{ background: b.color }} />
                </span>
                {b.name}
                {b.badge && (
                  <span className="hidden rounded-full px-1.5 py-0.5 text-[11px] font-extrabold tabular-nums sm:inline" style={{ color: b.tone ? TONE[b.tone] : "#5b6170", background: b.tone ? `${TONE[b.tone]}1a` : "rgba(0,0,0,.05)" }}>
                    {b.badge}
                  </span>
                )}
              </button>
              <div className={`mx-auto mt-1.5 w-max max-w-[220px] rounded-xl bg-[#1f2330]/85 px-2.5 py-1 text-center text-[11px] font-semibold text-white backdrop-blur transition-opacity ${on ? "opacity-100" : "opacity-0"}`}>{b.sub} →</div>
            </div>
          );
        })}
      </motion.div>

      {/* -------------------------------------------- sol üst: marka + hava */}
      <div className="pointer-events-none absolute inset-0">
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: 0.2 }} className={`absolute left-5 top-5 flex items-center gap-3 sm:left-8 sm:top-7 ${ink}`}>
          <button onClick={() => setPanel((p) => (p === "menu" ? null : "menu"))} className={`pointer-events-auto grid h-9 w-9 place-items-center rounded-full border backdrop-blur-md ${tile}`} aria-label="Bölümler">
            <Icon name="sidebar" size={16} />
          </button>
          <div className="hidden text-[13px] font-extrabold tracking-[0.32em] sm:block">
            LABIQ <span className="font-medium opacity-60">ADA</span>
          </div>
        </motion.div>

        <motion.div
          initial="hide"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.07, delayChildren: 0.45 } } }}
          className={`absolute left-5 top-20 w-[min(300px,calc(100vw-40px))] sm:left-8 sm:top-28 ${ink}`}
        >
          <motion.div variants={ITEM} className={`text-[10.5px] font-extrabold tracking-[0.2em] ${sub}`}>
            <SwapLine text={dateLine} />
          </motion.div>
          <motion.div variants={ITEM} className="mt-1 flex items-baseline gap-2 text-lg font-bold">
            <SwapLine text={place.name} />
            <span className={`tabular-nums ${sub}`}>· {hm(now)}</span>
          </motion.div>
          <motion.div variants={ITEM} className="mt-1 flex items-start text-[64px] font-semibold leading-[0.9] tracking-tight sm:text-[96px]">
            {shown ? <AnimatedNumber value={shown.temp} /> : "–"}
            <span className="mt-1 text-[30px] font-medium sm:mt-2 sm:text-[40px]">°</span>
          </motion.div>
          <motion.div variants={ITEM} className="mt-2 text-base font-semibold sm:mt-3 sm:text-lg">
            <SwapLine text={shown?.label ?? "Hava durumu yükleniyor"} />
          </motion.div>
          {shown && (
            <motion.div variants={ITEM} className={`mt-1 text-xs font-semibold ${sub}`}>
              En yüksek <b className={ink}>{Math.round(shown.max)}°</b> · En düşük <b className={ink}>{Math.round(shown.min)}°</b>
            </motion.div>
          )}
          {shown && (
            <motion.div variants={ITEM} className="mt-4 hidden grid-cols-2 gap-2 sm:grid">
              <Tile cls={tile} sub={sub} k="Rüzgâr" v={`${Math.round(shown.wind)} km/s`} />
              <Tile cls={tile} sub={sub} k="Yağış" v={`${shown.rain.toFixed(1).replace(".", ",")} mm`} />
              {shown.hum != null ? <Tile cls={tile} sub={sub} k="Nem" v={`%${shown.hum}`} /> : <Tile cls={tile} sub={sub} k="Gün doğumu" v={today ? today.sunrise.slice(11, 16) : "–"} />}
              <Tile cls={tile} sub={sub} k="Gün batımı" v={today ? today.sunset.slice(11, 16) : "–"} />
            </motion.div>
          )}
          {/* bugün: uygulamadan kısa özet */}
          <motion.div variants={ITEM} className={`pointer-events-auto mt-3 hidden overflow-hidden rounded-2xl border backdrop-blur-md sm:block ${tile}`}>
            <div className={`px-3.5 pt-3 text-[10.5px] font-extrabold tracking-[0.2em] ${sub}`}>BUGÜN</div>
            {(["denetim", "beyin", "google", "aksiyonlar"] as BuildingId[]).map((id) => (
              <button key={id} onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)} onClick={() => pick(id)} className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] font-semibold ${night ? "hover:bg-white/10" : "hover:bg-white/50"}`}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: info[id].color }} />
                <span className="flex-1 truncate">{info[id].name}</span>
                <span className={`tabular-nums ${sub}`}>{info[id].badge ?? "—"}</span>
              </button>
            ))}
            <div className="h-1.5" />
          </motion.div>
        </motion.div>

        {/* ---------------------------------------- sağ üst: arama + eylemler */}
        <motion.div initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: 0.35 }} className="absolute right-4 top-4 flex items-center gap-2 sm:right-8 sm:top-6">
          <Search onPick={(p) => { setPlace(p); store.set("lq:wx-place", p); setDay(null); }} night={night} />
          <div className={`pointer-events-auto flex items-center gap-1 rounded-full border p-1 shadow-sm backdrop-blur-md ${night ? "border-white/15 bg-white/10 text-white" : "border-white/70 bg-white/70 text-[#1d2433]"}`}>
            <RoundBtn label="Konumum" onClick={() => locate((p) => { setPlace(p); store.set("lq:wx-place", p); })}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0C18.5 15.4 12 21 12 21z" /><circle cx="12" cy="10" r="2.3" /></svg>
            </RoundBtn>
            <RoundBtn label="Asistan" onClick={toggleAssistant}>
              <Icon name="spark" size={16} />
            </RoundBtn>
            <RoundBtn label="Görünümü ayarla" active={panel === "settings"} onClick={() => setPanel((p) => (p === "settings" ? null : "settings"))}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
            </RoundBtn>
          </div>
          <div className="pointer-events-auto hidden sm:block">
            <NotificationBell />
          </div>
        </motion.div>

        {/* ---------------------------------------- paneller */}
        <AnimatePresence>
          {panel === "settings" && (
            <Panel key="settings" onClose={() => setPanel(null)} title="Görünümü ayarla">
              <ChipGroup label="Günün saati" value={view.tod} onChange={(v) => saveView({ ...view, tod: v })} options={[["live", "Canlı"], ["morning", "Sabah"], ["day", "Gündüz"], ["evening", "Akşam"], ["night", "Gece"]]} />
              <ChipGroup
                label="Hava"
                value={view.wx}
                onChange={(v) => saveView({ ...view, wx: v })}
                options={[["live", "Canlı"], ["clear", "Açık"], ["partly", "Parçalı"], ["cloudy", "Bulutlu"], ["fog", "Sis"], ["rain", "Yağmur"], ["heavy", "Sağanak"], ["storm", "Fırtına"], ["snow", "Kar"]]}
              />
              <ChipGroup label="Mevsim" value={view.season} onChange={(v) => saveView({ ...view, season: v })} options={[["live", "Canlı"], ["spring", "İlkbahar"], ["summer", "Yaz"], ["autumn", "Sonbahar"], ["winter", "Kış"]]} />
              <ChipGroup label="Görüntü kalitesi" value={view.quality} onChange={(v) => saveView({ ...view, quality: v })} options={[["auto", "Otomatik"], ["low", "Düşük"], ["mid", "Orta"], ["high", "Yüksek"]]} />
              <p className="mt-1 text-[11px] leading-relaxed text-[#1d2433]/50">“Canlı” gerçek saati ve {place.name} için anlık havayı kullanır. Ayarlar bu cihazda saklanır.</p>
            </Panel>
          )}
          {panel === "menu" && (
            <motion.div key="menu" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="pointer-events-auto absolute left-5 top-16 z-20 w-56 rounded-2xl border border-white/70 bg-white/90 p-1.5 text-[#1d2433] shadow-xl backdrop-blur-xl sm:left-8 sm:top-[72px]">
              {(Object.keys(ROUTES) as BuildingId[]).map((id) => (
                <Link key={id} href={ROUTES[id]} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold hover:bg-black/5">
                  <span className="h-2 w-2 rounded-full" style={{ background: info[id].color }} />
                  <span className="flex-1">{info[id].name}</span>
                  <span className="text-xs text-[#1d2433]/50">{info[id].badge}</span>
                </Link>
              ))}
            </motion.div>
          )}
          {day != null && fc && (
            <DayPanel key={`day${day}`} fc={fc} day={day} onClose={() => setDay(null)} />
          )}
        </AnimatePresence>

        {/* ---------------------------------------- alt: 7 günlük tahmin */}
        {fc && (
          <motion.div
            initial={{ opacity: 0, y: 48, x: "-50%", scale: 0.96 }}
            animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
            transition={{ ...SPRING, delay: 0.7 }}
            className="pointer-events-auto absolute bottom-4 left-1/2 w-[min(700px,calc(100vw-24px))] rounded-[22px] bg-[#172f45]/92 p-2 text-white shadow-[0_20px_60px_-20px_rgba(10,20,40,.6)] backdrop-blur-md sm:bottom-6"
          >
            <div className="no-scrollbar flex gap-1 overflow-x-auto">
              {fc.days.map((d, i) => {
                const k = wmo(d.code).kind;
                const sel = (day ?? 0) === i && day != null;
                return (
                  <motion.button
                    key={d.date}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...SPRING, delay: 0.85 + i * 0.05 }}
                    whileHover={{ y: -3 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => setDay(sel ? null : i)}
                    className={`relative flex min-w-[78px] flex-1 flex-col items-center gap-1 rounded-2xl px-2 py-2 ${sel ? "text-[#1d2433]" : "hover:bg-white/10"}`}
                  >
                    {sel && <motion.span layoutId="day-pill" className="absolute inset-0 -z-0 rounded-2xl bg-[#f6dcae]" transition={SPRING} />}
                    <span className="relative text-[10.5px] font-extrabold tracking-[0.14em] opacity-80">{i === 0 ? "BUGÜN" : TR_DAYS_SHORT[new Date(d.date).getDay()].toLocaleUpperCase("tr")}</span>
                    <motion.span className="relative" animate={sel ? { scale: 1.15, rotate: [0, -8, 6, 0] } : { scale: 1, rotate: 0 }} transition={SPRING}>
                      <WxIcon kind={k} size={24} />
                    </motion.span>
                    <span className="relative text-[13px] font-bold tabular-nums">
                      {Math.round(d.max)}° <span className="font-semibold opacity-60">{Math.round(d.min)}°</span>
                    </span>
                  </motion.button>
                );
              })}
            </div>
            <div className="flex items-center justify-between px-2 pb-0.5 pt-1.5 text-[10px] font-semibold text-white/50">
              <span>Kaynak: Open-Meteo{fc.offline ? " · çevrimdışı örnek" : ""}</span>
              <span>Güncellendi {hm(new Date(fc.at))}</span>
            </div>
          </motion.div>
        )}

        {/* ---------------------------------------- alt köşeler */}
        <div className={`absolute bottom-7 left-8 hidden text-[11px] font-semibold lg:block ${sub}`}>Sürükle: döndür · Tekerlek: yakınlaştır · Binaya tıkla: içeri gir</div>
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...SPRING, delay: 1.05 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => setSound((s) => !s)}
          className={`pointer-events-auto absolute bottom-[136px] right-4 flex items-center gap-2 rounded-full border px-2 py-1.5 pr-3 text-xs font-bold shadow-sm backdrop-blur-md sm:bottom-7 sm:right-8 ${night ? "border-white/15 bg-white/10 text-white" : "border-white/70 bg-white/75 text-[#1d2433]"}`}
          aria-pressed={sound}
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[#f6dcae] text-[#1d2433]">{sound ? <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1" width="2.4" height="8" rx="1" fill="currentColor" /><rect x="6" y="1" width="2.4" height="8" rx="1" fill="currentColor" /></svg> : <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1l7 4-7 4z" fill="currentColor" /></svg>}</span>
          Ses
        </motion.button>
      </div>

      {/* uçarken binanın renginde hafif ışıma (kapıya hazırlık) */}
      <AnimatePresence>
        {fly && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25, duration: 0.5 }}
            className="pointer-events-none absolute inset-0"
            style={{ background: `radial-gradient(circle at 50% 48%, transparent 30%, ${info[fly].color}55 100%)` }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function locate(done: (p: WxPlace) => void) {
  navigator.geolocation?.getCurrentPosition(
    (pos) => done({ name: "Konumum", lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100 }),
    () => {},
    { timeout: 8000 },
  );
}

/* ------------------------------------------------------------------ küçük parçalar */
const SPRING = { type: "spring" as const, stiffness: 260, damping: 26 };
/** sol bloktaki satırlar sırayla, bulanıktan netleşerek gelir */
const ITEM = {
  hide: { opacity: 0, x: -24, filter: "blur(8px)" },
  show: { opacity: 1, x: 0, filter: "blur(0px)", transition: SPRING },
};

/** metin değişince eskisi yukarı kayıp gider, yenisi alttan gelir */
function SwapLine({ text }: { text: string }) {
  return (
    <span className="relative inline-grid overflow-hidden align-bottom">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={text} initial={{ y: "90%", opacity: 0, filter: "blur(4px)" }} animate={{ y: 0, opacity: 1, filter: "blur(0px)" }} exit={{ y: "-90%", opacity: 0, filter: "blur(4px)" }} transition={SPRING} className="col-start-1 row-start-1 whitespace-nowrap">
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
function Tile({ k, v, cls, sub }: { k: string; v: string; cls: string; sub: string }) {
  return (
    <div className={`rounded-2xl border px-3.5 py-2.5 backdrop-blur-md ${cls}`}>
      <div className={`text-[10.5px] font-bold ${sub}`}>{k}</div>
      <div className="text-[15px] font-bold tabular-nums">{v}</div>
    </div>
  );
}

function RoundBtn({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className={`grid h-8 w-8 place-items-center rounded-full transition-colors ${active ? "bg-[#1d2433] text-white" : "hover:bg-black/5 dark:hover:bg-white/10"}`}>
      {children}
    </button>
  );
}

function Search({ onPick, night }: { onPick: (p: WxPlace) => void; night: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<WxPlace[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setRes([]);
    const ac = new AbortController();
    const t = setTimeout(() => geocode(q.trim(), ac.signal).then(setRes).catch(() => {}), 250);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [q]);
  return (
    <div className="pointer-events-auto relative">
      <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 shadow-sm backdrop-blur-md ${night ? "border-white/15 bg-white/10 text-white" : "border-white/70 bg-white/70 text-[#1d2433]"}`}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></svg>
        <input
          value={q}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Konum ara"
          className={`w-24 bg-transparent text-xs font-semibold outline-none transition-[width] focus:w-44 ${night ? "placeholder:text-white/60" : "placeholder:text-[#1d2433]/55"}`}
        />
      </div>
      {open && res.length > 0 && (
        <div className="absolute right-0 top-11 z-30 w-64 rounded-2xl border border-white/70 bg-white/95 p-1.5 text-[#1d2433] shadow-xl backdrop-blur-xl">
          {res.map((p) => (
            <button
              key={`${p.lat},${p.lon}`}
              onMouseDown={() => {
                onPick(p);
                setQ("");
                setOpen(false);
              }}
              className="block w-full rounded-xl px-3 py-2 text-left hover:bg-black/5"
            >
              <div className="text-sm font-bold">{p.name}</div>
              {p.admin && <div className="text-xs text-[#1d2433]/55">{p.admin}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Panel({ title, kicker, onClose, children }: { title: string; kicker?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
      className="pointer-events-auto absolute right-4 top-[68px] z-20 max-h-[calc(100dvh-200px)] w-[min(340px,calc(100vw-32px))] overflow-y-auto rounded-[22px] border border-white/70 bg-white/88 p-4 text-[#1d2433] shadow-[0_24px_60px_-24px_rgba(20,30,60,.45)] backdrop-blur-xl sm:right-8 sm:top-[76px]"
    >
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {kicker && <div className="text-[10px] font-extrabold tracking-[0.2em] text-[#1d2433]/50">{kicker}</div>}
          <div className="text-[15px] font-extrabold">{title}</div>
        </div>
        <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-full bg-black/5 hover:bg-black/10" aria-label="Kapat">
          <Icon name="close" size={13} />
        </button>
      </div>
      {children}
    </motion.div>
  );
}

function ChipGroup<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-[10px] font-extrabold tracking-[0.18em] text-[#1d2433]/50">{label.toLocaleUpperCase("tr")}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)} className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold transition-colors ${value === v ? "bg-[#1d2433] text-white" : "bg-black/[0.05] text-[#1d2433]/70 hover:bg-black/10"}`}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Seçilen gün için saatlik tahmin: grafik + 3 saatlik satırlar */
function DayPanel({ fc, day, onClose }: { fc: Forecast; day: number; onClose: () => void }) {
  const [tab, setTab] = useState<"temp" | "wind" | "rain">("temp");
  const d = fc.days[day];
  const hours = fc.hours.filter((h) => h.time.startsWith(d.date));
  const val = (h: (typeof hours)[number]) => (tab === "temp" ? h.temp : tab === "wind" ? h.wind : h.rain);
  const vals = hours.map(val);
  const lo = Math.min(...vals, tab === "temp" ? Infinity : 0);
  const hi = Math.max(...vals, lo + 1);
  const W = 300;
  const H = 90;
  const pts = vals.map((v, i) => [(i / Math.max(1, vals.length - 1)) * W, H - 8 - ((v - lo) / (hi - lo)) * (H - 20)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const date = new Date(d.date);
  const unit = tab === "temp" ? "°" : tab === "wind" ? " km/s" : " mm";
  return (
    <Panel title={`${TR_DAYS[date.getDay()]}, ${date.getDate()} ${TR_MONTHS[date.getMonth()]}`} kicker="SAATLİK TAHMİN" onClose={onClose}>
      <div className="mb-3 flex gap-0.5 rounded-full bg-black/[0.05] p-0.5">
        {(
          [
            ["temp", "Sıcaklık"],
            ["wind", "Rüzgâr"],
            ["rain", "Yağış"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-full py-1 text-xs font-bold ${tab === k ? "bg-white shadow-sm" : "text-[#1d2433]/55"}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="rounded-2xl bg-[#eef3f6] p-3">
        <div className="mb-1 flex justify-between text-[11px] font-bold text-[#1d2433]/55">
          <span>{tab === "temp" ? "Sıcaklık" : tab === "wind" ? "Rüzgâr" : "Yağış"}</span>
          <span className="text-[#1d2433]">
            {Math.round(Math.min(...vals))}
            {unit} – {Math.round(Math.max(...vals))}
            {unit}
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" preserveAspectRatio="none">
          {pts.length > 1 && <path d={`${line} L${W},${H} L0,${H} Z`} fill="#3b6ea5" opacity="0.12" />}
          <path d={line} fill="none" stroke="#2c5d8f" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="flex justify-between text-[10px] font-semibold text-[#1d2433]/45">
          <span>00:00</span>
          <span>12:00</span>
          <span>23:00</span>
        </div>
      </div>
      <div className="mt-3 divide-y divide-black/5 text-[12.5px]">
        {hours
          .filter((_, i) => i % 3 === 0)
          .map((h) => (
            <div key={h.time} className="flex items-center gap-3 py-1.5">
              <span className="w-11 font-semibold tabular-nums text-[#1d2433]/60">{h.time.slice(11, 16)}</span>
              <WxIcon kind={wmo(h.code).kind} size={18} night={Number(h.time.slice(11, 13)) < 7 || Number(h.time.slice(11, 13)) > 19} />
              <span className="w-10 font-extrabold tabular-nums">{Math.round(h.temp)}°</span>
              <span className="flex-1 text-[#1d2433]/60">{Math.round(h.wind)} km/s</span>
              <span className="tabular-nums text-[#1d2433]/60">{h.rain.toFixed(1).replace(".", ",")} mm</span>
            </div>
          ))}
      </div>
    </Panel>
  );
}
