/** Videodaki gibi açık, beyaz-mavi, yumuşak "cozy" palet; koyu temada gece kampüsü. */
export interface Palette {
  dark: boolean;
  bg: string;
  ground: string;
  pad: string;
  road: string;
  roadLine: string;
  curb: string;
  grass: string;
  wall: string;
  roof: string;
  slab: string;
  trim: string;
  interior: string;
  door: string;
  pallet: string;
  box: string;
  tarp: string;
  slotLine: string;
  leaf: string;
  leaf2: string;
  trunk: string;
  fence: string;
  window: string;
  sun: number;
  ambient: number;
  hemiSky: string;
  hemiGround: string;
}

export const LIGHT: Palette = {
  dark: false,
  bg: "#eaf0f8",
  ground: "#e6ecf4",
  pad: "#f3f6fa",
  road: "#d6deea",
  roadLine: "#ffffff",
  curb: "#f9fbfd",
  grass: "#d7ecd2",
  wall: "#f7f9fc",
  roof: "#eef2f8",
  slab: "#dfe5ee",
  trim: "#2f5bd8",
  interior: "#3a4256",
  door: "#e3e8f0",
  pallet: "#c99f72",
  box: "#e2bd8e",
  tarp: "#b9c2d1",
  slotLine: "#f5c443",
  leaf: "#8fd18b",
  leaf2: "#6cc07a",
  trunk: "#a98163",
  fence: "#c9d2df",
  window: "#9cc3ff",
  sun: 2.4,
  ambient: 0.55,
  hemiSky: "#ffffff",
  hemiGround: "#cfd8e6",
};

export const DARK: Palette = {
  dark: true,
  bg: "#161c2a",
  ground: "#1c2333",
  pad: "#232b3d",
  road: "#2c3548",
  roadLine: "#5d6886",
  curb: "#313a4f",
  grass: "#24402f",
  wall: "#3b455c",
  roof: "#343d52",
  slab: "#2a3245",
  trim: "#6d8bff",
  interior: "#ffcf7a",
  door: "#4a5570",
  pallet: "#9a7653",
  box: "#c39a6b",
  tarp: "#5b6680",
  slotLine: "#d6a935",
  leaf: "#4c9459",
  leaf2: "#3f824c",
  trunk: "#6e5340",
  fence: "#4a5570",
  window: "#ffd889",
  sun: 1.1,
  ambient: 0.55,
  hemiSky: "#a9bbf0",
  hemiGround: "#1a1f2c",
};

export const HOSPITAL_COLOR = { bursa: "#5b7cff", basaksehir: "#2ec4b6" } as const;
export const OK = "#34c26b";
export const FAIL = "#ff5e6c";
