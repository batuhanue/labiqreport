"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { TOTAL_ITEMS } from "@/lib/checklist";
import { MONTHS, periodLabel, toPeriod } from "@/lib/period";
import { usePeriod } from "./PeriodProvider";
import { Icon, Ring, Sheet } from "./ui";

export function PeriodPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { summaries, activePeriod, data, openPeriod } = usePeriod();
  const now = new Date();
  const [year, setYear] = useState(() => Number((data?.period ?? toPeriod(now)).slice(0, 4)));
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const maxPeriod = toPeriod(now);

  const pick = async (p: string) => {
    const exists = summaries.some((s) => s.period === p);
    if (!exists && !confirm) {
      setConfirm(p);
      return;
    }
    setBusy(true);
    try {
      await openPeriod(p);
      setConfirm(null);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={() => { setConfirm(null); onClose(); }} title="Dönem seç">
      <div className="mb-4 flex items-center justify-between">
        <button className="clay-sm grid h-11 w-11 place-items-center rounded-full" onClick={() => setYear((y) => y - 1)} aria-label="Önceki yıl">
          <Icon name="back" size={18} />
        </button>
        <motion.div key={year} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-2xl font-extrabold">
          {year}
        </motion.div>
        <button
          className="clay-sm grid h-11 w-11 place-items-center rounded-full disabled:opacity-40"
          disabled={year >= now.getFullYear()}
          onClick={() => setYear((y) => y + 1)}
          aria-label="Sonraki yıl"
        >
          <Icon name="chevron" size={18} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {MONTHS.map((m, i) => {
          const p = `${year}-${String(i + 1).padStart(2, "0")}`;
          const s = summaries.find((x) => x.period === p);
          const future = p > maxPeriod;
          const isActive = p === activePeriod;
          const isViewing = p === data?.period;
          const pct = s ? (s.bursaOk + s.basaksehirOk) / (TOTAL_ITEMS * 2) : 0;
          return (
            <motion.button
              key={p}
              initial={{ opacity: 0, scale: 0.85, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ delay: i * 0.025, type: "spring", stiffness: 380, damping: 24 }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.95 }}
              disabled={future || busy}
              onClick={() => pick(p)}
              className={`relative flex flex-col items-center gap-1.5 rounded-[22px] px-2 py-3 transition ${
                isViewing ? "clay-color bg-blue text-white" : confirm === p ? "clay-pressed" : "clay-sm"
              } ${future ? "opacity-35" : ""}`}
            >
              {isActive && (
                <span className="absolute -top-1.5 right-2 rounded-full bg-ok px-2 py-0.5 text-[10px] font-bold text-white shadow">AKTİF</span>
              )}
              <span className="text-sm font-bold">{m}</span>
              {s ? (
                <Ring value={pct} size={34} stroke={4.5} color={isViewing ? "white" : "var(--color-ok)"} track={isViewing ? "rgba(255,255,255,.25)" : undefined}>
                  <span className="text-[10px] font-extrabold">{Math.round(pct * 100)}</span>
                </Ring>
              ) : (
                <span className={`grid h-[34px] place-items-center text-xs ${isViewing ? "text-white/80" : "text-ink-3"}`}>
                  {future ? "—" : "Yeni"}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>

      {confirm && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="clay mt-5 p-4">
          <div className="font-extrabold">{periodLabel(confirm)} dönemi başlatılsın mı?</div>
          <p className="mt-1 text-sm text-ink-2">
            Yeni dönem tüm maddeler boş olarak sıfırdan başlar ve aktif dönem olur. Uygulamayı açtığında buradan devam edersin.
          </p>
          <div className="mt-4 flex gap-3">
            <button className="clay-sm flex-1 rounded-full py-3 font-bold" onClick={() => setConfirm(null)}>
              Vazgeç
            </button>
            <button className="clay-dark flex-1 rounded-full py-3 font-bold" disabled={busy} onClick={() => pick(confirm)}>
              {busy ? "Başlatılıyor…" : "Başlat"}
            </button>
          </div>
        </motion.div>
      )}
    </Sheet>
  );
}
