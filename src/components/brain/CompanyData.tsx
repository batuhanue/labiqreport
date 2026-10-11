"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KURUM_HOSPITALS, folderText, periodText, unitKey, type KurumCategory, type KurumFile, type KurumUnit } from "@/lib/kurum-types";
import { usePeriod } from "../PeriodProvider";
import { Icon, Menu, Sheet, Tabs } from "../ui";

/*
 * Şirket verisi — dosya yöneticisi: hastane → dönem → kategori klasörleri. Kategoriler ad + açıklama ile tanımlanır
 * (beyin dosyanın ne olduğunu buradan anlar). Eğitim seçmeli: "dönemi öğren" ya da "kategoriyi öğren";
 * öğrenilen klasör ✓, değişen "güncellenmeli", kalanı "öğrenilmedi".
 */

interface View {
  files: KurumFile[];
  categories: KurumCategory[];
  units: KurumUnit[];
  running: boolean;
}

const TEXT_EXT = ["md", "txt", "csv", "tsv", "json", "xml", "html", "htm", "log"];
const BIN_EXT = ["docx", "xlsx", "pptx", "pdf"];
const MAX_BYTES = 4 * 1024 * 1024;
const SEG = 1_500_000;
const SUGGEST = ["Arıza", "Sayım", "Tüketim", "Hakediş", "Fatura", "Prosedür"];

const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const dayText = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short" }) : "");
const thisMonth = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 7);

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}
const post = <T,>(body: unknown) => api<T>("/api/kurum", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

type Status = "trained" | "stale" | "none" | "empty";
const statusOf = (u?: KurumUnit): Status => (!u ? "empty" : !u.trainedAt ? "none" : u.stale ? "stale" : "trained");
function StatusPill({ s, at }: { s: Status; at?: string }) {
  if (s === "empty") return <span className="text-[11px] font-semibold text-ink-3">boş</span>;
  const m = { trained: ["bg-ok/15 text-ok", `✓ öğrenildi ${dayText(at)}`], stale: ["bg-[#ff9f43]/15 text-[#d9770f]", "⟳ güncellenmeli"], none: ["bg-track text-ink-3", "○ öğrenilmedi"] }[s];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${m[0]}`}>{m[1]}</span>;
}

export default function CompanyData({ onChange }: { onChange?: () => void }) {
  const { toast, activePeriod } = usePeriod();
  const [v, setV] = useState<View | null>(null);
  const [hospital, setHospital] = useState<string>("bursa");
  const [period, setPeriod] = useState<string>("");
  const [category, setCategory] = useState<string | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [training, setTraining] = useState<string | null>(null);
  const [cats, setCats] = useState(false);
  const [move, setMove] = useState<KurumFile | null>(null);

  const load = useCallback(async () => {
    try {
      setV(await api<View>("/api/kurum"));
    } catch (e) {
      toast((e as Error).message);
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!period) setPeriod(activePeriod ?? thisMonth());
  }, [activePeriod, period]);

  const files = useMemo(() => v?.files ?? [], [v]);
  const unit = useCallback((h: string, p: string, c: string) => v?.units.find((u) => u.key === unitKey(h, p, c)), [v]);
  const catName = (id: string) => v?.categories.find((c) => c.id === id)?.name ?? "";

  // dönemler: dosyası olanlar + aktif dönem + eklenenler; dönemsiz en sonda
  const periods = useMemo(() => {
    const s = new Set<string>([activePeriod ?? thisMonth(), ...extra, ...files.filter((f) => f.hospital === hospital).map((f) => f.period)]);
    const list = [...s].filter(Boolean).sort((a, b) => b.localeCompare(a));
    return [...list, ""];
  }, [files, hospital, activePeriod, extra]);

  const periodUnits = (p: string) => (v?.units ?? []).filter((u) => u.hospital === hospital && u.period === p);
  const folderFiles = category == null ? [] : files.filter((f) => f.hospital === hospital && f.period === period && f.category === category);

  // ------------------------------------------------------------------ yükleme
  const upload = async (list: FileList | File[], target: { hospital: string; period: string; category: string }) => {
    for (const f of Array.from(list)) {
      const ext = f.name.toLowerCase().split(".").pop() ?? "";
      setBusy(f.name);
      try {
        if (TEXT_EXT.includes(ext)) {
          const text = await f.text();
          let id: string | undefined;
          for (let i = 0; i < text.length; ) {
            let j = Math.min(text.length, i + SEG);
            if (j < text.length) {
              const nl = text.lastIndexOf("\n", j);
              if (nl > i) j = nl + 1;
            }
            const r = await post<{ file: KurumFile }>({ action: "text", name: f.name, text: text.slice(i, j), id, size: f.size, ...target });
            id = r.file.id;
            i = j;
          }
        } else if (BIN_EXT.includes(ext)) {
          if (f.size > MAX_BYTES) throw new Error(`${f.name} 4 MB'tan büyük — Google Drive'a koy (arşiv okur) ya da Excel'i CSV olarak kaydet`);
          const q = new URLSearchParams({ name: f.name, ...target });
          const r = await api<{ file: KurumFile }>(`/api/kurum?${q}`, { method: "PUT", body: f });
          if (r.file.partial) toast(`${f.name}: PDF uzun; okunabilen kısmı kaydedildi`);
        } else throw new Error(`${f.name}: .${ext} desteklenmiyor (${[...TEXT_EXT, ...BIN_EXT].join(", ")})`);
      } catch (e) {
        toast((e as Error).message);
      }
    }
    setBusy(null);
    await load();
    onChange?.();
  };

  // ------------------------------------------------------------------ eğitim (seçmeli)
  const train = async (p: string, c?: string, force = false) => {
    const label = folderText(hospital, p, c != null ? catName(c) : "tüm kategoriler");
    setTraining(c != null ? unitKey(hospital, p, c) : `${hospital}|${p}|*`);
    try {
      let learned = 0;
      for (let i = 0, first = true; i < 12; i++) {
        const r = await post<{ did?: string[]; remaining?: number; error?: string; busy?: boolean }>({ action: "train", hospital, period: p, category: c, force: first && force });
        first = false;
        if (r.busy) {
          await new Promise((res) => setTimeout(res, 5000));
          continue;
        }
        learned += r.did?.length ?? 0;
        await load();
        if (r.error) throw new Error(r.error);
        if (!r.remaining) break;
      }
      toast(learned ? `Öğrenildi: ${label}` : `${label} zaten öğrenilmiş`);
      onChange?.();
    } catch (e) {
      toast(`Öğrenme durdu: ${(e as Error).message}`);
    } finally {
      setTraining(null);
      load();
    }
  };

  const remove = async (f: KurumFile) => {
    if (!confirm(`“${f.name}” silinsin mi?`)) return;
    await api(`/api/kurum?id=${f.id}`, { method: "DELETE" }).catch((e) => toast((e as Error).message));
    await load();
    onChange?.();
  };

  if (!v) return <div className="clay h-[360px] animate-pulse rounded-[30px]" />;
  const trained = v.units.filter((u) => u.trainedAt && !u.stale).length;
  const anyTraining = !!training || v.running;

  return (
    <section className="clay p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-lg font-extrabold">Şirket verisi</span>
        <span className="text-xs text-ink-3">
          {files.length} dosya · {trained}/{v.units.length} klasör öğrenildi
        </span>
        <button onClick={() => setCats(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-track px-3 py-1.5 text-xs font-bold text-ink-2 hover:text-ink">
          <Icon name="edit" size={13} /> Kategoriler ({v.categories.length})
        </button>
      </div>
      <p className="mt-0.5 text-xs text-ink-3">Dosyaları hastane · dönem · kategori klasörüne koy; beyin ne olduklarını kategori tanımından anlar. Öğrenmeyi sen seçersin: dönemi ya da tek kategoriyi.</p>

      <Tabs
        className="mt-3"
        value={hospital}
        onChange={(h) => {
          setHospital(h);
          setCategory(null);
        }}
        options={KURUM_HOSPITALS.map((h) => ({ value: h.id, label: h.label, n: files.filter((f) => f.hospital === h.id).length || undefined }))}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        {/* dönemler */}
        <div>
          <div className="mb-1.5 flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-wide text-ink-3">
            Dönemler
            <label className="cursor-pointer rounded-full px-2 py-0.5 normal-case tracking-normal text-blue hover:bg-track">
              + Dönem
              <input
                type="month"
                className="sr-only"
                onChange={(e) => {
                  const p = e.target.value;
                  if (!p) return;
                  setExtra((x) => [...new Set([...x, p])]);
                  setPeriod(p);
                  setCategory(null);
                }}
              />
            </label>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {periods.map((p) => {
              const us = periodUnits(p);
              const done = us.filter((u) => u.trainedAt && !u.stale).length;
              const sel = p === period;
              return (
                <button
                  key={p || "none"}
                  onClick={() => {
                    setPeriod(p);
                    setCategory(null);
                  }}
                  className={`flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2 text-left transition-colors lg:w-full ${sel ? "bg-blue text-white" : "hover:bg-track"}`}
                >
                  <Icon name="folder" size={15} className={sel ? "" : "text-ink-3"} />
                  <span className="flex-1 whitespace-nowrap text-sm font-bold">{periodText(p)}</span>
                  {us.length > 0 && (
                    <span className={`text-[11px] font-bold tabular-nums ${sel ? "text-white/85" : done === us.length ? "text-ok" : "text-ink-3"}`}>
                      {done === us.length ? "✓ " : ""}
                      {done}/{us.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* kategoriler (klasörler) ya da açık klasör */}
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-sm font-bold">
              <button onClick={() => setCategory(null)} className={category == null ? "text-ink" : "text-ink-3 hover:text-ink"}>
                {folderText(hospital, period, "").split(" · ").slice(0, 2).join(" › ")}
              </button>
              {category != null && (
                <>
                  <Icon name="chevron" size={12} className="text-ink-3" />
                  <span className="truncate">{catName(category) || "Kategorisiz"}</span>
                </>
              )}
            </div>
            <div className="ml-auto">
              {category == null ? (
                periodUnits(period).length > 0 && (
                  <TrainButton
                    busy={training === `${hospital}|${period}|*`}
                    disabled={anyTraining}
                    label={periodUnits(period).every((u) => u.trainedAt && !u.stale) ? "Dönem öğrenildi ✓" : periodUnits(period).some((u) => !u.trainedAt) ? "Bu dönemi öğren" : "Dönemi güncelle"}
                    done={periodUnits(period).every((u) => u.trainedAt && !u.stale)}
                    onClick={() => train(period)}
                  />
                )
              ) : (
                folderFiles.length > 0 && (
                  <TrainButton
                    busy={training === unitKey(hospital, period, category)}
                    disabled={anyTraining}
                    done={statusOf(unit(hospital, period, category)) === "trained"}
                    label={{ trained: "Öğrenildi ✓", stale: "Güncelle", none: "Bu kategoriyi öğren", empty: "Bu kategoriyi öğren" }[statusOf(unit(hospital, period, category))]}
                    onClick={() => train(period, category)}
                  />
                )
              )}
            </div>
          </div>

          <AnimatePresence mode="popLayout" initial={false}>
            {category == null ? (
              <motion.div key="cats" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
                {[...v.categories, ...(files.some((f) => f.hospital === hospital && f.period === period && !f.category) ? [{ id: "", name: "Kategorisiz", description: "Klasörü belirtilmemiş dosyalar", createdAt: "" }] : [])].map((c) => (
                  <CategoryCard
                    key={c.id || "none"}
                    c={c}
                    count={files.filter((f) => f.hospital === hospital && f.period === period && f.category === c.id).length}
                    u={unit(hospital, period, c.id)}
                    training={training === unitKey(hospital, period, c.id) || training === `${hospital}|${period}|*`}
                    onOpen={() => setCategory(c.id)}
                    onDrop={(fl) => upload(fl, { hospital, period, category: c.id })}
                  />
                ))}
                <button onClick={() => setCats(true)} className="grid min-h-[104px] place-items-center rounded-2xl border-2 border-dashed border-line text-sm font-bold text-ink-3 hover:border-ink-3 hover:text-ink">
                  + Kategori tanımla
                </button>
              </motion.div>
            ) : (
              <motion.div key={`f-${category}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <Folder
                  files={folderFiles}
                  u={unit(hospital, period, category)}
                  busy={busy}
                  onUpload={(fl) => upload(fl, { hospital, period, category })}
                  onMove={setMove}
                  onRemove={remove}
                  onForget={async () => {
                    await post({ action: "forget", key: unitKey(hospital, period, category) }).catch((e) => toast((e as Error).message));
                    load();
                    onChange?.();
                  }}
                  onRelearn={() => train(period, category, true)}
                  disabled={anyTraining}
                />
              </motion.div>
            )}
          </AnimatePresence>
          {busy && category == null && <div className="mt-2 text-xs font-semibold text-ink-2">Okunuyor: {busy}…</div>}
        </div>
      </div>

      <Categories open={cats} onClose={() => setCats(false)} categories={v.categories} onSaved={() => (load(), onChange?.())} />
      <MoveSheet file={move} categories={v.categories} periods={periods} onClose={() => setMove(null)} onMoved={() => (setMove(null), load(), onChange?.())} />
    </section>
  );
}

function TrainButton({ label, busy, disabled, done, onClick }: { label: string; busy: boolean; disabled: boolean; done: boolean; onClick: () => void }) {
  return (
    <button disabled={disabled} onClick={onClick} className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-extrabold disabled:opacity-60 ${done ? "bg-ok/15 text-ok" : "clay-dark"}`}>
      {busy ? (
        <>
          <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent" />
          Öğreniyor…
        </>
      ) : (
        <>
          {!done && <Icon name="brain" size={14} />}
          {label}
        </>
      )}
    </button>
  );
}

function CategoryCard({ c, count, u, training, onOpen, onDrop }: { c: KurumCategory; count: number; u?: KurumUnit; training: boolean; onOpen: () => void; onDrop: (f: FileList) => void }) {
  const [drag, setDrag] = useState(false);
  const s = count ? statusOf(u) : "empty";
  return (
    <button
      onClick={onOpen}
      onDragOver={(e) => (e.preventDefault(), setDrag(true))}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files.length) onDrop(e.dataTransfer.files);
      }}
      className={`clay-sm flex min-h-[104px] flex-col rounded-2xl p-3.5 text-left transition-shadow ${drag ? "ring-2 ring-blue" : ""} ${s === "trained" ? "ring-1 ring-ok/40" : ""}`}
    >
      <div className="flex w-full items-start gap-2">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${s === "trained" ? "bg-ok/15 text-ok" : "bg-track text-ink-2"}`}>
          {s === "trained" ? <Icon name="check" size={16} /> : <Icon name="folder" size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-extrabold">{c.name}</div>
          <div className="text-[11px] text-ink-3">{count ? `${count} dosya` : "dosya bırak"}</div>
        </div>
        {training ? <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="mt-1 inline-block h-3.5 w-3.5 rounded-full border-2 border-blue border-t-transparent" /> : <StatusPill s={s} at={u?.trainedAt} />}
      </div>
      {c.description ? <div className="mt-2 line-clamp-2 text-xs text-ink-2">{c.description}</div> : <div className="mt-2 text-xs italic text-ink-3">Tanım yok — beyin yalnızca adından anlar</div>}
      {u?.summary && s !== "empty" && <div className="mt-1.5 line-clamp-2 text-[11.5px] text-ink-3">↳ {u.summary}</div>}
    </button>
  );
}

function Folder({
  files,
  u,
  busy,
  disabled,
  onUpload,
  onMove,
  onRemove,
  onForget,
  onRelearn,
}: {
  files: KurumFile[];
  u?: KurumUnit;
  busy: string | null;
  disabled: boolean;
  onUpload: (f: FileList) => void;
  onMove: (f: KurumFile) => void;
  onRemove: (f: KurumFile) => void;
  onForget: () => void;
  onRelearn: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const s = files.length ? statusOf(u) : "empty";
  return (
    <div className="space-y-3">
      {s !== "empty" && (
        <div className={`rounded-2xl p-3.5 ${s === "trained" ? "bg-ok/10" : s === "stale" ? "bg-[#ff9f43]/10" : "bg-track/60"}`}>
          <div className="flex items-center gap-2">
            <StatusPill s={s} at={u?.trainedAt} />
            <span className="text-xs text-ink-3">{s === "none" ? "Beyin bu klasörü henüz okumadı." : s === "stale" ? "Öğrenildikten sonra dosyalar değişti." : "Beyin bu klasörü okudu; düşünürken kullanıyor."}</span>
            {u?.trainedAt && (
              <Menu
                className="ml-auto -my-1"
                items={[
                  { label: "Yeniden öğren", icon: "refresh", onClick: onRelearn, hidden: disabled },
                  { label: "Öğrenileni unut", icon: "trash", onClick: onForget, danger: true },
                ]}
              />
            )}
          </div>
          {u?.summary && <p className="mt-2 text-[13px] leading-snug text-ink-2">{u.summary}</p>}
        </div>
      )}
      <div
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length) onUpload(e.dataTransfer.files);
        }}
        onClick={() => !busy && input.current?.click()}
        className={`grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed px-4 py-5 text-center transition-colors ${drag ? "border-blue bg-blue/5" : "border-line hover:border-ink-3"}`}
      >
        <Icon name="upload" size={20} className="text-ink-3" />
        <div className="mt-1 text-sm font-bold">{busy ? `Okunuyor: ${busy}` : "Bu klasöre dosya bırak ya da seç"}</div>
        <div className="text-[11px] text-ink-3">Word, Excel, PowerPoint, PDF (4 MB'a kadar) · CSV, TXT, MD, JSON (sınırsız)</div>
        <input ref={input} type="file" multiple hidden accept={[...TEXT_EXT, ...BIN_EXT].map((x) => `.${x}`).join(",")} onChange={(e) => e.target.files && onUpload(e.target.files)} />
      </div>
      {files.length > 0 && (
        <ul className="divide-y divide-line">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-track text-[10px] font-extrabold uppercase text-ink-2">{f.kind.slice(0, 4)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{f.name}</div>
                <div className="text-[11px] text-ink-3">
                  {kb(f.size)} · {f.parts} parça · {dayText(f.uploadedAt)}
                  {f.partial ? " · yarım okundu" : ""}
                </div>
              </div>
              <Menu
                items={[
                  { label: "Başka klasöre taşı", icon: "folder", onClick: () => onMove(f) },
                  { label: "Sil", icon: "trash", danger: true, onClick: () => onRemove(f) },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ kategori tanımları */
function Categories({ open, onClose, categories, onSaved }: { open: boolean; onClose: () => void; categories: KurumCategory[]; onSaved: () => void }) {
  const { toast } = usePeriod();
  const [draft, setDraft] = useState<{ id?: string; name: string; description: string } | null>(null);
  const save = async () => {
    if (!draft?.name.trim()) return;
    try {
      await post({ action: "category", ...draft });
      setDraft(null);
      onSaved();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const del = async (c: KurumCategory) => {
    if (!confirm(`“${c.name}” kategorisi silinsin mi? Dosyaları kategorisiz kalır.`)) return;
    await post({ action: "category-delete", id: c.id }).catch((e) => toast((e as Error).message));
    onSaved();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Kategoriler">
      <p className="-mt-2 text-sm text-ink-2">Her kategoriye kısa bir tanım yaz: içinde ne tür dosyalar var, hangi sistemden gelir, ne için kullanılır. Beyin dosyaları bu tanıma göre yorumlar.</p>
      <div className="mt-4 space-y-2">
        {categories.map((c) =>
          draft?.id === c.id ? (
            <Editor key={c.id} draft={draft} setDraft={setDraft} onSave={save} />
          ) : (
            <div key={c.id} className="clay-sm flex items-start gap-3 rounded-2xl p-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-extrabold">{c.name}</div>
                <div className={`mt-0.5 text-xs ${c.description ? "text-ink-2" : "italic text-ink-3"}`}>{c.description || "Tanım yok"}</div>
              </div>
              <Menu
                items={[
                  { label: "Düzenle", icon: "edit", onClick: () => setDraft({ id: c.id, name: c.name, description: c.description }) },
                  { label: "Sil", icon: "trash", danger: true, onClick: () => del(c) },
                ]}
              />
            </div>
          ),
        )}
        {draft && !draft.id ? (
          <Editor draft={draft} setDraft={setDraft} onSave={save} />
        ) : (
          <button onClick={() => setDraft({ name: "", description: "" })} className="w-full rounded-2xl border-2 border-dashed border-line py-3 text-sm font-bold text-ink-3 hover:border-ink-3 hover:text-ink">
            + Yeni kategori
          </button>
        )}
        {!categories.length && !draft && (
          <div className="pt-2">
            <div className="text-xs font-bold text-ink-3">Hızlı başla:</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {SUGGEST.map((s) => (
                <button key={s} onClick={() => setDraft({ name: s, description: "" })} className="rounded-full bg-track px-3 py-1.5 text-xs font-bold text-ink-2 hover:text-ink">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function Editor({ draft, setDraft, onSave }: { draft: { id?: string; name: string; description: string }; setDraft: (d: { id?: string; name: string; description: string } | null) => void; onSave: () => void }) {
  return (
    <div className="clay-sm space-y-2 rounded-2xl p-3.5">
      <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Kategori adı (ör. Arıza)" className="clay-pressed w-full rounded-full px-4 py-2 text-sm font-bold outline-none" />
      <textarea
        value={draft.description}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        rows={3}
        placeholder="Tanım: ör. Cihaz arıza kayıtları ve servis formları; LabIQ arıza modülünden aylık döküm. Arıza sayısı, süre ve tekrar eden cihazlar için kullanılır."
        className="clay-pressed w-full resize-none rounded-2xl px-4 py-2.5 text-sm outline-none"
      />
      <div className="flex justify-end gap-2">
        <button onClick={() => setDraft(null)} className="px-3 py-2 text-xs font-bold text-ink-3 hover:text-ink">
          Vazgeç
        </button>
        <button disabled={!draft.name.trim()} onClick={onSave} className="rounded-full bg-blue px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
          Kaydet
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ taşı */
function MoveSheet({ file, categories, periods, onClose, onMoved }: { file: KurumFile | null; categories: KurumCategory[]; periods: string[]; onClose: () => void; onMoved: () => void }) {
  const { toast } = usePeriod();
  const [h, setH] = useState("");
  const [p, setP] = useState("");
  const [c, setC] = useState("");
  useEffect(() => {
    if (file) {
      setH(file.hospital);
      setP(file.period);
      setC(file.category);
    }
  }, [file]);
  const go = async () => {
    if (!file) return;
    try {
      await post({ action: "move", id: file.id, hospital: h, period: p, category: c });
      toast(`Taşındı: ${folderText(h, p, categories.find((x) => x.id === c)?.name ?? "")}`);
      onMoved();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const sel = "clay-pressed w-full rounded-full bg-transparent px-4 py-2.5 text-sm font-bold outline-none";
  return (
    <Sheet open={!!file} onClose={onClose} title="Başka klasöre taşı">
      {file && (
        <div className="space-y-3">
          <div className="truncate text-sm font-bold text-ink-2">{file.name}</div>
          <label className="block text-xs font-bold text-ink-3">
            Hastane
            <select value={h} onChange={(e) => setH(e.target.value)} className={`mt-1 ${sel}`}>
              {KURUM_HOSPITALS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-bold text-ink-3">
            Dönem
            <div className="mt-1 flex gap-2">
              <input type="month" value={p} onChange={(e) => setP(e.target.value)} className={sel} />
              <button onClick={() => setP("")} className={`shrink-0 rounded-full px-3 text-xs font-bold ${p ? "bg-track text-ink-2" : "bg-blue text-white"}`}>
                Dönemsiz
              </button>
            </div>
            {periods.length > 1 && <span className="mt-1 block font-semibold">Var olanlar: {periods.filter(Boolean).slice(0, 4).map(periodText).join(", ")}</span>}
          </label>
          <label className="block text-xs font-bold text-ink-3">
            Kategori
            <select value={c} onChange={(e) => setC(e.target.value)} className={`mt-1 ${sel}`}>
              <option value="">Kategorisiz</option>
              {categories.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <button onClick={go} className="clay-dark w-full rounded-full py-3 text-sm font-extrabold">
            Taşı
          </button>
        </div>
      )}
    </Sheet>
  );
}
