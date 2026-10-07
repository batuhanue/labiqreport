"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";
const KEY = "lq:theme";

/** İlk boyamadan önce temayı uygular (yanıp sönmeyi önler). */
export const themeScript = `(function(){try{var p=localStorage.getItem("${KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";document.documentElement.dataset.sidebar=localStorage.getItem("lq:sidebar")==="closed"?"closed":"open";}catch(e){}})();`;

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#111319" : "#f4f1ec");
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    let p: ThemePref = "system";
    try {
      p = (localStorage.getItem(KEY) as ThemePref) || "system";
    } catch {}
    setPref(p);
    apply(p);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      let cur: ThemePref = "system";
      try {
        cur = (localStorage.getItem(KEY) as ThemePref) || "system";
      } catch {}
      if (cur === "system") apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  /** origin verilirse tema, o noktadan büyüyen bir daireyle değişir (View Transitions API). */
  const set = (p: ThemePref, origin?: { x: number; y: number }) => {
    setPref(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {}
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!origin || !doc.startViewTransition || reduce) {
      apply(p);
      return;
    }
    const r = Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y));
    const t = doc.startViewTransition(() => apply(p));
    t.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${r}px at ${origin.x}px ${origin.y}px)`] },
        { duration: 550, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    });
  };
  return { pref, set };
}

const ORDER: ThemePref[] = ["system", "light", "dark"];
const LABEL: Record<ThemePref, string> = { system: "Sistem teması", light: "Açık tema", dark: "Koyu tema" };

function Glyph({ p }: { p: ThemePref }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (p === "light")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
      </svg>
    );
  if (p === "dark")
    return (
      <svg {...common}>
        <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Sistem → Açık → Koyu arasında döner. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { pref, set } = useTheme();
  const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        set(next, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${className}`}
      aria-label={`${LABEL[pref]} — değiştir`}
      title={`${LABEL[pref]} (dokun: ${LABEL[next]})`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={pref} initial={{ rotate: -90, scale: 0.5, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} exit={{ rotate: 90, scale: 0.5, opacity: 0 }} transition={{ duration: 0.22 }}>
          <Glyph p={pref} />
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
