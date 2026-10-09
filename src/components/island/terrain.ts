/**
 * Ada şekli ve yerleşim: kıyı çizgisi, yükseklik, kumsal; binaların, nehrin, patikaların yeri.
 * x sağa, z kameraya doğru (ön), y yukarı. Ada x yönünde biraz uzun.
 */

export const SX = 1.22; // x uzama
export const R = 9;
export const BEACH_ANGLE = 0.72; // ön-sağ (rad, atan2(z, x/SX))

export function radiusAt(t: number) {
  return R * (1 + 0.08 * Math.sin(2 * t + 0.6) + 0.06 * Math.sin(3 * t + 2.1) + 0.035 * Math.sin(5 * t + 0.3));
}

/** noktanın ada içindeki göreli uzaklığı (0 merkez, 1 kıyı) ve açısı */
export function polar(x: number, z: number) {
  const t = Math.atan2(z, x / SX);
  const d = Math.hypot(x / SX, z);
  return { t, s: d / radiusAt(t) };
}

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** kumsal ağırlığı (0..1) */
export function beachAt(x: number, z: number) {
  const { t, s } = polar(x, z);
  const b = Math.exp(-(angDiff(t, BEACH_ANGLE) ** 2) / 0.22);
  return b * smooth(0.5, 0.92, s);
}

export const EDGE_Y = 0.85;

export function heightAt(x: number, z: number) {
  const { s } = polar(x, z);
  const hill = 2.7 * Math.exp(-((x - 1.2) ** 2 + (z + 4.4) ** 2) / 15) + 0.9 * Math.exp(-((x + 3.8) ** 2 + (z + 4.1) ** 2) / 9) + 0.35 * Math.exp(-((x - 6) ** 2 + (z + 2.8) ** 2) / 6);
  const bumps = 0.12 * Math.sin(x * 0.8 + 1) * Math.cos(z * 0.7 - 0.5);
  let h = EDGE_Y + (hill + bumps) * (1 - smooth(0.7, 1, s)) + 0.08 * (1 - s);
  // kumsal: kıyıya doğru suya iner
  const b = beachAt(x, z);
  h = h * (1 - b) + (0.18 + 0.4 * (1 - smooth(0.6, 1, s))) * b;
  return h;
}

export type BuildingId = "denetim" | "beyin" | "google" | "analiz" | "aksiyonlar" | "gecmis";

export interface Spot {
  id: BuildingId;
  x: number;
  z: number;
  rot: number;
  /** etiket yüksekliği */
  top: number;
  /** ağaçların kaçınacağı yarıçap */
  clear: number;
}

export const SPOTS: Spot[] = [
  { id: "denetim", x: 1.3, z: -4.7, rot: 0, top: 6.6, clear: 1.8 },
  { id: "analiz", x: -3.4, z: -4.3, rot: 0.25, top: 5.4, clear: 2.2 },
  { id: "google", x: -5.2, z: 0.2, rot: 0.2, top: 3.2, clear: 2.4 },
  { id: "beyin", x: 6.6, z: -2.9, rot: -0.5, top: 4.4, clear: 2 },
  { id: "aksiyonlar", x: 2.6, z: 2.3, rot: -0.25, top: 2.6, clear: 1.6 },
  { id: "gecmis", x: 14.0, z: 1.4, rot: -1.5, top: 3.4, clear: 1.6 },
];
export const spotOf = (id: BuildingId) => SPOTS.find((s) => s.id === id)!;

export const WELL = { x: 0.6, z: -0.6 };
export const PEN = { x: -3.6, z: 3.6, r: 2.0 };
export const DOCK: [number, number][] = [
  [6.2, 5.2],
  [9.8, 8.1],
];

/** nehir: tepeden kumsala */
export const RIVER: [number, number][] = [
  [2.9, -3.3],
  [3.6, -1.6],
  [4.9, -0.2],
  [5.6, 1.6],
  [6.6, 3.3],
  [7.9, 4.6],
];

/** patikalar (merkez kuyudan binalara) */
export const PATHS: [number, number][][] = [
  [
    [0.6, -0.6],
    [0.9, -2.4],
    [1.3, -3.7],
  ],
  [
    [0.6, -0.6],
    [-1.8, -0.4],
    [-3.8, 0.1],
  ],
  [
    [-1.2, -0.6],
    [-2.4, -2.2],
    [-3.1, -3.3],
  ],
  [
    [0.6, -0.6],
    [1.6, 0.8],
    [2.4, 1.7],
  ],
  [
    [2.6, 2.6],
    [4.2, 3.6],
    [5.9, 4.7],
  ],
  [
    [0.6, -0.6],
    [-1.6, 1.4],
    [-3.0, 2.6],
  ],
];

/** deterministik rastgele */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function distToPolyline(x: number, z: number, line: [number, number][]) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const k = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - (ax + dx * k), z - (az + dz * k)));
  }
  return best;
}

/** ağaç/çit konulabilir mi: bina, patika, nehir, kumsal ve kıyıdan uzak */
export function freeSpot(x: number, z: number, margin = 0) {
  const { s } = polar(x, z);
  if (s > 0.86) return false;
  if (beachAt(x, z) > 0.2) return false;
  for (const sp of SPOTS) if (Math.hypot(x - sp.x, z - sp.z) < sp.clear + margin) return false;
  if (Math.hypot(x - WELL.x, z - WELL.z) < 1.3) return false;
  if (Math.hypot(x - PEN.x, z - PEN.z) < PEN.r + 0.5) return false;
  if (distToPolyline(x, z, RIVER) < 0.9) return false;
  for (const p of PATHS) if (distToPolyline(x, z, p) < 0.6) return false;
  return true;
}
