/** Hava durumu (Open-Meteo — anahtarsız, ücretsiz). İstemci tarafında kullanılır. */

export type WxKind = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "heavy" | "storm" | "snow";

export interface WxPlace {
  name: string;
  lat: number;
  lon: number;
  admin?: string;
}

export interface WxDay {
  date: string; // YYYY-MM-DD
  code: number;
  max: number;
  min: number;
  rain: number;
  windMax: number;
  sunrise: string;
  sunset: string;
}

export interface WxHour {
  time: string; // ISO yerel
  temp: number;
  code: number;
  wind: number;
  rain: number;
  prob: number;
}

export interface Forecast {
  place: WxPlace;
  at: string;
  current: { temp: number; code: number; wind: number; windDir: number; humidity: number; rain: number; isDay: boolean };
  days: WxDay[];
  hours: WxHour[];
  /** ağ yoksa örnek veri */
  offline?: boolean;
}

export const DEFAULT_PLACE: WxPlace = { name: "İstanbul", lat: 41.01, lon: 28.98, admin: "İstanbul" };

/** WMO hava kodu → Türkçe ad + sahne türü */
export function wmo(code: number): { label: string; kind: WxKind } {
  if (code === 0) return { label: "Açık", kind: "clear" };
  if (code === 1) return { label: "Az bulutlu", kind: "clear" };
  if (code === 2) return { label: "Parçalı bulutlu", kind: "partly" };
  if (code === 3) return { label: "Kapalı", kind: "cloudy" };
  if (code === 45 || code === 48) return { label: "Sisli", kind: "fog" };
  if (code >= 51 && code <= 57) return { label: "Çisenti", kind: "drizzle" };
  if (code === 61 || code === 80) return { label: "Hafif yağmur", kind: "rain" };
  if (code === 63 || code === 81 || code === 66) return { label: "Yağmurlu", kind: "rain" };
  if (code === 65 || code === 82 || code === 67) return { label: "Kuvvetli yağmur", kind: "heavy" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: code === 75 || code === 86 ? "Yoğun kar" : "Karlı", kind: "snow" };
  if (code >= 95) return { label: "Gök gürültülü fırtına", kind: "storm" };
  return { label: "Bulutlu", kind: "cloudy" };
}

export async function fetchForecast(place: WxPlace, signal?: AbortSignal): Promise<Forecast> {
  const q = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day",
    hourly: "temperature_2m,weather_code,wind_speed_10m,precipitation,precipitation_probability",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,wind_speed_10m_max",
    timezone: "auto",
    forecast_days: "7",
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal, cache: "no-store" });
  if (!r.ok) throw new Error(`Hava durumu alınamadı (${r.status})`);
  const j = await r.json();
  const d = j.daily;
  const h = j.hourly;
  return {
    place,
    at: new Date().toISOString(),
    current: {
      temp: j.current.temperature_2m,
      code: j.current.weather_code,
      wind: j.current.wind_speed_10m,
      windDir: j.current.wind_direction_10m,
      humidity: j.current.relative_humidity_2m,
      rain: j.current.precipitation,
      isDay: !!j.current.is_day,
    },
    days: (d.time as string[]).map((t, i) => ({
      date: t,
      code: d.weather_code[i],
      max: d.temperature_2m_max[i],
      min: d.temperature_2m_min[i],
      rain: d.precipitation_sum[i],
      windMax: d.wind_speed_10m_max[i],
      sunrise: d.sunrise[i],
      sunset: d.sunset[i],
    })),
    hours: (h.time as string[]).map((t, i) => ({
      time: t,
      temp: h.temperature_2m[i],
      code: h.weather_code[i],
      wind: h.wind_speed_10m[i],
      rain: h.precipitation[i],
      prob: h.precipitation_probability?.[i] ?? 0,
    })),
  };
}

export async function geocode(name: string, signal?: AbortSignal): Promise<WxPlace[]> {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name, count: "6", language: "tr", format: "json" })}`, { signal });
  if (!r.ok) return [];
  const j = await r.json();
  return ((j.results ?? []) as { name: string; latitude: number; longitude: number; admin1?: string; country?: string }[]).map((x) => ({
    name: x.name,
    lat: x.latitude,
    lon: x.longitude,
    admin: [x.admin1, x.country].filter(Boolean).join(", "),
  }));
}

/** Ağ yoksa sahne yine çalışsın diye makul bir örnek (ekim ayı, İstanbul). */
export function sampleForecast(place: WxPlace): Forecast {
  const now = new Date();
  const day = (i: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  };
  const codes = [61, 3, 2, 1, 2, 63, 0];
  const days: WxDay[] = codes.map((c, i) => ({
    date: day(i),
    code: c,
    max: [17, 18, 19, 20, 19, 16, 18][i],
    min: [12, 12, 13, 13, 12, 11, 11][i],
    rain: c >= 61 ? 4 : 0,
    windMax: 14 + i,
    sunrise: `${day(i)}T07:10`,
    sunset: `${day(i)}T18:35`,
  }));
  const hours: WxHour[] = [];
  for (let i = 0; i < 7 * 24; i++) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setHours(i);
    const di = Math.floor(i / 24);
    const hr = i % 24;
    const t = days[di].min + (days[di].max - days[di].min) * Math.max(0, Math.sin(((hr - 6) / 16) * Math.PI));
    hours.push({ time: `${d.toISOString().slice(0, 13)}:00`, temp: Math.round(t * 10) / 10, code: days[di].code, wind: 8 + (hr % 7), rain: days[di].rain ? 0.4 : 0, prob: days[di].rain ? 60 : 5 });
  }
  return {
    place,
    at: now.toISOString(),
    current: { temp: 16, code: 61, wind: 12, windDir: 220, humidity: 82, rain: 0.6, isDay: now.getHours() > 7 && now.getHours() < 19 },
    days,
    hours,
    offline: true,
  };
}

export const TR_DAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
export const TR_DAYS_SHORT = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
export const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
