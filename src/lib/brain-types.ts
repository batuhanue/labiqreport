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
  waiting: { label: "Bekliyor", hint: "Onayın ya da başkasının yanıtı bekleniyor", color: "#9aa3b5" },
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

/** Ajanın bu iş için ürettiği teslimat (taslak yanıt, özet, analiz…). */
export interface ItemWork {
  /** queued: ajan kendisi yapacak (güven seviyesi 2 ya da beyin önden hazırlıyor), sırada */
  status: "queued" | "running" | "ready" | "waiting_ok" | "approved" | "error";
  /** followup: yanıt gelmeyen gönderim için hatırlatma taslağı */
  purpose?: "followup";
  /** markdown teslimat */
  output: string;
  /** dışarıya gidecekse ne gideceği (onay kapısı) */
  outbound?: string;
  /** kullandığı araçlar (ör. "🔎 E-postalarda aranıyor: sayım") */
  used: string[];
  /** düzeltme geçmişi */
  revisions: { at: string; feedback: string; rule?: string }[];
  at: string;
  ms?: number;
  cost?: number | null;
  error?: string;
  /** ekip olarak yapıldıysa: lider işi parçalara böldü, ajanlar aynı anda çalıştı, lider birleştirdi */
  team?: TeamRun;
  /** onaylanınca Gmail'e yazılan taslak (gönderim Batuhan'da: Gmail'de açıp "Gönder") */
  draft?: MailDraft;
}

export interface MailDraft {
  id: string;
  messageId: string;
  link: string;
  to: string[];
  cc: string[];
  subject: string;
  /** bir e-postaya yanıt olarak mı (aynı yazışmada) */
  reply: boolean;
  threadId?: string;
  at: string;
}

export interface TeamPiece {
  agent: AgentId;
  task: string;
  output: string;
  status: "running" | "done" | "error";
  used: string[];
  ms?: number;
}
export interface TeamRun {
  lead: AgentId;
  pieces: TeamPiece[];
  /** ajanların birbirine / lidere bıraktığı notlar */
  notes: { from: AgentId; to: string; text: string }[];
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
  /** ajan güven seviyesiyle kendisi onayladı (Batuhan'a sormadan Yapılacak'a aldı) */
  auto?: { at: string; level: TrustLevel };
  work?: ItemWork;
  /** bu tarihe (YYYY-AA-GG) kadar kararlarda gösterilmez ("Sonra") */
  snoozeUntil?: string;
  /** beyin teslimatı sen istemeden önden hazırladı (öneri hâlâ senin onayında) */
  prep?: boolean;
  /** strateji katmanının açtığı iş (risk, takip, çakışma) */
  origin?: "strateji";
  /** gönderildi, yanıt bekleniyor */
  followUp?: FollowUp;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUp {
  to: string[];
  threadId?: string;
  /** gönderim zamanı (ISO) */
  since: string;
  /** bu tarihe kadar yanıt gelmezse hatırlat (YYYY-AA-GG) */
  due: string;
  nudges: number;
  /** yanıt geldiyse zamanı ve özeti */
  replied?: { at: string; from: string; snippet: string };
}

/** Beynin sana sunduğu tek karar: durum → önerim → tek tuş. Her karar bir işe bağlıdır. */
export interface Decision {
  itemId: string;
  /** durum, tek cümle ("Hakan Bey Eylül tüketim verisini soruyor") */
  headline: string;
  /** öneri, emir kipinde tek cümle ("Hazırladığım yanıtı gönder; veri 3 Ekim'de yüklendi") */
  recommendation: string;
  why: string;
  urgency: 1 | 2 | 3;
  type: "reply" | "accept" | "follow_up" | "risk" | "prep" | "do";
}

export interface PlanBlock {
  /** HH:MM (İstanbul) */
  start: string;
  end: string;
  title: string;
  kind: "meeting" | "focus";
  itemId?: string;
}

export interface BrainFocus {
  at: string;
  /** beynin kısa brifingi (markdown) */
  brief: string;
  /** öncelik sırası: iş kimliği ya da "todo:<id>" */
  order: { id: string; reason: string }[];
  /** tek cümlelik durum ("Bugün 3 karar ve 1 risk var; en önemlisi …") */
  headline?: string;
  /** senin vermen gereken kararlar (en önemliden) */
  decisions?: Decision[];
  /** bugünün planı: toplantılar + boş saatlere yerleştirilmiş odak blokları */
  plan?: PlanBlock[];
  /** plan hangi gün için */
  day?: string;
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
  /** bu düşünmede açılan işler */
  createdIds?: string[];
  /** strateji katmanının sunduğu karar sayısı */
  decisions?: number;
  /** yanıtı gelen gönderimler */
  replied?: string[];
  /** ajanların güven seviyesiyle kendisi onayladığı işler */
  autoIds?: string[];
}

export interface BrainState {
  items: BrainItem[];
  focus: BrainFocus | null;
  runs: BrainRun[];
  lastRun?: string;
  running?: boolean;
  /** her ajan için bekleyen (henüz işlenmemiş) sinyal sayısı — bir sonraki düşünmede işlenecek */
  pending?: Partial<Record<AgentId, number>>;
  /** seçimlerden öğrenme: bekleyen seçim sayısı ve son öğrenilenler */
  learning?: LearningState;
  /** ajanların güven seviyeleri ve onay istatistikleri */
  trust?: Record<AgentId, AgentTrustView>;
}

// ------------------------------------------------------------------ kazanılan güven
/*
 * 0 Öner: her işi sorar · 1 Kendisi onaylasın: güvenilir türdeki yeni işleri doğrudan Yapılacak'a alır ·
 * 2 Teslimatı da hazırlasın: onayladığı işi hemen yapar. Dışarıya giden hiçbir şey otomatik gitmez.
 * Seçimlerden onay oranı hesaplanır, hak edince yükseltme önerilir; yanlış otomatik onaylarda kendiliğinden düşer.
 */
export type TrustLevel = 0 | 1 | 2;
export const TRUST_META: { label: string; short: string; hint: string }[] = [
  { label: "Öner", short: "Öner", hint: "Her yeni işi sana sorar" },
  { label: "Kendisi onaylasın", short: "Onaylar", hint: "Onay oranı yüksek türdeki yeni işleri sormadan Yapılacak'a alır" },
  { label: "Teslimatı da hazırlasın", short: "Yapar", hint: "Onayladığı işi hemen yapar; gidecek bir şey varsa yine onayını bekler" },
];
export interface AgentTrust {
  level: TrustLevel;
  since?: string;
  /** sistemin kendiliğinden düşürdüğü durumda açıklama */
  note?: string;
}
export interface TrustStats {
  /** son 60 gündeki kararların: onay (onay, görevlere ekleme, bitirme) ve ret */
  accepted: number;
  rejected: number;
  /** teslimat: onay ve düzeltme */
  delivered: number;
  fixed: number;
  /** yanlış otomatik onaylar (son 14 gün) */
  wrongAuto: number;
  /** türlere göre (onay, ret) — düşük oranlı türler yine sorulur */
  byKind: Partial<Record<ItemKind, [number, number]>>;
}
export interface AgentTrustView extends AgentTrust {
  stats: TrustStats;
  /** hak ettiği bir üst seviye (öneri) */
  suggest?: TrustLevel;
  /** bu seviyede yine de sorulacak türler */
  askKinds: ItemKind[];
}

// ------------------------------------------------------------------ seçimlerden öğrenme
/*
 * Batuhan'ın uygulamadaki her seçimi (öneriye evet/hayır, öncelik, ajan değişikliği, görev tamamlama…)
 * kaydedilir; asistan bunlardan kalıcı tercihler çıkarıp belleğe (gelistirme.md) yazar.
 */
export type ChoiceKind =
  | "accept"
  | "reject"
  | "done"
  | "reopen"
  | "priority"
  | "due"
  | "reassign"
  | "rename"
  | "to_todo"
  | "approve"
  | "fix"
  | "todo_add"
  | "todo_done"
  | "todo_delete"
  | "todo_focus"
  | "suggestion_accept"
  | "suggestion_dismiss"
  | "snooze";

export const CHOICE_LABEL: Record<ChoiceKind, string> = {
  accept: "öneriyi onayladı",
  reject: "öneriyi reddetti",
  done: "işi bitirdi",
  reopen: "işi yeniden açtı",
  priority: "önceliği değiştirdi",
  due: "termini değiştirdi",
  reassign: "işi başka ajana verdi",
  rename: "başlığı düzeltti",
  to_todo: "görevlerine ekledi",
  approve: "ajanın teslimatını onayladı",
  fix: "ajanın teslimatını düzeltti",
  todo_add: "asistanın önerdiği görevi ekledi",
  todo_done: "görevi tamamladı",
  todo_delete: "görevi sildi",
  todo_focus: "görevi odağa aldı",
  suggestion_accept: "asistan önerisini uyguladı",
  suggestion_dismiss: "asistan önerisini gizledi",
  snooze: "kararı sonraya erteledi",
};

/** Hazır ret sebepleri (tek dokunuş) */
export const REJECT_REASONS = ["Benim işim değil", "Zaten yapıldı", "Şimdi değil", "Önemsiz / gürültü"] as const;

export interface Choice {
  id: string;
  at: string;
  kind: ChoiceKind;
  /** beyin işinin türü (güven: hangi tür işlerde onay oranı yüksek) */
  itemKind?: ItemKind;
  /** ajanın kendi onayladığı işe dair seçim (yanlış otomatik onay → güven düşer) */
  auto?: boolean;
  /** nerede: beyin, görevler, asistan */
  where: "beyin" | "gorevler" | "asistan";
  agent?: AgentId;
  title: string;
  /** bağlam: kaynak, kişi, tür, eski → yeni değer */
  detail?: string;
  /** Batuhan'ın verdiği sebep (en güçlü sinyal) */
  reason?: string;
  learned?: boolean;
}

export interface Lesson {
  topic: string;
  entry: string;
}
export interface LearnLog {
  at: string;
  choices: number;
  lessons: Lesson[];
}
export interface LearningState {
  pending: number;
  total: number;
  log: LearnLog[];
}
