/** Şirket verisi (dosya yöneticisi) tipleri — sunucu ve istemci */
import { periodLabel } from "./period";

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
  /** YYYY-MM; boş = dönemsiz (prosedür, sözleşme gibi) */
  period: string;
  /** kategori kimliği; boş = kategorisiz */
  category: string;
  /** PDF metni süre dolduğu için yarım kaldıysa */
  partial?: boolean;
  /** tablo (csv/tsv) başlık satırı: parça parça gelen dosyada her parçaya eklenir */
  header?: string;
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
export const periodText = (p: string) => (p ? periodLabel(p) : "Dönemsiz");
export const folderText = (hospital: string, period: string, categoryName: string) => `${hospitalLabel(hospital)} · ${periodText(period)} · ${categoryName || "Kategorisiz"}`;
