"use client";

import { AnimatePresence, motion, MotionConfig } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { periodLabel, periodShort } from "@/lib/period";
import { NotificationBell } from "./Notifications";
import { PeriodPicker } from "./PeriodPicker";
import { ThemeToggle } from "./Theme";
import { PenGlyph, useNotes } from "./notes/NotesPanel";
import { useAssistant } from "./assistant/AssistantPanel";
import { usePeriod } from "./PeriodProvider";
import { Icon } from "./ui";
import { ScrollProgress, Skeleton, SwapText, useRippleDelegation } from "./fx";
import { spring } from "@/lib/motion";

const NAV = [
  { href: "/", label: "Denetim", icon: "home" as const },
  { href: "/gorevler", label: "Görevler", icon: "todo" as const },
  { href: "/aksiyonlar", label: "Aksiyonlar", icon: "flag" as const },
  { href: "/analiz", label: "Analiz", icon: "chart" as const },
  { href: "/gecmis", label: "Geçmiş", icon: "history" as const },
];

function SaveDot() {
  const { saveState } = usePeriod();
  const map = {
    idle: { c: "bg-ink-3/40", t: "" },
    saving: { c: "bg-warn animate-pulse", t: "Kaydediliyor" },
    saved: { c: "bg-ok", t: "Kaydedildi" },
    error: { c: "bg-fail", t: "Kaydedilemedi" },
  }[saveState];
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-3" title={map.t}>
      <span className="relative grid h-3 w-3 place-items-center">
        <motion.span key={saveState} className={`h-2 w-2 rounded-full ${map.c}`} initial={{ scale: 0.3 }} animate={{ scale: 1 }} transition={spring.pop} />
        {saveState === "saved" && (
          <motion.span className="absolute inset-0 rounded-full border-2 border-ok" initial={{ scale: 0.6, opacity: 0.8 }} animate={{ scale: 2.2, opacity: 0 }} transition={{ duration: 0.7 }} />
        )}
      </span>
      <SwapText text={map.t || " "} className="hidden sm:inline-grid" />
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data, isHistory, activePeriod, backToActive, toastMsg, error, booting } = usePeriod();
  const [picker, setPicker] = useState(false);

  useRippleDelegation();

  if (pathname === "/giris") return <>{children}</>;

  return (
    <MotionConfig reducedMotion="user">
    <ScrollProgress />
    <div className="mx-auto flex min-h-dvh w-full max-w-[1400px] gap-6 px-4 pt-4 sm:px-6 lg:px-8 lg:pt-6">
      {/* Masaüstü yan menü — açılır/kapanır (kapalıyken ikon şeridi). Durum <html data-sidebar> üzerinde tutulur. */}
      <aside className="sticky top-6 hidden h-[calc(100dvh-48px)] w-64 shrink-0 flex-col gap-3 transition-[width] duration-300 ease-out lg:flex in-data-[sidebar=closed]:w-[84px]">
        <div className="clay relative flex items-center gap-3 overflow-hidden p-4 in-data-[sidebar=closed]:flex-col in-data-[sidebar=closed]:px-2">
          <Logo />
          <div className="min-w-0 flex-1 whitespace-nowrap in-data-[sidebar=closed]:hidden">
            <div className="text-lg font-extrabold leading-tight">LabIQ Kontrol</div>
            <div className="text-xs font-semibold text-ink-3">Diacore · Aylık Kapanış</div>
          </div>
          <SidebarToggle />
        </div>
        <nav className="clay flex flex-col gap-1.5 p-3 in-data-[sidebar=closed]:px-2">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                title={n.label}
                className="relative flex items-center gap-3 rounded-2xl px-4 py-3 font-bold in-data-[sidebar=closed]:justify-center in-data-[sidebar=closed]:px-0"
              >
                {active && <motion.span layoutId="side-nav" className="clay-pressed absolute inset-0 rounded-2xl" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
                <motion.span className={`relative ${active ? "text-blue" : "text-ink-2"}`} animate={{ scale: active ? 1.12 : 1, rotate: active ? [0, -8, 0] : 0 }} transition={{ scale: spring.wobbly, rotate: { duration: 0.4, ease: "easeOut" } }}>
                  <Icon name={n.icon} />
                </motion.span>
                <span className={`relative whitespace-nowrap in-data-[sidebar=closed]:hidden ${active ? "text-blue" : "text-ink-2"}`}>{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <button
          onClick={() => setPicker(true)}
          title={data ? periodLabel(data.period) : "Dönem seç"}
          className="clay mt-auto flex items-center gap-3 overflow-hidden p-4 text-left in-data-[sidebar=closed]:justify-center in-data-[sidebar=closed]:px-2"
        >
          <div className="clay-color grid h-11 w-11 shrink-0 place-items-center bg-blue text-white" style={{ borderRadius: 16 }}>
            <Icon name="calendar" size={20} />
          </div>
          <div className="min-w-0 whitespace-nowrap in-data-[sidebar=closed]:hidden">
            <div className="text-xs font-semibold text-ink-3">{isHistory ? "Görüntülenen dönem" : "Aktif dönem"}</div>
            <div className="truncate font-extrabold">{data ? periodLabel(data.period) : "Seçilmedi"}</div>
          </div>
        </button>
      </aside>

      <main className="min-w-0 flex-1 pb-36 lg:pb-12">
        {/* Üst bilgi */}
        <header className="glass sticky top-2 z-30 -mx-1 mb-5 flex items-center gap-2 rounded-[26px] py-2 pl-4 pr-2 sm:gap-3 lg:top-4">
          <div className="hidden sm:block lg:hidden">
            <Logo />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-ink-3 sm:text-sm">Merhaba Batuhan,</div>
            <div className="truncate text-lg font-extrabold tracking-tight sm:text-2xl">
              {pathname === "/" ? "Bugün neler var?" : NAV.find((n) => n.href !== "/" && pathname.startsWith(n.href))?.label}
            </div>
          </div>
          <SaveDot />
          <AssistantButton />
          <ThemeToggle className="clay-sm hidden sm:grid" />
          <NotesButton />
          <NotificationBell />
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setPicker(true)}
            className="clay-sm flex items-center gap-2 rounded-full px-3 py-2.5 font-bold sm:px-4"
          >
            <Icon name="calendar" size={18} className="text-blue" />
            <span className="whitespace-nowrap text-sm sm:hidden">{data ? periodShort(data.period) : "Dönem"}</span>
            <span className="hidden whitespace-nowrap text-sm sm:inline">{data ? periodLabel(data.period) : "Dönem seç"}</span>
          </motion.button>
        </header>

        <AnimatePresence>
          {isHistory && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="clay-sm mb-5 flex flex-wrap items-center gap-3 bg-tint-warn px-4 py-3">
                <span className="text-xl">🕰️</span>
                <div className="min-w-0 flex-1 text-sm">
                  <b>Geçmiş dönem görüntüleniyor.</b> Yaptığın değişiklikler bu döneme kaydedilir.
                </div>
                {activePeriod && (
                  <button onClick={backToActive} className="clay-dark rounded-full px-4 py-2 text-sm font-bold">
                    {periodLabel(activePeriod)}&apos;e dön
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {error && !booting && (
          <div className="clay-sm mb-5 flex items-start gap-3 bg-tint-fail px-4 py-3 text-sm">
            <Icon name="alert" className="mt-0.5 shrink-0 text-fail" />
            <div>{error}</div>
          </div>
        )}

        {booting ? <Splash /> : children}
      </main>

      {/* Mobil / tablet alt menü */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 px-4 pb-3 lg:hidden">
        <div className="glass mx-auto flex max-w-xl items-center justify-between gap-1 rounded-[30px] p-2">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className="relative flex flex-1 flex-col items-center gap-0.5 rounded-[20px] py-2.5">
                {active && (
                  <motion.span
                    layoutId="bottom-nav"
                    className="glass-chip absolute inset-0 rounded-[22px]"
                    style={{ background: "color-mix(in srgb, var(--color-blue) 16%, transparent)" }}
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <motion.span
                  className={`relative ${active ? "text-blue" : "text-ink-3"}`}
                  animate={{ y: active ? -2 : 0, scale: active ? 1.12 : 1 }}
                  transition={spring.wobbly}
                >
                  <Icon name={n.icon} size={24} />
                </motion.span>
                <span className={`relative text-[11px] font-bold ${active ? "text-blue" : "text-ink-3"}`}>{n.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Mobil: yüzen not düğmesi (sol alt) */}
      <MobileNotesButton />

      <PeriodPicker open={picker} onClose={() => setPicker(false)} />

      <AnimatePresence>
        {toastMsg && (
          <motion.div
            key={toastMsg}
            initial={{ y: -40, opacity: 0, scale: 0.85, x: "-50%" }}
            animate={{ y: 0, opacity: 1, scale: 1, x: "-50%" }}
            exit={{ y: -30, opacity: 0, scale: 0.9, x: "-50%" }}
            transition={spring.lift}
            className="glass-strong fixed left-1/2 top-4 z-[60] flex max-w-[92vw] items-center gap-2 rounded-full px-5 py-3 text-sm font-bold"
          >
            {(() => {
              const bad = /amadı|emedi|amadı|verilmedi|hatalı|Yetkisiz|eksik:/i.test(toastMsg);
              return (
                <motion.span
                  initial={{ scale: 0, rotate: -90 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ ...spring.pop, delay: 0.08 }}
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-white ${bad ? "bg-fail" : "bg-blue"}`}
                >
                  <Icon name={bad ? "alert" : "check"} size={12} stroke={3} />
                </motion.span>
              );
            })()}
            <span className="truncate">{toastMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </MotionConfig>
  );
}

function AssistantButton() {
  const { toggle } = useAssistant();
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      whileHover={{ y: -2, rotate: -6 }}
      onClick={toggle}
      className="clay-color grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg text-white"
      style={{ background: "linear-gradient(135deg,#8b5cf6,#5b7cff 60%,#2ec4b6)", ["--glow" as string]: "rgba(139,92,246,.45)" }}
      aria-label="Asistan"
      title="Asistan (J · Alt+J)"
    >
      ✨
    </motion.button>
  );
}

function NotesButton() {
  const { toggle } = useNotes();
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={toggle}
      className="clay-sm hidden h-11 w-11 shrink-0 place-items-center rounded-full sm:grid"
      aria-label="Notlar"
      title="Notlar (N · Alt+N)"
    >
      <PenGlyph />
    </motion.button>
  );
}

function MobileNotesButton() {
  const { toggle } = useNotes();
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={toggle}
      className="glass fixed bottom-28 left-5 z-30 grid h-14 w-14 place-items-center rounded-full text-ink sm:hidden"
      aria-label="Notlar"
    >
      <PenGlyph />
    </motion.button>
  );
}

/** Masaüstü yan menüyü açar/kapatır; tercih cihazda hatırlanır. Kısayol: Ctrl/⌘ + B */
function SidebarToggle() {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    setClosed(document.documentElement.dataset.sidebar === "closed");
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const toggle = () => {
    const next = document.documentElement.dataset.sidebar === "closed" ? "open" : "closed";
    document.documentElement.dataset.sidebar = next;
    setClosed(next === "closed");
    try {
      localStorage.setItem("lq:sidebar", next);
    } catch {}
  };
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={toggle}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:text-ink"
      aria-label={closed ? "Menüyü aç" : "Menüyü kapat"}
      title={`${closed ? "Menüyü aç" : "Menüyü kapat"} (Ctrl+B)`}
    >
      <span className="transition-transform duration-300 in-data-[sidebar=closed]:rotate-180">
        <Icon name="sidebar" size={20} />
      </span>
    </motion.button>
  );
}

export function Logo() {
  return (
    <div
      className="clay-color grid h-12 w-12 place-items-center text-white"
      style={{ borderRadius: 18, background: "linear-gradient(145deg,#6d8bff,#4361ee)" }}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />
        <path d="m9 15 2 2 4-4" />
      </svg>
    </div>
  );
}

function Splash() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Yükleniyor">
      <div className="flex gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[76px] flex-1" />
        ))}
      </div>
      <Skeleton className="h-56" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    </div>
  );
}
