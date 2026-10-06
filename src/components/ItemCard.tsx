"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { HOSPITALS, tintOf, type Area, type CheckItem, type Hospital } from "@/lib/checklist";
import type { ItemState, Mark } from "@/lib/types";
import { usePeriod } from "./PeriodProvider";
import { Icon } from "./ui";

const MARKS: { v: Exclude<Mark, null>; label: string; icon: "check" | "x" | "minus"; color: string }[] = [
  { v: "ok", label: "Tamam", icon: "check", color: "#34C26B" },
  { v: "fail", label: "Sorun", icon: "x", color: "#FF5E6C" },
  { v: "na", label: "N/A", icon: "minus", color: "#9AA1B5" },
];

function MarkButton({ m, selected, onClick, big }: { m: (typeof MARKS)[number]; selected: boolean; onClick: () => void; big: boolean }) {
  const size = m.v === "na" ? (big ? 48 : 42) : big ? 60 : 50;
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.85 }}
      aria-pressed={selected}
      aria-label={m.label}
      title={m.label}
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
      <motion.span
        className="relative"
        animate={{ scale: selected ? [1, 1.35, 1] : 1, color: selected ? "#fff" : m.color }}
        transition={{ duration: 0.35 }}
      >
        {m.v === "na" ? (
          <span className="text-[11px] font-extrabold">N/A</span>
        ) : (
          <Icon name={m.icon} size={big ? 30 : 26} stroke={3} />
        )}
      </motion.span>
      {/* parıltı halkası */}
      <AnimatePresence>
        {selected && m.v === "ok" && (
          <motion.span
            className="pointer-events-none absolute inset-0 rounded-full border-4"
            style={{ borderColor: m.color }}
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 1.7, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          />
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function HospitalMarks({ hospital, value, onChange, big }: { hospital: Hospital; value: Mark; onChange: (m: Mark) => void; big: boolean }) {
  const h = HOSPITALS.find((x) => x.id === hospital)!;
  const cur = MARKS.find((m) => m.v === value);
  return (
    <div className="clay-pressed flex items-center gap-3 rounded-[24px] px-3 py-2.5 sm:px-4">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold uppercase tracking-wider text-ink-3">{h.label}</div>
        <div className="text-sm font-extrabold" style={{ color: cur?.color ?? "var(--color-ink-3)" }}>
          {cur ? cur.label : "Bekliyor"}
        </div>
      </div>
      <div className="flex items-center gap-2.5 sm:gap-3">
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
    (state.bursa === "ok" || state.bursa === "na") && (state.basaksehir === "ok" || state.basaksehir === "na");

  const setMark = (h: Hospital, m: Mark) => {
    update((d) => ({
      ...d,
      items: { ...d.items, [item.id]: { ...d.items[item.id], [h]: m, updatedAt: new Date().toISOString() } },
    }));
    if (m === "fail") {
      setShowNote(true);
      toast("Sorun işaretlendi — not veya bulgu eklemeyi unutma");
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.3), type: "spring", stiffness: 260, damping: 26 }}
      className="clay p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <motion.div
          className="clay-color grid h-10 w-10 shrink-0 place-items-center text-base font-extrabold text-white"
          style={{ background: doneBoth ? "var(--color-ok)" : area.color, borderRadius: 14, ["--glow" as string]: (doneBoth ? "#34C26B" : area.color) + "88" }}
          animate={{ rotate: doneBoth ? [0, -10, 10, 0] : 0 }}
        >
          {doneBoth ? <Icon name="check" size={20} stroke={3} /> : index + 1}
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

      <div className={`mt-4 grid gap-3 ${hospitals.length === 2 ? "xl:grid-cols-2" : ""}`}>
        {hospitals.map((h) => (
          <HospitalMarks key={h} hospital={h} value={state[h]} big={hospitals.length === 1} onChange={(m) => setMark(h, m)} />
        ))}
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
