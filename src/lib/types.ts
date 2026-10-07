import type { Hospital } from "./checklist";

/** ok = ☑, fail = x, na = N/A, null = ☐ (bekliyor) */
export type Mark = "ok" | "fail" | "na" | null;

export interface ItemState {
  bursa: Mark;
  basaksehir: Mark;
  note: string;
  updatedAt?: string;
}

export type ActionPriority = "Kritik" | "Yüksek" | "Orta" | "Düşük";
export type ActionStatus = "Açık" | "Devam Ediyor" | "Beklemede" | "Tamamlandı";

export interface ActionRow {
  id: string;
  hospital: Hospital;
  areaCode: string;
  itemId?: string;
  finding: string;
  financialImpact: string;
  operationalImpact: string;
  priority: ActionPriority;
  action: string;
  owner: string;
  due: string; // YYYY-MM-DD
  status: ActionStatus;
  managementNote: string;
  createdAt: string;
}

export interface Signoff {
  name: string;
  date: string;
}

export type PeriodStatus = "Taslak" | "Ön Onay" | "Son Onay";

export interface PeriodData {
  period: string; // YYYY-MM
  status: PeriodStatus;
  version: string;
  preparedAt: string; // YYYY-MM-DD
  signoffs: {
    preparer: Signoff;
    control: Signoff;
    preApproval: Signoff;
    finalApproval: Signoff;
    closing: Signoff; // name alanı: "Onaylandı" / "Revizyon"
  };
  items: Record<string, ItemState>;
  actions: ActionRow[];
  notes: Note[];
  createdAt: string;
  updatedAt: string;
}

export interface PeriodSummary {
  period: string;
  status: PeriodStatus;
  updatedAt: string;
  bursaOk: number;
  basaksehirOk: number;
  fails: number;
  openActions: number;
}

export interface AppState {
  activePeriod: string | null;
}

// ---------------------------------------------------------------- Notlar
export type InkTool = "pen" | "marker";
export type InkColor = "ink" | "blue" | "red" | "green" | "orange" | "yellow";

export interface Stroke {
  tool: InkTool;
  color: InkColor;
  size: number; // mantıksal birim (sayfa genişliği 800)
  pen: boolean; // gerçek kalem basıncı var mı
  pts: number[]; // düz dizi: x, y, basınç, x, y, basınç…
}

export interface NoteInk {
  strokes: Stroke[];
  height: number; // mantıksal yükseklik
  paper: "lined" | "grid" | "blank";
}

export interface Note {
  id: string;
  title: string;
  text: string;
  ink: NoteInk;
  areaCode?: string;
  mode: "text" | "ink";
  createdAt: string;
  updatedAt: string;
}
