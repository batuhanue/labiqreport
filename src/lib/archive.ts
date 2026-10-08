import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { promises as fs } from "fs";
import path from "path";
import type { ArchiveHit, ArchiveItem, ArchiveSource, ArchiveStats } from "./google-types";

/**
 * Google arşivi: e-posta, Chat mesajı, Meet transkripti ve takvim etkinlikleri kalıcı olarak birikir.
 * Postgres'te `google_archive` tablosu (tam metin araması için normalleştirilmiş `norm` sütunu + GIN dizini);
 * yerel geliştirmede .data/archive.json.
 */

/** Türkçe duyarsız arama için: küçük harf, aksan/çengel yok, ı→i. */
export const norm = (s: string) =>
  s
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i");

const STOP = new Set(["ve", "ile", "icin", "bir", "bu", "su", "da", "de", "mi", "mu", "ne", "neler", "nedir", "hangi", "olan", "gibi", "daha", "kadar", "son", "the", "and"]);

/** Sorgudaki anlamlı kelimeler (normalleştirilmiş, en fazla 8). */
export function terms(q: string) {
  return [...new Set(norm(q).split(/[^a-z0-9@._-]+/).map((t) => t.replace(/^[._-]+|[._-]+$/g, "")).filter((t) => t.length >= 2 && !STOP.has(t)))].slice(0, 8);
}

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
let ready: Promise<void> | null = null;
function pg(): NeonQueryFunction<false, false> {
  const sql = neon(url!);
  ready ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS google_archive (
      source text NOT NULL,
      id text NOT NULL,
      ts timestamptz NOT NULL,
      title text NOT NULL DEFAULT '',
      who text NOT NULL DEFAULT '',
      body text NOT NULL DEFAULT '',
      link text,
      meta jsonb,
      norm text NOT NULL DEFAULT '',
      PRIMARY KEY (source, id)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS google_archive_ts ON google_archive (ts DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS google_archive_fts ON google_archive USING gin (to_tsvector('simple', norm))`;
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return sql;
}

const normOf = (x: ArchiveItem) => norm(`${x.title} ${x.who} ${x.body}`).slice(0, 20000);

function excerpt(body: string, ts: string[], max = 700) {
  if (body.length <= max) return body;
  const n = norm(body);
  let at = -1;
  for (const t of ts) {
    const i = n.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, at < 0 ? 0 : at - 150);
  return (start > 0 ? "…" : "") + body.slice(start, start + max) + (start + max < body.length ? "…" : "");
}

// ------------------------------------------------------------------ dosya (yerel)
const file = path.join(process.cwd(), ".data", "archive.json");
async function readAll(): Promise<ArchiveItem[]> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return [];
  }
}
async function writeAll(items: ArchiveItem[]) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(items));
}

// ------------------------------------------------------------------ API
/**
 * Postgres metin/jsonb alanları NUL (\u0000) karakterini ve eşi olmayan UTF-16 vekillerini kabul etmez
 * ("unsupported Unicode escape sequence"); bazı Drive/Office dosyalarının metninde bulunur. Kayıttan önce temizlenir.
 */
const BAD_CHARS = /\u0000|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const cleanStr = (s: string) => s.replace(BAD_CHARS, "");
function clean<T>(v: T): T {
  if (typeof v === "string") return cleanStr(v) as T;
  if (Array.isArray(v)) return v.map(clean) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) as T;
  return v;
}

export async function upsertItems(raw: ArchiveItem[]) {
  if (!raw.length) return;
  const items = raw.map(clean);
  if (!url) {
    const all = await readAll();
    const idx = new Map(all.map((x, i) => [`${x.source}:${x.id}`, i]));
    for (const x of items) {
      const k = `${x.source}:${x.id}`;
      if (idx.has(k)) all[idx.get(k)!] = x;
      else idx.set(k, all.push(x) - 1);
    }
    return writeAll(all);
  }
  const sql = pg();
  await ready;
  type Row = ArchiveItem & { norm: string };
  const insert = (rows: Row[]) =>
    sql.query(
      `INSERT INTO google_archive (source, id, ts, title, who, body, link, meta, norm)
       SELECT source, id, ts, title, who, body, link, meta, norm
       FROM jsonb_to_recordset($1::jsonb) AS r(source text, id text, ts timestamptz, title text, who text, body text, link text, meta jsonb, norm text)
       ON CONFLICT (source, id) DO UPDATE SET ts = EXCLUDED.ts, title = EXCLUDED.title, who = EXCLUDED.who, body = EXCLUDED.body,
         link = EXCLUDED.link, meta = EXCLUDED.meta, norm = EXCLUDED.norm`,
      [JSON.stringify(rows)],
    );
  // tek istekte toplu ekleme (jsonb_to_recordset)
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100).map((x) => ({ ...x, meta: x.meta ?? null, link: x.link ?? null, norm: normOf(x) })) as Row[];
    try {
      await insert(chunk);
    } catch (e) {
      // bir kayıt yüzünden bütün parti takılmasın: tek tek dene, yazılamayanı metinsiz kaydet
      if (chunk.length === 1 && chunk[0].body === "") throw e;
      console.error("[archive] toplu kayıt başarısız, tek tek deneniyor:", e instanceof Error ? e.message : e);
      for (const row of chunk) {
        try {
          await insert([row]);
        } catch {
          await insert([{ ...row, body: "", norm: normOf({ ...row, body: "" }), meta: { ...(row.meta ?? {}), error: "metin kaydedilemedi" } }]).catch(() => {});
        }
      }
    }
  }
}

/** Verilen kimliklerden arşivde zaten olanlar. */
export async function existingIds(source: ArchiveSource, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  if (!url) {
    const all = await readAll();
    const want = new Set(ids);
    return new Set(all.filter((x) => x.source === source && want.has(x.id)).map((x) => x.id));
  }
  const sql = pg();
  await ready;
  const rows = (await sql.query(`SELECT id FROM google_archive WHERE source = $1 AND id = ANY($2::text[])`, [source, ids])) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

export interface SearchOpts {
  query?: string;
  source?: ArchiveSource;
  after?: string;
  before?: string;
  limit?: number;
}

export async function search(o: SearchOpts): Promise<ArchiveHit[]> {
  const ts = terms(o.query ?? "");
  const limit = Math.min(Math.max(o.limit ?? 15, 1), 40);
  const after = o.after && !isNaN(Date.parse(o.after)) ? new Date(o.after).toISOString() : null;
  const before = o.before && !isNaN(Date.parse(o.before)) ? new Date(Date.parse(o.before) + (o.before.length === 10 ? 86400000 : 0)).toISOString() : null;

  let rows: (ArchiveItem & { score?: number })[];
  if (!url) {
    const all = await readAll();
    rows = all
      .filter((x) => (!o.source || x.source === o.source) && (!after || x.ts >= after) && (!before || x.ts < before))
      .map((x) => {
        const n = normOf(x);
        return { ...x, score: ts.length ? ts.filter((t) => n.includes(t)).length : 1 };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.ts.localeCompare(a.ts))
      .slice(0, limit);
  } else {
    const sql = pg();
    await ready;
    const tsq = ts.map((t) => `${t.replace(/[^a-z0-9]/g, "")}:*`).filter((t) => t.length > 2).join(" | ");
    const where = ["($1::text IS NULL OR source = $1)", "($2::timestamptz IS NULL OR ts >= $2)", "($3::timestamptz IS NULL OR ts < $3)"];
    if (tsq) where.push("to_tsvector('simple', norm) @@ to_tsquery('simple', $4)");
    // alaka (eşleşen kelime sayısı) + yakınlık: son 30 gün ~ +1, bir yıl önce ~ +0.1
    const order = tsq
      ? "ts_rank(to_tsvector('simple', norm), to_tsquery('simple', $4)) * 10 + 1.0 / (1 + extract(epoch from (now() - ts)) / 2592000) DESC"
      : "ts DESC";
    rows = (await sql.query(
      `SELECT source, id, ts, title, who, body, link, meta FROM google_archive WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${limit}`,
      tsq ? [o.source ?? null, after, before, tsq] : [o.source ?? null, after, before],
    )) as ArchiveItem[];
  }
  return rows.map((x) => ({
    source: x.source,
    id: x.id,
    ts: new Date(x.ts).toISOString(),
    title: x.title,
    who: x.who,
    excerpt: excerpt(x.body, ts),
    link: x.link ?? undefined,
  }));
}

export async function getItem(source: ArchiveSource, id: string): Promise<ArchiveItem | null> {
  if (!url) return (await readAll()).find((x) => x.source === source && x.id === id) ?? null;
  const sql = pg();
  await ready;
  const rows = (await sql.query(`SELECT source, id, ts, title, who, body, link, meta FROM google_archive WHERE source = $1 AND id = $2`, [source, id])) as ArchiveItem[];
  return rows[0] ? { ...rows[0], ts: new Date(rows[0].ts).toISOString() } : null;
}

export async function stats(): Promise<ArchiveStats> {
  const out: ArchiveStats = { total: 0, bySource: {} };
  if (!url) {
    for (const x of await readAll()) {
      const s = (out.bySource[x.source] ??= { count: 0, oldest: x.ts });
      s.count++;
      if (x.ts < s.oldest) s.oldest = x.ts;
      out.total++;
    }
    return out;
  }
  const sql = pg();
  await ready;
  const rows = (await sql`SELECT source, count(*)::int AS n, min(ts) AS oldest FROM google_archive GROUP BY source`) as { source: ArchiveSource; n: number; oldest: string }[];
  for (const r of rows) {
    out.bySource[r.source] = { count: r.n, oldest: new Date(r.oldest).toISOString() };
    out.total += r.n;
  }
  return out;
}

export async function clearArchive() {
  if (!url) return writeAll([]);
  const sql = pg();
  await ready;
  await sql`DELETE FROM google_archive`;
}

// ------------------------------------------------------------------ listeleme (aylık / sohbet bazlı)
export interface ListRow {
  source: ArchiveSource;
  id: string;
  ts: string;
  title: string;
  who: string;
  preview: string;
  link?: string;
  meta?: Record<string, unknown> | null;
}
const toRow = (x: ArchiveItem, n = 220): ListRow => ({
  source: x.source,
  id: x.id,
  ts: new Date(x.ts).toISOString(),
  title: x.title,
  who: x.who,
  preview: x.body.replace(/\s+/g, " ").slice(0, n),
  link: x.link ?? undefined,
  meta: x.meta ?? null,
});

/** Kaynaktaki ayların listesi (YYYY-MM, İstanbul saatine göre) ve kayıt sayıları; yeniden eskiye. */
export async function months(source: ArchiveSource): Promise<{ month: string; count: number }[]> {
  if (!url) {
    const m = new Map<string, number>();
    for (const x of await readAll()) {
      if (x.source !== source) continue;
      const k = new Date(Date.parse(x.ts) + 3 * 3600000).toISOString().slice(0, 7);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, count]) => ({ month, count }));
  }
  const sql = pg();
  await ready;
  const rows = (await sql.query(
    `SELECT to_char(ts AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM') AS month, count(*)::int AS count
     FROM google_archive WHERE source = $1 GROUP BY 1 ORDER BY 1 DESC`,
    [source],
  )) as { month: string; count: number }[];
  return rows;
}

/** Bir aydaki kayıtlar (yeniden eskiye). */
export async function listMonth(source: ArchiveSource, month: string, limit = 1000): Promise<ListRow[]> {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const from = new Date(`${month}-01T00:00:00+03:00`);
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  if (!url) {
    return (await readAll())
      .filter((x) => x.source === source && x.ts >= from.toISOString() && Date.parse(x.ts) < to.getTime())
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, limit)
      .map((x) => toRow(x));
  }
  const sql = pg();
  await ready;
  const rows = (await sql.query(
    `SELECT source, id, ts, title, who, left(body, 400) AS body, link, meta FROM google_archive
     WHERE source = $1 AND ts >= $2 AND ts < $3 ORDER BY ts DESC LIMIT ${Math.min(limit, 2000)}`,
    [source, from.toISOString(), to.toISOString()],
  )) as ArchiveItem[];
  return rows.map((x) => toRow(x));
}

/** Aynı bağlantıya (ör. bir Chat sohbeti) ait kayıtlar; `before` verilirse ondan eskiler. Yeniden eskiye. */
export async function listByLink(source: ArchiveSource, link: string, before?: string, limit = 60): Promise<ListRow[]> {
  if (!url) {
    return (await readAll())
      .filter((x) => x.source === source && x.link === link && (!before || x.ts < before))
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, limit)
      .map((x) => toRow(x, 6000));
  }
  const sql = pg();
  await ready;
  const rows = (await sql.query(
    `SELECT source, id, ts, title, who, body, link, meta FROM google_archive
     WHERE source = $1 AND link = $2 AND ($3::timestamptz IS NULL OR ts < $3) ORDER BY ts DESC LIMIT ${Math.min(limit, 200)}`,
    [source, link, before ?? null],
  )) as ArchiveItem[];
  return rows.map((x) => toRow(x, 6000));
}

export interface ChatThread {
  link: string;
  title: string;
  kind?: string;
  last: string;
  count: number;
  lastWho: string;
  lastText: string;
}

/** Arşivdeki tüm Chat sohbetleri (son mesajıyla), en son aktif olandan başlayarak. */
export async function chatThreads(limit = 300): Promise<ChatThread[]> {
  if (!url) {
    const m = new Map<string, ChatThread>();
    for (const x of await readAll()) {
      if (x.source !== "chat" || !x.link) continue;
      const t = m.get(x.link);
      if (!t) m.set(x.link, { link: x.link, title: x.title, kind: x.meta?.kind as string | undefined, last: x.ts, count: 1, lastWho: x.who, lastText: x.body.slice(0, 160) });
      else {
        t.count++;
        if (x.ts > t.last) Object.assign(t, { last: x.ts, title: x.title, lastWho: x.who, lastText: x.body.slice(0, 160) });
      }
    }
    return [...m.values()].sort((a, b) => b.last.localeCompare(a.last)).slice(0, limit);
  }
  const sql = pg();
  await ready;
  const rows = (await sql.query(
    `SELECT DISTINCT ON (link) link, title, meta->>'kind' AS kind, ts AS last, who AS "lastWho", left(body, 160) AS "lastText",
       count(*) OVER (PARTITION BY link)::int AS count
     FROM google_archive WHERE source = 'chat' AND link IS NOT NULL ORDER BY link, ts DESC`,
  )) as ChatThread[];
  return rows
    .map((r) => ({ ...r, last: new Date(r.last).toISOString() }))
    .sort((a, b) => b.last.localeCompare(a.last))
    .slice(0, limit);
}
