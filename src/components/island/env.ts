import * as THREE from "three";
import type { WxKind } from "@/lib/weather";

export type Season = "spring" | "summer" | "autumn" | "winter";
export type Quality = "low" | "mid" | "high";

export interface ViewSettings {
  tod: "live" | "morning" | "day" | "evening" | "night";
  wx: "live" | WxKind;
  season: "live" | Season;
  quality: "auto" | Quality;
}
export const DEFAULT_VIEW: ViewSettings = { tod: "live", wx: "live", season: "live", quality: "auto" };

export function seasonOf(d = new Date()): Season {
  const m = d.getMonth();
  return m <= 1 || m === 11 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "autumn";
}

/** Sahnenin o anki ışık/renk/hava ayarı. */
export interface Env {
  hour: number;
  /** güneş yüksekliği -1..1 (0 ufuk) */
  sunE: number;
  night: number; // 0 gündüz .. 1 gece
  dusk: number; // gün doğumu/batımı sıcaklığı
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  fog: THREE.Color;
  fogNear: number;
  fogFar: number;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunI: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiI: number;
  waterShallow: THREE.Color;
  waterDeep: THREE.Color;
  clouds: number; // 0..1 örtü
  cloudDark: number;
  rain: number;
  snow: number;
  storm: boolean;
  wind: number; // 0..1
  season: Season;
}

const C = (h: string) => new THREE.Color(h);
const mix = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, Math.min(1, Math.max(0, t)));

const WX: Record<WxKind, { clouds: number; dark: number; rain: number; snow: number; fog: number; storm?: boolean; gray: number }> = {
  clear: { clouds: 0.15, dark: 0, rain: 0, snow: 0, fog: 0, gray: 0 },
  partly: { clouds: 0.45, dark: 0.05, rain: 0, snow: 0, fog: 0, gray: 0.1 },
  cloudy: { clouds: 0.85, dark: 0.3, rain: 0, snow: 0, fog: 0.15, gray: 0.35 },
  fog: { clouds: 0.5, dark: 0.15, rain: 0, snow: 0, fog: 1, gray: 0.45 },
  drizzle: { clouds: 0.8, dark: 0.3, rain: 0.25, snow: 0, fog: 0.25, gray: 0.35 },
  rain: { clouds: 0.9, dark: 0.45, rain: 0.6, snow: 0, fog: 0.3, gray: 0.45 },
  heavy: { clouds: 1, dark: 0.6, rain: 1, snow: 0, fog: 0.4, gray: 0.55 },
  storm: { clouds: 1, dark: 0.85, rain: 1, snow: 0, fog: 0.4, storm: true, gray: 0.7 },
  snow: { clouds: 0.9, dark: 0.25, rain: 0, snow: 1, fog: 0.35, gray: 0.4 },
};

export function computeEnv(o: { hour: number; sunrise: number; sunset: number; kind: WxKind; season: Season; windKmh: number }): Env {
  const { hour, sunrise, sunset } = o;
  const dayLen = Math.max(1, sunset - sunrise);
  // güneş: doğuştan batışa yay; gece ufkun altında
  let sunE: number;
  if (hour >= sunrise && hour <= sunset) sunE = Math.sin((Math.PI * (hour - sunrise)) / dayLen);
  else {
    const nightLen = 24 - dayLen;
    const k = hour > sunset ? hour - sunset : hour + 24 - sunset;
    sunE = -Math.sin((Math.PI * k) / nightLen);
  }
  const night = 1 - Math.min(1, Math.max(0, (sunE + 0.12) / 0.3));
  const dusk = Math.max(0, 1 - Math.abs(sunE) / 0.32) * (1 - night * 0.6);
  const w = WX[o.kind];

  // gökyüzü
  let top = C("#b9d6ee");
  let hor = C("#eaf1f4");
  top = mix(top, C("#a8b4dc"), dusk * 0.8);
  hor = mix(hor, C("#f7c9a0"), dusk * 0.9);
  top = mix(top, C("#0e1b47"), night);
  hor = mix(hor, C("#22356c"), night);
  const gray = w.gray;
  top = mix(top, mix(C("#b5bfc8"), C("#1c2440"), night), gray * 0.85);
  hor = mix(hor, mix(C("#d2d9de"), C("#2a3555"), night), gray * 0.8);
  if (w.storm) {
    top = mix(top, C("#4c5566"), 0.5 * (1 - night));
    hor = mix(hor, C("#8a93a0"), 0.45 * (1 - night));
  }

  // güneş / ay
  const az = ((hour - 6) / 24) * Math.PI * 2;
  const el = Math.max(0.12, Math.abs(sunE)) * 1.15;
  const sunDir = new THREE.Vector3(Math.cos(az) * 1.2, el * 1.6 + 0.3, Math.sin(az) * 0.6 + 0.9).normalize();
  let sunColor = mix(C("#fff3dd"), C("#ffb36b"), dusk);
  sunColor = mix(sunColor, C("#9fb4ff"), night);
  const sunI = (night > 0.5 ? 0.7 : 2.3 * (1 - dusk * 0.35)) * (1 - w.dark * 0.5);

  let hemiSky = mix(C("#dfeefa"), C("#ffd6b5"), dusk * 0.6);
  hemiSky = mix(hemiSky, C("#5068ad"), night);
  const hemiGround = mix(C("#8b7a5a"), C("#26305a"), night);
  const hemiI = (night > 0.5 ? 0.95 : 1.05) * (1 - w.dark * 0.2);

  let shallow = C("#71d3e2");
  let deep = C("#2f86d2");
  shallow = mix(shallow, C("#e8a983"), dusk * 0.25);
  deep = mix(deep, C("#3b62ad"), dusk * 0.4);
  shallow = mix(shallow, C("#1e5694"), night);
  deep = mix(deep, C("#0f2a67"), night);
  shallow = mix(shallow, C("#7fb0bd"), gray * 0.5);
  deep = mix(deep, C("#3d6a96"), gray * 0.5);

  const fog = mix(hor, top, 0.15);
  const fogFar = 175 - w.fog * 95;
  const fogNear = 52 - w.fog * 25;
  return {
    hour,
    sunE,
    night,
    dusk,
    skyTop: top,
    skyHorizon: hor,
    fog,
    fogNear,
    fogFar,
    sunDir,
    sunColor,
    sunI,
    hemiSky,
    hemiGround,
    hemiI,
    waterShallow: shallow,
    waterDeep: deep,
    clouds: w.clouds,
    cloudDark: Math.min(1, w.dark + night * 0.3),
    rain: w.rain,
    snow: w.snow,
    storm: !!w.storm,
    wind: Math.min(1, o.windKmh / 45),
    season: o.season,
  };
}

/** ağaç taç renkleri (mevsime göre) */
export const LEAVES: Record<Season, string[]> = {
  autumn: ["#f2b544", "#ec9a3a", "#e07a35", "#d65f36", "#f0c35a", "#c9733e"],
  summer: ["#7fb24a", "#6aa23f", "#8cc157", "#5f9a3b", "#9ccc62"],
  spring: ["#8cc760", "#a3d36f", "#f4b6c8", "#eea2bd", "#7cbf55"],
  winter: ["#e9eef2", "#dfe6ec", "#cfd8df", "#f4f7f9"],
};
export const GRASS: Record<Season, [string, string]> = {
  autumn: ["#86ad4c", "#9bb855"],
  summer: ["#79b04a", "#8fc157"],
  spring: ["#7dbb52", "#96cb62"],
  winter: ["#e6edf1", "#d6e0e6"],
};

export const cloneEnv = (e: Env): Env => ({
  ...e,
  skyTop: e.skyTop.clone(),
  skyHorizon: e.skyHorizon.clone(),
  fog: e.fog.clone(),
  sunDir: e.sunDir.clone(),
  sunColor: e.sunColor.clone(),
  hemiSky: e.hemiSky.clone(),
  hemiGround: e.hemiGround.clone(),
  waterShallow: e.waterShallow.clone(),
  waterDeep: e.waterDeep.clone(),
});

/** cur'u hedefe doğru yumuşakça yaklaştırır (ayar/saat değişince ışık zıplamasın) */
export function lerpEnv(cur: Env, t: Env, k: number) {
  for (const key of ["skyTop", "skyHorizon", "fog", "sunColor", "hemiSky", "hemiGround", "waterShallow", "waterDeep"] as const) cur[key].lerp(t[key], k);
  cur.sunDir.lerp(t.sunDir, k).normalize();
  for (const key of ["sunE", "night", "dusk", "fogNear", "fogFar", "sunI", "hemiI", "clouds", "cloudDark", "rain", "snow", "wind"] as const) cur[key] += (t[key] - cur[key]) * k;
  cur.hour = t.hour;
  cur.storm = t.storm;
  cur.season = t.season;
}
