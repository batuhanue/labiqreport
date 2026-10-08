/**
 * Beyin: gelen her şeyi (e-posta, sohbet, takvim, toplantı, denetim, elle yazılan) anlayıp
 * Batuhan'ın işini önceleyerek işlere (görev / iş akışı) çeviren merkez ve ona bağlı yan ajanlar.
 * Sunucu ve istemci ortak tipleri.
 */

export type AgentId = "posta" | "sohbet" | "takvim" | "toplanti" | "denetim" | "dosya" | "gorev";

export interface AgentMeta {
  id: AgentId;
  name: string;
  emoji: string;
  color: string;
  /** bağlı kaynak */
  source: string;
  /** ne yapar (arayüzde) */
  role: string;
}

export const AGENTS: AgentMeta[] = [
  { id: "posta", name: "Posta ajanı", emoji: "📨", color: "#ff5e6c", source: "Gmail", role: "Yeni e-postaları okur; senden istenen işi, yanıt gerekenleri ve terminleri çıkarır." },
  { id: "sohbet", name: "Sohbet ajanı", emoji: "💬", color: "#2ec4b6", source: "Google Chat", role: "Sana yazılan mesajlardaki istekleri ve verdiğin sözleri yakalar." },
  { id: "takvim", name: "Takvim ajanı", emoji: "📅", color: "#5b7cff", source: "Takvim", role: "Önümüzdeki toplantılar için hazırlık işleri ve yanıt bekleyen davetler." },
  { id: "toplanti", name: "Toplantı ajanı", emoji: "🎥", color: "#8b5cf6", source: "Meet", role: "Transkriptlerden kararları ve sana düşen aksiyonları çıkarır." },
  { id: "denetim", name: "Denetim ajanı", emoji: "✅", color: "#34c26b", source: "Denetim", role: "10 başlığın terminlerini, eksik kontrolleri ve ✗ bulguların takibini izler." },
  { id: "dosya", name: "Dosya ajanı", emoji: "📁", color: "#ffa53d", source: "Drive", role: "Her işe arşivden (Drive dahil) ilgili dosyaları bulup ekler." },
  { id: "gorev", name: "Görev ajanı", emoji: "🗂️", color: "#9aa3b5", source: "Elle girilenler", role: "Beyne yazdıklarını işe çevirir; onaylanan işleri görev listene aktarır." },
];
export const agentById = (id: string) => AGENTS.find((a) => a.id === id);

/** Kaynaklardan toplanan ham girdi. */
export interface Signal {
  /** kaynak:kimlik — tekrar işlenmesin diye */
  id: string;
  agent: AgentId;
  ts: string;
  title: string;
  who?: string;
  text: string;
  link?: string;
  /** arşivdeki kayıt (uygulama içinde açmak için) */
  ref?: { source: string; id: string };
}

export type ItemKind = "gorev" | "yanit" | "toplanti" | "takip" | "bilgi";
export const KIND_LABEL: Record<ItemKind, string> = { gorev: "Görev", yanit: "Yanıt gerekli", toplanti: "Toplantı hazırlığı", takip: "Takip", bilgi: "Bilgi" };

/** Kanban sütunları: öneri → yapılacak → devam → bekliyor → bitti; reddedilen gizlenir. */
export type ItemStatus = "inbox" | "todo" | "doing" | "waiting" | "done" | "dismissed";
export const STATUS_META: Record<Exclude<ItemStatus, "dismissed">, { label: string; hint: string; color: string }> = {
  inbox: { label: "Öneriler", hint: "Ajanlar önerdi, onayını bekliyor", color: "#8b5cf6" },
  todo: { label: "Yapılacak", hint: "Onaylandı", color: "#5b7cff" },
  doing: { label: "Devam ediyor", hint: "Üzerinde çalışıyorsun", color: "#ffa53d" },
  waiting: { label: "Bekliyor", hint: "Başkasından yanıt/veri bekleniyor", color: "#9aa3b5" },
  done: { label: "Bitti", hint: "Son 7 gün", color: "#34c26b" },
};

export interface ItemSource {
  agent: AgentId;
  signalId: string;
  title: string;
  who?: string;
  ts: string;
  link?: string;
  ref?: { source: string; id: string };
}

export interface ItemFile {
  id: string;
  name: string;
  link?: string;
  excerpt?: string;
}

export interface BrainItem {
  id: string;
  title: string;
  /** ne isteniyor, kimden */
  summary: string;
  /** neden Batuhan'ın işi / rolüne göre önemi */
  why: string;
  kind: ItemKind;
  priority: 1 | 2 | 3 | 4;
  due?: string;
  person?: string;
  area?: string;
  steps: { title: string; done: boolean }[];
  files: ItemFile[];
  sources: ItemSource[];
  agent: AgentId;
  status: ItemStatus;
  /** Görevler listesine aktarıldıysa görev kimliği */
  todoId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrainFocus {
  at: string;
  /** beynin kısa brifingi (markdown) */
  brief: string;
  /** öncelik sırası: iş kimliği ya da "todo:<id>" */
  order: { id: string; reason: string }[];
}

export interface AgentRun {
  agent: AgentId;
  signals: number;
  created: number;
  updated: number;
  ms: number;
  error?: string;
}

export interface BrainRun {
  id: string;
  at: string;
  trigger: "manual" | "auto" | "cron" | "capture";
  ms: number;
  agents: AgentRun[];
  files: number;
  tokens: number;
  cost: number | null;
  error?: string;
}

export interface BrainState {
  items: BrainItem[];
  focus: BrainFocus | null;
  runs: BrainRun[];
  lastRun?: string;
  running?: boolean;
  /** her ajan için bekleyen (henüz işlenmemiş) sinyal sayısı — bir sonraki düşünmede işlenecek */
  pending?: Partial<Record<AgentId, number>>;
}
