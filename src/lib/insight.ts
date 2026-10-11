import "server-only";
import { listByLink, mailThread, mailWith, norm, search } from "./archive";
import type { Signal } from "./brain-types";
import { findPerson, measure, statLine, tierOf } from "./people";
import type { PeopleStore } from "./people-types";

/*
 * Önem değerlendirmesi için bağlam: beyin bir e-postayı/sohbeti yalnızca kendi metninden değil,
 * arşivden okunan geçmişle değerlendirir (yapay zekâsız, veritabanı sorguları):
 *  - gönderen kim: kişi haritasındaki seviye/rol, son 180 günde yazışma, Batuhan'ın ona yanıt oranı ve hızı
 *  - Batuhan doğrudan alıcı mı, CC'de mi, toplu gönderim mi
 *  - yazışmanın önceki iletileri (Batuhan ne demişti, bekleyen soru var mı)
 *  - sohbette: birebir mi, Batuhan'ın adı geçiyor mu, o sohbette ne kadar yazıyor
 *  - yüklenen şirket verisinde ilgili kayıt
 */

const DAY = 86400_000;
const TIER = { 1: "KRİTİK kişi", 2: "önemli kişi", 3: "rutin/düşük öncelikli kişi" } as const;
const REL: Record<string, string> = { yonetici: "Batuhan'ın yöneticisi", ust_yonetim: "üst yönetim", ekip: "ekip arkadaşı", is_birimi: "iş birimi", dis: "şirket dışı", otomatik: "otomatik/sistem gönderici", diger: "" };
const EMAIL = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const short = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "Europe/Istanbul" });

async function pool<T>(xs: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (i < xs.length) await fn(xs[i++]).catch(() => {});
  }));
}

function personLine(people: PeopleStore, who: { email?: string; name?: string }, live?: ReturnType<typeof measure>[number]) {
  const p = findPerson(people, who);
  const parts: string[] = [];
  if (p) {
    parts.push(`kişi haritasında ${TIER[tierOf(p)]}${p.override ? " (Batuhan belirledi)" : ""}`);
    if (p.role) parts.push(p.role);
    if (p.relation && REL[p.relation]) parts.push(REL[p.relation]);
    if (p.expects) parts.push(`genelde: ${p.expects}`);
    if (p.note) parts.push(`Batuhan'ın notu: ${p.note}`);
  } else parts.push("kişi haritasında yok (yeni ya da seyrek yazışan)");
  const s = live ?? p;
  const stats = s ? statLine(s) : "";
  return `Gönderen ${who.name || who.email}: ${parts.join(" · ")}${stats ? `. Son 180 gün: ${stats}` : ""}${s?.lastAt ? `; son etkileşim ${short(s.lastAt)}` : ""}.`;
}

/** E-posta sinyali için bağlam satırları */
async function mailContext(s: Signal, people: PeopleStore, self?: { email?: string; name?: string }) {
  const h = s.hint ?? {};
  const out: string[] = [];
  const me = self?.email?.toLowerCase();
  // gönderen ve ilişki ölçümü (canlı, bu kişinin yazışmalarından)
  let live: ReturnType<typeof measure>[number] | undefined;
  if (h.email) {
    const rows = await mailWith(h.email, new Date(Date.now() - 180 * DAY).toISOString());
    live = measure(rows, self?.email, self?.name).find((x) => x.key === h.email!.toLowerCase());
  }
  out.push(personLine(people, { email: h.email, name: h.name }, live));
  // alıcı durumu
  if (me && (h.to || h.cc)) {
    const to = (h.to?.match(EMAIL) ?? []).map((x) => x.toLowerCase());
    const cc = (h.cc?.match(EMAIL) ?? []).map((x) => x.toLowerCase());
    const n = new Set([...to, ...cc]).size;
    out.push(
      to.includes(me)
        ? `Batuhan doğrudan alıcı${to.length > 1 ? ` (${to.length} alıcıdan biri)` : " (tek alıcı)"}${n > 8 ? `; toplam ${n} kişiye gitmiş (toplu)` : ""}.`
        : cc.includes(me)
          ? `Batuhan yalnızca CC'de (${n} kişilik dağıtım) — bilgi amaçlı olabilir; içinde Batuhan'a özel istek var mı bak.`
          : `Batuhan alıcılar arasında görünmüyor (liste/grup adresi ya da BCC; ${n} alıcı).`,
    );
  }
  // yazışma geçmişi
  if (h.threadId) {
    const th = (await mailThread(h.threadId, 8, 260)).filter((x) => x.id !== s.ref?.id);
    if (th.length) {
      const mine = th.filter((x) => x.meta?.sent === true);
      out.push(
        `Bu yazışmada daha önce ${th.length} ileti var${mine.length ? `; Batuhan ${mine.length} kez yazmış (son: ${short(mine.at(-1)!.ts)})` : "; Batuhan henüz yazmamış"}:\n${th
          .slice(-4)
          .map((x) => `  · ${short(x.ts)} ${x.meta?.sent === true ? "Batuhan" : x.who.split(" <")[0]}: ${clip(x.body.replace(/\s+/g, " "), 220)}`)
          .join("\n")}`,
      );
    } else out.push("Yeni yazışma (öncesi yok).");
  }
  return out;
}

/** Sohbet sinyali için bağlam satırları */
async function chatContext(s: Signal, people: PeopleStore, self?: { email?: string; name?: string }) {
  const h = s.hint ?? {};
  const out: string[] = [];
  if (h.name) out.push(personLine(people, { name: h.name }));
  const first = self?.name?.split(" ")[0];
  const mention = first && norm(s.text).includes(norm(first));
  out.push(h.dm ? "Birebir (DM) sohbet — doğrudan Batuhan'a yazılmış." : `Grup alanı${mention ? "; mesajlarda Batuhan'ın adı geçiyor" : "; Batuhan'ın adı geçmiyor"}.`);
  if (h.space) {
    const rows = await listByLink("chat", h.space, undefined, 80);
    const recent = rows.filter((r) => Date.parse(r.ts) > Date.now() - 60 * DAY);
    const mine = recent.filter((r) => r.meta?.mine === true);
    if (recent.length) out.push(`Bu sohbette son 60 günde ${recent.length} mesaj; Batuhan ${mine.length} kez yazmış${mine[0] ? ` (son: ${short(mine[0].ts)})` : ""}.`);
  }
  return out;
}

/** Yüklenen şirket verisinde konuyla ilgili kayıt (varsa) */
async function companyContext(s: Signal) {
  const hits = await search({ query: s.title, source: "kurum", limit: 2 }).catch(() => []);
  return hits.length ? [`Şirket verisinde ilgili: ${hits.map((x) => `"${x.title}" — ${clip(x.excerpt.replace(/\s+/g, " "), 220)}`).join(" | ")}`] : [];
}

/**
 * Posta ve sohbet sinyallerine BAĞLAM ekler (metnin sonuna). Süre sınırlı: yetişmeyen sinyal bağlamsız kalır.
 */
export async function enrichSignals(signals: Signal[], people: PeopleStore, self?: { email?: string; name?: string }, budgetMs = 8000) {
  const deadline = Date.now() + budgetMs;
  let n = 0;
  await pool(signals, 5, async (s) => {
    if (Date.now() > deadline) return;
    const lines = [
      ...(s.agent === "posta" ? await mailContext(s, people, self) : s.agent === "sohbet" ? await chatContext(s, people, self) : []),
      ...(await companyContext(s)),
    ];
    if (!lines.length) return;
    s.text = `${s.text}\nBAĞLAM (arşivden ölçüldü):\n${lines.map((l) => `- ${l}`).join("\n")}`;
    n++;
  });
  return n;
}

