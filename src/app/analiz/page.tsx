"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { STATUSES } from "@/components/ActionEditor";
import { usePeriod } from "@/components/PeriodProvider";
import { EmptyState, Icon, Ring } from "@/components/ui";
import { AREAS, HOSPITALS, TOTAL_ITEMS } from "@/lib/checklist";
import { areaProgress, deadlineInfo, overallProgress, periodLabel, periodShort } from "@/lib/period";
import type { PeriodData } from "@/lib/types";

// Grafik serileri (doğrulanmış kategorik çift: CVD ΔE 30.8)
const SERIES = { bursa: "#4F6BED", basaksehir: "#E8833A" } as const;

export default function AnalizPage() {
  const { data } = usePeriod();
  if (!data)
    return (
      <EmptyState emoji="📊" title="Analiz için bir dönem seç" text="Üstteki dönem düğmesinden bir dönem aç ya da yeni dönem başlat.">
        <Link href="/" className="clay-dark rounded-full px-5 py-3 font-bold">Denetime git</Link>
      </EmptyState>
    );
  return <Analysis data={data} />;
}

function Legend() {
  return (
    <div className="flex items-center gap-4 text-xs font-bold text-ink-2">
      {HOSPITALS.map((h) => (
        <span key={h.id} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: SERIES[h.id] }} />
          {h.label}
        </span>
      ))}
    </div>
  );
}

function Tile({ label, value, sub, emoji, tint, delay }: { label: string; value: string; sub?: string; emoji: string; tint: string; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} className="clay flex items-center gap-3 p-4">
      <div className="clay-color grid h-12 w-12 shrink-0 place-items-center text-2xl" style={{ background: tint, borderRadius: 16, ["--glow" as string]: "rgba(0,0,0,.12)" }}>
        {emoji}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-bold text-ink-3">{label}</div>
        <div className="text-2xl font-extrabold leading-tight">{value}</div>
        {sub && <div className="truncate text-xs text-ink-3">{sub}</div>}
      </div>
    </motion.div>
  );
}

function Analysis({ data }: { data: PeriodData }) {
  const { summaries } = usePeriod();
  const prog = overallProgress(data);
  const [hover, setHover] = useState<{ x: number; y: number; html: React.ReactNode } | null>(null);

  const deadlines = useMemo(
    () =>
      AREAS.map((a) => ({ a, d: deadlineInfo(data.period, a), p: areaProgress(data, a) })).sort(
        (x, y) => (x.d.days ?? 999) - (y.d.days ?? 999),
      ),
    [data],
  );
  const overdue = deadlines.filter((x) => x.d.days != null && x.d.days < 0 && x.p.both < x.a.items.length);
  const fails = AREAS.flatMap((a) =>
    a.items.flatMap((it) =>
      HOSPITALS.filter((h) => data.items[it.id]?.[h.id] === "fail").map((h) => ({ a, it, h, note: data.items[it.id].note })),
    ),
  );
  const openActions = data.actions.filter((a) => a.status !== "Tamamlandı");
  const trend = [...summaries].sort((a, b) => a.period.localeCompare(b.period)).slice(-12);

  const tip = (e: React.MouseEvent | React.FocusEvent, html: React.ReactNode) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHover({ x: r.left + r.width / 2, y: r.top, html });
  };

  return (
    <div className="space-y-5" onMouseLeave={() => setHover(null)}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-ink-3">Seçili dönem</div>
          <div className="text-2xl font-extrabold">{periodLabel(data.period)}</div>
        </div>
        <span className="clay-sm rounded-full px-4 py-2 text-sm font-bold">{data.status}</span>
      </div>

      {/* Özet kutuları */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Tile delay={0} emoji="🎯" tint="#E8EDFF" label="Genel tamamlanma" value={`%${Math.round(prog.overall * 100)}`} sub={`${prog.remaining} işaret kaldı`} />
        <Tile delay={0.04} emoji="🏥" tint="#E8EDFF" label="Bursa" value={`%${Math.round(prog.bursa * 100)}`} sub={`${prog.b.ok + prog.b.na}/${TOTAL_ITEMS} madde`} />
        <Tile delay={0.08} emoji="🏥" tint="#FFF1E3" label="Başakşehir" value={`%${Math.round(prog.basaksehir * 100)}`} sub={`${prog.k.ok + prog.k.na}/${TOTAL_ITEMS} madde`} />
        <Tile delay={0.12} emoji="⚠️" tint="#FFE6EC" label="Sorunlu işaret" value={String(prog.fails)} sub={`BRS ${prog.b.fail} · BŞK ${prog.k.fail}`} />
        <Tile delay={0.16} emoji="🚩" tint="#FFF7DD" label="Açık aksiyon" value={String(openActions.length)} sub={`toplam ${data.actions.length}`} />
        <Tile delay={0.2} emoji="⏰" tint="#FFEBE4" label="Geciken alan" value={String(overdue.length)} sub={overdue.map((x) => x.a.code).join(", ") || "yok"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        {/* Alan bazında tamamlanma */}
        <section className="clay p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-extrabold">Alan bazında tamamlanma</h3>
            <Legend />
          </div>
          <div className="space-y-3.5">
            {AREAS.map((a) => {
              const p = areaProgress(data, a);
              return (
                <div key={a.code} className="grid grid-cols-[112px_1fr] items-center gap-3 sm:grid-cols-[200px_1fr]">
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold text-ink-3">{a.code}{a.priority ? " 🔥" : ""}</div>
                    <div className="truncate text-sm font-bold">{a.title}</div>
                  </div>
                  <div className="space-y-[2px]">
                    {HOSPITALS.map((h) => {
                      const n = h.id === "bursa" ? p.bursa : p.basaksehir;
                      return (
                        <div
                          key={h.id}
                          className="flex items-center gap-2 py-0.5"
                          tabIndex={0}
                          onMouseEnter={(e) => tip(e, <><b>{a.code} · {h.label}</b><br />{n}/{p.total} madde tamam (%{Math.round((n / p.total) * 100)})</>)}
                          onFocus={(e) => tip(e, <><b>{a.code} · {h.label}</b><br />{n}/{p.total} madde tamam</>)}
                          onMouseLeave={() => setHover(null)}
                          onBlur={() => setHover(null)}
                        >
                          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/[0.05]">
                            <motion.div
                              className="h-full rounded-r"
                              style={{ background: SERIES[h.id], borderRadius: 4 }}
                              initial={{ width: 0 }}
                              animate={{ width: `${(n / p.total) * 100}%` }}
                              transition={{ type: "spring", stiffness: 70, damping: 18 }}
                            />
                          </div>
                          <span className="w-9 text-right text-xs font-bold tabular-nums text-ink-2">{n}/{p.total}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Termin takvimi */}
        <section className="clay p-5">
          <h3 className="mb-4 text-lg font-extrabold">Termin takvimi</h3>
          <div className="space-y-2.5">
            {deadlines.map(({ a, d, p }) => {
              const done = p.both === p.total;
              const state = done
                ? { i: "✅", t: "Tamamlandı", c: "text-ok" }
                : d.days == null
                  ? { i: "🔁", t: "Ayda 2 kez", c: "text-ink-3" }
                  : d.days < 0
                    ? { i: "⛔", t: d.text, c: "text-fail" }
                    : d.days <= 2
                      ? { i: "⚠️", t: d.text, c: "text-warn" }
                      : { i: "🕒", t: d.text, c: "text-ink-2" };
              return (
                <Link key={a.code} href={`/?alan=${a.code}`} className="clay-sm flex items-center gap-3 px-3 py-2.5">
                  <span className="text-xl">{a.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{a.code} · {a.title}</div>
                    <div className="text-xs text-ink-3">{a.deadlineLabel}{d.dateText ? ` · ${d.dateText}` : ""}</div>
                  </div>
                  <span className={`whitespace-nowrap text-xs font-extrabold ${state.c}`}>
                    {state.i} {state.t}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {/* Sorunlu maddeler */}
        <section className="clay p-5">
          <h3 className="mb-4 text-lg font-extrabold">Sorunlu maddeler (x)</h3>
          {fails.length === 0 ? (
            <div className="py-6 text-center text-ink-3">Sorun işaretli madde yok 🎉</div>
          ) : (
            <div className="space-y-2.5">
              {fails.map(({ a, it, h, note }) => (
                <Link key={it.id + h.id} href={`/?alan=${a.code}`} className="clay-sm block px-4 py-3">
                  <div className="flex items-center gap-2 text-xs font-extrabold">
                    <span style={{ color: a.color }}>{a.code}</span>
                    <span className="rounded-full px-2 py-0.5 text-white" style={{ background: SERIES[h.id] }}>{h.label}</span>
                  </div>
                  <div className="mt-1 text-sm font-bold">{it.text.trim()}</div>
                  {note && <div className="mt-1 text-sm text-ink-2">📝 {note}</div>}
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Aksiyon durumu */}
        <section className="clay p-5">
          <h3 className="mb-4 text-lg font-extrabold">Aksiyon durumu</h3>
          {data.actions.length === 0 ? (
            <div className="py-6 text-center text-ink-3">Bu dönemde aksiyon yok.</div>
          ) : (
            <>
              <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-full">
                {STATUSES.map((s) => {
                  const n = data.actions.filter((a) => a.status === s.v).length;
                  if (!n) return null;
                  return (
                    <motion.div
                      key={s.v}
                      initial={{ flexGrow: 0 }}
                      animate={{ flexGrow: n }}
                      style={{ background: s.c, flexBasis: 0 }}
                      onMouseEnter={(e) => tip(e, <><b>{s.v}</b><br />{n} aksiyon</>)}
                      onMouseLeave={() => setHover(null)}
                    />
                  );
                })}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                {STATUSES.map((s) => (
                  <div key={s.v} className="clay-sm flex items-center gap-2 px-3 py-2.5">
                    <span>{s.e}</span>
                    <span className="flex-1 text-sm font-bold">{s.v}</span>
                    <span className="text-lg font-extrabold tabular-nums">{data.actions.filter((a) => a.status === s.v).length}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-1.5">
                {AREAS.filter((a) => data.actions.some((x) => x.areaCode === a.code)).map((a) => {
                  const n = data.actions.filter((x) => x.areaCode === a.code).length;
                  const open = data.actions.filter((x) => x.areaCode === a.code && x.status !== "Tamamlandı").length;
                  return (
                    <div key={a.code} className="flex items-center justify-between text-sm">
                      <span className="font-bold">{a.emoji} {a.code} · {a.title}</span>
                      <span className="text-ink-2">{open} açık / {n}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>

      {/* Dönem trendi */}
      <section className="clay p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-extrabold">Dönemler arası tamamlanma</h3>
          <Legend />
        </div>
        {trend.length === 0 ? (
          <div className="py-6 text-center text-ink-3">Henüz kayıtlı dönem yok.</div>
        ) : (
          <>
            <div className="relative h-52">
              {[0, 0.5, 1].map((g) => (
                <div key={g} className="absolute inset-x-0 border-t border-dashed border-black/[0.07]" style={{ bottom: `${g * 100}%` }}>
                  <span className="absolute -top-2.5 left-0 bg-[var(--color-card)] pr-1 text-[10px] font-bold text-ink-3">%{g * 100}</span>
                </div>
              ))}
              <div className="absolute inset-0 flex items-end gap-3 pl-8 sm:gap-5">
                {trend.map((s) => {
                  const vals = [s.bursaOk / TOTAL_ITEMS, s.basaksehirOk / TOTAL_ITEMS];
                  const sel = s.period === data.period;
                  return (
                    <div
                      key={s.period}
                      className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                      onMouseEnter={(e) =>
                        tip(e, <><b>{periodLabel(s.period)}</b><br />Bursa %{Math.round(vals[0] * 100)} · Başakşehir %{Math.round(vals[1] * 100)}<br />Sorun: {s.fails} · Açık aksiyon: {s.openActions}</>)
                      }
                      onMouseLeave={() => setHover(null)}
                    >
                      <div className="flex h-full w-full max-w-[56px] items-end justify-center gap-[2px]">
                        {vals.map((v, i) => (
                          <motion.div
                            key={i}
                            className="w-1/2 max-w-[22px]"
                            style={{ background: i === 0 ? SERIES.bursa : SERIES.basaksehir, borderRadius: "4px 4px 0 0", opacity: sel ? 1 : 0.75 }}
                            initial={{ height: 0 }}
                            animate={{ height: `${Math.max(v * 100, 1.5)}%` }}
                            transition={{ type: "spring", stiffness: 70, damping: 18 }}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-2 flex gap-3 pl-8 sm:gap-5">
              {trend.map((s) => (
                <div key={s.period} className={`min-w-0 flex-1 truncate text-center text-[11px] font-bold ${s.period === data.period ? "text-ink" : "text-ink-3"}`}>
                  {periodShort(s.period)}
                </div>
              ))}
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-3">
                    <th className="py-1.5 font-bold">Dönem</th>
                    <th className="font-bold">Durum</th>
                    <th className="text-right font-bold">Bursa</th>
                    <th className="text-right font-bold">Başakşehir</th>
                    <th className="text-right font-bold">Sorun</th>
                    <th className="text-right font-bold">Açık aksiyon</th>
                  </tr>
                </thead>
                <tbody>
                  {[...trend].reverse().map((s) => (
                    <tr key={s.period} className="border-t border-black/[0.06]">
                      <td className="py-2 font-bold">{periodLabel(s.period)}</td>
                      <td className="text-ink-2">{s.status}</td>
                      <td className="text-right tabular-nums">{s.bursaOk}/{TOTAL_ITEMS}</td>
                      <td className="text-right tabular-nums">{s.basaksehirOk}/{TOTAL_ITEMS}</td>
                      <td className="text-right tabular-nums">{s.fails}</td>
                      <td className="text-right tabular-nums">{s.openActions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Hastane karşılaştırma halkaları */}
      <section className="clay grid gap-4 p-5 sm:grid-cols-2">
        {HOSPITALS.map((h) => {
          const c = h.id === "bursa" ? prog.b : prog.k;
          return (
            <div key={h.id} className="flex items-center gap-4">
              <Ring value={(c.ok + c.na) / TOTAL_ITEMS} size={84} stroke={10} color={SERIES[h.id]}>
                <span className="text-lg font-extrabold">%{Math.round(((c.ok + c.na) / TOTAL_ITEMS) * 100)}</span>
              </Ring>
              <div>
                <div className="text-lg font-extrabold">{h.label}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-2">
                  <span className="flex items-center gap-1"><Icon name="check" size={15} className="text-ok" /> {c.ok} tamam</span>
                  <span className="flex items-center gap-1"><Icon name="x" size={15} className="text-fail" /> {c.fail} sorun</span>
                  <span>N/A {c.na}</span>
                  <span>⏳ {c.pending} bekliyor</span>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {hover && (
        <div
          className="clay-dark pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-2xl px-3 py-2 text-xs"
          style={{ left: hover.x, top: hover.y - 8 }}
        >
          {hover.html}
        </div>
      )}
    </div>
  );
}
