"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePeriod } from "@/components/PeriodProvider";
import { Icon } from "@/components/ui";
import type { BrainItem } from "@/lib/brain-types";
import { renderMd } from "@/lib/markdown";
import type { Brief, MeetingChip } from "@/lib/prepare";
import { ItemSheet } from "./BrainView";
import { DecisionDeck, sourceLine, useDecisions } from "./DecisionDeck";
import { useBrainState } from "./useBrain";

const isOpen = (x: BrainItem) => x.status !== "done" && x.status !== "dismissed";
const shortDay = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "Europe/Istanbul" });

/**
 * Bugün: tek ekran. Solda senden karar bekleyenler (her biri nereden geldiğini söyler, üç tuş),
 * sağda "Hazırla" (toplantı/konu notu) ve beynin kendiliğinden kapattıkları. Gerisi Tüm işler'de.
 */
export default function Today() {
  const brain = useBrainState();
  const { st } = brain;
  const { list } = useDecisions(brain);
  const [moreOpen, setMoreOpen] = useState(false);

  const shownIds = useMemo(() => new Set(list.map((x) => x.it.id)), [list]);
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const other = useMemo(
    () =>
      (st?.items ?? [])
        .filter((x) => isOpen(x) && !shownIds.has(x.id) && !(x.snoozeUntil && x.snoozeUntil > today))
        .sort((a, b) => a.priority - b.priority || (a.due ?? "9999").localeCompare(b.due ?? "9999") || b.updatedAt.localeCompare(a.updatedAt)),
    [st, shownIds, today],
  );
  const closed = useMemo(
    () =>
      [...(st?.items ?? []), ...(st?.closedRecent ?? []).filter((c) => !st?.items.some((x) => x.id === c.id))]
        .filter((x) => !isOpen(x) && Date.now() - Date.parse(x.closed?.at ?? x.updatedAt) < 3 * 86400_000)
        .sort((a, b) => (b.closed?.at ?? b.updatedAt).localeCompare(a.closed?.at ?? a.updatedAt))
        .slice(0, 12),
    [st],
  );

  const reopen = async (x: BrainItem) => {
    await brain.patch(x.id, { status: x.status === "dismissed" ? "inbox" : "todo" });
    brain.load();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
      <div className="min-w-0 space-y-4">
        <DecisionDeck brain={brain} onOpen={brain.setOpen} />
        {other.length > 0 && (
          <section className="clay p-4">
            <button onClick={() => setMoreOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
              <span className="text-sm font-extrabold">Diğer açık işler</span>
              <span className="text-xs font-bold text-ink-3">{other.length}</span>
              <span className="hidden text-xs text-ink-3 sm:inline">· acil değil, gözden geçirmen yeterli</span>
              <Icon name="chevron" size={13} className={`ml-auto text-ink-3 transition-transform ${moreOpen ? "rotate-90" : ""}`} />
            </button>
            <AnimatePresence initial={false}>
              {moreOpen && (
                <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-2 divide-y divide-line overflow-hidden">
                  {other.slice(0, 25).map((x) => (
                    <OtherRow key={x.id} x={x} onOpen={() => brain.setOpen(x)} onDone={() => brain.patch(x.id, { status: "done" })} onDrop={() => brain.patch(x.id, { status: "dismissed" }, "Önemsiz")} />
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </section>
        )}
        {/* telefonda kapananlar en altta */}
        {closed.length > 0 && (
          <div className="lg:hidden">
            <Closed items={closed} onReopen={reopen} />
          </div>
        )}
      </div>
      <div className="order-first min-w-0 space-y-4 lg:order-none">
        <Prepare />
        {closed.length > 0 && (
          <div className="hidden lg:block">
            <Closed items={closed} onReopen={reopen} />
          </div>
        )}
      </div>
      <ItemSheet x={brain.open} onClose={() => brain.setOpen(null)} onPatch={brain.patch} onWork={brain.runWork} onApprove={brain.approveWork} />
    </div>
  );
}

function OtherRow({ x, onOpen, onDone, onDrop }: { x: BrainItem; onOpen: () => void; onDone: () => void; onDrop: () => void }) {
  const src = sourceLine(x);
  return (
    <li className="flex items-center gap-2 py-2">
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="truncate text-[13.5px] font-bold">{x.title}</div>
        <div className="truncate text-[11.5px] text-ink-3">
          {src.icon} {src.text}
          {x.due ? ` · termin ${shortDay(x.due)}` : ""}
        </div>
      </button>
      <button onClick={onDone} title="Bitti" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ok hover:bg-ok/10">
        <Icon name="check" size={15} stroke={2.6} />
      </button>
      <button onClick={onDrop} title="Gerek yok" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-track hover:text-ink">
        <Icon name="x" size={14} />
      </button>
    </li>
  );
}

/** Beynin kapattıkları (gerekçesiyle) — yanlışsa tek dokunuşla geri açılır. */
function Closed({ items, onReopen }: { items: BrainItem[]; onReopen: (x: BrainItem) => void }) {
  const [open, setOpen] = useState(false);
  const auto = items.filter((x) => x.closed).length;
  return (
    <section className="clay p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <span className="text-sm font-extrabold">Son kapananlar</span>
        <span className="text-xs font-bold text-ink-3">
          {items.length}
          {auto ? ` · ${auto} tanesini ben kapattım` : ""}
        </span>
        <Icon name="chevron" size={13} className={`ml-auto text-ink-3 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-2 divide-y divide-line overflow-hidden">
            {items.map((x) => (
              <li key={x.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-ink-2 line-through decoration-ink-3/40">{x.title}</div>
                  <div className="truncate text-[11.5px] text-ink-3">{x.closed?.reason ?? (x.status === "done" ? "Bitti dedin" : "Gerek yok dedin")}</div>
                </div>
                <button onClick={() => onReopen(x)} className="shrink-0 rounded-full px-2.5 py-1 text-xs font-bold text-blue hover:bg-blue/10">
                  Geri aç
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </section>
  );
}

const STEPS = ["Toplantıyı ve kişileri buluyorum", "Son e-posta ve sohbetleri okuyorum", "Açık işleri ve denetim durumunu ekliyorum", "Notu yazıyorum"];

/** Hazırla: tek cümleyle ya da yaklaşan toplantıya tek dokunuşla, kaynaklı not. */
export function Prepare() {
  const { toast } = usePeriod();
  const [text, setText] = useState("");
  const [meetings, setMeetings] = useState<MeetingChip[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [busyAt, setBusyAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [shown, setShown] = useState<Brief | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [past, setPast] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/prepare", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setMeetings(j.meetings ?? []);
        setBriefs(j.briefs ?? []);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!busyAt) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [busyAt]);

  const go = async (body: { request: string; meetingId?: string }) => {
    if (busyAt) return;
    setBusyAt(Date.now());
    setErr(null);
    setShown(null);
    try {
      const r = await fetch("/api/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.brief) throw new Error(j.error ?? (r.status === 504 ? "Süre doldu — daha dar bir istekle tekrar dene" : `HTTP ${r.status}`));
      setShown(j.brief);
      setBriefs((b) => [j.brief, ...b.filter((x) => x.id !== j.brief.id)]);
      setText("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyAt(null);
    }
  };
  const remove = async (id: string) => {
    setBriefs((b) => b.filter((x) => x.id !== id));
    if (shown?.id === id) setShown(null);
    await fetch(`/api/prepare?id=${id}`, { method: "DELETE" }).catch(() => {});
  };
  const copy = async (b: Brief) => {
    try {
      await navigator.clipboard.writeText(b.md);
      toast("Not kopyalandı");
    } catch {
      toast("Kopyalanamadı");
    }
  };
  const download = (b: Brief) => {
    const url = URL.createObjectURL(new Blob([b.md], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${b.title.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 60) || "not"}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const secs = busyAt ? Math.round((Date.now() - busyAt) / 1000) : 0;
  void tick;
  const step = STEPS[Math.min(STEPS.length - 1, secs < 4 ? 0 : secs < 12 ? 1 : secs < 22 ? 2 : 3)];

  return (
    <section className="clay p-4 sm:p-5">
      <div className="flex items-baseline gap-2">
        <div className="text-lg font-extrabold">📝 Hazırla</div>
        <div className="text-xs text-ink-3">toplantı notu, özet, konuşulacaklar</div>
      </div>
      <form
        className="mt-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) go({ request: text });
        }}
      >
        <textarea
          ref={ta}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && text.trim()) {
              e.preventDefault();
              go({ request: text });
            }
          }}
          rows={3}
          disabled={!!busyAt}
          placeholder="Ör. Yarın Hakan Bey'le toplantım var; son mailleri, chatleri ve R-05 bulgularını ekleyerek konuşulacakları hazırla"
          className="w-full resize-none rounded-2xl border border-line bg-card px-3.5 py-3 text-[14px] leading-snug outline-none placeholder:text-ink-3 focus:border-blue disabled:opacity-60"
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {meetings.map((m) => (
            <button key={m.id} type="button" disabled={!!busyAt} onClick={() => go({ request: text, meetingId: m.id })} title={m.who.join(", ")} className="max-w-full truncate rounded-full border border-line bg-card px-3 py-1.5 text-[12px] font-bold text-ink-2 hover:border-blue hover:text-blue disabled:opacity-50">
              📅 {m.label}
            </button>
          ))}
          <motion.button whileTap={{ scale: 0.95 }} type="submit" disabled={!text.trim() || !!busyAt} className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-bold text-paper disabled:opacity-40 dark:bg-white dark:text-[#1b1e27]">
            <Icon name="spark" size={14} />
            Hazırla
          </motion.button>
        </div>
      </form>

      {busyAt && (
        <div className="mt-3 flex items-center gap-2 rounded-2xl bg-track/60 px-3 py-2.5 text-[12.5px] font-semibold text-ink-2">
          <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-blue border-t-transparent" />
          {step}… <span className="ml-auto tabular-nums text-ink-3">{secs} sn</span>
        </div>
      )}
      {err && <div className="mt-2 text-xs font-semibold text-fail">{err}</div>}

      <AnimatePresence initial={false}>
        {shown && (
          <motion.div key={shown.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 rounded-2xl border border-line bg-card">
            <div className="flex items-center gap-1 border-b border-line px-3 py-2">
              <div className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-ink-3">
                {shortDay(shown.at)} · {shown.sources} kaynak tarandı · {Math.round(shown.ms / 1000)} sn
              </div>
              <button onClick={() => copy(shown)} title="Kopyala" className="grid h-8 w-8 place-items-center rounded-full text-ink-2 hover:bg-track">
                <Icon name="copy" size={15} />
              </button>
              <button onClick={() => download(shown)} title="İndir (.md)" className="grid h-8 w-8 place-items-center rounded-full text-ink-2 hover:bg-track">
                <Icon name="download" size={15} />
              </button>
              <button onClick={() => setShown(null)} title="Kapat" className="grid h-8 w-8 place-items-center rounded-full text-ink-2 hover:bg-track">
                <Icon name="x" size={15} />
              </button>
            </div>
            <div className="md max-h-[60vh] overflow-y-auto px-4 py-3 text-[14px] leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMd(shown.md) }} />
          </motion.div>
        )}
      </AnimatePresence>

      {briefs.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setPast((v) => !v)} className="flex items-center gap-1.5 text-xs font-bold text-ink-3 hover:text-ink">
            Önceki notlar ({briefs.length})
            <Icon name="chevron" size={12} className={`transition-transform ${past ? "rotate-90" : ""}`} />
          </button>
          {past && (
            <ul className="mt-1.5 divide-y divide-line">
              {briefs.slice(0, 15).map((b) => (
                <li key={b.id} className="flex items-center gap-2 py-1.5">
                  <button onClick={() => setShown(b)} className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold hover:text-blue">
                    {b.title}
                    <span className="ml-1.5 text-[11px] font-normal text-ink-3">{shortDay(b.at)}</span>
                  </button>
                  <button onClick={() => remove(b.id)} title="Sil" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-track hover:text-fail">
                    <Icon name="trash" size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
