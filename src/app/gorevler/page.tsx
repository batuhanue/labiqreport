"use client";

import { motion } from "motion/react";
import dynamic from "next/dynamic";
import { startTransition, useEffect, useState, ViewTransition } from "react";
import BrainView from "@/components/brain/BrainView";
import TodoBoard from "@/components/todos/TodoBoard";
import { Segmented } from "@/components/ui";

const TAB_KEY = "lq:brain-tab";
const VIEW_KEY = "lq:brain-view";

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

/** Beyin: asıl çalışma ekibi (ajan departmanları). Kişisel görev listesi beynin bir yan işi olarak ikinci sekmede. */
export default function BeyinPage() {
  const [tab, setTab] = useState<"brain" | "todos">("brain");
  const [view, setView] = useState<"office" | "list">("office");
  const [wide, setWide] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(TAB_KEY) === "todos" || new URLSearchParams(window.location.search).get("sekme") === "gorevler") setTab("todos");
      if (localStorage.getItem(VIEW_KEY) === "list") setView("list");
    } catch {}
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // görünüm değişimleri geçiş içinde: <ViewTransition> çapraz geçiş yapar
  const pick = (t: "brain" | "todos") => {
    startTransition(() => setTab(t));
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {}
  };
  const pickView = (v: "office" | "list") => {
    startTransition(() => setView(v));
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-sm">
          <Segmented
            value={tab}
            onChange={pick}
            options={[
              { value: "brain", label: "🧠 Beyin" },
              { value: "todos", label: "✅ Görevlerim" },
            ]}
          />
        </div>
        {tab === "brain" && wide && (
          <div className="clay-pressed flex rounded-full p-1">
            {(
              [
                ["office", "🏢 Ofis"],
                ["list", "☰ Liste"],
              ] as const
            ).map(([v, l]) => (
              <button key={v} onClick={() => pickView(v)} className={`relative rounded-full px-4 py-2 text-sm font-bold ${view === v ? "text-white" : "text-ink-2"}`}>
                {view === v && <motion.span layoutId="brain-view" className="absolute inset-0 rounded-full bg-blue" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <span className="relative">{l}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <ViewTransition update="swap" default="none">
        <div>{tab === "todos" ? <TodoBoard /> : wide && view === "office" ? <BrainOffice /> : <BrainView />}</div>
      </ViewTransition>
    </div>
  );
}
