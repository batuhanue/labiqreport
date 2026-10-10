/** Ajan organizasyonu (düşünme ağı) ve süreç analitiği — sunucu ve istemci ortak tipleri. */

/** llm: Claude ile düşünür · analitik: ölçer ve uyarır (ücretsiz) · otomasyon: iş yapar (Gmail, Drive, arşiv) */
export type AgentKind = "llm" | "analitik" | "otomasyon";
/** working: şu an çalışıyor · ok: sağlıklı · alert: dikkat · idle: veri/bağlantı yok · error: son çalışması hata */
export type AgentHealth = "working" | "ok" | "alert" | "idle" | "error";

export interface Kpi {
  label: string;
  value: string;
}

export interface OrgAgent {
  id: string;
  name: string;
  role: string;
  kind: AgentKind;
  lead?: boolean;
  health: AgentHealth;
  /** kısa durum cümlesi */
  status: string;
  alert?: string;
  kpis: Kpi[];
  lastAt?: string;
  /** ilgili sayfa */
  href?: string;
}

export interface OrgDept {
  id: string;
  name: string;
  sub: string;
  color: string;
  agents: OrgAgent[];
  /** 0..1 */
  health: number;
}

export interface OrgCore {
  files: number;
  memory: number;
  rules: number;
  archive: number;
  bySource: Record<string, number>;
}

export interface ProcStage {
  name: string;
  count: number;
  /** varsa hedef (ör. 96 kontrol) */
  of?: number;
}

export interface OrgProcess {
  id: string;
  name: string;
  sub: string;
  health: "ok" | "warn" | "alert";
  stages: ProcStage[];
  metrics: Kpi[];
  /** ileriye dönük tek cümle (tahmin) */
  forecast?: string;
  /** darboğaz (en çok bekleyen yer) */
  bottleneck?: string;
  href?: string;
}

export interface OrgState {
  at: string;
  core: OrgCore;
  depts: OrgDept[];
  processes: OrgProcess[];
  totals: { agents: number; working: number; alerts: number; health: number; costToday: number; runsToday: number };
}

export const HEALTH_COLOR: Record<AgentHealth, string> = { working: "#ff8a3d", ok: "#3ddc97", alert: "#ffc53d", idle: "#6b7489", error: "#ff4d5e" };
export const HEALTH_LABEL: Record<AgentHealth, string> = { working: "çalışıyor", ok: "sağlıklı", alert: "dikkat", idle: "beklemede", error: "hata" };
export const KIND_LABEL_ORG: Record<AgentKind, string> = { llm: "Claude ile düşünür", analitik: "ölçer ve uyarır", otomasyon: "iş yapar" };
