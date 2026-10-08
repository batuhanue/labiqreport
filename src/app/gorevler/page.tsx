"use client";

import { useEffect, useState } from "react";
import BrainView from "@/components/brain/BrainView";
import TodoBoard from "@/components/todos/TodoBoard";
import { Segmented } from "@/components/ui";

const TAB_KEY = "lq:brain-tab";

/** Beyin: işini anlayan merkez ve yan ajanlar. Kişisel görev listesi beynin bir yan işi olarak ikinci sekmede. */
export default function BeyinPage() {
  const [tab, setTab] = useState<"brain" | "todos">("brain");
  useEffect(() => {
    try {
      if (localStorage.getItem(TAB_KEY) === "todos" || new URLSearchParams(window.location.search).get("sekme") === "gorevler") setTab("todos");
    } catch {}
  }, []);
  const pick = (t: "brain" | "todos") => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {}
  };
  return (
    <div className="space-y-5">
      <div className="max-w-sm">
        <Segmented
          value={tab}
          onChange={pick}
          options={[
            { value: "brain", label: "🧠 Beyin" },
            { value: "todos", label: "✅ Görevlerim" },
          ]}
        />
      </div>
      {tab === "brain" ? <BrainView /> : <TodoBoard />}
    </div>
  );
}
