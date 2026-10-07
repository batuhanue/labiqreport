"use client";

import { AnimatePresence, motion, useAnimate } from "motion/react";
import { useState } from "react";
import { HOSPITALS, tintOf, type Area, type CheckItem, type Hospital } from "@/lib/checklist";
import type { ItemState, Mark } from "@/lib/types";
import { isChecked } from "@/lib/period";
import { usePeriod } from "./PeriodProvider";
import { Icon } from "./ui";
import { Burst, SwapText } from "./fx";
import { easeOutExpo, spring } from "@/lib/motion";

const MARKS: { v: Exclude<Mark, null>; label: string; icon: "check" | "x" | "minus"; color: string }[] = [
  { v: "ok", label: "Tamam", icon: "check", color: "#34C26B" },
  { v: "fail", label: "Bulgu var", icon: "x", color: "#FF5E6C" },
  { v: "na", label: "N/A · eksik", icon: "minus", color: "#9AA1B5" },
];

/** İşaret ikonu: seçilince çizgisi çizilerek belirir. */
function MarkGlyph({ kind, selected, size }: { kind: "check" | "x"; selected: boolean; size: number }) {
  const d = kind === "check" ? ["m5 12.5 4.5 4.5L19 7.5"] : ["M6.5 6.5l11 11", "M17.5 6.5l-11 11"];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d.map((p, i) => (
        <motion.path
          key={`${p}-${selected}`}
          d={p}
          initial={{ pathLength: selected ? 0 : 1 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: selected ? 0.32 : 0, delay: selected ? 0.06 + i * 0.1 : 0, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
    </svg>
  );
}

function MarkButton({ m, selected, onClick, big }: { m: (typeof MARKS)[number]; selected: boolean; onClick: () => void; big: boolean }) {
  const size = m.v === "na" ? (big ? 48 : 42) : big ? 60 : 50;
  const [scope, animate] = useAnimate();
  const [burst, setBurst] = useState(0);

  const press = () => {
    const willSelect = !selected;
    onClick();
    if (!willSelect) {
      animate(scope.current, { scale: [1, 0.8, 1] }, { type: "spring", stiffness: 500, damping: 18 });
      return;
    }
    if (m.v === "ok") {
      setBurst((b) => b + 1);
      animate(scope.current, { scale: [1, 1.18, 1] }, { type: "spring", stiffness: 500, damping: 12 });
    } else if (m.v === "fail") {
      // "hayır" sallanması
      animate(scope.current, { x: [0, -7, 7, -5, 5, -2, 0], rotate: [0, -6, 6, -3, 3, 0] }, { duration: 0.45, ease: "easeOut" });
    } else {
      animate(scope.current, { y: [0, 5, 0], scale: [1, 0.92, 1] }, { type: "spring", stiffness: 400, damping: 14 });
    }
  };

  return (
    <motion.button
      ref={scope}
      onClick={press}
      whileTap={{ scale: 0.86 }}
      whileHover={{ y: -2 }}
      aria-pressed={selected}
      aria-label={m.label}
      title={m.label}
      data-no-ripple
      className="relative grid place-items-center rounded-full"
      style={{ width: size, height: size }}
    >
      <motion.span
        className="absolute inset-0 rounded-full"
        animate={{
          background: selected ? m.color : "var(--color-mark)",
          boxShadow: selected
            ? `0 10px 18px -6px ${m.color}aa, inset 3px 4px 7px rgba(255,255,255,.45), inset -4px -5px 9px rgba(0,0,0,.15)`
            : "var(--clay-shadow-sm)",
        }}
        transition={{ duration: 0.25 }}
      />
      <motion.span className="relative" animate={{ color: selected ? "#fff" : m.color }} transition={{ duration: 0.2 }}>
        {m.v === "na" ? (
          <motion.span className="block text-[11px] font-extrabold" animate={{ scale: selected ? [0.6, 1.15, 1] : 1 }}>
            N/A
          </motion.span>
        ) : (
          <MarkGlyph kind={m.icon as "check" | "x"} selected={selected} size={big ? 30 : 26} />
        )}
      </motion.span>
      {/* parıltı halkası */}
      <AnimatePresence>
        {selected && m.v !== "na" && (
          <motion.span
            key="ring"
            className="pointer-events-none absolute inset-0 rounded-full border-4"
            style={{ borderColor: m.color }}
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 1.8, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          />
        )}
      </AnimatePresence>
      {m.v === "ok" && <Burst trigger={burst} color={m.color} radius={big ? 46 : 40} />}
    </motion.button>
  );
}

function HospitalMarks({ hospital, value, onChange, big }: { hospital: Hospital; value: Mark; onChange: (m: Mark) => void; big: boolean }) {
  const h = HOSPITALS.find((x) => x.id === hospital)!;
  const cur = MARKS.find((m) => m.v === value);
  return (
    <div className="clay-pressed relative flex flex-wrap items-center gap-x-3 gap-y-2 overflow-hidden rounded-[24px] px-3 py-2.5 sm:px-4">
      {/* seçime göre zemine hafif renk akışı */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        initial={false}
        animate={{ opacity: cur ? 1 : 0 }}
        transition={{ duration: 0.35 }}
        style={{ background: cur ? `linear-gradient(90deg, ${cur.color}22, transparent 70%)` : "transparent" }}
      />
      {/* dar alanda butonlar yazının üstüne binmez, alt satıra iner */}
      <div className="relative min-w-[6.5rem] flex-1">
        <div className="truncate text-[11px] font-bold uppercase tracking-wider text-ink-3">{h.label}</div>
        <SwapText text={cur ? cur.label : "Bekliyor"} className="text-sm font-extrabold" style={{ color: cur?.color ?? "var(--color-ink-3)" }} />
      </div>
      <div className="relative ml-auto flex shrink-0 items-center gap-2.5 sm:gap-3">
        {MARKS.map((m) => (
          <MarkButton key={m.v} m={m} big={big} selected={value === m.v} onClick={() => onChange(value === m.v ? null : m.v)} />
        ))}
      </div>
    </div>
  );
}

export function ItemCard({
  area,
  item,
  index,
  state,
  actionCount,
  onAddAction,
}: {
  area: Area;
  item: CheckItem;
  index: number;
  state: ItemState;
  actionCount: number;
  onAddAction: (h?: Hospital) => void;
}) {
  const { update, focus, toast } = usePeriod();
  const [showHint, setShowHint] = useState(false);
  const [showNote, setShowNote] = useState(!!state.note);
  const hospitals = focus === "both" ? HOSPITALS.map((h) => h.id) : [focus];
  const doneBoth =
    isChecked(state.bursa) && isChecked(state.basaksehir);

  const setMark = (h: Hospital, m: Mark) => {
    update((d) => ({
      ...d,
      items: { ...d.items, [item.id]: { ...d.items[item.id], [h]: m, updatedAt: new Date().toISOString() } },
    }));
    if (m === "fail") {
      setShowNote(true);
      toast("Bulgu işaretlendi (kontrol edildi) — not veya aksiyon eklemeyi unutma");
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ delay: Math.min(index * 0.05, 0.25), duration: 0.5, ease: easeOutExpo }}
      className="clay relative p-4 sm:p-5"
    >
      {/* madde tamamlanınca kenarda yeşil parıltı */}
      <AnimatePresence>
        {doneBoth && (
          <motion.span
            key="glow"
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[28px]"
            style={{ boxShadow: "0 0 0 2px #34C26B, 0 0 28px 2px #34C26B55" }}
            initial={{ opacity: 0.9 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>
      <div className="flex items-start gap-3">
        <motion.div
          className="clay-color grid h-10 w-10 shrink-0 place-items-center text-base font-extrabold text-white"
          style={{ borderRadius: 14, ["--glow" as string]: (doneBoth ? "#34C26B" : area.color) + "88", perspective: 400 }}
          animate={{ background: doneBoth ? "#34C26B" : area.color, scale: doneBoth ? [1, 1.2, 1] : 1 }}
          transition={spring.wobbly}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={doneBoth ? "done" : "num"}
              initial={{ rotateY: 90, opacity: 0 }}
              animate={{ rotateY: 0, opacity: 1 }}
              exit={{ rotateY: -90, opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="grid place-items-center"
            >
              {doneBoth ? <Icon name="check" size={20} stroke={3} /> : index + 1}
            </motion.span>
          </AnimatePresence>
        </motion.div>
        <div className="min-w-0 flex-1 pt-1">
          <div className="text-[15px] font-bold leading-snug sm:text-base">{item.text.trim()}</div>
          <AnimatePresence>
            {showHint && item.hint && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="mt-2 rounded-2xl px-3 py-2 text-sm text-ink-2" style={{ background: tintOf(area.color) }}>
                  💡 {item.hint}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {item.hint && (
          <button onClick={() => setShowHint((s) => !s)} className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${showHint ? "clay-pressed text-blue" : "text-ink-3"}`} aria-label="İpucu">
            <Icon name="info" size={20} />
          </button>
        )}
      </div>

      {/* yan yana yalnızca kartın kendisi yeterince genişse (container query) */}
      <div className={`@container mt-4`}>
        <div className={`grid gap-3 ${hospitals.length === 2 ? "@2xl:grid-cols-2" : ""}`}>
        {hospitals.map((h) => (
          <HospitalMarks key={h} hospital={h} value={state[h]} big={hospitals.length === 1} onChange={(m) => setMark(h, m)} />
        ))}
        </div>
      </div>

      <AnimatePresence>
        {showNote && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <textarea
              className="field mt-3 min-h-[64px] resize-y"
              placeholder="Açıklama / anomali notu (Excel'de DURUM kolonuna yazılır)"
              value={state.note}
              onChange={(e) =>
                update((d) => ({ ...d, items: { ...d.items, [item.id]: { ...d.items[item.id], note: e.target.value } } }))
              }
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setShowNote((s) => !s)}
          className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold ${showNote ? "clay-pressed text-blue" : "clay-sm text-ink-2"}`}
        >
          <Icon name="note" size={17} />
          Not{state.note ? " •" : ""}
        </button>
        <button onClick={() => onAddAction()} className="clay-sm flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold text-ink-2">
          <Icon name="flag" size={17} />
          Bulgu ekle
        </button>
        {actionCount > 0 && (
          <span className="rounded-full bg-tint-fail px-3 py-1.5 text-xs font-extrabold text-fail">{actionCount} aksiyon</span>
        )}
      </div>
    </motion.div>
  );
}
