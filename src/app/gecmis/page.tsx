"use client";

import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { usePeriod } from "@/components/PeriodProvider";
import { EmptyState, Icon, Ring, Sheet } from "@/components/ui";
import { TOTAL_ITEMS } from "@/lib/checklist";
import { defaultPeriod, normalizePeriod, PERIOD_RE, periodLabel, MONTHS } from "@/lib/period";
import type { PeriodData, PeriodStatus, Signoff } from "@/lib/types";

export default function GecmisPage() {
  const { summaries, activePeriod, data, openPeriod, exportExcel, deletePeriod, setActive, toast } = usePeriod();
  const router = useRouter();
  const [importOpen, setImportOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const byYear = summaries.reduce<Record<string, typeof summaries>>((acc, s) => {
    (acc[s.period.slice(0, 4)] ??= []).push(s);
    return acc;
  }, {});

  const download = async (p: string) => {
    const res = await fetch(`/api/periods/${p}`, { cache: "no-store" });
    if (!res.ok) return toast("Dönem okunamadı");
    await exportExcel(normalizePeriod(await res.json()));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-ink-3">Kayıtlı dönemler</div>
          <div className="text-2xl font-extrabold">Geçmiş kapanışlar</div>
        </div>
        <div className="flex gap-2">
          {data && (
            <button onClick={() => setInfoOpen(true)} className="clay-sm flex items-center gap-2 rounded-full px-4 py-3 text-sm font-bold">
              <Icon name="edit" size={17} /> Form bilgileri
            </button>
          )}
          <button onClick={() => setImportOpen(true)} className="clay-dark flex items-center gap-2 rounded-full px-4 py-3 text-sm font-bold">
            <Icon name="upload" size={17} /> Excel&apos;den içe aktar
          </button>
        </div>
      </div>

      {summaries.length === 0 ? (
        <EmptyState emoji="🗂️" title="Henüz kayıtlı dönem yok" text="Denetim ekranından bir dönem başlattığında burada listelenir. Elindeki Excel formunu da içe aktarabilirsin." />
      ) : (
        Object.entries(byYear)
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([year, list]) => (
            <section key={year}>
              <div className="mb-3 px-1 text-lg font-extrabold text-ink-3">{year}</div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {list.map((s, i) => {
                  const pct = (s.bursaOk + s.basaksehirOk) / (TOTAL_ITEMS * 2);
                  const isActive = s.period === activePeriod;
                  const isViewing = s.period === data?.period;
                  return (
                    <motion.div
                      key={s.period}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className={`clay p-5 ${isViewing ? "ring-2 ring-blue/40" : ""}`}
                    >
                      <div className="flex items-center gap-4">
                        <Ring value={pct} size={66} stroke={8} color={pct === 1 ? "var(--color-ok)" : "var(--color-blue)"}>
                          <span className="text-sm font-extrabold">%{Math.round(pct * 100)}</span>
                        </Ring>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-lg font-extrabold">{periodLabel(s.period)}</span>
                            {isActive && <span className="rounded-full bg-ok px-2 py-0.5 text-[10px] font-extrabold text-white">AKTİF</span>}
                          </div>
                          <div className="text-xs font-semibold text-ink-3">
                            {s.status} · güncellendi {new Date(s.updatedAt).toLocaleDateString("tr-TR")}
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs font-bold text-ink-2">
                            <span>BRS {s.bursaOk}/{TOTAL_ITEMS}</span>
                            <span>BŞK {s.basaksehirOk}/{TOTAL_ITEMS}</span>
                            {s.fails > 0 && <span className="text-fail">{s.fails} sorun</span>}
                            {s.openActions > 0 && <span className="text-warn">{s.openActions} açık aksiyon</span>}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <button
                          onClick={async () => {
                            await openPeriod(s.period);
                            router.push("/");
                          }}
                          className="clay-dark flex-1 rounded-full py-3 text-sm font-bold"
                        >
                          {isViewing ? "Açık" : "Aç"}
                        </button>
                        <button onClick={() => download(s.period)} className="clay-sm grid h-11 w-11 place-items-center rounded-full" aria-label="Excel indir" title="Excel indir">
                          <Icon name="download" size={19} />
                        </button>
                        {!isActive && (
                          <button
                            onClick={async () => {
                              await setActive(s.period);
                              toast(`${periodLabel(s.period)} aktif dönem yapıldı`);
                            }}
                            className="clay-sm grid h-11 w-11 place-items-center rounded-full text-ok"
                            aria-label="Aktif yap"
                            title="Aktif dönem yap (açılışta bu dönemden devam eder)"
                          >
                            <Icon name="play" size={17} />
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            if (confirm(`${periodLabel(s.period)} dönemi kalıcı olarak silinsin mi?`)) {
                              await deletePeriod(s.period);
                              toast("Dönem silindi");
                            }
                          }}
                          className="clay-sm grid h-11 w-11 place-items-center rounded-full text-fail"
                          aria-label="Sil"
                          title="Sil"
                        >
                          <Icon name="trash" size={18} />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </section>
          ))
      )}

      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} />
      {data && <FormInfoSheet open={infoOpen} onClose={() => setInfoOpen(false)} data={data} />}
    </div>
  );
}

/* ------------------------------------------------------------------ İçe aktarma */
function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { replaceData, summaries, setActive, toast, refreshSummaries } = usePeriod();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [period, setPeriod] = useState(defaultPeriod());
  const [preview, setPreview] = useState<PeriodData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const read = async (file: File) => {
    setErr(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("period", period);
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setPreview(normalizePeriod(body));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exists = summaries.some((s) => s.period === period);
  const counts = preview
    ? Object.values(preview.items).reduce(
        (a, s) => {
          for (const v of [s.bursa, s.basaksehir]) a[v ?? "pending"]++;
          return a;
        },
        { ok: 0, fail: 0, na: 0, pending: 0 } as Record<string, number>,
      )
    : null;

  const [y, m] = period.split("-").map(Number);

  return (
    <Sheet open={open} onClose={() => { setPreview(null); onClose(); }} title="Excel'den içe aktar">
      <p className="text-sm text-ink-2">
        Mevcut kontrol formunu (01_Aylık_Kontrol_Rapor + 02_Aksiyon_Takip) yükle; tikler, notlar ve aksiyonlar seçtiğin döneme aktarılır.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <select className="field font-bold" value={m} onChange={(e) => setPeriod(`${y}-${String(e.target.value).padStart(2, "0")}`)}>
          {MONTHS.map((n, i) => (
            <option key={n} value={i + 1}>{n}</option>
          ))}
        </select>
        <input
          className="field font-bold"
          type="number"
          value={y}
          min={2024}
          max={2100}
          onChange={(e) => {
            const p = `${e.target.value}-${String(m).padStart(2, "0")}`;
            if (PERIOD_RE.test(p)) setPeriod(p);
          }}
        />
      </div>
      {exists && <div className="mt-3 rounded-2xl bg-[#FFF4E2] px-3 py-2 text-sm">⚠️ {periodLabel(period)} zaten kayıtlı; içe aktarım üzerine yazar.</div>}

      <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
      <button onClick={() => fileRef.current?.click()} disabled={busy} className="clay-pressed mt-4 flex w-full flex-col items-center gap-2 rounded-[24px] py-8 font-bold text-ink-2">
        <Icon name="upload" size={30} />
        {busy ? "Okunuyor…" : "Excel dosyası seç (.xlsx)"}
      </button>
      {err && <div className="mt-3 rounded-2xl bg-[#FFE9EC] px-3 py-2 text-sm text-fail">{err}</div>}

      {preview && counts && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="clay mt-4 p-4">
          <div className="font-extrabold">{periodLabel(preview.period)} önizleme</div>
          <div className="mt-2 grid grid-cols-4 gap-2 text-center text-sm">
            <div><div className="text-xl font-extrabold text-ok">{counts.ok}</div>☑</div>
            <div><div className="text-xl font-extrabold text-fail">{counts.fail}</div>x</div>
            <div><div className="text-xl font-extrabold text-na">{counts.na}</div>N/A</div>
            <div><div className="text-xl font-extrabold text-ink-3">{counts.pending}</div>☐</div>
          </div>
          <div className="mt-2 text-sm text-ink-2">
            {Object.values(preview.items).filter((s) => s.note).length} not · {preview.actions.length} aksiyon
          </div>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await replaceData(preview);
                if (!summaries.length) await setActive(preview.period);
                await refreshSummaries();
                toast("İçe aktarıldı");
                setPreview(null);
                onClose();
                router.push("/");
              } finally {
                setBusy(false);
              }
            }}
            className="clay-dark mt-4 w-full rounded-full py-3.5 font-extrabold"
          >
            Kaydet ve aç
          </button>
        </motion.div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Form başlık bilgileri */
function FormInfoSheet({ open, onClose, data }: { open: boolean; onClose: () => void; data: PeriodData }) {
  const { update } = usePeriod();
  const set = (fn: (d: PeriodData) => PeriodData) => update(fn);
  const so = (k: keyof PeriodData["signoffs"], f: keyof Signoff, v: string) =>
    set((d) => ({ ...d, signoffs: { ...d.signoffs, [k]: { ...d.signoffs[k], [f]: v } } }));

  const rows: { k: keyof PeriodData["signoffs"]; l: string; ph: string }[] = [
    { k: "preparer", l: "Hazırlayan", ph: "Ad Soyad" },
    { k: "control", l: "Bütçe & Raporlama Kontrolü", ph: "Ad Soyad" },
    { k: "preApproval", l: "Ön Onay (Proje Yöneticisi)", ph: "Ad Soyad" },
    { k: "finalApproval", l: "Son Onay (Genel Müdür)", ph: "Ad Soyad" },
    { k: "closing", l: "Kapanış", ph: "Onaylandı / Revizyon" },
  ];

  return (
    <Sheet open={open} onClose={onClose} title={`${periodLabel(data.period)} · form bilgileri`} wide>
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-3">Durum</div>
      <div className="grid grid-cols-3 gap-2">
        {(["Taslak", "Ön Onay", "Son Onay"] as PeriodStatus[]).map((s) => (
          <button key={s} onClick={() => set((d) => ({ ...d, status: s }))} className={`rounded-2xl py-3 text-sm font-bold ${data.status === s ? "clay-dark" : "clay-sm"}`}>
            {s}
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-3">Hazırlanma tarihi</div>
          <input type="date" className="field" value={data.preparedAt} onChange={(e) => set((d) => ({ ...d, preparedAt: e.target.value }))} />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-3">Versiyon</div>
          <input className="field" value={data.version} onChange={(e) => set((d) => ({ ...d, version: e.target.value }))} />
        </div>
      </div>
      <div className="mt-5 text-sm font-extrabold">Aylık kapanış onayı</div>
      <div className="mt-2 space-y-3">
        {rows.map((r) => (
          <div key={r.k} className="clay-sm p-3">
            <div className="mb-2 text-xs font-bold text-ink-3">{r.l}</div>
            <div className="grid grid-cols-[1fr_150px] gap-2">
              {r.k === "closing" ? (
                <div className="flex gap-2">
                  {["Onaylandı", "Revizyon"].map((v) => (
                    <button key={v} onClick={() => so(r.k, "name", data.signoffs.closing.name === v ? "" : v)} className={`flex-1 rounded-xl py-2.5 text-sm font-bold ${data.signoffs.closing.name === v ? "clay-dark" : "clay-pressed"}`}>
                      {v}
                    </button>
                  ))}
                </div>
              ) : (
                <input className="field" placeholder={r.ph} value={data.signoffs[r.k].name} onChange={(e) => so(r.k, "name", e.target.value)} />
              )}
              <input type="date" className="field" value={data.signoffs[r.k].date} onChange={(e) => so(r.k, "date", e.target.value)} />
            </div>
          </div>
        ))}
      </div>
      <button onClick={onClose} className="clay-dark mt-5 w-full rounded-full py-3.5 font-extrabold">Tamam</button>
    </Sheet>
  );
}
