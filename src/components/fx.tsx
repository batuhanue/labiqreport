"use client";

import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { spring } from "@/lib/motion";

/** Sayıyı yaylı şekilde sayarak gösterir (ör. %42). */
export function AnimatedNumber({ value, prefix = "", suffix = "", className }: { value: number; prefix?: string; suffix?: string; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const [text, setText] = useState(`${prefix}${Math.round(reduce ? value : 0)}${suffix}`);
  useEffect(() => {
    if (reduce) {
      setText(`${prefix}${Math.round(value)}${suffix}`);
      return;
    }
    const c = animate(mv, value, { type: "spring", stiffness: 90, damping: 20 });
    const un = mv.on("change", (v) => setText(`${prefix}${Math.round(v)}${suffix}`));
    return () => {
      c.stop();
      un();
    };
  }, [value, prefix, suffix, mv, reduce]);
  return <span className={`tabular-nums ${className ?? ""}`}>{text}</span>;
}

/** İşaretlenince etrafa saçılan parçacıklar (tek seferlik). */
export function Burst({ trigger, color, count = 10, radius = 38 }: { trigger: number; color: string; count?: number; radius?: number }) {
  const reduce = useReducedMotion();
  if (!trigger || reduce) return null;
  return (
    <span key={trigger} className="pointer-events-none absolute inset-0">
      {Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2 + (trigger % 7) * 0.3;
        const r = radius * (0.75 + ((i * 37) % 10) / 25);
        return (
          <motion.span
            key={i}
            className="absolute left-1/2 top-1/2 rounded-full"
            style={{ width: i % 3 ? 6 : 8, height: i % 3 ? 6 : 8, marginLeft: -3, marginTop: -3, background: i % 4 === 0 ? "#FFC93C" : color }}
            initial={{ x: 0, y: 0, scale: 0.4, opacity: 1 }}
            animate={{ x: Math.cos(a) * r, y: Math.sin(a) * r, scale: [0.4, 1.1, 0], opacity: [1, 1, 0] }}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          />
        );
      })}
    </span>
  );
}

/** Sayfanın üstünde ince kaydırma ilerleme çubuğu (modern-web-design 8.2). */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 26, restDelta: 0.001 });
  const opacity = useTransform(scrollYProgress, [0, 0.02], [0, 1]);
  return (
    <motion.div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[45] h-[3px] origin-left"
      style={{ scaleX, opacity, background: "linear-gradient(90deg,#5b7cff,#a66cff,#ff7a59)" }}
    />
  );
}

/** Yükleme iskeleti (shimmer). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-[24px] ${className}`} />;
}

/**
 * Dalga efekti (modern-web-design 1.2) — sayfadaki tüm clay/glass butonlara delegasyonla uygulanır.
 * data-no-ripple olan öğeler hariç.
 */
export function useRippleDelegation() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("button, a");
      if (!el || el.closest("[data-no-ripple]") || el.closest("canvas")) return;
      if (!/(clay|glass|chip)/.test(el.className)) return;
      const rect = el.getBoundingClientRect();
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      const host = document.createElement("span");
      host.className = "ripple-host";
      const size = Math.max(rect.width, rect.height) * 1.2;
      const dot = document.createElement("span");
      dot.className = "ripple-dot";
      dot.style.width = dot.style.height = `${size}px`;
      dot.style.left = `${e.clientX - rect.left - size / 2}px`;
      dot.style.top = `${e.clientY - rect.top - size / 2}px`;
      host.appendChild(dot);
      el.appendChild(host);
      setTimeout(() => host.remove(), 650);
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
}

/** Metin değişince yukarı kayarak değişir. */
export function SwapText({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={`relative inline-grid overflow-hidden ${className ?? ""}`} style={style}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-100%", opacity: 0 }}
          transition={spring.stiff}
          className="col-start-1 row-start-1"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
