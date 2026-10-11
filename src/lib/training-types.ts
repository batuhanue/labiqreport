/** Eğitim (beynin geçmişten öğrenmesi) tipleri — sunucu ve istemci */
export interface MonthNotes {
  month: string;
  at: string;
  stats: { mails: number; threads: number; engaged: number; chats: number; meetings: number; events: number };
  /** o ayda okunacak kadar veri yoktu */
  empty?: boolean;
  processes: { name: string; when: string; steps: string[]; people: string[]; evidence: string }[];
  people: { name: string; role: string; needs: string }[];
  urgent: string[];
  ignored: string[];
  rules: string[];
  commitments: string[];
  questions: { q: string; why: string }[];
}

export interface TrainingQuestion {
  id: string;
  q: string;
  why: string;
  at: string;
  answer?: string;
  answeredAt?: string;
  skipped?: boolean;
}

export interface TrainingState {
  months: Record<string, MonthNotes>;
  profileAt?: string;
  /** yeni cevap geldi: iş bilgisi bir sonraki adımda yeniden yazılır */
  resynth?: boolean;
  questions: TrainingQuestion[];
  running?: number;
  lastError?: string;
  log: { at: string; did: string[]; ms: number; cost: number; error?: string }[];
}

/** Beynin önem isabeti (son N gün, Batuhan'ın seçimlerinden) */
export interface ImportanceStats {
  days: number;
  /** onaylanan / görevlere alınan öneriler */
  accepted: number;
  /** "Önemsiz / gürültü" ya da "Benim işim değil" ile reddedilenler */
  noise: number;
  notMine: number;
  /** diğer retler ("Zaten yapıldı", "Şimdi değil" → zamanlama; isabete sayılmaz) */
  timing: number;
  /** beynin kaçırdığı (Batuhan'ın gösterdiği) önemli mesajlar */
  missed: number;
  /** önceliği değiştirilen öneriler */
  reprioritized: number;
  /** isabet % (null: yeterli seçim yok) */
  precision: number | null;
  /** önceki dönem isabeti */
  prevPrecision: number | null;
  byAgent: Record<string, { accepted: number; rejected: number }>;
}

export interface TrainingView {
  months: { month: string; at?: string; empty?: boolean; stats?: MonthNotes["stats"] }[];
  profileAt?: string;
  resynth?: boolean;
  peopleAt?: string;
  people: number;
  running: boolean;
  due: boolean;
  hasArchive: boolean;
  archive: { total: number; kurum: number };
  questions: TrainingQuestion[];
  log: TrainingState["log"];
  lastError?: string;
  account?: string;
}
