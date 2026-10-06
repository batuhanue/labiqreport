"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type IconName =
  | "home" | "chart" | "history" | "flag" | "check" | "x" | "minus" | "note" | "plus" | "download"
  | "upload" | "back" | "close" | "chevron" | "calendar" | "info" | "trash" | "cloud" | "alert"
  | "flame" | "user" | "clock" | "share" | "play" | "edit" | "spark" | "bell";

const P: Record<IconName, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  chart: <path d="M5 20V10M12 20V4M19 20v-7" />,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  flag: <path d="M5 21V4h11l-1.5 4L16 12H5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  minus: <path d="M6 12h12" />,
  note: <><path d="M4 5h16v11l-4 4H4z" /><path d="M16 20v-4h4M8 9h8M8 13h5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  download: <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14" />,
  upload: <path d="M12 20V9m0 0-4.5 4.5M12 9l4.5 4.5M5 4h14" />,
  back: <path d="M15 5 8 12l7 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  cloud: <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5z" />,
  alert: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17v.5" /></>,
  flame: <path d="M12 21c-4 0-6.5-2.6-6.5-6 0-3.7 3-5.5 3.5-9 2 1.3 3 3 3 4.5 1-.8 1.6-2 1.7-3.3C16.3 9 18.5 11.6 18.5 15c0 3.4-2.5 6-6.5 6z" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  share: <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 13v7h14v-7" />,
  play: <path d="M7 4.5v15l12-7.5z" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  bell: <><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />,
};

export function Icon({ name, size = 22, stroke = 2.2, className }: { name: IconName; size?: number; stroke?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {P[name]}
    </svg>
  );
}

export function Ring({
  value,
  size = 56,
  stroke = 7,
  color = "var(--color-blue)",
  track = "rgba(0,0,0,0.07)",
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - Math.min(1, Math.max(0, value))) }}
          transition={{ type: "spring", stiffness: 60, damping: 18 }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function Bar({ value, color, height = 8 }: { value: number; color: string; height?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-full bg-track" style={{ height }}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.round(Math.min(1, value) * 100)}%` }}
        transition={{ type: "spring", stiffness: 70, damping: 18 }}
      />
    </div>
  );
}

/** Mobilde alttan açılan, masaüstünde ortada duran clay panel. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // cam (backdrop-filter) katmanların içinde fixed konum bozulmasın diye body'ye taşınır
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-scrim backdrop-blur-[3px]" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal
            className={`relative max-h-[92dvh] w-full overflow-y-auto glass-strong rounded-t-[32px] border-b-0 p-5 pb-8 sm:border-b sm:rounded-[32px] sm:p-7 ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
            initial={{ y: 60, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 60, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
          >
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-line-strong sm:hidden" />
            {title && (
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-xl font-extrabold tracking-tight">{title}</div>
                <button onClick={onClose} className="clay-sm grid h-10 w-10 shrink-0 place-items-center rounded-full" aria-label="Kapat">
                  <Icon name="close" size={18} />
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Chip({
  active,
  onClick,
  children,
  color,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${
        active ? "clay-dark" : "clay-sm text-ink-2"
      }`}
      style={active && color ? { background: color, color: "white" } : undefined}
    >
      {children}
    </motion.button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
}) {
  return (
    <div className="clay-pressed relative flex rounded-full p-1.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`relative z-10 flex-1 rounded-full px-3 py-2 text-sm font-bold transition-colors ${active ? "text-white" : "text-ink-2"}`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${options.map((x) => x.value).join("")}`}
                className="absolute inset-0 -z-10 rounded-full bg-blue clay-color"
                style={{ ["--glow" as string]: "rgba(91,124,255,.45)" }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({ emoji, title, text, children }: { emoji: string; title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="clay flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="text-5xl">{emoji}</div>
      <div className="text-lg font-extrabold">{title}</div>
      {text && <p className="max-w-sm text-sm text-ink-2">{text}</p>}
      {children}
    </div>
  );
}
