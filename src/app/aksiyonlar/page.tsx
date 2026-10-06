"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ActionEditor, PRIORITIES, STATUSES } from "@/components/ActionEditor";
import { usePeriod } from "@/components/PeriodProvider";
import { Chip, EmptyState, Icon } from "@/components/ui";
import { ALL_ITEMS, HOSPITALS, areaByCode, type Hospital } from "@/lib/checklist";
import { MONTHS_SHORT, periodLabel, todayISO } from "@/lib/period";
import type { ActionRow, ActionStatus } from "@/lib/types";

const fmt = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1]}` : iso;
};

export default function AksiyonlarPage() {
  const { data, update } = usePeriod();
  const [status, setStatus] = useState<ActionStatus | "open" | "all">("open");
  const [hospital, setHospital] = useState<Hospital | "all">("all");
  const [editing, setEditing] = useState<ActionRow | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useMemo(() => {
    if (!data) return [];
    const order = { Kritik: 0, Yüksek: 1, Orta: 2, Düşük: 3 };
    return data.actions
      .filter((a) => (status === "all" ? true : status === "open" ? a.status !== "Tamamlandı" : a.status === status))
      .filter((a) => hospital === "all" || a.hospital === hospital)
      .sort((a, b) => order[a.priority] - order[b.priority] || (a.due || "9").localeCompare(b.due || "9"));
  }, [data, status, hospital]);

  if (!data)
    return (
      <EmptyState emoji="🚩" title="Önce bir dönem aç" text="Aksiyonlar dönem bazında tutulur.">
        <Link href="/" className="clay-dark rounded-full px-5 py-3 font-bold">Denetime git</Link>
      </EmptyState>
    );

  const today = todayISO();
  const setRowStatus = (id: string, s: ActionStatus) =>
    update((d) => ({ ...d, actions: d.actions.map((a) => (a.id === id ? { ...a, status: s } : a)) }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-ink-3">{periodLabel(data.period)} · 02_Aksiyon_Takip</div>
          <div className="text-2xl font-extrabold">Bulgu → sorumlu → çözüm</div>
        </div>
        <motion.button whileTap={{ scale: 0.95 }} onClick={() => setCreating(true)} className="clay-dark flex items-center gap-2 rounded-full px-5 py-3 font-bold">
          <Icon name="plus" size={18} /> Yeni aksiyon
        </motion.button>
      </div>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-2 sm:mx-0 sm:px-1">
        <Chip active={status === "open"} onClick={() => setStatus("open")}>Açık olanlar</Chip>
        {STATUSES.map((s) => (
          <Chip key={s.v} active={status === s.v} onClick={() => setStatus(s.v)}>
            {s.e} {s.v}
          </Chip>
        ))}
        <Chip active={status === "all"} onClick={() => setStatus("all")}>Tümü</Chip>
        <span className="mx-1 w-px shrink-0 bg-black/10" />
        <Chip active={hospital === "all"} onClick={() => setHospital("all")}>İki hastane</Chip>
        {HOSPITALS.map((h) => (
          <Chip key={h.id} active={hospital === h.id} onClick={() => setHospital(h.id)}>{h.label}</Chip>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState emoji="✨" title="Burada aksiyon yok" text="Denetimde bir maddeye 'Bulgu ekle' diyerek ya da yukarıdan yeni aksiyon açabilirsin." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          <AnimatePresence>
            {list.map((a, i) => {
              const area = areaByCode(a.areaCode);
              const item = a.itemId ? ALL_ITEMS.find((x) => x.id === a.itemId) : null;
              const pr = PRIORITIES.find((p) => p.v === a.priority)!;
              const st = STATUSES.find((s) => s.v === a.status)!;
              const late = a.due && a.due < today && a.status !== "Tamamlandı";
              return (
                <motion.div
                  key={a.id}
                  layout
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: Math.min(i * 0.03, 0.25) }}
                  className="clay flex flex-col p-4"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-full px-2.5 py-1 text-xs font-extrabold text-white" style={{ background: area?.color }}>
                      {area?.emoji} {a.areaCode}
                    </span>
                    <span className="clay-sm rounded-full px-2.5 py-1 text-xs font-bold">{a.hospital === "bursa" ? "Bursa" : "Başakşehir"}</span>
                    <span className="ml-auto flex items-center gap-1 text-xs font-extrabold" style={{ color: pr.c }}>
                      <span className="h-2 w-2 rounded-full" style={{ background: pr.c }} /> {a.priority}
                    </span>
                  </div>
                  {item && <div className="mt-2 text-xs font-semibold text-ink-3">{item.text.trim()}</div>}
                  <div className="mt-1.5 font-bold leading-snug">{a.finding}</div>
                  {a.action && <div className="mt-2 text-sm text-ink-2">➜ {a.action}</div>}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-ink-2">
                    {a.owner && <span className="flex items-center gap-1"><Icon name="user" size={14} /> {a.owner}</span>}
                    {a.due && (
                      <span className={`flex items-center gap-1 ${late ? "text-fail" : ""}`}>
                        <Icon name="clock" size={14} /> {fmt(a.due)}{late ? " · gecikti" : ""}
                      </span>
                    )}
                    {a.financialImpact && <span>💰 {a.financialImpact}</span>}
                  </div>
                  <div className="mt-auto flex items-center gap-2 pt-4">
                    <select
                      value={a.status}
                      onChange={(e) => setRowStatus(a.id, e.target.value as ActionStatus)}
                      className="flex-1 rounded-full px-3 py-2.5 text-sm font-bold text-white outline-none"
                      style={{ background: st.c }}
                    >
                      {STATUSES.map((s) => (
                        <option key={s.v} value={s.v} className="text-ink">{s.v}</option>
                      ))}
                    </select>
                    {a.status !== "Tamamlandı" && (
                      <button onClick={() => setRowStatus(a.id, "Tamamlandı")} className="clay-sm grid h-11 w-11 place-items-center rounded-full text-ok" aria-label="Tamamlandı">
                        <Icon name="check" stroke={3} />
                      </button>
                    )}
                    <button onClick={() => setEditing(a)} className="clay-sm grid h-11 w-11 place-items-center rounded-full" aria-label="Düzenle">
                      <Icon name="edit" size={19} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <ActionEditor open={creating || !!editing} editing={editing} onClose={() => { setCreating(false); setEditing(null); }} />
    </div>
  );
}
