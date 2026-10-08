import { AGENTS, type AgentId } from "@/lib/brain-types";

/**
 * Beyin ofisi yerleşimi: ortada Beyin, çevresinde bir halka üzerinde her ajan için bir departman pod'u.
 * Her pod'da masalar: lider (★) ve alt görevler — çalışan ajan bu masalarda iş yapar.
 */
export const POD_W = 11;
export const POD_D = 8.4;
export const RING_X = 19.5;
export const RING_Z = 15.5;

export interface Dept {
  id: AgentId;
  name: string;
  emoji: string;
  color: string;
  /** pod zemininin pastel tonu (referanstaki gibi) */
  floor: string;
  floorDark: string;
  desks: { label: string; lead?: boolean }[];
  x: number;
  z: number;
}

const DESKS: Record<AgentId, string[]> = {
  posta: ["Posta lideri", "Gelen kutusu", "Yanıt taslağı", "Termin takibi"],
  sohbet: ["Sohbet lideri", "İstek yakalama", "Söz takibi"],
  takvim: ["Takvim lideri", "Toplantı hazırlığı", "Davet yanıtları"],
  toplanti: ["Toplantı lideri", "Transkript", "Karar ve aksiyon"],
  denetim: ["Denetim lideri", "Termin izleme", "Bulgu takibi", "Kontrol planı"],
  dosya: ["Dosya lideri", "Drive arama", "Özetleme"],
  gorev: ["Görev lideri", "Not → iş", "Görev listesi"],
};
const FLOOR: Record<AgentId, [string, string]> = {
  posta: ["#f3c6cc", "#4a2a33"],
  sohbet: ["#bfe8e1", "#203f3c"],
  takvim: ["#c9d4fb", "#262f52"],
  toplanti: ["#dccdf7", "#33284d"],
  denetim: ["#c8eccf", "#22402a"],
  dosya: ["#f7dfb7", "#4a3a22"],
  gorev: ["#e2e5ec", "#2f3442"],
};

export const DEPTS: Dept[] = AGENTS.map((a, i) => {
  const ang = -Math.PI / 2 + (i / AGENTS.length) * Math.PI * 2;
  return {
    id: a.id,
    name: a.source === "Elle girilenler" ? "Görevler" : a.name.replace(" ajanı", ""),
    emoji: a.emoji,
    color: a.color,
    floor: FLOOR[a.id][0],
    floorDark: FLOOR[a.id][1],
    desks: DESKS[a.id].map((label, k) => ({ label, lead: k === 0 })),
    x: Math.cos(ang) * RING_X,
    z: Math.sin(ang) * RING_Z,
  };
});
export const deptById = (id: string | null | undefined) => DEPTS.find((d) => d.id === id);

/** masa yerleşimi (pod içinde, 2 sütun) */
export function deskPos(i: number): [number, number] {
  const col = i % 2;
  const row = Math.floor(i / 2);
  return [col ? 2.6 : -2.6, -1.4 + row * 3.1];
}

export const HALF = RING_X + POD_W / 2 + 1;
