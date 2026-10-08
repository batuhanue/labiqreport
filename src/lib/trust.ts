import "server-only";
import { AGENTS, TRUST_META, type AgentId, type AgentTrust, type AgentTrustView, type BrainItem, type Choice, type ItemKind, type TrustLevel, type TrustStats } from "./brain-types";
import { store } from "./db";
import { readChoices } from "./learning";

/*
 * Kazanılan güven: her ajanın seviyesi (0 Öner · 1 Kendisi onaylasın · 2 Teslimatı da hazırlasın).
 * Seviyeyi Batuhan seçer; sistem seçimlerden onay oranını hesaplar, hak edince yükseltmeyi önerir,
 * yanlış otomatik onaylarda (ya da art arda düzeltilen teslimatlarda) kendiliğinden bir seviye düşürür.
 */

const KEY = "agent-trust";
const DAY = 86400_000;

const readTrust = async () => (await store().getKV<Partial<Record<AgentId, AgentTrust>>>(KEY)) ?? {};

export async function setTrust(agent: AgentId, level: TrustLevel, note?: string) {
  const all = await readTrust();
  all[agent] = { level, since: new Date().toISOString(), note };
  await store().setKV(KEY, all);
  return all[agent]!;
}

const ACCEPT = new Set<Choice["kind"]>(["accept", "to_todo", "done"]);
/** "Şimdi değil" bir ret değil, zamanlama tercihidir */
const isReject = (c: Choice) => c.kind === "reject" && c.reason !== "Şimdi değil";

function statsFor(list: Choice[]): TrustStats {
  const s: TrustStats = { accepted: 0, rejected: 0, delivered: 0, fixed: 0, wrongAuto: 0, byKind: {} };
  for (const c of list) {
    const k = c.itemKind;
    if (ACCEPT.has(c.kind)) {
      s.accepted++;
      if (k) (s.byKind[k] ??= [0, 0])[0]++;
    } else if (isReject(c)) {
      s.rejected++;
      if (k) (s.byKind[k] ??= [0, 0])[1]++;
      if (c.auto && Date.now() - Date.parse(c.at) < 14 * DAY) s.wrongAuto++;
    } else if (c.kind === "approve") s.delivered++;
    else if (c.kind === "fix") s.fixed++;
  }
  return s;
}

const rate = (a: number, r: number) => (a + r ? a / (a + r) : 0);

/** Tüm ajanların seviyesi, istatistiği, yükseltme önerisi ve yine de sorulacak türler. */
export async function trustView(choices?: Choice[]): Promise<Record<AgentId, AgentTrustView>> {
  const [saved, all] = await Promise.all([readTrust(), choices ? Promise.resolve(choices) : readChoices()]);
  const recent = all.filter((c) => c.where === "beyin" && Date.now() - Date.parse(c.at) < 60 * DAY);
  const out = {} as Record<AgentId, AgentTrustView>;
  for (const a of AGENTS) {
    const mine = recent.filter((c) => c.agent === a.id).slice(0, 40);
    const stats = statsFor(mine);
    const t = saved[a.id] ?? { level: 0 as TrustLevel };
    const decided = stats.accepted + stats.rejected;
    const r = rate(stats.accepted, stats.rejected);
    // son 3 karar içinde ret varsa henüz yükseltme önerme
    const lastRejected = mine.filter((c) => ACCEPT.has(c.kind) || isReject(c)).slice(0, 3).some(isReject);
    let suggest: TrustLevel | undefined;
    if (t.level === 0 && decided >= 6 && r >= 0.8 && !lastRejected) suggest = 1;
    else if (t.level === 1 && stats.delivered + stats.fixed >= 3 && rate(stats.delivered, stats.fixed) >= 0.66 && r >= 0.8 && !lastRejected) suggest = 2;
    const askKinds = (Object.entries(stats.byKind) as [ItemKind, [number, number]][]).filter(([, [ac, rj]]) => rj >= 2 && rate(ac, rj) < 0.6).map(([k]) => k);
    out[a.id] = { ...t, stats, suggest, askKinds };
  }
  return out;
}

/** Yeni açılan işe ajanın seviyesini uygular: kendisi onaylar, gerekirse işi sıraya koyar. Uygulanan seviyeyi döndürür. */
export function applyTrust(it: BrainItem, view: Record<AgentId, AgentTrustView>): TrustLevel {
  const t = view[it.agent];
  if (!t || t.level === 0 || t.askKinds.includes(it.kind)) return 0;
  const at = new Date().toISOString();
  if (it.status === "inbox") {
    it.status = "todo";
    it.auto = { at, level: t.level };
  } else if (it.status !== "todo" || t.level < 2) return 0; // kendi notların zaten Yapılacak'ta açılır
  if (t.level === 2 && !it.work) it.work = { status: "queued", output: "", used: [], revisions: [], at };
  return t.level;
}

/**
 * Seçimden sonra: yanlış otomatik onaylar (14 günde 2) ya da art arda düzeltilen teslimatlar seviyeyi bir düşürür.
 * Düşürdüyse açıklamayı döndürür.
 */
export async function reviewTrust(agent: AgentId): Promise<string | null> {
  const saved = await readTrust();
  const t = saved[agent];
  if (!t?.level) return null;
  const since = t.since ? Date.parse(t.since) : 0;
  // yalnızca bu seviyeye geçildikten sonraki seçimler sayılır
  const mine = (await readChoices()).filter((c) => c.agent === agent && c.where === "beyin" && Date.parse(c.at) >= since);
  const s = statsFor(mine);
  const fixesInRow = mine.filter((c) => c.kind === "approve" || c.kind === "fix").slice(0, 3);
  const badDelivery = t.level === 2 && fixesInRow.length >= 2 && fixesInRow.filter((c) => c.kind === "fix").length >= 2;
  if (s.wrongAuto < 2 && !badDelivery) return null;
  const level = (t.level - 1) as TrustLevel;
  const day = new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", timeZone: "Europe/Istanbul" });
  const note = `${day}: ${badDelivery ? "teslimatları art arda düzeltildi" : `${s.wrongAuto} işi yanlış onayladı`}, “${TRUST_META[level].label}” seviyesine indi.`;
  await setTrust(agent, level, note);
  return note;
}
