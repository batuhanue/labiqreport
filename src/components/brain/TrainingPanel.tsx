"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { renderMd } from "@/lib/markdown";
import type { Person, PeopleStore } from "@/lib/people-types";
import type { ImportanceStats, TrainingView } from "@/lib/training-types";
import { usePeriod } from "../PeriodProvider";
import { Icon, Menu, Ring } from "../ui";

/*
 * Beyin → Eğitim: beynin seni ne kadar tanıdığı (önem isabeti), geçmişten öğrenme (kişi haritası, ay ay okuma,
 * iş bilgisi), sana soruları, kişilerin önemi ve şirket verisi yükleme.
 */

type View = TrainingView & { importance: ImportanceStats };
interface KurumFile {
  id: string;
  name: string;
  kind: string;
  size: number;
  chars: number;
  parts: number;
  uploadedAt: string;
  partial?: boolean;
}

const TEXT_EXT = ["md", "txt", "csv", "tsv", "json", "xml", "html", "htm", "log"];
const BIN_EXT = ["docx", "xlsx", "pptx", "pdf"];
const MAX_BYTES = 4 * 1024 * 1024;
const SEG = 1_500_000;

const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("tr-TR", { month: "short" });
const dayText = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short" }) : "");
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}
const post = <T,>(body: unknown) => api<T>("/api/training", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function TrainingPanel() {
  const { toast } = usePeriod();
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [training, setTraining] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const x = await api<View>("/api/training");
      setV(x);
      setErr(null);
      return x;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // arka planda eğitim sürüyorsa izle
  useEffect(() => {
    if (!v?.running || training) return;
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [v?.running, training, load]);

  const train = async (force = false) => {
    setTraining(true);
    setProgress([]);
    try {
      for (let i = 0, first = true; i < 14; i++) {
        const r = await post<{ did?: string[]; error?: string; busy?: boolean }>({ action: "step", force: first && force });
        first = false;
        if (r.busy) {
          setProgress((p) => [...p.filter((x) => x !== "…"), "Arka planda bir adım sürüyor, bekliyorum…"]);
          await sleep(6000);
        } else {
          if (r.did?.length) setProgress((p) => [...p, ...r.did!]);
          if (r.error) throw new Error(r.error);
        }
        const x = await load();
        if (x && !x.due && !x.running) break;
      }
      toast("Eğitim güncel — beyin öğrendiklerini her düşünmede kullanacak");
    } catch (e) {
      toast(`Eğitim durdu: ${(e as Error).message}`);
    } finally {
      setTraining(false);
      load();
    }
  };

  if (err && !v) return <div className="clay p-6 text-sm text-fail">Eğitim durumu okunamadı: {err}</div>;
  if (!v) return <div className="clay h-[420px] animate-pulse rounded-[30px]" />;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Hero v={v} training={training} progress={progress} onTrain={train} />
        <Questions v={v} onChange={load} />
        <Profile at={v.profileAt} />
      </div>
      <div className="space-y-4">
        <People onChange={load} />
        <Company onChange={load} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ ne kadar tanıyor */
function Hero({ v, training, progress, onTrain }: { v: View; training: boolean; progress: string[]; onTrain: (force?: boolean) => void }) {
  const s = v.importance;
  const read = v.months.filter((m) => m.at).length;
  const busy = training || v.running;
  const p = s.precision;
  const color = p == null ? "var(--color-ink-3)" : p >= 80 ? "var(--color-ok)" : p >= 60 ? "#ff9f43" : "var(--color-fail)";
  const decided = s.accepted + s.noise + s.notMine + s.missed;
  return (
    <section className="clay p-5">
      <div className="flex items-start gap-4">
        <Ring value={(p ?? 0) / 100} size={92} stroke={9} color={color}>
          <div className="text-center leading-none">
            <div className="text-[22px] font-extrabold tabular-nums">{p == null ? "—" : `%${p}`}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-ink-3">isabet</div>
          </div>
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-extrabold">Beyin seni ne kadar tanıyor?</div>
          <p className="mt-0.5 text-sm text-ink-2">
            {p == null
              ? "Henüz ölçecek kadar seçim yok. Önerilere Onayla / Gerek yok dedikçe ve kaçırdığını gösterdikçe isabeti ölçülür."
              : `Son ${s.days} günde ${decided} kararında önerilerinin %${p}'i doğru çıktı.`}
            {p != null && s.prevPrecision != null && (
              <span className={`ml-1 font-bold ${p >= s.prevPrecision ? "text-ok" : "text-fail"}`}>
                {p >= s.prevPrecision ? "↑" : "↓"} önceki 30 gün %{s.prevPrecision}
              </span>
            )}
          </p>
          {decided > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
              <Pill tone="ok">✓ {s.accepted} doğru</Pill>
              {s.noise > 0 && <Pill tone="warn">{s.noise} gürültü</Pill>}
              {s.notMine > 0 && <Pill tone="warn">{s.notMine} senin işin değil</Pill>}
              {s.missed > 0 && <Pill tone="fail">{s.missed} kaçırdı</Pill>}
              {s.reprioritized > 0 && <Pill>{s.reprioritized} öncelik düzeltildi</Pill>}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <Stat label="kişi tanıyor" value={v.people} sub={v.peopleAt ? dayText(v.peopleAt) : "henüz yok"} />
        <Stat label="ay okundu" value={`${read}/${v.months.length}`} sub={v.profileAt ? (v.resynth ? "iş bilgisi güncellenecek" : `iş bilgisi ${dayText(v.profileAt)}`) : "iş bilgisi yok"} />
        <Stat label="şirket parçası" value={v.archive.kurum} sub={`${v.archive.total.toLocaleString("tr-TR")} arşiv kaydı`} />
      </div>

      {/* aylar */}
      <div className="mt-4 flex items-center gap-1.5">
        {[...v.months].reverse().map((m) => (
          <div key={m.month} title={m.at ? `${m.month}: ${m.stats?.engaged ?? 0} yazıştığın yazışma, ${m.stats?.chats ?? 0} sohbet, ${m.stats?.meetings ?? 0} toplantı okundu` : `${m.month}: okunmadı`} className="flex-1">
            <div className={`h-1.5 rounded-full ${m.at ? (m.empty ? "bg-ink-3/30" : "bg-ok") : "bg-track"}`} />
            <div className="mt-1 text-center text-[10px] font-bold capitalize text-ink-3">{monthName(m.month)}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          disabled={busy || !v.hasArchive}
          onClick={() => onTrain()}
          className={`flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-extrabold disabled:opacity-60 ${v.due || busy ? "clay-dark" : "clay-sm text-ink-2"}`}
        >
          {busy ? (
            <>
              <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent" />
              Öğreniyor…
            </>
          ) : !v.hasArchive ? (
            "Önce Google arşivi dolsun"
          ) : v.due ? (
            read ? "Eğitime devam et" : "Geçmişimden öğren"
          ) : (
            <>
              <Icon name="check" size={16} /> Güncel · yeniden oku
            </>
          )}
        </button>
        <Menu items={[{ label: "Baştan eğit (tüm aylar)", icon: "refresh", onClick: () => onTrain(true), hidden: busy || !v.hasArchive }]} />
      </div>
      <AnimatePresence>
        {(busy || progress.length > 0) && (
          <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-3 space-y-1 overflow-hidden text-xs text-ink-2">
            {progress.map((x, i) => (
              <li key={i}>✓ {x}</li>
            ))}
            {busy && <li className="text-ink-3">Arşivi ay ay okuyorum; her adım en çok bir dakika…</li>}
          </motion.ul>
        )}
      </AnimatePresence>
      {v.lastError && !busy && <div className="mt-2 text-xs font-semibold text-fail">Son eğitim hatası: {v.lastError}</div>}
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
        Beyin son 6 ayda yanıt verdiğin yazışmaları, yazdığın sohbetleri, toplantıları ve takvimi okuyup süreçleri, kimin ne beklediğini, neyin acil neyin gürültü olduğunu öğrenir; bunu
        her düşünmede okur. Uygulama açıkken haftalık kendini günceller.
      </p>
    </section>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: "ok" | "warn" | "fail" }) {
  const c = tone === "ok" ? "bg-ok/15 text-ok" : tone === "warn" ? "bg-[#ff9f43]/15 text-[#d9770f]" : tone === "fail" ? "bg-fail/15 text-fail" : "bg-track text-ink-2";
  return <span className={`rounded-full px-2 py-0.5 ${c}`}>{children}</span>;
}
function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="clay-pressed rounded-2xl px-3 py-2.5">
      <div className="text-lg font-extrabold leading-none tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] font-bold text-ink-2">{label}</div>
      <div className="truncate text-[10.5px] text-ink-3">{sub}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ sorular */
function Questions({ v, onChange }: { v: View; onChange: () => void }) {
  const open = v.questions.filter((q) => !q.answer);
  const done = v.questions.filter((q) => q.answer);
  const [showDone, setShowDone] = useState(false);
  if (!v.questions.length) return null;
  return (
    <section className="clay p-5">
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-extrabold">Sana soruları var</span>
        <span className="text-xs text-ink-3">{open.length ? `${open.length} açık` : "hepsi cevaplandı"}</span>
      </div>
      <p className="mt-0.5 text-xs text-ink-3">Veriden emin olamadığı noktalar. Cevabın belleğe yazılır ve hemen etkili olur.</p>
      <div className="mt-3 space-y-2.5">
        {open.map((q) => (
          <Question key={q.id} id={q.id} q={q.q} why={q.why} onDone={onChange} />
        ))}
      </div>
      {done.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowDone((x) => !x)} className="text-xs font-bold text-ink-3 hover:text-ink">
            {showDone ? "Cevapladıklarını gizle" : `Cevapladıkların (${done.length})`}
          </button>
          {showDone && (
            <ul className="mt-2 space-y-1.5 text-[13px]">
              {done.map((q) => (
                <li key={q.id}>
                  <span className="text-ink-3">{q.q}</span> <span className="font-semibold">→ {q.answer}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Question({ id, q, why, onDone }: { id: string; q: string; why: string; onDone: () => void }) {
  const { toast } = usePeriod();
  const [a, setA] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (answer: string | null) => {
    setBusy(true);
    try {
      await post({ action: "answer", id, answer });
      if (answer) toast("Belleğe yazdım");
      onDone();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="clay-sm rounded-2xl p-3.5">
      <div className="text-sm font-bold">{q}</div>
      {why && <div className="mt-0.5 text-xs text-ink-3">{why}</div>}
      <div className="mt-2 flex items-center gap-2">
        <input
          value={a}
          onChange={(e) => setA(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && a.trim() && send(a.trim())}
          placeholder="Cevabın…"
          className="clay-pressed min-w-0 flex-1 rounded-full px-4 py-2 text-sm outline-none"
        />
        <button disabled={busy || !a.trim()} onClick={() => send(a.trim())} className="rounded-full bg-blue px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          Kaydet
        </button>
        <button disabled={busy} onClick={() => send(null)} className="px-1 text-xs font-bold text-ink-3 hover:text-ink">
          Atla
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ öğrenilen iş bilgisi */
function Profile({ at }: { at?: string }) {
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    if (!open || html != null) return;
    api<{ files: { name: string; md: string }[] }>("/api/assistant/knowledge")
      .then((j) => setHtml(renderMd(j.files.find((f) => f.name === "is-bilgisi.md")?.md ?? "")))
      .catch(() => setHtml(""));
  }, [open, html]);
  useEffect(() => setHtml(null), [at]);
  if (!at) return null;
  return (
    <section className="clay p-5">
      <button onClick={() => setOpen((x) => !x)} className="flex w-full items-center gap-2 text-left">
        <span className="text-lg font-extrabold">Öğrendiği iş bilgisi</span>
        <span className="text-xs text-ink-3">is-bilgisi.md · {dayText(at)}</span>
        <Icon name="chevron" size={13} className={`ml-auto text-ink-3 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="md mt-3 max-h-[520px] overflow-y-auto pr-1 text-sm" dangerouslySetInnerHTML={{ __html: html ?? "<p>Yükleniyor…</p>" }} />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ kişiler */
const TIERS = [
  { t: 1, l: "Kritik", c: "bg-fail text-white" },
  { t: 2, l: "Önemli", c: "bg-blue text-white" },
  { t: 3, l: "Rutin", c: "bg-ink-3 text-white" },
] as const;
const REL: Record<string, string> = { yonetici: "yöneticin", ust_yonetim: "üst yönetim", ekip: "ekip", is_birimi: "iş birimi", dis: "dış", otomatik: "otomatik", diger: "" };

function People({ onChange }: { onChange: () => void }) {
  const { toast } = usePeriod();
  const [st, setSt] = useState<PeopleStore | null>(null);
  const [all, setAll] = useState(false);
  const load = useCallback(() => api<PeopleStore>("/api/training?people=1").then(setSt).catch(() => setSt({ at: "", people: [] })), []);
  useEffect(() => {
    load();
  }, [load]);
  const set = async (p: Person, t: 1 | 2 | 3) => {
    const override = p.override === t ? null : t;
    setSt((s) => (s ? { ...s, people: s.people.map((x) => (x.key === p.key ? { ...x, override: override ?? undefined } : x)) } : s));
    try {
      await post({ action: "person", key: p.key, override });
      onChange();
    } catch (e) {
      toast((e as Error).message);
      load();
    }
  };
  const list = st?.people ?? [];
  const tier = (p: Person) => p.override ?? p.tier ?? (p.auto ? 3 : 2);
  const sorted = [...list].sort((a, b) => tier(a) - tier(b));
  return (
    <section className="clay p-5">
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-extrabold">Kişi haritası</span>
        <span className="text-xs text-ink-3">{list.length ? `${list.length} kişi · ${dayText(st?.at)}` : "eğitimde oluşur"}</span>
      </div>
      <p className="mt-0.5 text-xs text-ink-3">Gelen mesajın önemi gönderene göre tartılır. Yanlışsa önemini değiştir; senin seçimin her zaman esas.</p>
      {!list.length ? (
        <div className="mt-3 text-sm text-ink-3">Henüz kişi haritası yok — “Geçmişimden öğren” ile oluşur.</div>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {sorted.slice(0, all ? 80 : 10).map((p) => (
            <li key={p.key} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">
                  {p.name}
                  {p.relation && REL[p.relation] ? <span className="font-semibold text-ink-3"> · {REL[p.relation]}</span> : null}
                </div>
                <div className="truncate text-xs text-ink-3">
                  {[p.role, p.threads ? `yanıt %${Math.round((p.replied / p.threads) * 100)}` : "", p.inbound ? `${p.inbound} e-posta` : "", p.chat ? `${p.chat} mesaj` : "", p.meetings ? `${p.meetings} toplantı` : ""].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="flex shrink-0 rounded-full bg-track p-0.5">
                {TIERS.map((x) => (
                  <button
                    key={x.t}
                    onClick={() => set(p, x.t)}
                    title={p.override === x.t ? "Senin seçimin (geri almak için tekrar bas)" : x.l}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${tier(p) === x.t ? x.c : "text-ink-3 hover:text-ink"} ${p.override === x.t ? "ring-2 ring-offset-1 ring-offset-transparent ring-white/60" : ""}`}
                  >
                    {x.l}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.length > 10 && (
        <button onClick={() => setAll((x) => !x)} className="mt-2 text-xs font-bold text-blue">
          {all ? "Daha az göster" : `Tümünü göster (${list.length})`}
        </button>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ şirket verisi */
function Company({ onChange }: { onChange: () => void }) {
  const { toast } = usePeriod();
  const [files, setFiles] = useState<KurumFile[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(() => api<{ files: KurumFile[] }>("/api/kurum").then((j) => setFiles(j.files)).catch(() => setFiles([])), []);
  useEffect(() => {
    load();
  }, [load]);

  const upload = async (list: FileList | File[]) => {
    for (const f of Array.from(list)) {
      const ext = f.name.toLowerCase().split(".").pop() ?? "";
      setBusy(f.name);
      try {
        if (TEXT_EXT.includes(ext)) {
          const text = await f.text();
          let id: string | undefined;
          // büyük dosya satır sınırlarından parça parça gider (satır bölünmez)
          for (let i = 0; i < text.length; ) {
            let j = Math.min(text.length, i + SEG);
            if (j < text.length) {
              const nl = text.lastIndexOf("\n", j);
              if (nl > i) j = nl + 1;
            }
            const r = await api<{ file: KurumFile }>("/api/kurum", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, text: text.slice(i, j), id, size: f.size }) });
            id = r.file.id;
            i = j;
          }
        } else if (BIN_EXT.includes(ext)) {
          if (f.size > MAX_BYTES) throw new Error(`${f.name} 4 MB'tan büyük — Google Drive'a koy (arşiv okur) ya da Excel'i CSV olarak kaydet`);
          const r = await api<{ file: KurumFile }>(`/api/kurum?name=${encodeURIComponent(f.name)}`, { method: "PUT", body: f });
          if (r.file.partial) toast(`${f.name}: PDF uzun; okunabilen kısmı kaydedildi`);
        } else throw new Error(`${f.name}: .${ext} desteklenmiyor (${[...TEXT_EXT, ...BIN_EXT].join(", ")})`);
      } catch (e) {
        toast((e as Error).message);
      }
    }
    setBusy(null);
    load();
    onChange();
  };
  const remove = async (f: KurumFile) => {
    if (!confirm(`“${f.name}” şirket verisinden silinsin mi?`)) return;
    await api(`/api/kurum?id=${f.id}`, { method: "DELETE" }).catch((e) => toast((e as Error).message));
    load();
    onChange();
  };

  return (
    <section className="clay p-5">
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-extrabold">Şirket verisi</span>
        <span className="text-xs text-ink-3">{files?.length ? `${files.length} dosya` : "izinli dosyalar"}</span>
      </div>
      <p className="mt-0.5 text-xs text-ink-3">
        Prosedür, rapor, tablo, sistem dökümü… Metni veritabanına yazılır; beyin önem değerlendirirken ve asistan cevap verirken buradan arar. Yalnızca paylaşma iznin olan verileri yükle.
      </p>
      <div
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
        }}
        onClick={() => !busy && input.current?.click()}
        className={`mt-3 grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors ${drag ? "border-blue bg-blue/5" : "border-line hover:border-ink-3"}`}
      >
        <Icon name="upload" size={22} className="text-ink-3" />
        <div className="mt-1.5 text-sm font-bold">{busy ? `Okunuyor: ${busy}` : "Dosyaları bırak ya da seç"}</div>
        <div className="text-[11px] text-ink-3">Word, Excel, PowerPoint, PDF (4 MB'a kadar) · CSV, TXT, MD, JSON (sınırsız)</div>
        <input ref={input} type="file" multiple hidden accept={[...TEXT_EXT, ...BIN_EXT].map((x) => `.${x}`).join(",")} onChange={(e) => e.target.files && upload(e.target.files)} />
      </div>
      {!!files?.length && (
        <ul className="mt-3 divide-y divide-line">
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
              <button onClick={() => remove(f)} aria-label="Sil" className="grid h-8 w-8 place-items-center rounded-full text-ink-3 hover:bg-track hover:text-fail">
                <Icon name="trash" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
