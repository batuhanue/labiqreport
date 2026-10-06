"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { periodLabel } from "@/lib/period";
import { PeriodPicker } from "./PeriodPicker";
import { usePeriod } from "./PeriodProvider";
import { Icon } from "./ui";

const NAV = [
  { href: "/", label: "Denetim", icon: "home" as const },
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
      <span className={`h-2 w-2 rounded-full ${map.c}`} />
      <span className="hidden sm:inline">{map.t}</span>
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data, isHistory, activePeriod, backToActive, toastMsg, error, booting } = usePeriod();
  const [picker, setPicker] = useState(false);

  if (pathname === "/giris") return <>{children}</>;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1400px] gap-6 px-4 pt-4 sm:px-6 lg:px-8 lg:pt-6">
      {/* Masaüstü yan menü */}
      <aside className="sticky top-6 hidden h-[calc(100dvh-48px)] w-64 shrink-0 flex-col gap-3 lg:flex">
        <div className="clay flex items-center gap-3 p-4">
          <Logo />
          <div>
            <div className="text-lg font-extrabold leading-tight">LabIQ Kontrol</div>
            <div className="text-xs font-semibold text-ink-3">Diacore · Aylık Kapanış</div>
          </div>
        </div>
        <nav className="clay flex flex-col gap-1.5 p-3">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className="relative flex items-center gap-3 rounded-2xl px-4 py-3 font-bold">
                {active && <motion.span layoutId="side-nav" className="clay-pressed absolute inset-0 rounded-2xl" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
                <span className={`relative ${active ? "text-blue" : "text-ink-2"}`}>
                  <Icon name={n.icon} />
                </span>
                <span className={`relative ${active ? "text-blue" : "text-ink-2"}`}>{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <button onClick={() => setPicker(true)} className="clay mt-auto flex items-center gap-3 p-4 text-left">
          <div className="clay-color grid h-11 w-11 place-items-center bg-blue text-white" style={{ borderRadius: 16 }}>
            <Icon name="calendar" size={20} />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-ink-3">{isHistory ? "Görüntülenen dönem" : "Aktif dönem"}</div>
            <div className="truncate font-extrabold">{data ? periodLabel(data.period) : "Seçilmedi"}</div>
          </div>
        </button>
      </aside>

      <main className="min-w-0 flex-1 pb-36 lg:pb-12">
        {/* Üst bilgi */}
        <header className="mb-5 flex items-center gap-3">
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink-3">Merhaba Batuhan,</div>
            <div className="truncate text-lg font-extrabold tracking-tight sm:text-2xl">
              {pathname === "/" ? "Bugün neler var?" : NAV.find((n) => n.href !== "/" && pathname.startsWith(n.href))?.label}
            </div>
          </div>
          <SaveDot />
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setPicker(true)}
            className="clay-sm flex items-center gap-2 rounded-full px-4 py-2.5 font-bold"
          >
            <Icon name="calendar" size={18} className="text-blue" />
            <span className="whitespace-nowrap text-sm">{data ? periodLabel(data.period) : "Dönem seç"}</span>
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
              <div className="clay-sm mb-5 flex flex-wrap items-center gap-3 bg-[#FFF4E2] px-4 py-3">
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
          <div className="clay-sm mb-5 flex items-start gap-3 bg-[#FFE9EC] px-4 py-3 text-sm">
            <Icon name="alert" className="mt-0.5 shrink-0 text-fail" />
            <div>{error}</div>
          </div>
        )}

        {booting ? <Splash /> : children}
      </main>

      {/* Mobil / tablet alt menü */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 px-4 pb-3 lg:hidden">
        <div className="clay mx-auto flex max-w-xl items-center justify-between gap-1 p-2">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className="relative flex flex-1 flex-col items-center gap-0.5 rounded-[20px] py-2.5">
                {active && <motion.span layoutId="bottom-nav" className="clay-pressed absolute inset-0 rounded-[20px]" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <span className={`relative ${active ? "text-blue" : "text-ink-3"}`}>
                  <Icon name={n.icon} size={24} />
                </span>
                <span className={`relative text-[11px] font-bold ${active ? "text-blue" : "text-ink-3"}`}>{n.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <PeriodPicker open={picker} onClose={() => setPicker(false)} />

      <AnimatePresence>
        {toastMsg && (
          <motion.div
            key={toastMsg}
            initial={{ y: -30, opacity: 0, x: "-50%" }}
            animate={{ y: 0, opacity: 1, x: "-50%" }}
            exit={{ y: -30, opacity: 0, x: "-50%" }}
            className="clay-dark fixed left-1/2 top-4 z-[60] rounded-full px-5 py-3 text-sm font-bold"
          >
            {toastMsg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
    <div className="grid place-items-center py-24">
      <motion.div animate={{ scale: [1, 1.08, 1], rotate: [0, -4, 4, 0] }} transition={{ repeat: Infinity, duration: 1.6 }}>
        <Logo />
      </motion.div>
      <div className="mt-4 text-sm font-semibold text-ink-3">Kaldığın yer yükleniyor…</div>
    </div>
  );
}
