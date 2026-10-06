"use client";

import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { AREAS, type Area } from "@/lib/checklist";
import type { PeriodData } from "@/lib/types";
import { areaProgress } from "@/lib/period";
import { Icon } from "./ui";

const BLOBS = [
  { x: "12%", y: "18%", c: "#FF9F43", r: -30, w: 18, h: 44 },
  { x: "82%", y: "14%", c: "#34C26B", r: 35, w: 20, h: 54 },
  { x: "8%", y: "48%", c: "#FF5E6C", r: 50, w: 18, h: 40 },
  { x: "88%", y: "44%", c: "#FFC93C", r: -40, w: 18, h: 40 },
  { x: "22%", y: "64%", c: "#5B7CFF", r: 20, w: 16, h: 36 },
  { x: "76%", y: "62%", c: "#A66CFF", r: -15, w: 16, h: 34 },
];

export function Celebration({
  area,
  data,
  onClose,
  onNext,
}: {
  area: Area | null;
  data: PeriodData;
  onClose: () => void;
  onNext?: () => void;
}) {
  useEffect(() => {
    if (!area) return;
    const colors = ["#34C26B", "#5B7CFF", "#FF9F43", "#FF5E6C", "#FFC93C", "#A66CFF"];
    confetti({ particleCount: 90, spread: 80, origin: { y: 0.35 }, colors, scalar: 1.1 });
    const t = setTimeout(() => confetti({ particleCount: 60, spread: 120, origin: { y: 0.3 }, colors }), 250);
    return () => clearTimeout(t);
  }, [area]);

  const doneAreas = AREAS.filter((a) => areaProgress(data, a).both === a.items.length).length;

  return (
    <AnimatePresence>
      {area && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-[#2a2620]/30 backdrop-blur-[3px]" onClick={onClose} />
          <motion.div
            className="relative w-full max-w-md overflow-hidden rounded-[36px] p-7 pb-6 text-center"
            style={{ background: "linear-gradient(180deg,#fff4e6 0%,#f3eefe 45%,#fbfaf7 75%)", boxShadow: "0 30px 60px -20px rgba(40,30,20,.35)" }}
            initial={{ scale: 0.8, y: 40 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 30, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
          >
            <button onClick={onClose} className="clay-sm absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full" aria-label="Kapat">
              <Icon name="close" size={18} />
            </button>
            <div className="relative mx-auto h-48 w-full">
              {BLOBS.map((b, i) => (
                <motion.span
                  key={i}
                  className="absolute rounded-full"
                  style={{
                    left: b.x,
                    top: b.y,
                    width: b.w,
                    height: b.h,
                    background: b.c,
                    boxShadow: "inset 3px 4px 6px rgba(255,255,255,.5), inset -3px -4px 6px rgba(0,0,0,.15)",
                  }}
                  initial={{ scale: 0, rotate: b.r }}
                  animate={{ scale: 1, rotate: b.r, y: [0, -6, 0] }}
                  transition={{ delay: 0.15 + i * 0.05, y: { repeat: Infinity, duration: 2 + i * 0.3 } }}
                />
              ))}
              <motion.div
                className="absolute left-1/2 top-1/2 grid h-36 w-36 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-white"
                style={{
                  background: "radial-gradient(circle at 35% 30%, #7be08f, #34c26b 55%, #22994f)",
                  boxShadow: "0 24px 40px -12px rgba(52,194,107,.7), inset 8px 10px 18px rgba(255,255,255,.4), inset -10px -14px 22px rgba(0,0,0,.18)",
                }}
                initial={{ scale: 0, rotate: -40 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 12, delay: 0.05 }}
              >
                <svg width="76" height="76" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                  <motion.path d="m5 12.5 4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.35, duration: 0.45 }} />
                </svg>
              </motion.div>
            </div>
            <div className="text-4xl font-extrabold tracking-tight">Harika!</div>
            <div className="mt-1 text-2xl font-extrabold tracking-tight">{area.code} tamamlandı.</div>
            <p className="mx-auto mt-2 max-w-xs text-ink-2">
              {area.title} her iki hastane için kontrol edildi. Küçük bir adım daha, kapanışa yaklaşıyorsun.
            </p>

            <div className="clay-sm mt-5 flex items-center gap-3 px-4 py-3 text-left">
              <span className="text-3xl">🔥</span>
              <div>
                <div className="text-lg font-extrabold">
                  {doneAreas}/{AREAS.length} alan tamam
                </div>
                <div className="text-sm text-ink-3">Kapanış serisi devam ediyor!</div>
              </div>
            </div>

            <div className="clay-sm mt-3 grid grid-cols-10 gap-1 px-3 py-3">
              {AREAS.map((a) => {
                const p = areaProgress(data, a);
                const done = p.both === a.items.length;
                const partial = p.bursa + p.basaksehir > 0;
                return (
                  <div key={a.code} className="flex flex-col items-center gap-1">
                    <span className="text-[9px] font-bold text-ink-3">{a.code.slice(2)}</span>
                    <span
                      className="grid h-6 w-6 place-items-center rounded-full"
                      style={{
                        background: done ? "#34C26B" : "transparent",
                        border: done ? "none" : `2.5px solid ${partial ? "#5B7CFF" : "#ddd6cc"}`,
                      }}
                    >
                      {done && <Icon name="check" size={13} stroke={3.5} className="text-white" />}
                    </span>
                  </div>
                );
              })}
            </div>

            <button onClick={onNext ?? onClose} className="clay-dark mt-5 w-full rounded-full py-4 text-lg font-extrabold">
              Devam Et
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
