import "server-only";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { norm, rowsIn, type LightRow } from "./archive";
import { saveKnowledge } from "./assistant";
import { brainBlocks } from "./brain-prompt";
import { addUsage, ASSISTANT_MODEL, claude, claudeConfigured, logUsage, newUsage } from "./claude";
import { store } from "./db";
import { getSnapshot } from "./google";
import type { Person, PeopleStore, Relation } from "./people-types";

/*
 * Kişi haritası: kim kimdir ve Batuhan için ne kadar önemli?
 * 1) Ölç (ücretsiz): son 180 günün arşivinden her kişiyle gelen/giden e-posta, Batuhan'ın yanıt oranı ve hızı,
 *    sohbet mesajı, ortak toplantı.
 * 2) Tanı (Claude): bilgi dosyaları + bellek + bu ölçümler + son konular → rol, ilişki, önem (1-3), genelde ne ister.
 * 3) Yaz: bilgi dosyası `kisi-haritasi.md` (her düşünmede okunur) — Batuhan'ın düzeltmesi (önem) her zaman esas.
 */

const KEY = "people-map";
export const PEOPLE_FILE = "kisi-haritasi.md";
const DAYS = 180;
const AUTO = /no-?reply|noreply|do-?not-?reply|notification|notifications|mailer-daemon|postmaster|bounce|calendar-notification|newsletter|bulten|info@|bilgi@|destek@|support@|alerts?@|system@|robot|bot@/i;

export const readPeople = async (): Promise<PeopleStore> => (await store().getKV<PeopleStore>(KEY)) ?? { at: "", people: [] };

const EMAIL = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g;
const nameKey = (n: string) => `ad:${norm(n).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim()}`;

/** "Ad Soyad <a@b> → alıcılar" biçimindeki `who` alanını çözer */
function parseWho(who: string) {
  const [from, to = ""] = who.split(" → ");
  const m = from.match(/^(.*?)\s*<([^>]+)>\s*$/);
  return { name: (m ? m[1] : from).replace(/^"|"$/g, "").trim(), email: (m ? m[2] : from).trim().toLowerCase(), to: (to.match(EMAIL) ?? []).map((x) => x.toLowerCase()) };
}

const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Arşivden kişi ölçümleri (yapay zekâsız) */
export function measure(rows: LightRow[], self?: string, selfName?: string): Person[] {
  const me = self?.toLowerCase();
  const meName = selfName ? nameKey(selfName) : "";
  const map = new Map<string, Person>();
  const nameToEmail = new Map<string, string>();
  const get = (key: string, name: string, email?: string) => {
    let p = map.get(key);
    if (!p) map.set(key, (p = { key, name, email, inbound: 0, outbound: 0, threads: 0, replied: 0, chat: 0, meetings: 0, subjects: [], auto: email ? AUTO.test(email) : false }));
    if (name && (!p.name || p.name.includes("@"))) p.name = name;
    return p;
  };
  const touch = (p: Person, ts: string) => {
    if (!p.lastAt || ts > p.lastAt) p.lastAt = ts;
  };
  const sentByThread = new Map<string, string[]>();
  const mails = rows.filter((r) => r.source === "gmail");
  for (const r of mails) {
    if (r.meta?.sent === true) {
      const th = String(r.meta?.threadId ?? "");
      if (th) sentByThread.set(th, [...(sentByThread.get(th) ?? []), r.ts]);
    }
  }
  const threadFirst = new Map<string, { key: string; ts: string }>();
  for (const r of mails) {
    const w = parseWho(r.who);
    if (r.meta?.sent === true) {
      for (const e of new Set(w.to)) {
        if (e === me) continue;
        const p = get(e, e.split("@")[0], e);
        p.outbound++;
        touch(p, r.ts);
      }
      continue;
    }
    if (!w.email.includes("@") || w.email === me) continue;
    const p = get(w.email, w.name, w.email);
    p.inbound++;
    touch(p, r.ts);
    if (p.subjects.length < 6 && r.title && !p.subjects.includes(r.title)) p.subjects.push(r.title.slice(0, 90));
    if (w.name) nameToEmail.set(nameKey(w.name), w.email);
    const th = String(r.meta?.threadId ?? "");
    if (th) {
      const f = threadFirst.get(`${th}|${w.email}`);
      if (!f || r.ts < f.ts) threadFirst.set(`${th}|${w.email}`, { key: w.email, ts: r.ts });
    }
  }
  // yanıt oranı ve hızı: kişinin başlattığı/yazdığı yazışmada Batuhan sonradan yazdı mı
  const lat = new Map<string, number[]>();
  for (const [k, f] of threadFirst) {
    const p = map.get(f.key)!;
    p.threads++;
    const th = k.split("|")[0];
    const after = (sentByThread.get(th) ?? []).filter((t) => t > f.ts).sort()[0];
    if (after) {
      p.replied++;
      lat.set(f.key, [...(lat.get(f.key) ?? []), (Date.parse(after) - Date.parse(f.ts)) / 3600_000]);
    }
  }
  for (const [k, xs] of lat) {
    const m = median(xs);
    if (m != null) map.get(k)!.replyHours = Math.round(m * 10) / 10;
  }
  // sohbet ve toplantı: ada göre (e-postası biliniyorsa aynı kişiye bağlanır)
  const byName = (name: string) => {
    const n = name.trim();
    if (meName && nameKey(n) === meName) return null;
    const e = nameToEmail.get(nameKey(n));
    return e ? get(e, n, e) : get(nameKey(n), n);
  };
  for (const r of rows) {
    if (r.source === "chat") {
      if (r.meta?.mine === true || ["Sen", "Uygulama", "Bir kişi"].includes(r.who)) continue;
      const p = byName(r.who);
      if (!p) continue;
      p.chat++;
      touch(p, r.ts);
    } else if (r.source === "meet") {
      for (const n of r.who.split(/,\s*/).filter((x) => x && x !== "Sen")) {
        const p = byName(n);
        if (!p) continue;
        p.meetings++;
        touch(p, r.ts);
      }
    }
  }
  const score = (p: Person) => p.inbound + 2 * p.outbound + 3 * p.replied + 0.5 * p.chat + 2 * p.meetings;
  const all = [...map.values()].filter((p) => score(p) >= 2);
  const human = all.filter((p) => !p.auto).sort((a, b) => score(b) - score(a)).slice(0, 70);
  const auto = all.filter((p) => p.auto).sort((a, b) => b.inbound - a.inbound).slice(0, 12);
  return [...human, ...auto];
}

const REL: Relation[] = ["yonetici", "ust_yonetim", "ekip", "is_birimi", "dis", "otomatik", "diger"];
const PEOPLE_SCHEMA = {
  type: "object",
  properties: {
    people: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string", description: "listedeki anahtar (aynen)" },
          role: { type: "string", description: "şirketteki rolü/birimi (bilgi dosyalarından ya da yazışmalardan); emin değilsen boş" },
          relation: { type: "string", enum: REL, description: "Batuhan'a göre: yonetici (doğrudan yöneticisi) · ust_yonetim · ekip (birlikte çalıştığı) · is_birimi (iş aldığı/verdiği diğer birim) · dis (şirket dışı) · otomatik (sistem/bülten) · diger" },
          tier: { type: "integer", enum: [1, 2, 3], description: "Batuhan için önem: 1 kritik (hemen bakmalı) · 2 önemli · 3 rutin/düşük" },
          expects: { type: "string", description: "genelde Batuhan'dan ne ister / ne için yazar (kısa); bilinmiyorsa boş" },
        },
        required: ["key", "role", "relation", "tier", "expects"],
        additionalProperties: false,
      },
    },
  },
  required: ["people"],
  additionalProperties: false,
} as const;

const statLine = (p: Person) =>
  [
    p.inbound ? `${p.inbound} e-posta geldi` : "",
    p.outbound ? `Batuhan ${p.outbound} e-posta yazdı` : "",
    p.threads ? `yanıt oranı %${Math.round((p.replied / p.threads) * 100)}${p.replyHours != null ? ` (genelde ${fmtH(p.replyHours)} içinde)` : ""}` : "",
    p.chat ? `${p.chat} sohbet mesajı` : "",
    p.meetings ? `${p.meetings} ortak toplantı` : "",
  ]
    .filter(Boolean)
    .join(", ");
export const fmtH = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} dk` : h < 48 ? `${Math.round(h)} saat` : `${Math.round(h / 24)} gün`);

/** Kişileri ölçer, Claude ile rol/önem etiketler, bilgi dosyasını yazar. */
export async function buildPeople(opts: { label?: boolean; timeout?: number } = {}) {
  const t0 = Date.now();
  const u = newUsage();
  let rounds = 0;
  let error: string | undefined;
  const prev = await readPeople();
  const account = (await getSnapshot().catch(() => null))?.account;
  const rows = await rowsIn(["gmail", "chat", "meet"], new Date(Date.now() - DAYS * 86400_000).toISOString(), undefined, { limit: 30000 });
  const people = measure(rows, account?.email, account?.name);
  const old = new Map(prev.people.map((p) => [p.key, p]));
  for (const p of people) {
    const o = old.get(p.key);
    if (o) Object.assign(p, { role: o.role, relation: o.relation, tier: o.tier, expects: o.expects, override: o.override, note: o.note });
  }
  let labeledAt = prev.labeledAt;
  if (opts.label !== false && claudeConfigured() && people.length) {
    try {
      const list = people
        .map((p) => `- key=${p.key} · ${p.name}${p.email && !p.key.startsWith("ad:") ? ` <${p.email}>` : ""}${p.auto ? " · (otomatik gönderici olabilir)" : ""}\n  ${statLine(p)}${p.subjects.length ? `\n  son konular: ${p.subjects.join(" | ")}` : ""}`)
        .join("\n");
      const res = await claude().messages.parse(
        {
          model: ASSISTANT_MODEL,
          max_tokens: 12000,
          system: await brainBlocks(),
          output_config: { effort: "medium", format: jsonSchemaOutputFormat(PEOPLE_SCHEMA) },
          messages: [
            {
              role: "user",
              content: `ŞU AN: Kişi haritası. Aşağıda son ${DAYS} günde Batuhan'la en çok etkileşen kişiler ve ölçümler var. Her biri için rolünü, Batuhan'la ilişkisini, Batuhan için önemini ve genelde ne istediğini belirle.
Kanıt sırası: 1) bilgi dosyaları ve BELLEK (rol/kişi bilgisi varsa esas al) 2) davranış: Batuhan'ın yanıt oranı yüksek ve hızlıysa önemlidir; hiç yanıt vermediği, toplu/otomatik gönderen düşük önemdir 3) konu başlıkları.
Uydurma: rol bilinmiyorsa role boş kalsın. Doğrudan yöneticisi ve üst yönetim genelde 1; günlük birlikte çalıştığı ekip 2; bülten/sistem bildirimi 3.

KİŞİLER:
${list}`,
            },
          ],
        },
        { timeout: opts.timeout ?? 45000 },
      );
      rounds++;
      addUsage(u, res);
      const out = new Map((res.parsed_output?.people ?? []).map((x) => [x.key, x]));
      for (const p of people) {
        const x = out.get(p.key);
        if (!x) continue;
        p.role = x.role.trim() || p.role;
        p.relation = x.relation as Relation;
        p.tier = x.tier as 1 | 2 | 3;
        p.expects = x.expects.trim() || p.expects;
      }
      labeledAt = new Date().toISOString();
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 200) : String(e);
    }
  }
  const st: PeopleStore = { at: new Date().toISOString(), labeledAt, people };
  await store().setKV(KEY, st);
  await saveKnowledge(PEOPLE_FILE, peopleMd(st));
  await logUsage("👥 Kişi haritası", u, { t0, rounds, error });
  return { ...st, error };
}

export const tierOf = (p: Person) => p.override ?? p.tier ?? (p.auto ? 3 : 2);
const REL_LABEL: Record<Relation, string> = { yonetici: "yöneticisi", ust_yonetim: "üst yönetim", ekip: "ekip arkadaşı", is_birimi: "iş birimi", dis: "şirket dışı", otomatik: "otomatik/sistem", diger: "diğer" };
const TIER_LABEL = { 1: "Kritik — hemen bakılmalı", 2: "Önemli", 3: "Rutin / düşük öncelik" } as const;

/** Bilgi dosyası: her düşünmede okunur */
export function peopleMd(st: PeopleStore) {
  const groups = [1, 2, 3].map((t) => ({ t, list: st.people.filter((p) => tierOf(p) === t) }));
  const line = (p: Person) =>
    `- **${p.name}**${p.email && !p.key.startsWith("ad:") ? ` (${p.email})` : ""}${p.role ? ` — ${p.role}` : ""}${p.relation ? ` · ${REL_LABEL[p.relation]}` : ""}${p.override ? " · önemi Batuhan belirledi" : ""}\n  ${statLine(p) || "az etkileşim"}${p.expects ? `\n  Genelde: ${p.expects}` : ""}${p.note ? `\n  Batuhan'ın notu: ${p.note}` : ""}`;
  return `# Kişi haritası (otomatik)

> Son ${DAYS} günün e-posta, sohbet ve toplantı arşivinden ölçülür, Claude rol ve önemi etiketler; güncelleme: ${st.at.slice(0, 10)}.
> Gelen bir mesajın önemini değerlendirirken gönderenin buradaki seviyesini ve Batuhan'ın ona yanıt alışkanlığını kullan.
> Bu dosya Eğitim'de yeniden yazılır; kalıcı düzeltme için Beyin → Eğitim → Kişiler'den önem seç ya da belleğe yaz.
${groups
  .filter((g) => g.list.length)
  .map((g) => `\n## ${TIER_LABEL[g.t as 1 | 2 | 3]}\n\n${g.list.map(line).join("\n")}`)
  .join("\n")}
`;
}

/** Batuhan'ın düzeltmesi: önem seviyesi ve not (bilgi dosyası hemen güncellenir) */
export async function setPerson(key: string, patch: { override?: 1 | 2 | 3 | null; note?: string }) {
  const st = await readPeople();
  const p = st.people.find((x) => x.key === key);
  if (!p) throw new Error("Kişi bulunamadı");
  if (patch.override !== undefined) p.override = patch.override ?? undefined;
  if (patch.note !== undefined) p.note = patch.note.trim().slice(0, 300) || undefined;
  await store().setKV(KEY, st);
  await saveKnowledge(PEOPLE_FILE, peopleMd(st));
  return p;
}

/** Gönderen için kişi kaydı (e-posta ya da ada göre) */
export function findPerson(st: PeopleStore, who: { email?: string; name?: string }) {
  const e = who.email?.toLowerCase();
  if (e) {
    const p = st.people.find((x) => x.key === e);
    if (p) return p;
  }
  if (who.name) {
    const k = nameKey(who.name);
    const exact = st.people.find((x) => x.key === k || nameKey(x.name) === k);
    if (exact) return exact;
    // sohbette çoğu zaman yalnızca ad görünür ("Ceren"): tek bir kişiyle eşleşiyorsa o
    const first = k.slice(3).split(" ")[0];
    if (first.length >= 3 && !k.slice(3).includes(" ")) {
      const c = st.people.filter((x) => nameKey(x.name).slice(3).split(" ")[0] === first);
      if (c.length === 1) return c[0];
    }
  }
  return undefined;
}

export { statLine };
