import "server-only";
import { stats as archiveStats } from "./archive";
import { listKnowledge, MEMORY_FILE } from "./assistant";
import { daysSince, meetingsOn, trDay } from "./brain-plan";
import type { AgentId, BrainFocus, BrainItem, BrainRun } from "./brain-types";
import { AREAS } from "./checklist";
import type { UsageLog } from "./claude";
import { store } from "./db";
import { getSnapshot, status as googleStatus } from "./google";
import { COMPOSE_SCOPE, type ArchiveStats } from "./google-types";
import { learningState } from "./learning";
import type { AgentHealth, Kpi, OrgAgent, OrgDept, OrgProcess, OrgState } from "./org-types";
import { areaDeadline, areaProgress, deadlineInfo, normalizePeriod, overallProgress, periodLabel } from "./period";
import type { TodoStore } from "./todo";
import { trustView } from "./trust";
import type { PeriodData } from "./types";

/*
 * Ajan organizasyonu: 6 departman, ~35 ajan, merkezde Bilgi Çekirdeği. Her ajan uygulamadaki gerçek bir işleve
 * karşılık gelir (Claude ile düşünen, ölçen/uyaran ya da iş yapan) ve durumu canlı veriden hesaplanır.
 * Süreçler: aylık kapanış (hız, tahmini bitiş, darboğaz), gelen iş hunisi, yanıt ve takip, toplantı hazırlığı,
 * kişisel görevler. Strateji katmanı bu analizi her düşünmede okur (digest).
 */

export interface BrainRaw {
  items: BrainItem[];
  focus: BrainFocus | null;
  runs: BrainRun[];
  lastRun?: string;
  running: boolean;
  captures: number;
}

const DAY = 86400_000;
const isOpen = (x: BrainItem) => x.status !== "done" && x.status !== "dismissed";
const ago = (iso?: string) => {
  if (!iso) return "—";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "şimdi" : m < 60 ? `${m} dk önce` : m < 1440 ? `${Math.round(m / 60)} sa önce` : `${Math.round(m / 1440)} gün önce`;
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const prevPeriod = (p: string) => {
  const [y, m] = p.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};
const marked = (v: unknown) => v === "ok" || v === "fail";

function agent(a: Omit<OrgAgent, "kpis" | "health" | "status"> & { kpis?: Kpi[]; health?: AgentHealth; status?: string }): OrgAgent {
  return { kpis: [], health: "ok", status: "", ...a };
}

export async function buildOrg(brain: BrainRaw): Promise<OrgState> {
  const now = new Date();
  const today = trDay(now);
  const [snap, gst, files, arch, learning, trust, usage, todosRaw, st, summaries] = await Promise.all([
    getSnapshot().catch(() => null),
    googleStatus("", false).catch(() => null),
    listKnowledge().catch(() => []),
    archiveStats().catch((): ArchiveStats => ({ total: 0, bySource: {} })),
    learningState().catch(() => ({ pending: 0, total: 0, log: [] })),
    trustView().catch(() => null),
    store().getKV<UsageLog>("assistant-usage-claude").catch(() => null),
    store().getKV<TodoStore>("todos").catch(() => null),
    store().getState(),
    store().listPeriods().catch(() => []),
  ]);
  const raw = st.activePeriod ? await store().getPeriod(st.activePeriod).catch(() => null) : null;
  const period: PeriodData | null = raw ? normalizePeriod(raw) : null;
  const prevRaw = period ? await store().getPeriod(prevPeriod(period.period)).catch(() => null) : null;
  const prev = prevRaw ? normalizePeriod(prevRaw) : null;

  const connected = !!gst?.connected;
  const items = brain.items;
  const open = items.filter(isOpen);
  const byAgent = (a: AgentId) => open.filter((x) => x.agent === a);
  const lastRunOf = (a: AgentId) => {
    for (const r of brain.runs) {
      const x = r.agents.find((g) => g.agent === a);
      if (x) return { ...x, at: r.at };
    }
    return null;
  };
  const weekRuns = brain.runs.filter((r) => Date.now() - Date.parse(r.at) < 7 * DAY);
  const created7 = (a: AgentId) => weekRuns.reduce((n, r) => n + (r.agents.find((g) => g.agent === a)?.created ?? 0), 0);
  const runningWork = (pred: (x: BrainItem) => boolean) => items.some((x) => pred(x) && (x.work?.status === "running" || x.work?.status === "queued"));

  /** Kaynak ajanı (e-posta, sohbet, takvim, toplantı, denetim, görev) */
  const signalAgent = (a: AgentId, id: string, name: string, role: string, needsGoogle: boolean, href: string, lead = false): OrgAgent => {
    const lr = lastRunOf(a);
    const health: AgentHealth = brain.running ? "working" : needsGoogle && !connected ? "idle" : lr?.error ? "error" : lr ? "ok" : "idle";
    return agent({
      id,
      name,
      role,
      kind: "llm",
      lead,
      href,
      health,
      lastAt: lr?.at,
      status: needsGoogle && !connected ? "Google bağlı değil" : lr ? `${lr.signals} sinyal okudu, ${lr.created} iş açtı` : "henüz çalışmadı",
      alert: lr?.error ? lr.error.slice(0, 120) : undefined,
      kpis: [
        { label: "Açık iş", value: String(byAgent(a).length) },
        { label: "7 günde açılan", value: String(created7(a)) },
        { label: "Son çalışma", value: ago(lr?.at) },
      ],
    });
  };

  // ------------------------------------------------------------------ Strateji
  const decisions = brain.focus?.decisions ?? [];
  const liveDec = decisions.filter((d) => {
    const it = items.find((x) => x.id === d.itemId);
    return it && isOpen(it) && !(it.snoozeUntil && it.snoozeUntil > today);
  });
  const acted = decisions.length - liveDec.length;
  const strategyErr = brain.runs[0]?.error?.startsWith("Strateji") ? brain.runs[0].error : undefined;
  const focusBlocks = (brain.focus?.plan ?? []).filter((b) => b.kind === "focus");
  const risks = open.filter((x) => x.origin === "strateji");
  const lessons = learning.log.reduce((n, g) => n + g.lessons.length, 0);
  const trustUp = trust ? Object.values(trust).filter((t) => t.level > 0).length : 0;
  const trustSuggest = trust ? Object.values(trust).filter((t) => t.suggest != null).length : 0;
  const trustDown = trust ? Object.values(trust).filter((t) => t.note).length : 0;

  // ------------------------------------------------------------------ denetim analizi (alan analistleri)
  const areaAgents: OrgAgent[] = AREAS.map((a) => {
    if (!period) return agent({ id: `area-${a.code}`, name: `${a.code} analisti`, role: `${a.title}: ilerleme, termin, bulgu ve aksiyonları izler`, kind: "analitik", health: "idle", status: "aktif dönem yok", href: "/denetim" });
    const pr = areaProgress(period, a);
    const d = deadlineInfo(period.period, a, now);
    const done = pr.bursa + pr.basaksehir;
    const total = pr.total * 2;
    const fails = a.items.reduce((n, it) => n + (["bursa", "basaksehir"] as const).filter((h) => period.items[it.id]?.[h] === "fail").length, 0);
    const noAction = a.items.reduce((n, it) => n + (["bursa", "basaksehir"] as const).filter((h) => period.items[it.id]?.[h] === "fail" && !period.actions.some((x) => x.itemId === it.id && x.hospital === h)).length, 0);
    const complete = done >= total;
    const late = d.days != null && d.days < 0 && !complete;
    const tight = d.days != null && d.days <= 2 && d.days >= 0 && done / total < 0.6;
    const prevFails = prev ? a.items.filter((it) => (["bursa", "basaksehir"] as const).some((h) => prev.items[it.id]?.[h] === "fail" && period.items[it.id]?.[h] === "fail")).length : 0;
    return agent({
      id: `area-${a.code}`,
      name: `${a.code} analisti`,
      role: `${a.title}: ilerleme, termin, bulgu ve aksiyonları izler`,
      kind: "analitik",
      href: `/denetim?alan=${a.code}`,
      health: late || tight || noAction ? "alert" : "ok",
      status: `${complete ? "tamamlandı" : `${done}/${total} kontrol · ${d.text}`}${fails ? ` · ${fails} bulgu` : ""}`,
      alert: late ? `Termin ${-d.days!} gün geçti, ${total - done} kontrol eksik` : tight ? `Termine ${d.days} gün, %${pct(done, total)} tamam` : noAction ? `${noAction} bulgunun aksiyon kaydı yok` : undefined,
      kpis: [
        { label: "Bursa", value: `${pr.bursa}/${pr.total}` },
        { label: "Başakşehir", value: `${pr.basaksehir}/${pr.total}` },
        { label: "Bulgu", value: String(fails) },
        { label: "Tekrarlayan", value: String(prevFails) },
      ],
    });
  });
  const openActs = period?.actions.filter((x) => x.status !== "Tamamlandı") ?? [];
  const noActionTotal = period ? AREAS.reduce((n, a) => n + a.items.reduce((m, it) => m + (["bursa", "basaksehir"] as const).filter((h) => period.items[it.id]?.[h] === "fail" && !period.actions.some((x) => x.itemId === it.id && x.hospital === h)).length, 0), 0) : 0;
  const repeatTotal = areaAgents.reduce((n, x) => n + Number(x.kpis.find((k) => k.label === "Tekrarlayan")?.value ?? 0), 0);
  const lateActs = openActs.filter((x) => x.due && x.due < today);

  // ------------------------------------------------------------------ kapanış süreci: hız ve tahmin
  let closing: OrgProcess;
  let closingEta: string | undefined;
  let lastDeadline: string | undefined;
  if (period) {
    const pr = overallProgress(period);
    const total = AREAS.reduce((n, a) => n + a.items.length * 2, 0);
    const done = pr.bursaDone + pr.basaksehirDone;
    const since = Date.now() - 7 * DAY;
    let recent = 0;
    for (const s of Object.values(period.items)) if (s.updatedAt && Date.parse(s.updatedAt) > since) recent += Number(marked(s.bursa)) + Number(marked(s.basaksehir));
    const startedDays = Math.max(1, Math.min(7, daysSince(period.createdAt, now) || 1));
    const velocity = recent / startedDays;
    const remaining = total - done;
    const deadlines = AREAS.map((a) => areaDeadline(period.period, a)).filter((d): d is Date => !!d);
    const last = deadlines.length ? new Date(Math.max(...deadlines.map((d) => +d))) : null;
    lastDeadline = last ? trDay(last) : undefined;
    const etaDays = velocity > 0 ? Math.ceil(remaining / velocity) : null;
    closingEta = remaining === 0 ? today : etaDays != null ? trDay(new Date(+now + etaDays * DAY)) : undefined;
    const fails = pr.fails;
    const failsWithAction = AREAS.reduce((n, a) => n + a.items.reduce((m, it) => m + (["bursa", "basaksehir"] as const).filter((h) => period.items[it.id]?.[h] === "fail" && period.actions.some((x) => x.itemId === it.id && x.hospital === h)).length, 0), 0);
    const doneActs = period.actions.filter((x) => x.status === "Tamamlandı").length;
    const worst = areaAgents.filter((x) => x.health === "alert").sort((a, b) => (a.alert?.includes("geçti") ? -1 : 1) - (b.alert?.includes("geçti") ? -1 : 1))[0];
    const late = closingEta && lastDeadline && closingEta > lastDeadline;
    closing = {
      id: "kapanis",
      name: `${periodLabel(period.period)} kapanışı`,
      sub: "kontrol → bulgu → aksiyon → onay",
      href: "/denetim",
      health: remaining === 0 ? "ok" : late || areaAgents.some((x) => x.alert?.includes("geçti")) ? "alert" : areaAgents.some((x) => x.health === "alert") ? "warn" : "ok",
      stages: [
        { name: "Kontrol", count: done, of: total },
        { name: "Bulgu", count: fails },
        { name: "Aksiyonda", count: failsWithAction, of: fails },
        { name: "Aksiyon bitti", count: doneActs, of: period.actions.length },
        { name: "Onay", count: period.status === "Son Onay" ? 2 : period.status === "Ön Onay" ? 1 : 0, of: 2 },
      ],
      metrics: [
        { label: "Tamamlanma", value: `%${pct(done, total)}` },
        { label: "Hız", value: velocity ? `${velocity.toFixed(1).replace(".", ",")} kontrol/gün` : "son 7 günde yok" },
        { label: "Tahmini bitiş", value: closingEta ? new Date(`${closingEta}T12:00:00+03:00`).toLocaleDateString("tr-TR", { day: "numeric", month: "short" }) : "—" },
        { label: "Son termin", value: last ? last.toLocaleDateString("tr-TR", { day: "numeric", month: "short" }) : "—" },
        ...(prev ? [{ label: "Geçen ay bulgu", value: String(overallProgress(prev).fails) }] : []),
      ],
      forecast:
        remaining === 0
          ? "Bütün kontroller tamam; onaylara geç."
          : etaDays == null
            ? `${remaining} kontrol kaldı; son 7 günde ilerleme yok, bu hızla bitmez.`
            : late
              ? `Bu hızla ${etaDays} günde biter; son terminden ${daysSince(`${lastDeadline}T12:00:00+03:00`, new Date(`${closingEta}T12:00:00+03:00`))} gün geç. Günde ${Math.ceil(remaining / Math.max(1, daysSince(now.toISOString(), new Date(`${lastDeadline}T23:00:00+03:00`))))} kontrol gerekiyor.`
              : `Bu hızla ${etaDays} günde biter; terminlere yetişir.`,
      bottleneck: worst ? `${worst.name.replace(" analisti", "")}: ${worst.alert}` : lateActs.length ? `${lateActs.length} aksiyonun termini geçti` : undefined,
    };
  } else {
    closing = { id: "kapanis", name: "Aylık kapanış", sub: "aktif dönem yok", health: "warn", stages: [], metrics: [], forecast: "Dönem başlatılmamış.", href: "/denetim" };
  }

  // ------------------------------------------------------------------ gelen iş hunisi
  const recent30 = items.filter((x) => Date.now() - Date.parse(x.createdAt) < 30 * DAY);
  const inbox = open.filter((x) => x.status === "inbox");
  const accepted = recent30.filter((x) => x.status !== "inbox" && x.status !== "dismissed");
  const rejected = recent30.filter((x) => x.status === "dismissed");
  const draftReady = open.filter((x) => x.work?.status === "waiting_ok" || x.work?.status === "ready");
  const approved = recent30.filter((x) => x.work?.status === "approved");
  const replied = recent30.filter((x) => x.followUp?.replied);
  const cycleH = approved.map((x) => (Date.parse(x.updatedAt) - Date.parse(x.createdAt)) / 3600_000).sort((a, b) => a - b);
  const medianH = cycleH.length ? cycleH[Math.floor(cycleH.length / 2)] : null;
  const inflow: OrgProcess = {
    id: "gelen",
    name: "Gelen iş akışı",
    sub: "sinyal → öneri → kabul → teslimat → onay → yanıt",
    href: "/gorevler",
    health: inbox.length > 8 || draftReady.length > 5 ? "warn" : "ok",
    stages: [
      { name: "Öneri", count: inbox.length },
      { name: "Kabul", count: accepted.length },
      { name: "Taslak hazır", count: draftReady.length },
      { name: "Onaylandı", count: approved.length },
      { name: "Yanıt geldi", count: replied.length },
    ],
    metrics: [
      { label: "Kabul oranı", value: `%${pct(accepted.length, accepted.length + rejected.length)}` },
      { label: "Öneriden onaya", value: medianH == null ? "—" : medianH < 24 ? `${Math.round(medianH)} sa` : `${Math.round(medianH / 24)} gün` },
      { label: "30 günde iş", value: String(recent30.length) },
    ],
    bottleneck: inbox.length >= draftReady.length && inbox.length > 3 ? `${inbox.length} öneri kararını bekliyor` : draftReady.length > 2 ? `${draftReady.length} taslak onayını bekliyor` : undefined,
    forecast: draftReady.length ? `${draftReady.length} taslak tek dokunuşla gönderilmeye hazır.` : undefined,
  };

  // ------------------------------------------------------------------ yanıt ve takip
  const sent = items.filter((x) => x.followUp && Date.now() - Date.parse(x.followUp.since) < 30 * DAY);
  const waiting = sent.filter((x) => !x.followUp!.replied && x.status === "waiting");
  const overdue = waiting.filter((x) => today >= x.followUp!.due);
  const replyDays = sent.filter((x) => x.followUp!.replied).map((x) => (Date.parse(x.followUp!.replied!.at) - Date.parse(x.followUp!.since)) / DAY);
  const follow: OrgProcess = {
    id: "takip",
    name: "Yanıt ve takip",
    sub: "gönderildi → bekleniyor → hatırlatıldı → yanıt geldi",
    href: "/gorevler",
    health: overdue.length ? "warn" : "ok",
    stages: [
      { name: "Gönderildi", count: sent.length },
      { name: "Bekleniyor", count: waiting.length },
      { name: "Hatırlatıldı", count: sent.filter((x) => (x.followUp!.nudges ?? 0) > 0).length },
      { name: "Yanıt geldi", count: sent.filter((x) => x.followUp!.replied).length },
    ],
    metrics: [
      { label: "Ort. yanıt süresi", value: replyDays.length ? `${(replyDays.reduce((a, b) => a + b, 0) / replyDays.length).toFixed(1).replace(".", ",")} gün` : "—" },
      { label: "Geciken", value: String(overdue.length) },
    ],
    bottleneck: overdue.length ? `${overdue.map((x) => x.person ?? x.followUp!.to[0]).slice(0, 3).join(", ")} yanıt vermedi` : undefined,
  };

  // ------------------------------------------------------------------ toplantı hazırlığı
  const events = snap?.calendar.items ?? [];
  const upcoming = events.filter((e) => !e.allDay && e.response !== "declined" && Date.parse(e.start) > +now && Date.parse(e.start) < +now + 7 * DAY);
  const soon = upcoming.filter((e) => Date.parse(e.start) < +now + DAY && e.attendees.length >= 2);
  const prepItems = open.filter((x) => x.kind === "toplanti");
  const prepReady = prepItems.filter((x) => x.work?.status === "ready" || x.work?.status === "waiting_ok" || x.work?.status === "approved");
  const invites = events.filter((e) => e.response === "needsAction" && Date.parse(e.start) > +now);
  const meetings: OrgProcess = {
    id: "toplanti",
    name: "Toplantı hazırlığı",
    sub: "davet → hazırlık işi → not hazır",
    href: "/google",
    health: !connected ? "warn" : soon.length > prepReady.length ? "warn" : "ok",
    stages: [
      { name: "7 günde toplantı", count: upcoming.length },
      { name: "Yanıt bekleyen davet", count: invites.length },
      { name: "Hazırlık işi", count: prepItems.length },
      { name: "Not hazır", count: prepReady.length },
    ],
    metrics: [
      { label: "Bugün", value: String(meetingsOn(events, today).length) },
      { label: "24 saatte", value: String(soon.length) },
    ],
    bottleneck: soon.length > prepReady.length ? `24 saat içindeki ${soon.length} toplantının ${soon.length - prepReady.length} tanesinin notu yok` : invites.length ? `${invites.length} davet yanıt bekliyor` : undefined,
  };

  // ------------------------------------------------------------------ kişisel görevler
  const todos = todosRaw?.todos ?? [];
  const tOpen = todos.filter((t) => !t.done);
  const tLate = tOpen.filter((t) => t.due && t.due < today);
  const tToday = tOpen.filter((t) => t.due === today);
  const tWeek = todos.filter((t) => t.done && t.doneAt && Date.now() - Date.parse(t.doneAt) < 7 * DAY);
  const tasks: OrgProcess = {
    id: "gorevler",
    name: "Kişisel görevler",
    sub: "açık → bugün → biten",
    href: "/gorevler?sekme=gorevler",
    health: tLate.length > 3 ? "alert" : tLate.length ? "warn" : "ok",
    stages: [
      { name: "Açık", count: tOpen.length },
      { name: "Bugün", count: tToday.length },
      { name: "Gecikmiş", count: tLate.length },
      { name: "7 günde biten", count: tWeek.length },
    ],
    metrics: [{ label: "Haftalık tempo", value: `${tWeek.length} görev` }],
    bottleneck: tLate.length ? `${tLate.length} görev gecikti` : undefined,
  };

  // ------------------------------------------------------------------ maliyet / performans
  const day = usage?.days[today];
  const recentUsage = (usage?.recent ?? []).filter((e) => Date.now() - Date.parse(e.at) < DAY);
  const avgMs = recentUsage.length ? recentUsage.reduce((n, e) => n + e.ms, 0) / recentUsage.length : 0;

  // ------------------------------------------------------------------ departmanlar
  const memoryLines = (files.find((f) => f.name === MEMORY_FILE)?.md ?? "").split("\n").filter((l) => l.trim().startsWith("- ")).length;
  const rulesLines = (files.find((f) => f.name === "ajan-kurallari.md")?.md ?? "").split("\n").filter((l) => l.trim().startsWith("- ")).length;
  const drafts7 = items.filter((x) => x.work?.draft && Date.now() - Date.parse(x.work.draft.at) < 7 * DAY).length;
  const commsWork = items.filter((x) => (x.agent === "posta" || x.agent === "sohbet") && x.work);
  const fixes = commsWork.reduce((n, x) => n + (x.work?.revisions.length ?? 0), 0);
  const filesAttached = items.reduce((n, x) => n + x.files.length, 0);
  const composeOk = !!gst?.scopes?.includes(COMPOSE_SCOPE);

  const depts: OrgDept[] = [
    {
      id: "strateji",
      name: "Strateji",
      sub: "kararlar ve muhakeme",
      color: "#ff9f43",
      agents: [
        agent({ id: "stratejist", name: "Şef yardımcısı", role: "Bütün kaynakları birlikte okur, karar ve gün planı çıkarır, taslakları önden hazırlatır", kind: "llm", lead: true, href: "/", health: brain.running ? "working" : strategyErr ? "error" : brain.focus?.decisions ? "ok" : "idle", lastAt: brain.focus?.at, status: brain.focus?.headline ?? "henüz düşünmedi", alert: strategyErr, kpis: [{ label: "Bekleyen karar", value: String(liveDec.length) }, { label: "Sonuçlanan", value: String(acted) }, { label: "Son düşünme", value: ago(brain.lastRun) }] }),
        agent({ id: "planlayici", name: "Planlayıcı", role: "Boş saatlere odak blokları yerleştirir", kind: "analitik", health: focusBlocks.length ? "ok" : "idle", status: focusBlocks.length ? `${focusBlocks.length} odak bloğu planladı` : "bugün için plan yok", kpis: [{ label: "Odak bloğu", value: String(focusBlocks.length) }, { label: "Toplantı", value: String((brain.focus?.plan ?? []).filter((b) => b.kind === "meeting").length) }] }),
        agent({ id: "risk", name: "Risk analisti", role: "Hiçbir işin karşılamadığı riskleri (termin, çakışma, davet) iş olarak açar", kind: "analitik", health: areaAgents.some((x) => x.alert?.includes("geçti")) ? "alert" : "ok", status: `${risks.length} risk işi açık`, alert: areaAgents.find((x) => x.alert?.includes("geçti"))?.alert, kpis: [{ label: "Açık risk", value: String(risks.length) }, { label: "Riskli alan", value: String(areaAgents.filter((x) => x.health === "alert").length) }] }),
        agent({ id: "ogrenme", name: "Öğrenme ajanı", role: "Seçimlerinden kalıcı tercihleri çıkarıp belleğe yazar", kind: "llm", health: learning.pending > 12 ? "alert" : learning.total ? "ok" : "idle", status: `${lessons} tercih öğrendi`, alert: learning.pending > 12 ? `${learning.pending} seçim öğrenilmeyi bekliyor` : undefined, lastAt: learning.log[0]?.at, kpis: [{ label: "Seçim", value: String(learning.total) }, { label: "Öğrenilen", value: String(lessons) }, { label: "Sırada", value: String(learning.pending) }] }),
        agent({ id: "guven", name: "Güven denetçisi", role: "Ajanların onay oranını ölçer, yetki önerir ya da düşürür", kind: "analitik", health: trustDown ? "alert" : "ok", status: `${trustUp} ajan kendi başına çalışıyor`, alert: trustDown ? `${trustDown} ajanın yetkisi düşürüldü` : undefined, kpis: [{ label: "Yetkili ajan", value: String(trustUp) }, { label: "Yükseltme önerisi", value: String(trustSuggest) }] }),
      ],
      health: 0,
    },
    {
      id: "iletisim",
      name: "İletişim",
      sub: "e-posta, sohbet ve yanıtlar",
      color: "#ff6b6b",
      agents: [
        signalAgent("posta", "posta", "Posta ajanı", "Gelen e-postalardan senin işin olanları ayıklar", true, "/google", true),
        signalAgent("sohbet", "sohbet", "Sohbet ajanı", "Google Chat'te sana yöneltilen istekleri ve verdiğin sözleri yakalar", true, "/google"),
        agent({ id: "yanit", name: "Yanıt yazarı", role: "E-posta ve mesaj işlerine gönderilmeye hazır taslak yazar", kind: "llm", health: runningWork((x) => x.agent === "posta" || x.agent === "sohbet") ? "working" : commsWork.length ? "ok" : "idle", status: `${commsWork.filter((x) => x.work?.status === "waiting_ok").length} taslak onay bekliyor`, kpis: [{ label: "Teslimat", value: String(commsWork.length) }, { label: "Düzeltme oranı", value: `%${pct(fixes, Math.max(1, commsWork.length))}` }] }),
        agent({ id: "gmail", name: "Gmail taslakçısı", role: "Onayladığın e-postayı Gmail'e taslak olarak, doğru yazışmaya yazar", kind: "otomasyon", health: !connected ? "idle" : composeOk ? "ok" : "alert", status: composeOk ? `7 günde ${drafts7} taslak yazdı` : "taslak izni yok", alert: connected && !composeOk ? "Google'ı yeniden bağla (taslak izni)" : undefined, href: "/google", kpis: [{ label: "7 günde taslak", value: String(drafts7) }] }),
        agent({ id: "takip", name: "Takip ajanı", role: "Gönderdiklerinin yanıtını izler; gecikince hatırlatma yazar", kind: "llm", health: runningWork((x) => x.work?.purpose === "followup") ? "working" : overdue.length ? "alert" : sent.length ? "ok" : "idle", status: `${waiting.length} yanıt bekleniyor`, alert: overdue.length ? `${overdue.length} kişi zamanında yanıt vermedi` : undefined, kpis: [{ label: "Bekleniyor", value: String(waiting.length) }, { label: "Geciken", value: String(overdue.length) }, { label: "Yanıt geldi", value: String(sent.filter((x) => x.followUp!.replied).length) }] }),
      ],
      health: 0,
    },
    {
      id: "zaman",
      name: "Takvim & Toplantı",
      sub: "zaman ve toplantılar",
      color: "#a78bfa",
      agents: [
        signalAgent("takvim", "takvim", "Takvim ajanı", "Yaklaşan toplantılar için hazırlık ve davet işleri açar", true, "/google", true),
        signalAgent("toplanti", "toplanti", "Toplantı ajanı", "Transkriptlerden kararları ve sana düşen aksiyonları çıkarır", true, "/google"),
        agent({ id: "hazirlik", name: "Hazırlık ajanı", role: "Toplantı öncesi bir sayfalık hazırlık notu yazar", kind: "llm", health: runningWork((x) => x.kind === "toplanti") ? "working" : soon.length > prepReady.length ? "alert" : "ok", status: `${prepReady.length}/${prepItems.length} hazırlık notu hazır`, alert: soon.length > prepReady.length ? `24 saat içinde ${soon.length - prepReady.length} toplantının notu yok` : undefined, kpis: [{ label: "24 saatte toplantı", value: String(soon.length) }, { label: "Not hazır", value: String(prepReady.length) }] }),
        agent({ id: "davet", name: "Davet takipçisi", role: "Yanıtlamadığın toplantı davetlerini izler", kind: "analitik", health: !connected ? "idle" : invites.length ? "alert" : "ok", status: invites.length ? `${invites.length} davet yanıt bekliyor` : "bekleyen davet yok", alert: invites.length ? `Yanıt bekliyor: ${invites.slice(0, 2).map((e) => e.title).join(", ")}` : undefined, kpis: [{ label: "Bekleyen davet", value: String(invites.length) }] }),
      ],
      health: 0,
    },
    {
      id: "denetim",
      name: "Denetim & Kapanış",
      sub: "aylık kapanış operasyonu",
      color: "#3ddc97",
      agents: [
        signalAgent("denetim", "denetim", "Denetim ajanı", "Termini yaklaşan alanları ve aksiyonu açılmamış bulguları işe çevirir", false, "/denetim", true),
        ...areaAgents,
        agent({ id: "aksiyon", name: "Aksiyon takipçisi", role: "Bulgu aksiyonlarının sorumlusunu ve terminini izler", kind: "analitik", href: "/aksiyonlar", health: lateActs.length ? "alert" : period ? "ok" : "idle", status: `${openActs.length} açık aksiyon`, alert: lateActs.length ? `${lateActs.length} aksiyonun termini geçti (${lateActs.slice(0, 2).map((x) => x.owner).join(", ")})` : undefined, kpis: [{ label: "Açık", value: String(openActs.length) }, { label: "Termini geçen", value: String(lateActs.length) }] }),
      ],
      health: 0,
    },
    {
      id: "analiz",
      name: "Analiz",
      sub: "süreç ölçümü ve tahmin",
      color: "#4dabf7",
      agents: [
        agent({ id: "surec", name: "Süreç yöneticisi", role: "Beş süreci ölçer: aşamalar, hız, darboğaz", kind: "analitik", lead: true, health: "ok", status: "", kpis: [] }),
        agent({ id: "tahmin", name: "Tahminci", role: "Kapanışın bu hızla ne zaman biteceğini hesaplar", kind: "analitik", href: "/analiz", health: closing.health === "alert" ? "alert" : period ? "ok" : "idle", status: closing.forecast ?? "", alert: closing.health === "alert" ? closing.forecast : undefined, kpis: closing.metrics.slice(1, 4) }),
        agent({ id: "trend", name: "Trend analisti", role: "Bu ayı geçen ayla karşılaştırır", kind: "analitik", href: "/gecmis", health: prev ? "ok" : "idle", status: prev && period ? `Bulgu ${overallProgress(period).fails} (geçen ay ${overallProgress(prev).fails})` : "karşılaştıracak önceki dönem yok", kpis: prev && period ? [{ label: "Bu ay %", value: `%${Math.round(overallProgress(period).overall * 100)}` }, { label: "Geçen ay %", value: `%${Math.round(overallProgress(prev).overall * 100)}` }, { label: "Dönem sayısı", value: String(summaries.length) }] : [] }),
        agent({ id: "bulgu", name: "Bulgu analisti", role: "Tekrarlayan bulguları ve aksiyonsuz bulguları bulur", kind: "analitik", href: "/analiz", health: noActionTotal ? "alert" : period ? "ok" : "idle", status: `${noActionTotal} bulgu aksiyonsuz · ${repeatTotal} madde iki aydır bulgulu`, alert: noActionTotal ? `${noActionTotal} bulgunun aksiyon kaydı yok (${areaAgents.filter((x) => x.alert?.includes("aksiyon kaydı")).map((x) => x.name.replace(" analisti", "")).join(", ")})` : undefined, kpis: [{ label: "Bulgu", value: String(period ? overallProgress(period).fails : 0) }, { label: "Aksiyonsuz", value: String(noActionTotal) }, { label: "Tekrarlayan", value: String(repeatTotal) }] }),
        agent({ id: "performans", name: "Performans analisti", role: "Ajanların maliyetini, hızını ve hatalarını ölçer", kind: "analitik", health: day?.errors ? "alert" : "ok", status: `Bugün ${day?.requests ?? 0} çağrı, $${(day?.cost ?? 0).toFixed(3)}`, alert: day?.errors ? `Bugün ${day.errors} çağrı hata verdi` : undefined, kpis: [{ label: "Bugün maliyet", value: `$${(day?.cost ?? 0).toFixed(3)}` }, { label: "Ort. süre", value: avgMs ? `${(avgMs / 1000).toFixed(1).replace(".", ",")} sn` : "—" }, { label: "Hata", value: String(day?.errors ?? 0) }] }),
      ],
      health: 0,
    },
    {
      id: "isler",
      name: "Görev & Dosya",
      sub: "kişisel işler ve belgeler",
      color: "#ffd43b",
      agents: [
        signalAgent("gorev", "gorev", "Görev ajanı", "Beyne yazdığın notları uygulanabilir işlere çevirir", false, "/gorevler", true),
        agent({ id: "dosya", name: "Dosya ajanı", role: "Her işe Drive ve arşivden ilgili dosyaları ekler", kind: "otomasyon", health: !connected ? "idle" : "ok", status: `${filesAttached} dosya ekledi`, kpis: [{ label: "Eklenen dosya", value: String(filesAttached) }, { label: "Drive kaydı", value: String(arch.bySource.drive?.count ?? 0) }] }),
        agent({ id: "arsiv", name: "Arşivci", role: "Gmail, Chat, Meet, Takvim ve Drive geçmişini aranabilir arşive indirir", kind: "otomasyon", href: "/google", health: !connected ? "idle" : "ok", status: `${arch.total.toLocaleString("tr-TR")} kayıt`, kpis: Object.entries(arch.bySource).slice(0, 4).map(([k, v]) => ({ label: k, value: (v?.count ?? 0).toLocaleString("tr-TR") })) }),
        agent({ id: "gorevtakip", name: "Görev takipçisi", role: "Kişisel görevlerinde geciken ve bugün olanları izler", kind: "analitik", href: "/gorevler?sekme=gorevler", health: tLate.length ? "alert" : "ok", status: `${tOpen.length} açık görev`, alert: tLate.length ? `${tLate.length} görev gecikti` : undefined, kpis: [{ label: "Bugün", value: String(tToday.length) }, { label: "Gecikmiş", value: String(tLate.length) }, { label: "7 günde biten", value: String(tWeek.length) }] }),
      ],
      health: 0,
    },
  ];

  const processes = [closing, inflow, follow, meetings, tasks];
  // süreç yöneticisi
  const sm = depts[4].agents[0];
  const bad = processes.filter((p) => p.health !== "ok");
  sm.health = bad.some((p) => p.health === "alert") ? "alert" : "ok";
  sm.status = bad.length ? `${bad.length} süreçte dikkat: ${bad.map((p) => p.name).join(", ")}` : "bütün süreçler akıyor";
  sm.alert = bad.find((p) => p.bottleneck)?.bottleneck;
  sm.kpis = processes.map((p) => ({ label: p.name, value: p.health === "ok" ? "akıyor" : p.health === "warn" ? "dikkat" : "risk" }));

  const SCORE: Record<AgentHealth, number> = { working: 1, ok: 1, idle: 0.6, alert: 0.35, error: 0 };
  for (const d of depts) d.health = d.agents.reduce((n, a) => n + SCORE[a.health], 0) / d.agents.length;
  const all = depts.flatMap((d) => d.agents);
  return {
    at: now.toISOString(),
    core: { files: files.length, memory: memoryLines, rules: rulesLines, archive: arch.total, bySource: Object.fromEntries(Object.entries(arch.bySource).map(([k, v]) => [k, v?.count ?? 0])) },
    depts,
    processes,
    totals: {
      agents: all.length,
      working: all.filter((a) => a.health === "working").length,
      alerts: all.filter((a) => a.health === "alert" || a.health === "error").length,
      health: Math.round((all.reduce((n, a) => n + SCORE[a.health], 0) / all.length) * 100),
      costToday: day?.cost ?? 0,
      runsToday: day?.requests ?? 0,
    },
  };
}

/** Strateji katmanı için kısa analiz özeti: süreç tahminleri, darboğazlar, ajan uyarıları. */
export function orgDigest(o: OrgState) {
  const procs = o.processes.map((p) => `- ${p.name} [${p.health === "ok" ? "akıyor" : p.health === "warn" ? "dikkat" : "RİSK"}]: ${p.metrics.map((m) => `${m.label} ${m.value}`).join(", ")}${p.forecast ? ` · ${p.forecast}` : ""}${p.bottleneck ? ` · darboğaz: ${p.bottleneck}` : ""}`);
  const alerts = o.depts.flatMap((d) => d.agents.filter((a) => a.alert && (a.health === "alert" || a.health === "error")).map((a) => `- ${a.name} (${d.name}): ${a.alert}`));
  return `SÜREÇLER:\n${procs.join("\n")}\nAJAN UYARILARI:\n${alerts.slice(0, 14).join("\n") || "(yok)"}`;
}
