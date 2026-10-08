import { AREAS, type Area } from "@/lib/checklist";

/**
 * Kampüs yerleşimi (dünya birimi ≈ metre). 10 rapor alanı = 10 depo binası, bulvarın iki yanında iki sıra.
 * Her kontrol maddesi binanın ön cephesinde bir yükleme rampası; önünde iki palet yeri (Bursa / Başakşehir).
 */
export const DOCK = 2.7; // rampa aralığı
export const DEPTH = 7.5;
/** Kuzey sıra bulvarın arkasında, güney sıra önünde; hepsinin rampaları kameraya (+z) bakar. */
export const ROW_Z = { north: -12, south: 9 };
export const GAP = 4;

export interface Lot {
  area: Area;
  index: number;
  /** bina merkezi (dünya) */
  x: number;
  z: number;
  /** y ekseni dönüşü; 0 = ön yüz +z (kameraya doğru) */
  rot: number;
  w: number;
  h: number;
  d: number;
}

const widthOf = (a: Area) => a.items.length * DOCK + 2.4;

function row(areas: Area[], offset: number, z: number, rot: number): Lot[] {
  const total = areas.reduce((s, a) => s + widthOf(a), 0) + GAP * (areas.length - 1);
  let x = -total / 2;
  return areas.map((a, i) => {
    const w = widthOf(a);
    const lot: Lot = { area: a, index: offset + i, x: x + w / 2, z, rot, w, h: a.priority ? 4.4 : 3.6, d: DEPTH };
    x += w + GAP;
    return lot;
  });
}

export const LOTS: Lot[] = [...row(AREAS.slice(0, 5), 0, ROW_Z.north, 0), ...row(AREAS.slice(5), 5, ROW_Z.south, 0)];

export const BOUNDS = (() => {
  const xs = LOTS.flatMap((l) => [l.x - l.w / 2, l.x + l.w / 2]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs) };
})();

/** Merkez bina (Diacore) bulvarın doğu ucunda, konteyner sahası batı ucunda. */
export const HQ = { x: BOUNDS.maxX + 14, z: 0 };
export const YARD = { x: BOUNDS.minX - 13, z: 0 };

/** Çevre yolu (dikdörtgen) */
export const RING = { x0: BOUNDS.minX - 24, x1: BOUNDS.maxX + 26, z0: -23, z1: 23 };

/** i. rampanın yerel x konumu */
export const dockX = (l: Lot, i: number) => -((l.area.items.length - 1) * DOCK) / 2 + i * DOCK;

export const lotByCode = (code: string) => LOTS.find((l) => l.area.code === code);
