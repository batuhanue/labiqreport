/** Kişi haritası tipleri (sunucu ve istemci) */
export type Relation = "yonetici" | "ust_yonetim" | "ekip" | "is_birimi" | "dis" | "otomatik" | "diger";

export interface Person {
  /** e-posta (küçük harf) ya da "ad:<normalleştirilmiş ad>" */
  key: string;
  name: string;
  email?: string;
  /** ondan gelen e-posta (son 180 gün) */
  inbound: number;
  /** Batuhan'ın ona yazdığı e-posta */
  outbound: number;
  /** ondan gelen yazışma (thread) sayısı */
  threads: number;
  /** bunlardan Batuhan'ın yanıt verdikleri */
  replied: number;
  /** medyan yanıt süresi (saat) */
  replyHours?: number;
  chat: number;
  meetings: number;
  lastAt?: string;
  subjects: string[];
  /** otomatik gönderici gibi görünüyor (noreply, bildirim) */
  auto?: boolean;
  // Claude'un etiketi
  role?: string;
  relation?: Relation;
  tier?: 1 | 2 | 3;
  expects?: string;
  // Batuhan'ın düzeltmesi (her zaman esas)
  override?: 1 | 2 | 3;
  note?: string;
}

export interface PeopleStore {
  at: string;
  labeledAt?: string;
  people: Person[];
}

export const TIER_TEXT = { 1: "Kritik", 2: "Önemli", 3: "Rutin" } as const;
