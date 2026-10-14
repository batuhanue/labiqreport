"use client";

import { motion } from "motion/react";
import dynamic from "next/dynamic";
import { startTransition, useEffect, useState, ViewTransition } from "react";
import LabIQAgentPanel from "@/components/brain/LabIQAgentPanel";
import BrainView from "@/components/brain/BrainView";
import TrainingPanel from "@/components/brain/TrainingPanel";
import Today from "@/components/brain/Today";
import TodoBoard from "@/components/todos/TodoBoard";
import { Menu } from "@/components/ui";

const VIEW_KEY = "lq:brain-view3";
type View = "today" | "todos" | "train" | "labiq" | "all" | "net" | "office";

/** Beyin ofisi (3B) yalnızca tablet/masaüstünde ve gerektiğinde indirilir. */
const BrainOffice = dynamic(() => import("@/components/brain/BrainOffice"), {
  ssr: false,
  loading: () => (
    <div className="clay grid h-[calc(100dvh-12rem)] min-h-[600px] place-items-center rounded-[30px]">
      <div className="flex flex-col items-center gap-3 text-sm font-bold text-ink-3">
        <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="inline-block h-8 w-8 rounded-full border-[3px] border-[#8b5cf6] border-t-transparent" />
        Beyin ofisi kuruluyor…
      </div>
    </div>
  ),
});

/** Ajan ağı (canvas) — yalnızca istemcide */
const NetworkMap = dynamic(() => import("@/components/brain/NetworkMap"), {
  ssr: false,
  loading: () => <div className="h-[calc(100dvh-12rem)] min-h-[420px] rounded-[30px] bg-[#06070c]" />,
});

const MAIN = [
  ["today", "Bugün"],
  ["todos", "Görevlerim"],
  ["train", "Eğitim"],
  ["labiq", "LabIQ"],
] as const;
const EXTRA: Record<"all" | "net" | "office", string> = { all: "Tüm işler", net: "Ajan ağı", office: "Ofis (3B)" };

/** Beyin: varsayılan "Bugün" (karar bekleyenler + Hazırla). Görevlerim, Eğitim, LabIQ yanında; ayrıntılı görünümler ⋯ altında. */
export default function BeyinPage() {
  const [view, setView] = useState<View>("today");
  const [wide, setWide] = useState(false);
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      // her açılış Bugün'le başlar; yalnızca Görevlerim'de kaldıysan oradan devam eder
      if (localStorage.getItem(VIEW_KEY) === "todos") setView("todos");
      if (q.get("sekme") === "gorevler") setView("todos");
      const g = q.get("gorunum");
      if (g === "egitim") setView("train");
      if (g === "labiq") setView("labiq");
      if (g === "bugun") setView("today");
    } catch {}
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // görünüm değişimleri geçiş içinde: <ViewTransition> çapraz geçiş yapar
  const pickView = (v: View) => {
    startTransition(() => setView(v));
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };
  // ofis 3B'si dar ekranda yok → tüm işlere düş
  const shown: View = view === "office" && !wide ? "all" : view;
  const extra = shown === "all" || shown === "net" || shown === "office" ? shown : null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        <div className="clay-pressed flex min-w-0 overflow-x-auto rounded-full p-1">
          {[...MAIN, ...(extra ? ([[extra, EXTRA[extra]]] as const) : [])].map(([v, l]) => (
            <button key={v} onClick={() => pickView(v)} className={`relative shrink-0 rounded-full px-3.5 py-2 text-sm font-bold sm:px-4 ${shown === v ? "text-white" : "text-ink-2"}`}>
              {shown === v && <motion.span layoutId="brain-view" className="absolute inset-0 rounded-full bg-blue" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span className="relative">{l}</span>
            </button>
          ))}
        </div>
        <Menu
          label="Diğer görünümler"
          items={[
            { label: "Tüm işler (pano)", icon: "todo", onClick: () => pickView("all") },
            { label: "Ajan ağı", icon: "brain", onClick: () => pickView("net") },
            { label: "Ofis (3B)", icon: "home", onClick: () => pickView("office"), hidden: !wide },
          ]}
        />
      </div>
      <ViewTransition update="swap" default="none">
        <div>{shown === "todos" ? <TodoBoard /> : shown === "today" ? <Today /> : shown === "net" ? <NetworkMap /> : shown === "office" ? <BrainOffice /> : shown === "train" ? <TrainingPanel /> : shown === "labiq" ? <LabIQAgentPanel /> : <BrainView />}</div>
      </ViewTransition>
    </div>
  );
}
