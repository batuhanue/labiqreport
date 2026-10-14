"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { Icon } from "@/components/ui";
import { liveDecision, ruleDecisions, trDay, trHM } from "@/lib/brain-plan";
import { agentById, type BrainItem, type Decision, type PlanBlock } from "@/lib/brain-types";
import { Brief, splitDeliverable } from "./BrainView";
import type { useBrainState } from "./useBrain";

type Brain = ReturnType<typeof useBrainState>;

const URGENCY: Record<Decision["urgency"], { label: string; color: string }> = {
  1: { label: "Bugün", color: "#ef4d5a" },
  2: { label: "Bugün", color: "#f59e0b" },
  3: { label: "Bu hafta", color: "#8a93a6" },
};
const SPRING = { type: "spring" as const, stiffness: 380, damping: 32 };

/** Canlı kararlar: stratejinin sundukları + o andan beri hazır olan taslaklar (yeniden düşünmeyi beklemeden). */
export function useDecisions(brain: Brain) {
  const st = brain.st;
  return useMemo(() => {
    if (!st) return { list: [] as { d: Decision; it: BrainItem }[], ready: 0 };
    const byId = new Map(st.items.map((x) => [x.id, x]));
    const today = trDay();
    const base = (st.focus?.decisions ?? []).filter((d) => liveDecision(d, byId.get(d.itemId), today));
    const extra = ruleDecisions(st.items).filter((r) => (r.type === "reply" || r.type === "follow_up" || r.type === "do") && !base.some((d) => d.itemId === r.itemId) && liveDecision(r, byId.get(r.itemId), today));
    const list = [...base, ...extra].slice(0, 7).map((d) => ({ d, it: byId.get(d.itemId)! }));
    const ready = list.filter(({ it }) => it.work?.status === "waiting_ok" || it.work?.status === "ready").length;
    return { list, ready };
  }, [st]);
}

/** "Senin için hazırladım": durum → önerim → tek tuş. */
export function DecisionDeck({ brain, compact, max = 7, onOpen, bare, hideTitle }: { brain: Brain; compact?: boolean; max?: number; onOpen: (x: BrainItem) => void; bare?: boolean; hideTitle?: boolean }) {
  const { list, ready } = useDecisions(brain);
  const st = brain.st;
  const busy = brain.thinking || !!st?.running;
  const [showBrief, setShowBrief] = useState(false);
  const headline = st?.focus?.headline;
  const shown = list.slice(0, max);
  return (
    <section className={bare ? "" : "clay p-3 sm:p-5"}>
      <div className="flex items-start gap-2 px-1">
        <div className="min-w-0 flex-1">
          {!hideTitle && <div className={`font-extrabold ${compact ? "text-sm" : "text-lg"}`}>Senin için hazırladım</div>}
          {list.length > 0 && (
            <div className="text-[11px] font-bold uppercase tracking-wider text-ink-3">
              {list.length} karar{ready ? ` · ${ready} taslak hazır` : ""}
            </div>
          )}
          {headline && (
            <button onClick={() => st?.focus?.brief && setShowBrief((v) => !v)} className={`mt-0.5 text-left text-ink-2 ${compact ? "text-[12.5px]" : "text-sm"} ${st?.focus?.brief ? "hover:text-ink" : "cursor-default"}`}>
              {headline}
              {st?.focus?.brief && <Icon name="chevron" size={11} className={`ml-1 inline transition-transform ${showBrief ? "rotate-90" : ""}`} />}
            </button>
          )}
        </div>
        <button onClick={brain.think} disabled={busy} title="Kaynakları şimdi oku ve yeniden düşün" className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold text-ink-2 hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/10">
          <Icon name="refresh" size={13} className={busy ? "animate-spin" : ""} />
          {busy ? "Düşünüyor" : "Düşün"}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {showBrief && st?.focus?.brief && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-1 pt-2 text-[13.5px] text-ink-2">
              <Brief text={st.focus.brief} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={`mt-3 ${compact ? "space-y-2" : "space-y-2.5"}`}>
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map(({ d, it }, i) => (
            <DecisionCard key={d.itemId} d={d} it={it} brain={brain} compact={compact} onOpen={onOpen} index={i} />
          ))}
        </AnimatePresence>
        {!st && <div className="h-24 animate-pulse rounded-3xl bg-track/70" />}
        {st && !list.length && (
          <div className="rounded-3xl bg-track/50 px-4 py-5 text-center">
            <div className="text-sm font-bold">{busy ? "Kaynakları okuyorum…" : "Şu an senden karar bekleyen bir şey yok"}</div>
            <div className="mt-0.5 text-xs text-ink-3">{st.lastRun ? `Son düşünme ${trHM(new Date(st.lastRun))}. ` : ""}E-posta, takvim, sohbet ve denetimi izlemeye devam ediyorum.</div>
          </div>
        )}
        {list.length > shown.length && <div className="px-1 text-xs font-semibold text-ink-3">+{list.length - shown.length} karar daha</div>}
      </div>
    </section>
  );
}

const SRC_ICON: Record<string, string> = { posta: "📧", sohbet: "💬", takvim: "📅", toplanti: "🎥", denetim: "📋", dosya: "📁", gorev: "✍️" };
const shortDay = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "Europe/Istanbul" });
const agoMin = (iso?: string) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)) : 0);

/** "Bunu nereden çıkardı": kartın en üstündeki tek satırlık kaynak (tıklanınca asıl e-posta/sohbet/dosya açılır). */
export function sourceLine(it: BrainItem): { icon: string; text: string; link?: string; more: number } {
  const s = it.sources[0];
  const more = Math.max(0, it.sources.length - 1);
  if (!s) return it.area ? { icon: "📋", text: `Denetim · ${it.area}`, more } : { icon: "🧠", text: it.origin === "strateji" ? "Beyin tespiti (birden çok kaynaktan)" : "Beyin tespiti", more };
  const who = (s.who ?? "").split(" <")[0].replace(/"/g, "").trim();
  const day = s.ts ? shortDay(s.ts) : "";
  const text =
    s.agent === "posta"
      ? `${who || "E-posta"} · ${day} e-postası`
      : s.agent === "sohbet"
        ? `${who || s.title} · ${day} sohbet`
        : s.agent === "takvim"
          ? `Toplantı: ${s.title} · ${day}`
          : s.agent === "toplanti"
            ? `Toplantı notu: ${s.title} · ${day}`
            : s.agent === "denetim"
              ? `Denetim · ${s.title}`
              : s.agent === "dosya"
                ? `Dosya · ${s.title}`
                : `Senin notun · ${day}`;
  return { icon: it.origin === "strateji" ? "🧠" : (SRC_ICON[s.agent] ?? "•"), text, link: s.link || undefined, more };
}

const NOPE: { label: string; act: "dismiss" | "done" | "snooze" }[] = [
  { label: "Zaten yaptım", act: "done" },
  { label: "Benim işim değil", act: "dismiss" },
  { label: "Önemsiz", act: "dismiss" },
  { label: "Şimdi değil", act: "snooze" },
];

/** Tek karar: nereden geldi → ne oldu → ne öneriyorum → [yap] [✓ Bitti] [Gerek yok]. */
function DecisionCard({ d, it, brain, compact, onOpen, index }: { d: Decision; it: BrainItem; brain: Brain; compact?: boolean; onOpen: (x: BrainItem) => void; index: number }) {
  const [nope, setNope] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ error: string; code?: string } | null>(null);
  const w = it.work;
  const working = w?.status === "queued" || w?.status === "running";
  const age = agoMin(w?.at);
  const stuck = w?.status === "running" && age >= 5;
  const draft = w?.output && (w.status === "waiting_ok" || w.status === "ready") ? splitDeliverable(w.output) : null;
  const u = URGENCY[d.urgency];
  const src = sourceLine(it);

  const run = async (fn: () => Promise<unknown> | unknown) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fn();
      if (r && typeof r === "object" && "error" in r) setErr(r as { error: string; code?: string });
    } finally {
      setBusy(false);
    }
  };
  const primary: { label: string; icon: "mail" | "check" | "play" | "refresh" | "send"; act: () => unknown } | null =
    working && !stuck
      ? null
      : stuck || w?.status === "error"
        ? { label: "Tekrar dene", icon: "refresh", act: () => brain.runWork(it.id) }
        : w?.status === "waiting_ok" && w.outbound
          ? { label: d.type === "follow_up" || w.purpose === "followup" ? "Hatırlatmayı Gmail'e koy" : "Gmail'e taslak koy", icon: "mail", act: () => brain.approveWork(it.id, true) }
          : w?.status === "ready" || w?.status === "waiting_ok"
            ? { label: "Onayla", icon: "check", act: () => brain.approveWork(it.id) }
            : it.followUp && it.status === "waiting"
              ? { label: "Hatırlatma yaz", icon: "send", act: () => brain.nudge(it.id) }
              : {
                  label: d.type === "reply" ? "Yanıtı yaz" : d.type === "prep" ? "Notu hazırla" : "Ajan yapsın",
                  icon: "play",
                  act: async () => {
                    if (it.status === "inbox") await brain.patch(it.id, { status: "todo" });
                    brain.runWork(it.id);
                  },
                };
  const pickNope = (n: (typeof NOPE)[number]) => {
    setNope(false);
    if (n.act === "snooze") brain.snooze(it.id, 3);
    else if (n.act === "done") brain.patch(it.id, { status: "done" });
    else brain.patch(it.id, { status: "dismissed" }, n.label);
  };

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { ...SPRING, delay: Math.min(index, 5) * 0.04 } }}
      exit={{ opacity: 0, x: 40, scale: 0.96, transition: { duration: 0.22 } }}
      className={`rounded-3xl border border-line bg-card ${compact ? "p-3" : "p-3.5 sm:p-4"}`}
    >
      {/* nereden geldi */}
      <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold text-ink-3">
        <span aria-hidden>{src.icon}</span>
        {src.link ? (
          <a href={src.link} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:text-blue hover:underline" title="Kaynağı aç">
            {src.text} ↗
          </a>
        ) : (
          <span className="min-w-0 truncate">{src.text}</span>
        )}
        {src.more > 0 && <span className="shrink-0">+{src.more}</span>}
        <span className="ml-auto shrink-0 font-bold" style={{ color: u.color }}>
          {d.type === "follow_up" ? "Takip" : it.due ? `Termin ${shortDay(it.due)}` : u.label}
        </span>
      </div>
      {/* ne oldu → ne öneriyorum */}
      <button onClick={() => onOpen(it)} className="mt-1.5 block w-full text-left">
        <div className={`font-extrabold leading-snug ${compact ? "text-[14px]" : "text-[15.5px]"}`}>{d.headline}</div>
        <div className={`mt-0.5 leading-snug text-ink-2 ${compact ? "text-[12.5px]" : "text-[13.5px]"}`}>
          <span className="font-bold text-ink-3">Önerim: </span>
          {d.recommendation}
        </div>
      </button>

      {working && (
        <div className="mt-2.5 flex items-center gap-2 rounded-2xl bg-track/60 px-3 py-2 text-xs font-semibold text-ink-2">
          {stuck ? (
            <span>⚠️ Hazırlık yarıda kaldı ({age} dk). Tekrar dene ya da gerek yok de.</span>
          ) : (
            <>
              <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-blue border-t-transparent" />
              {w?.status === "queued" ? "Sırada — birazdan hazırlıyorum" : `${w?.purpose === "followup" ? "Hatırlatmayı" : "Taslağı"} yazıyorum${age ? ` · ${age} dk` : ""}`}
            </>
          )}
        </div>
      )}
      {draft && (
        <button onClick={() => onOpen(it)} className="mt-2.5 block w-full rounded-2xl bg-track/60 px-3 py-2 text-left hover:bg-track">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-ink-3">
            <Icon name={w?.outbound ? "mail" : "note"} size={12} />
            {w?.outbound ? `Taslak hazır${draft.to ? ` · ${draft.to}` : ""}` : "Hazır"} · açmak için dokun
          </div>
          <div className={`mt-0.5 text-ink-2 ${compact ? "line-clamp-2 text-xs" : "line-clamp-3 text-[12.5px]"} leading-snug`}>{draft.body.replace(/^GİDECEK:.*$/gm, "").replace(/[#*_`>]/g, "").replace(/\n+/g, " ")}</div>
        </button>
      )}

      {nope ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {NOPE.map((n) => (
            <button key={n.label} onClick={() => pickNope(n)} className="rounded-full border border-line bg-card px-3 py-1.5 text-[12.5px] font-bold text-ink-2 hover:border-ink hover:text-ink">
              {n.label}
            </button>
          ))}
          <button onClick={() => setNope(false)} className="px-2 text-xs font-semibold text-ink-3 hover:text-ink">
            Vazgeç
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 sm:gap-2">
          {primary && (
            <motion.button whileTap={{ scale: 0.95 }} disabled={busy} onClick={() => run(primary.act)} className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-[13px] font-bold text-paper disabled:opacity-50 sm:px-4 dark:bg-white dark:text-[#1b1e27]">
              <Icon name={primary.icon} size={14} stroke={2.4} />
              {busy ? "Bir saniye…" : primary.label}
            </motion.button>
          )}
          <button onClick={() => brain.patch(it.id, { status: "done" })} className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[13px] font-bold text-ok hover:border-ok sm:px-3.5">
            <Icon name="check" size={13} stroke={2.6} />
            Bitti
          </button>
          <button onClick={() => setNope(true)} className="rounded-full px-2 py-2 text-[13px] font-bold text-ink-3 hover:bg-track hover:text-ink sm:px-3">
            Gerek yok
          </button>
        </div>
      )}
      {err && (
        <div className="mt-2 text-xs font-semibold text-fail">
          {err.error}{" "}
          {err.code === "scope" ? (
            <a href="/api/google/auth" className="text-blue underline">
              Google'ı yeniden bağla
            </a>
          ) : null}
          {w?.outbound && (
            <button onClick={() => run(() => brain.approveWork(it.id))} className="ml-1 text-blue underline">
              Kendim gönderdim
            </button>
          )}
        </div>
      )}
    </motion.article>
  );
}

/** Bugünün planı: toplantılar + boş saatlere yerleştirilmiş odak blokları; şu anki blok vurgulu. */
export function DayPlan({ plan, items, onOpen, compact }: { plan?: PlanBlock[]; items: BrainItem[]; onOpen: (x: BrainItem) => void; compact?: boolean }) {
  const [open, setOpen] = useState(true);
  if (!plan?.length) return null;
  const now = trHM(new Date());
  const live = plan.filter((b) => b.end > now);
  if (!live.length) return null;
  return (
    <section>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-1 text-left">
        <span className={`${compact ? "text-sm" : "text-lg"} font-extrabold`}>Bugünün planı</span>
        <span className="text-xs text-ink-3">{live.filter((b) => b.kind === "focus").length} odak bloğu</span>
        <Icon name="chevron" size={13} className={`ml-auto text-ink-3 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <ol className="relative mt-2 space-y-1 pl-4 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-line">
          {live.map((b, i) => {
            const it = b.itemId ? items.find((x) => x.id === b.itemId) : undefined;
            const current = b.start <= now && now < b.end;
            return (
              <motion.li key={`${b.start}${b.title}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ ...SPRING, delay: i * 0.04 }} className="relative">
                <span className={`absolute -left-[15px] top-[9px] h-2.5 w-2.5 rounded-full border-2 border-card ${current ? "bg-blue" : b.kind === "meeting" ? "bg-[#8b5cf6]" : "bg-ink-3/50"}`} />
                <button disabled={!it} onClick={() => it && onOpen(it)} className={`flex w-full items-baseline gap-3 rounded-xl px-2 py-1.5 text-left ${it ? "hover:bg-track/60" : "cursor-default"} ${current ? "bg-blue/10" : ""}`}>
                  <span className="w-[86px] shrink-0 text-xs font-bold tabular-nums text-ink-3">
                    {b.start}–{b.end}
                  </span>
                  <span className={`min-w-0 flex-1 text-[13px] ${b.kind === "meeting" ? "font-semibold text-[#8b5cf6]" : "font-semibold"}`}>
                    {b.kind === "meeting" ? "Toplantı · " : ""}
                    {b.title}
                  </span>
                </button>
              </motion.li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
