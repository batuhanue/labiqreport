/** Google Workspace senkron verisi — sunucu ve istemci ortak tipleri. */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export interface GAccount {
  email: string;
  name: string;
  picture?: string;
}

export interface GEvent {
  id: string;
  title: string;
  /** ISO tarih-saat; tüm gün etkinliklerinde YYYY-MM-DD */
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  meet?: string;
  link: string;
  organizer?: string;
  attendees: { name: string; email: string; status?: string }[];
  /** kullanıcının yanıtı: accepted / declined / tentative / needsAction */
  response?: string;
}

export interface GMail {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  important: boolean;
  link: string;
}

export interface GChatMsg {
  id: string;
  sender: string;
  mine: boolean;
  text: string;
  time: string;
}

export interface GChatSpace {
  id: string;
  title: string;
  kind: "SPACE" | "GROUP_CHAT" | "DIRECT_MESSAGE";
  lastActive?: string;
  link: string;
  messages: GChatMsg[];
}

export interface GMeeting {
  id: string;
  code?: string;
  title?: string;
  start: string;
  end?: string;
  participants: string[];
  transcripts: { url?: string; state?: string; name?: string }[];
  recordings: { url?: string }[];
  /** transkript metninin başı (asistan için) */
  transcriptText?: string;
}

export interface GFile {
  id: string;
  name: string;
  mime: string;
  /** son değişiklik (ISO) */
  modified: string;
  modifiedBy?: string;
  owner?: string;
  /** Drive'da açma bağlantısı */
  link: string;
  size?: number;
  /** klasör mü */
  folder?: boolean;
  /** benimle paylaşılan (sahibi başkası) */
  shared?: boolean;
  starred?: boolean;
  /** ortak drive adı ya da kimliği */
  drive?: string;
}

interface Part<T> {
  items: T[];
  error?: string;
}

export interface GoogleSnapshot {
  syncedAt: string;
  ms: number;
  account: GAccount;
  calendar: Part<GEvent>;
  gmail: Part<GMail> & { unread?: number };
  chat: Part<GChatSpace>;
  meet: Part<GMeeting>;
  /** son değişen Drive dosyaları (eski görüntülerde yok) */
  drive?: Part<GFile>;
}

export interface GoogleStatus {
  /** GOOGLE_CLIENT_ID / SECRET tanımlı mı */
  configured: boolean;
  connected: boolean;
  /** yetki iptal edildi / süresi doldu: yeniden bağlanmalı */
  needsReauth?: boolean;
  account?: GAccount;
  scopes?: string[];
  snapshot?: GoogleSnapshot | null;
  redirectUri?: string;
}

// ------------------------------------------------------------------ arşiv (geriye dönük hafıza)
export type ArchiveSource = "gmail" | "chat" | "meet" | "calendar" | "drive";

export interface ArchiveItem {
  source: ArchiveSource;
  id: string;
  ts: string;
  title: string;
  /** gönderen / katılımcılar */
  who: string;
  body: string;
  link?: string;
  meta?: Record<string, unknown> | null;
}

export interface ArchiveHit {
  source: ArchiveSource;
  id: string;
  ts: string;
  title: string;
  who: string;
  excerpt: string;
  link?: string;
}

export interface ArchiveStats {
  total: number;
  bySource: Partial<Record<ArchiveSource, { count: number; oldest: string }>>;
}

export interface ArchiveProgress {
  stats: ArchiveStats;
  /** geçmişin tamamı indirildi mi (kaynak bazında) */
  done: Partial<Record<ArchiveSource, boolean>>;
  running?: boolean;
  /** izni verilmemiş kaynaklar (yeniden bağlanınca indirilir) */
  needsScope?: ArchiveSource[];
  lastError?: string;
  updatedAt?: string;
}
