/** Şirket verisi (dosya yöneticisi) tipleri — sunucu ve istemci */
import { MONTHS, periodLabel } from "./period";

/** Klasör hiyerarşisi: hastane → dönem → kategori */
export const KURUM_HOSPITALS = [
  { id: "bursa", label: "Bursa" },
  { id: "basaksehir", label: "Başakşehir" },
  { id: "genel", label: "Şirket geneli" },
] as const;
export type KurumHospital = (typeof KURUM_HOSPITALS)[number]["id"];
export const hospitalLabel = (h: string) => KURUM_HOSPITALS.find((x) => x.id === h)?.label ?? h;

export interface KurumCategory {
  id: string;
  name: string;
  /** beynin dosyaların ne olduğunu anlaması için: içerik, kaynak sistem, ne için kullanılır */
  description: string;
  createdAt: string;
}

export interface KurumFile {
  id: string;
  name: string;
  kind: string;
  size: number;
  chars: number;
  parts: number;
  uploadedAt: string;
  hospital: string;
  /** YYYY-MM ya da çok aylı aralık YYYY-MM..YYYY-MM (ör. Ocak–Temmuz tek dosyada); boş = dönemsiz (prosedür, sözleşme gibi) */
  period: string;
  /** kategori kimliği; boş = kategorisiz */
  category: string;
  /** PDF metni süre dolduğu için yarım kaldıysa */
  partial?: boolean;
  /** tablo (csv/tsv) başlık satırı: parça parça gelen dosyada her parçaya eklenir */
  header?: string;
  /** tablo dosyasında bulunan aylar (tarih sütunundan, kodla sayıldı) */
  coverage?: { months: string[]; rows: number; dated: boolean };
}

/** Eğitim birimi: bir hastanenin bir dönemindeki bir kategori */
export interface KurumUnit {
  key: string;
  hospital: string;
  period: string;
  category: string;
  files: number;
  chars: number;
  /** öğrenildiyse zamanı */
  trainedAt?: string;
  /** öğrenildikten sonra dosyaları değişti */
  stale?: boolean;
  /** öğrenilen özet (kısa) */
  summary?: string;
}

export const unitKey = (hospital: string, period: string, category: string) => `${hospital}|${period}|${category}`;
// ------------------------------------------------------------------ dönem: tek ay ya da aralık
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MAX_RANGE_MONTHS = 36;
/** "2026-01..2026-07" → { from: "2026-01", to: "2026-07" }; tek ay → from = to */
export function periodRange(p: string): { from: string; to: string } | null {
  const parts = p.split("..");
  const [from, to = from] = parts;
  return parts.length <= 2 && MONTH_RE.test(from) && MONTH_RE.test(to) ? { from, to } : null;
}
/** aralıktaki aylar (YYYY-MM) */
export function periodMonths(p: string): string[] {
  const r = periodRange(p);
  if (!r) return [];
  const out: string[] = [];
  let [y, m] = r.from.split("-").map(Number);
  while (out.length <= MAX_RANGE_MONTHS) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.push(k);
    if (k >= r.to) break;
    m = m === 12 ? 1 : m + 1;
    if (m === 1) y++;
  }
  return out;
}
/** başlangıç/bitiş → dönem değeri (aynı ay: tek ay; ters seçildiyse düzeltilir) */
export function makePeriod(from: string, to?: string) {
  if (!to || to === from) return from;
  return from < to ? `${from}..${to}` : `${to}..${from}`;
}
/** boş, tek ay ya da en çok 36 aylık aralık mı */
export function validPeriod(p: string) {
  if (!p) return true;
  const r = periodRange(p);
  if (!r || r.from > r.to) return false;
  return !p.includes("..") || (r.from < r.to && periodMonths(p).length <= MAX_RANGE_MONTHS);
}
export const periodText = (p: string) => {
  if (!p) return "Dönemsiz";
  const r = periodRange(p);
  if (!r) return p;
  if (r.from === r.to) return periodLabel(r.from);
  const [y1, m1] = r.from.split("-").map(Number);
  const [y2, m2] = r.to.split("-").map(Number);
  return y1 === y2 ? `${MONTHS[m1 - 1]}–${MONTHS[m2 - 1]} ${y1}` : `${periodLabel(r.from)} – ${periodLabel(r.to)}`;
};
/** dönem bir aralıksa ay sayısı (tek ay/dönemsiz: 0) */
export const rangeMonths = (p: string) => (p.includes("..") ? periodMonths(p).length : 0);
/** dosyada bulunan aylar → kısa metin; dönem aralıksa eksik ve dönem dışı aylar */
export function coverageInfo(months: string[], period: string) {
  if (!months.length) return null;
  const all = makePeriod(months[0], months[months.length - 1]);
  const span = periodMonths(all).length === months.length && validPeriod(all) ? periodText(all) : `${months.length} ay (${periodText(months[0])} … ${periodText(months[months.length - 1])})`;
  const exp = period.includes("..") ? periodMonths(period) : period ? [period] : [];
  return { span, missing: exp.filter((m) => !months.includes(m)), outside: exp.length ? months.filter((m) => !exp.includes(m)) : [] };
}
export const folderText = (hospital: string, period: string, categoryName: string) => `${hospitalLabel(hospital)} · ${periodText(period)} · ${categoryName || "Kategorisiz"}`;
