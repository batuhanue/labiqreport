"use client";

import { useMemo, useState } from "react";
import { Tabs } from "@/components/ui";
import { agentById, type BrainItem } from "@/lib/brain-types";

/** İşin tek cümlelik durumu ve rengi (tüm listelerde aynı dil). */
export function itemState(x: BrainItem): { label: string; color: string; live?: boolean } {
  const w = x.work?.status;
  if (w === "running") return { label: "Ajan çalışıyor", color: "#5b7cff", live: true };
  if (w === "queued") return { label: "Sırada", color: "#5b7cff" };
  if (x.status === "done" || w === "approved") return { label: "Bitti", color: "#22b07d" };
  if (w === "waiting_ok") return { label: "Onayını bekliyor", color: "#f59e0b" };
  if (w === "ready") return { label: "Teslimat hazır", color: "#22b07d" };
  if (w === "error") return { label: "Hata", color: "#ef4d5a" };
  if (x.status === "inbox") return { label: "Öneri", color: "#8b5cf6" };
  if (x.status === "waiting") return { label: "Bekliyor", color: "#f59e0b" };
  if (x.status === "doing") return { label: "Sürüyor", color: "#5b7cff" };
  return { label: "Yapılacak", color: "#94a3b8" };
}

export function ago(s?: string) {
  if (!s) return "";
  const m = Math.round((Date.now() - Date.parse(s)) / 60000);
  return m < 1 ? "şimdi" : m < 60 ? `${m} dk` : m < 1440 ? `${Math.round(m / 60)} sa` : `${Math.round(m / 1440)} g`;
}

/** Sade iş satırı: durum noktası, başlık, tek satır bilgi. */
export function TaskRow({ x, onOpen, showAgent = true }: { x: BrainItem; onOpen: () => void; showAgent?: boolean }) {
  const s = itemState(x);
  const a = agentById(x.agent);
  return (
    <button onClick={onOpen} className="group flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-black/[0.035] dark:hover:bg-white/[0.06]">
      <span className="relative mt-[7px] grid h-2 w-2 shrink-0 place-items-center">
        {s.live && <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: s.color }} />}
        <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[13.5px] font-semibold leading-snug">{x.title}</span>
        <span className="mt-0.5 block truncate text-xs text-ink-3">
          {showAgent && a ? `${a.name.replace(" ajanı", "")} · ` : ""}
          <span style={{ color: s.color }}>{s.label}</span>
          {x.due ? ` · ${new Date(x.due).toLocaleDateString("tr-TR", { day: "numeric", month: "short" })}` : ""}
        </span>
      </span>
      <span className="mt-0.5 shrink-0 text-[11px] text-ink-3">{ago(x.updatedAt)}</span>
    </button>
  );
}

type Filter = "open" | "inbox" | "waiting" | "done";
const sortItems = (a: BrainItem, b: BrainItem) =>
  Number(b.work?.status === "running") - Number(a.work?.status === "running") || Number(b.work?.status === "waiting_ok") - Number(a.work?.status === "waiting_ok") || a.priority - b.priority || b.updatedAt.localeCompare(a.updatedAt);

/** İş listesi + sade filtre (Açık · Öneri · Onay · Bitti). */
export function TaskListView({ items, onOpen, filters = true, showAgent = true, limit = 40, empty = "Burada iş yok." }: { items: BrainItem[]; onOpen: (x: BrainItem) => void; filters?: boolean; showAgent?: boolean; limit?: number; empty?: string }) {
  const [f, setF] = useState<Filter>("open");
  const live = useMemo(() => items.filter((x) => x.status !== "dismissed"), [items]);
  const by = (k: Filter) =>
    k === "open"
      ? live.filter((x) => x.status !== "done" && x.work?.status !== "approved")
      : k === "inbox"
        ? live.filter((x) => x.status === "inbox")
        : k === "waiting"
          ? live.filter((x) => x.work?.status === "waiting_ok" || x.status === "waiting")
          : live.filter((x) => x.status === "done" || x.work?.status === "approved");
  const list = (filters ? by(f) : live).sort(sortItems).slice(0, limit);
  return (
    <div>
      {filters && (
        <Tabs
          className="mb-2"
          value={f}
          onChange={setF}
          options={[
            { value: "open", label: "Açık", n: by("open").length },
            { value: "inbox", label: "Öneri", n: by("inbox").length },
            { value: "waiting", label: "Onay", n: by("waiting").length },
            { value: "done", label: "Bitti" },
          ]}
        />
      )}
      {list.length ? (
        <div className="-mx-1 space-y-0.5">
          {list.map((x) => (
            <TaskRow key={x.id} x={x} onOpen={() => onOpen(x)} showAgent={showAgent} />
          ))}
        </div>
      ) : (
        <div className="py-6 text-center text-xs text-ink-3">{empty}</div>
      )}
    </div>
  );
}
