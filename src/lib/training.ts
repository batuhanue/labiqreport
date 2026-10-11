import "server-only";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { rowsIn, stats as archiveStats, type LightRow } from "./archive";
import { remember, saveKnowledge } from "./assistant";
import { brainBlocks } from "./brain-prompt";
import { addUsage, ASSISTANT_MODEL, claude, claudeConfigured, logUsage, newUsage, type Usage } from "./claude";
import { store } from "./db";
import { getSnapshot } from "./google";
import { buildPeople, readPeople } from "./people";
import { listFiles as kurumFiles, readNotes as kurumNotes, unitsOf } from "./kurum";
import type { ArchiveStats } from "./google-types";
import type { MonthNotes, TrainingState, TrainingView } from "./training-types";

/*
 * Beyni eğit: beyin Batuhan'ın işini kendi geçmişinden öğrenir.
 *  1) Kişi haritası (haftada bir): kim kimdir, kime ne hızla dönüyor.
 *  2) Ay ay okuma (son 6 ay, sonra her hafta bu ay): Batuhan'ın yanıt verdiği yazışmalar, yazdığı sohbetler,
 *     toplantılar ve takvim → süreçler, döngüler, kişilerin beklentileri, neyin acil neyin gürültü olduğu,
 *     yazılı olmayan kurallar, emin olunamayan noktalar (soru).
 *  3) Sentez: bütün ay notlarından bilgi dosyası `is-bilgisi.md` (her düşünmede okunur) + Batuhan'a sorular.
 * Her adım süre bütçeli ve kaldığı yerden devam eder; uygulama açıkken arka planda ve Pazar sabahı cron'da ilerler.
 */

const KEY = "brain-training";
export const PROFILE_FILE = "is-bilgisi.md";
const BACKFILL = 6;
const DAY = 86400_000;

const empty = (): TrainingState => ({ months: {}, questions: [], log: [] });
export const readTraining = async (): Promise<TrainingState> => ({ ...empty(), ...((await store().getKV<TrainingState>(KEY)) ?? {}) });
const save = (st: TrainingState) => store().setKV(KEY, st);

const ym = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 7);
const monthRange = (m: string) => {
  const from = new Date(`${m}-01T00:00:00+03:00`);
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
};
/** öğrenilecek aylar: bu ay + önceki BACKFILL-1 ay (yeniden eskiye) */
function targetMonths(now = new Date()) {
  const out: string[] = [];
  const d = new Date(`${ym(now)}-15T12:00:00+03:00`);
  for (let i = 0; i < BACKFILL; i++) {
    out.push(ym(d));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}
/** bir ay yeniden okunmalı mı: hiç okunmadıysa ya da içindeki ay ve 6 günden eskiyse */
const stale = (st: TrainingState, m: string, now = new Date()) => {
  const n = st.months[m];
  if (!n) return true;
  return m === ym(now) && Date.parse(n.at) < now.getTime() - 6 * DAY;
};

export function trainingDue(st: TrainingState, people: { at: string }, hasArchive: boolean, now = new Date()) {
  if (!hasArchive) return false;
  if (st.running && st.running > Date.now()) return false;
  if (!people.at || Date.parse(people.at) < now.getTime() - 7 * DAY) return true;
  if (targetMonths(now).some((m) => stale(st, m, now))) return true;
  const latest = Math.max(0, ...Object.values(st.months).map((n) => Date.parse(n.at)));
  return !!st.resynth || !st.profileAt || Date.parse(st.profileAt) < latest;
}

// ------------------------------------------------------------------ bir ayın okuma malzemesi
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const day = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short", weekday: "short", timeZone: "Europe/Istanbul" });
const sender = (who: string) => who.split(" → ")[0].replace(/\s*<[^>]+>/, "").trim();

export async function monthCorpus(m: string) {
  const { from, to } = monthRange(m);
  const [rows, meets] = await Promise.all([
    rowsIn(["gmail", "chat", "calendar"], from, to, { limit: 9000, bodyChars: 600 }),
    rowsIn(["meet"], from, to, { limit: 12, bodyChars: 2400 }),
  ]);
  const mails = rows.filter((r) => r.source === "gmail");
  const chats = rows.filter((r) => r.source === "chat");
  const events = rows.filter((r) => r.source === "calendar");

  // e-posta yazışmaları: Batuhan'ın yazdığı (yanıt verdiği / başlattığı) yazışmalar öncelikli
  const threads = new Map<string, LightRow[]>();
  for (const r of mails) {
    const k = String(r.meta?.threadId ?? r.id);
    threads.set(k, [...(threads.get(k) ?? []), r]);
  }
  const list = [...threads.values()].map((xs) => xs.sort((a, b) => a.ts.localeCompare(b.ts)));
  const engaged = list.filter((xs) => xs.some((x) => x.meta?.sent === true)).sort((a, b) => b.length - a.length || b.at(-1)!.ts.localeCompare(a.at(-1)!.ts));
  const silent = list.filter((xs) => !xs.some((x) => x.meta?.sent === true));
  const silentBy = new Map<string, number>();
  for (const xs of silent) for (const x of xs) silentBy.set(sender(x.who), (silentBy.get(sender(x.who)) ?? 0) + 1);

  const L: string[] = [];
  L.push(`## E-POSTA — Batuhan'ın yazdığı yazışmalar (${engaged.length}; en yoğun 40)`);
  for (const xs of engaged.slice(0, 40)) {
    const first = xs.find((x) => x.meta?.sent !== true);
    const mine = xs.filter((x) => x.meta?.sent === true);
    const firstMine = mine[0];
    const lag = first && firstMine && firstMine.ts > first.ts ? Math.round((Date.parse(firstMine.ts) - Date.parse(first.ts)) / 3600_000) : null;
    L.push(
      `### ${xs[0].title} · ${xs.length} ileti · ${day(xs[0].ts)}${lag != null ? ` · Batuhan ${lag < 1 ? "1 saatten kısa" : `${lag} saat`} içinde yazdı` : first ? "" : " · Batuhan başlattı"}\nKatılanlar: ${[...new Set(xs.map((x) => (x.meta?.sent === true ? "Batuhan" : sender(x.who))))].slice(0, 6).join(", ")}${first ? `\nGelen: ${clip(first.body, 420)}` : ""}${firstMine ? `\nBatuhan: ${clip(firstMine.body, 320)}` : ""}`,
    );
  }
  L.push(`\n## E-POSTA — Batuhan'ın hiç yazmadığı yazışmalar: ${silent.length}. En çok gönderenler: ${[...silentBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, n]) => `${k} (${n})`).join(", ") || "—"}`);
  L.push(`Örnek konular: ${silent.slice(0, 25).map((xs) => xs[0].title).join(" | ")}`);

  // sohbetler: Batuhan'ın yazdığı alanlar
  const spaces = new Map<string, LightRow[]>();
  for (const r of chats) spaces.set(r.link ?? r.title, [...(spaces.get(r.link ?? r.title) ?? []), r]);
  const sp = [...spaces.values()]
    .map((xs) => xs.sort((a, b) => a.ts.localeCompare(b.ts)))
    .filter((xs) => xs.some((x) => x.meta?.mine === true))
    .sort((a, b) => b.filter((x) => x.meta?.mine === true).length - a.filter((x) => x.meta?.mine === true).length)
    .slice(0, 12);
  L.push(`\n## SOHBET — Batuhan'ın yazdığı ${sp.length} sohbet (örnek mesajlar)`);
  for (const xs of sp) {
    L.push(`### ${xs[0].title} (${xs[0].meta?.kind === "DIRECT_MESSAGE" ? "birebir" : "grup"}) · ${xs.length} mesaj\n${xs.slice(-12).map((x) => `${day(x.ts)} ${x.meta?.mine === true ? "Batuhan" : x.who}: ${clip(x.body, 200)}`).join("\n")}`);
  }

  // toplantılar
  if (meets.length) {
    L.push(`\n## TOPLANTILAR (${meets.length})`);
    for (const x of meets.slice(0, 10)) L.push(`### ${x.title} · ${day(x.ts)} · ${clip(x.who, 160)}\n${clip(x.body, 1500)}`);
  }
  // takvim: tekrarlayanlar ve ayın günleri
  const byTitle = new Map<string, string[]>();
  for (const e of events) byTitle.set(e.title, [...(byTitle.get(e.title) ?? []), e.ts]);
  L.push(
    `\n## TAKVİM (${events.length} etkinlik)\n${[...byTitle.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 30)
      .map(([t, ts]) => `- ${t}: ${ts.length > 1 ? `${ts.length} kez (${ts.slice(0, 4).map(day).join(", ")})` : day(ts[0])}`)
      .join("\n")}`,
  );

  return { text: L.join("\n"), stats: { mails: mails.length, threads: list.length, engaged: engaged.length, chats: chats.length, meetings: meets.length, events: events.length } };
}

// ------------------------------------------------------------------ Claude: ay notları
const MONTH_SCHEMA = {
  type: "object",
  properties: {
    processes: {
      type: "array",
      description: "tekrarlayan iş süreçleri ve döngüler",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          when: { type: "string", description: "ne zaman/ne sıklıkla (ör. ayın ilk 5 iş günü, her Cuma, ay sonu+3)" },
          steps: { type: "array", items: { type: "string" } },
          people: { type: "array", items: { type: "string" } },
          evidence: { type: "string", description: "hangi yazışma/toplantıdan görüldü (kısa)" },
        },
        required: ["name", "when", "steps", "people", "evidence"],
        additionalProperties: false,
      },
    },
    people: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, role: { type: "string" }, needs: { type: "string", description: "Batuhan'dan genelde ne ister / Batuhan ondan ne bekler" } },
        required: ["name", "role", "needs"],
        additionalProperties: false,
      },
    },
    urgent: { type: "array", items: { type: "string" }, description: "Batuhan'ın hemen tepki verdiği durum türleri (kanıtla)" },
    ignored: { type: "array", items: { type: "string" }, description: "Batuhan'ın yanıt vermediği/görmezden geldiği kaynak ve türler" },
    rules: { type: "array", items: { type: "string" }, description: "yazılı olmayan kurallar, beklentiler, çalışma alışkanlıkları" },
    commitments: { type: "array", items: { type: "string" }, description: "tekrarlayan teslimler/sözler (kime, ne, ne zaman)" },
    questions: {
      type: "array",
      description: "veriden emin olunamayan, Batuhan'a sorulması gereken önemli noktalar (en çok 3)",
      items: { type: "object", properties: { q: { type: "string" }, why: { type: "string" } }, required: ["q", "why"], additionalProperties: false },
    },
  },
  required: ["processes", "people", "urgent", "ignored", "rules", "commitments", "questions"],
  additionalProperties: false,
} as const;

async function learnMonth(m: string, u: Usage, timeout: number): Promise<MonthNotes | null> {
  const c = await monthCorpus(m);
  if (c.stats.mails + c.stats.chats + c.stats.meetings < 5) return { month: m, at: new Date().toISOString(), stats: c.stats, empty: true, processes: [], people: [], urgent: [], ignored: [], rules: [], commitments: [], questions: [] };
  const res = await claude().messages.parse(
    {
      model: ASSISTANT_MODEL,
      max_tokens: 8000,
      system: await brainBlocks(),
      output_config: { effort: "medium", format: jsonSchemaOutputFormat(MONTH_SCHEMA) },
      messages: [
        {
          role: "user",
          content: `ŞU AN: Eğitim — ${m} ayını oku ve Batuhan'ın işinin GERÇEKTE nasıl yürüdüğünü öğren. Aşağıda o ayın arşivi var: Batuhan'ın yazdığı e-posta yazışmaları (gelen + onun yanıtı + yanıt hızı), hiç yazmadığı kaynaklar, yazdığı sohbetler, toplantı transkriptleri ve takvim.
Amaç bilgi dosyalarında yazmayan ama veride görünen bilgiyi çıkarmak: tekrarlayan süreçler ve ayın hangi günü ne olduğu, kim ne ister, Batuhan neye hemen döner, neyi görmezden gelir, yazılı olmayan kurallar, tekrarlayan teslimler.
Kurallar: yalnızca veride kanıtı olanı yaz (tek seferlik olayları genelleme); bilgi dosyalarında zaten aynen yazanı tekrar etme; kişileri zan altında bırakma; rakam/kişisel veri yerine iş kalıbını yaz. Emin olamadığın önemli bir nokta varsa soru olarak ekle.

${c.text}`,
        },
      ],
    },
    { timeout },
  );
  addUsage(u, res);
  if (res.stop_reason === "refusal" || !res.parsed_output) return null;
  return { month: m, at: new Date().toISOString(), stats: c.stats, ...res.parsed_output };
}

// ------------------------------------------------------------------ Claude: sentez → is-bilgisi.md
const PROFILE_SCHEMA = {
  type: "object",
  properties: {
    markdown: { type: "string", description: "bilgi dosyasının tamamı (Markdown)" },
    questions: {
      type: "array",
      description: "Batuhan'a sorulacak en önemli açık noktalar (en çok 6; cevaplanmışları sorma)",
      items: { type: "object", properties: { q: { type: "string" }, why: { type: "string" } }, required: ["q", "why"], additionalProperties: false },
    },
  },
  required: ["markdown", "questions"],
  additionalProperties: false,
} as const;

const notesText = (n: MonthNotes) =>
  `### ${n.month} (${n.stats.mails} e-posta, ${n.stats.engaged} yazıştığı yazışma, ${n.stats.chats} sohbet mesajı, ${n.stats.meetings} toplantı)
Süreçler: ${n.processes.map((p) => `${p.name} [${p.when}] ${p.steps.join(" → ")} (kişiler: ${p.people.join(", ")})`).join(" || ") || "—"}
Kişiler: ${n.people.map((p) => `${p.name} (${p.role}): ${p.needs}`).join(" | ") || "—"}
Acil: ${n.urgent.join(" | ") || "—"}
Görmezden: ${n.ignored.join(" | ") || "—"}
Kurallar: ${n.rules.join(" | ") || "—"}
Teslimler: ${n.commitments.join(" | ") || "—"}`;

async function synthesize(st: TrainingState, u: Usage, timeout: number) {
  const notes = Object.values(st.months)
    .filter((n) => !n.empty)
    .sort((a, b) => b.month.localeCompare(a.month));
  if (!notes.length) return null;
  const answered = st.questions.filter((q) => q.answer);
  const res = await claude().messages.parse(
    {
      model: ASSISTANT_MODEL,
      max_tokens: 12000,
      system: await brainBlocks(),
      output_config: { effort: "medium", format: jsonSchemaOutputFormat(PROFILE_SCHEMA) },
      messages: [
        {
          role: "user",
          content: `ŞU AN: Eğitim sentezi. Aşağıdaki ay notlarından (yeniden eskiye) Batuhan'ın işinin öğrenilmiş bilgisini tek bir bilgi dosyası olarak yaz. Bu dosya her düşünmede okunacak: gelen bir mesajın önemini ve hangi işin açılacağını buna göre karar vereceksin.
Biçim (Markdown, Türkçe, yoğun ve maddeli; en çok ~9000 karakter):
# İş bilgisi (öğrenilen)
> kısa açıklama: hangi aylardan, ne kadar veriden öğrenildi; düzeltme için Beyin → Eğitim'deki soruları yanıtla ya da belleğe yaz
## Rolün gerçekte nasıl işliyor
## Aylık döngü (ayın günlerine göre ne olur)
## Süreçler (adım adım, kimlerle)
## Önem kuralları — hemen bak / bekleyebilir / gürültü
## Kişiler ve beklentileri (kişi haritasını tamamla, tekrar etme)
## Yazılı olmayan kurallar ve alışkanlıklar
## Tekrarlayan teslimler ve sözler
Kurallar: birden çok ayda görülen kalıplara ağırlık ver; tek seferlikleri yazma; bilgi dosyalarında aynen yazanı tekrar etme ama gerçekte farklı işliyorsa belirt ("dosyada X yazıyor, pratikte Y"). Batuhan'ın cevapladığı sorular kesin bilgidir.

${answered.length ? `BATUHAN'IN CEVAPLARI:\n${answered.map((q) => `- S: ${q.q}\n  C: ${q.answer}`).join("\n")}\n\n` : ""}AY NOTLARI:
${notes.map(notesText).join("\n\n")}

Ayların açık soruları: ${notes.flatMap((n) => n.questions.map((q) => q.q)).join(" | ") || "—"}`,
        },
      ],
    },
    { timeout },
  );
  addUsage(u, res);
  if (res.stop_reason === "refusal" || !res.parsed_output?.markdown.trim()) return null;
  return res.parsed_output;
}

// ------------------------------------------------------------------ adım
/**
 * Eğitimin bir adımı (süre bütçeli): kişi haritası eskiyse yenile → okunmamış/eskimiş ayları oku →
 * yeni not varsa bilgi dosyasını yeniden yaz. Kaldığı yerden devam eder.
 */
export async function trainStep(opts: { budgetMs?: number; force?: boolean } = {}) {
  if (!claudeConfigured()) throw new Error("ANTHROPIC_API_KEY tanımlı değil");
  const budget = opts.budgetMs ?? 52000;
  const t0 = Date.now();
  const left = () => budget - (Date.now() - t0);
  const st = await readTraining();
  if (st.running && st.running > Date.now()) return { busy: true as const };
  st.running = Date.now() + budget + 15000;
  await save(st);
  const u = newUsage();
  let rounds = 0;
  const did: string[] = [];
  let error: string | undefined;
  try {
    // 1) kişi haritası (haftada bir)
    const people = await readPeople();
    if (opts.force || !people.at || Date.parse(people.at) < Date.now() - 7 * DAY) {
      const r = await buildPeople({ timeout: Math.max(15000, Math.min(45000, left() - 5000)) });
      did.push(r.error ? `kişi haritası ölçüldü, etiketlenemedi (${r.error.slice(0, 80)})` : `kişi haritası (${r.people.length} kişi)`);
    }
    // 2) aylar (yeniden eskiye)
    for (const m of targetMonths()) {
      if (left() < 30000) break;
      if (!opts.force && !stale(st, m)) continue;
      const n = await learnMonth(m, u, Math.min(50000, left() - 8000));
      rounds++;
      if (n) {
        st.months[m] = n;
        did.push(`${m}${n.empty ? " (veri az)" : ""}`);
        await save(st);
      }
    }
    // 3) sentez
    const latest = Math.max(0, ...Object.values(st.months).map((n) => Date.parse(n.at)));
    if ((st.resynth || !st.profileAt || Date.parse(st.profileAt) < latest) && left() > 25000) {
      const out = await synthesize(st, u, Math.min(55000, left() - 3000));
      rounds++;
      if (out) {
        const md = out.markdown.trim().replace(/^```(?:markdown)?\s*|\s*```$/g, "");
        await saveKnowledge(PROFILE_FILE, md);
        st.profileAt = new Date().toISOString();
        st.resynth = false;
        const known = new Set(st.questions.map((q) => q.q.trim().toLowerCase()));
        for (const q of out.questions.slice(0, 6)) {
          if (known.has(q.q.trim().toLowerCase())) continue;
          st.questions.push({ id: Math.random().toString(36).slice(2, 9), q: q.q.trim(), why: q.why.trim(), at: st.profileAt });
        }
        // açık sorular en çok 8 (eskileri cevapsızsa düşer)
        const open = st.questions.filter((q) => !q.answer && !q.skipped);
        if (open.length > 8) for (const q of open.slice(0, open.length - 8)) q.skipped = true;
        did.push("iş bilgisi yazıldı");
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 240) : String(e);
  } finally {
    const cost = await logUsage("🎓 Eğitim", u, { t0, rounds, error });
    const cur = await readTraining();
    // sentez sürerken gelen cevap yeniden yazmayı tetiklesin
    const answeredSince = cur.questions.some((q) => q.answeredAt && st.profileAt && q.answeredAt > st.profileAt);
    Object.assign(cur, { months: { ...cur.months, ...st.months }, profileAt: st.profileAt ?? cur.profileAt, resynth: answeredSince || (st.resynth ?? cur.resynth), questions: mergeQuestions(cur.questions, st.questions) });
    cur.running = undefined;
    cur.lastError = error;
    cur.log = [{ at: new Date().toISOString(), did, ms: Date.now() - t0, cost, error }, ...cur.log].slice(0, 20);
    await save(cur);
  }
  return { did, error };
}

/** Kaydı sırasında gelen cevaplar kaybolmasın */
function mergeQuestions(cur: TrainingState["questions"], next: TrainingState["questions"]) {
  const byId = new Map(cur.map((q) => [q.id, q]));
  for (const q of next) byId.set(q.id, { ...q, ...byId.get(q.id) });
  return [...byId.values()];
}

/** Başka bir öğrenme (ör. şirket verisi eğitimi) Batuhan'a soru ekler; aynısı varsa eklenmez */
export async function addQuestions(qs: { q: string; why: string }[]) {
  if (!qs.length) return;
  const st = await readTraining();
  const known = new Set(st.questions.map((q) => q.q.trim().toLowerCase()));
  const at = new Date().toISOString();
  for (const q of qs) {
    if (!q.q.trim() || known.has(q.q.trim().toLowerCase())) continue;
    st.questions.push({ id: Math.random().toString(36).slice(2, 9), q: q.q.trim(), why: q.why.trim(), at });
  }
  await save(st);
}

/** Batuhan'ın cevabı: belleğe yazılır (hemen etkili), sonraki sentezde kesin bilgi olur */
export async function answerQuestion(id: string, answer: string | null) {
  const st = await readTraining();
  const q = st.questions.find((x) => x.id === id);
  if (!q) throw new Error("Soru bulunamadı");
  if (answer == null) q.skipped = true;
  else {
    q.answer = answer.trim().slice(0, 1000);
    q.answeredAt = new Date().toISOString();
    await remember({ topic: "İşim hakkında (Eğitim cevapları)", entries: [`${q.q.replace(/\?$/, "")}: ${q.answer}`] });
    st.resynth = true; // sonraki adımda dosya cevapla yeniden yazılır
  }
  await save(st);
  return q;
}

/** Arayüz için özet */
export async function trainingView(): Promise<TrainingView> {
  const [st, people, arch, kf, kn] = await Promise.all([readTraining(), readPeople(), archiveStats().catch((): ArchiveStats => ({ total: 0, bySource: {} })), kurumFiles().catch(() => []), kurumNotes().catch(() => ({ units: {}, log: [] }))]);
  const units = unitsOf(kf, kn);
  const months = targetMonths().map((m) => ({ month: m, at: st.months[m]?.at, empty: st.months[m]?.empty, stats: st.months[m]?.stats }));
  const hasArchive = arch.total > 0;
  return {
    months,
    profileAt: st.profileAt,
    resynth: st.resynth,
    peopleAt: people.at || undefined,
    people: people.people.length,
    running: !!(st.running && st.running > Date.now()),
    due: trainingDue(st, people, hasArchive),
    hasArchive,
    archive: { total: arch.total, kurum: arch.bySource.kurum?.count ?? 0 },
    company: { units: units.length, trained: units.filter((u) => u.trainedAt && !u.stale).length, stale: units.filter((u) => u.stale).length, files: kf.length },
    questions: st.questions.filter((q) => !q.skipped).sort((a, b) => Number(!!a.answer) - Number(!!b.answer) || b.at.localeCompare(a.at)).slice(0, 12),
    log: st.log.slice(0, 6),
    lastError: st.lastError,
    account: (await getSnapshot().catch(() => null))?.account?.email,
  };
}
