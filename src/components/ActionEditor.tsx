"use client";

import { useEffect, useState } from "react";
import { AREAS, ALL_ITEMS, HOSPITALS, PEOPLE, areaByCode, type Hospital } from "@/lib/checklist";
import type { ActionPriority, ActionRow, ActionStatus } from "@/lib/types";
import { usePeriod } from "./PeriodProvider";
import { Icon, Sheet } from "./ui";

export const PRIORITIES: { v: ActionPriority; c: string }[] = [
  { v: "Kritik", c: "#FF5E6C" },
  { v: "Yüksek", c: "#FF9F43" },
  { v: "Orta", c: "#5B7CFF" },
  { v: "Düşük", c: "#2EC4B6" },
];
export const STATUSES: { v: ActionStatus; c: string; e: string }[] = [
  { v: "Açık", c: "#FF5E6C", e: "🔴" },
  { v: "Devam Ediyor", c: "#FF9F43", e: "🟠" },
  { v: "Beklemede", c: "#9AA1B5", e: "⏸️" },
  { v: "Tamamlandı", c: "#34C26B", e: "✅" },
];

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export interface ActionDraft {
  hospital?: Hospital;
  areaCode?: string;
  itemId?: string;
}

function blank(d: ActionDraft): ActionRow {
  return {
    id: uid(),
    hospital: d.hospital ?? "basaksehir",
    areaCode: d.areaCode ?? "R-01",
    itemId: d.itemId,
    finding: "",
    financialImpact: "",
    operationalImpact: "",
    priority: "Orta",
    action: "",
    owner: "",
    due: "",
    status: "Açık",
    managementNote: "",
    createdAt: new Date().toISOString(),
  };
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 mt-4 text-xs font-bold uppercase tracking-wide text-ink-3">{children}</div>;
}

export function ActionEditor({
  open,
  onClose,
  draft,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  draft?: ActionDraft;
  editing?: ActionRow | null;
}) {
  const { update, toast } = usePeriod();
  const [row, setRow] = useState<ActionRow>(() => editing ?? blank(draft ?? {}));

  useEffect(() => {
    if (open) setRow(editing ?? blank(draft ?? {}));
  }, [open, editing, draft]);

  const set = <K extends keyof ActionRow>(k: K, v: ActionRow[K]) => setRow((r) => ({ ...r, [k]: v }));
  const area = areaByCode(row.areaCode);
  const people = [...new Set([...(area?.people ?? []), ...PEOPLE])];

  const save = () => {
    if (!row.finding.trim()) {
      toast("Bulgu / sapma alanını doldur");
      return;
    }
    update((d) => {
      const exists = d.actions.some((a) => a.id === row.id);
      return { ...d, actions: exists ? d.actions.map((a) => (a.id === row.id ? row : a)) : [...d.actions, row] };
    });
    toast(editing ? "Aksiyon güncellendi" : "Aksiyon eklendi");
    onClose();
  };

  const remove = () => {
    if (!editing || !confirm("Bu aksiyon silinsin mi?")) return;
    update((d) => ({ ...d, actions: d.actions.filter((a) => a.id !== editing.id) }));
    toast("Aksiyon silindi");
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={editing ? "Aksiyonu düzenle" : "Bulgu / aksiyon ekle"} wide>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <div>
          <Label>Proje</Label>
          <div className="flex gap-2">
            {HOSPITALS.map((h) => (
              <button
                key={h.id}
                onClick={() => set("hospital", h.id)}
                className={`flex-1 rounded-2xl py-3 text-sm font-bold ${row.hospital === h.id ? "clay-dark" : "clay-sm"}`}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Rapor alanı</Label>
          <select
            className="field font-semibold"
            value={row.areaCode}
            onChange={(e) => setRow((r) => ({ ...r, areaCode: e.target.value, itemId: undefined }))}
          >
            {AREAS.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} · {a.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Label>Kontrol maddesi</Label>
      <select className="field" value={row.itemId ?? ""} onChange={(e) => set("itemId", e.target.value || undefined)}>
        <option value="">— Alan geneli —</option>
        {ALL_ITEMS.filter((i) => i.area.code === row.areaCode).map((i) => (
          <option key={i.id} value={i.id}>
            {i.text.trim()}
          </option>
        ))}
      </select>

      <Label>Bulgu / sapma *</Label>
      <textarea
        className="field min-h-[84px]"
        placeholder="Ne oldu? Kanıt ve olası neden… (veri kontrol bulgusu dili)"
        value={row.finding}
        onChange={(e) => set("finding", e.target.value)}
      />

      <div className="grid gap-x-4 sm:grid-cols-2">
        <div>
          <Label>Mali etki</Label>
          <input className="field" placeholder="ör. ₺12.400 doğrulanması gereken fark" value={row.financialImpact} onChange={(e) => set("financialImpact", e.target.value)} />
        </div>
        <div>
          <Label>Operasyonel etki</Label>
          <input className="field" placeholder="ör. sayım kapsamı eksik" value={row.operationalImpact} onChange={(e) => set("operationalImpact", e.target.value)} />
        </div>
      </div>

      <Label>Öncelik</Label>
      <div className="grid grid-cols-4 gap-2">
        {PRIORITIES.map((p) => (
          <button
            key={p.v}
            onClick={() => set("priority", p.v)}
            className={`rounded-2xl py-3 text-sm font-bold transition ${row.priority === p.v ? "clay-color text-white" : "clay-sm text-ink-2"}`}
            style={row.priority === p.v ? { background: p.c, ["--glow" as string]: p.c + "88" } : undefined}
          >
            {p.v}
          </button>
        ))}
      </div>

      <Label>Aksiyon</Label>
      <textarea className="field min-h-[70px]" placeholder="Ne yapılmalı? (sorumlu düzeltir, Batuhan takip eder)" value={row.action} onChange={(e) => set("action", e.target.value)} />

      <div className="grid gap-x-4 sm:grid-cols-2">
        <div>
          <Label>Sorumlu</Label>
          <input className="field" list="people" placeholder="Kişi seç / yaz" value={row.owner} onChange={(e) => set("owner", e.target.value)} />
          <datalist id="people">
            {people.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">
            {(area?.people ?? []).map((p) => (
              <button key={p} onClick={() => set("owner", p)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${row.owner === p ? "bg-blue text-white" : "clay-sm text-ink-2"}`}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Termin</Label>
          <input type="date" className="field" value={row.due} onChange={(e) => set("due", e.target.value)} />
        </div>
      </div>

      <Label>Durum</Label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STATUSES.map((s) => (
          <button
            key={s.v}
            onClick={() => set("status", s.v)}
            className={`rounded-2xl py-3 text-sm font-bold ${row.status === s.v ? "clay-color text-white" : "clay-sm text-ink-2"}`}
            style={row.status === s.v ? { background: s.c, ["--glow" as string]: s.c + "88" } : undefined}
          >
            {s.v}
          </button>
        ))}
      </div>

      <Label>Yönetim notu</Label>
      <input className="field" value={row.managementNote} onChange={(e) => set("managementNote", e.target.value)} />

      <div className="mt-6 flex gap-3">
        {editing && (
          <button onClick={remove} className="clay-sm grid h-14 w-14 place-items-center rounded-full text-fail" aria-label="Sil">
            <Icon name="trash" />
          </button>
        )}
        <button onClick={save} className="clay-dark flex-1 rounded-full py-4 text-base font-extrabold">
          Kaydet
        </button>
      </div>
    </Sheet>
  );
}
