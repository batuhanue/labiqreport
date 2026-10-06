import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { promises as fs } from "fs";
import path from "path";
import { normalizePeriod, summarize } from "./period";
import type { AppState, PeriodData, PeriodSummary } from "./types";

/**
 * Depolama: Vercel'de Neon Postgres (Vercel Marketplace → Storage → Neon).
 * DATABASE_URL tanımlı değilse yerel geliştirmede .data/ klasörüne JSON yazar.
 */
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

interface Store {
  listPeriods(): Promise<PeriodSummary[]>;
  getPeriod(period: string): Promise<PeriodData | null>;
  savePeriod(data: PeriodData): Promise<void>;
  deletePeriod(period: string): Promise<void>;
  getState(): Promise<AppState>;
  setState(s: AppState): Promise<void>;
  getKV<T>(key: string): Promise<T | null>;
  setKV(key: string, value: unknown): Promise<void>;
  listSubs(): Promise<StoredSub[]>;
  addSub(sub: StoredSub): Promise<void>;
  removeSub(endpoint: string): Promise<void>;
}

export interface StoredSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  device: string;
  createdAt: string;
}

// ---------------------------------------------------------------- Postgres
let ready: Promise<void> | null = null;
function pg(): NeonQueryFunction<false, false> {
  const sql = neon(url!);
  ready ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS periods (
      period text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS app_state (
      key text PRIMARY KEY,
      value jsonb NOT NULL
    )`;
    await sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint text PRIMARY KEY,
      data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return sql;
}

const pgStore: Store = {
  async listPeriods() {
    const sql = pg();
    await ready;
    const rows = (await sql`SELECT data FROM periods ORDER BY period DESC`) as { data: PeriodData }[];
    return rows.map((r) => summarize(normalizePeriod(r.data)));
  },
  async getPeriod(period) {
    const sql = pg();
    await ready;
    const rows = (await sql`SELECT data FROM periods WHERE period = ${period}`) as { data: PeriodData }[];
    return rows[0] ? normalizePeriod(rows[0].data) : null;
  },
  async savePeriod(data) {
    const sql = pg();
    await ready;
    await sql`INSERT INTO periods (period, data, updated_at) VALUES (${data.period}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (period) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  },
  async deletePeriod(period) {
    const sql = pg();
    await ready;
    await sql`DELETE FROM periods WHERE period = ${period}`;
  },
  async getState() {
    const sql = pg();
    await ready;
    const rows = (await sql`SELECT value FROM app_state WHERE key = 'app'`) as { value: AppState }[];
    return rows[0]?.value ?? { activePeriod: null };
  },
  async setState(s) {
    const sql = pg();
    await ready;
    await sql`INSERT INTO app_state (key, value) VALUES ('app', ${JSON.stringify(s)}::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  },
  async getKV<T>(key: string) {
    const sql = pg();
    await ready;
    const rows = (await sql`SELECT value FROM app_state WHERE key = ${key}`) as { value: T }[];
    return rows[0]?.value ?? null;
  },
  async setKV(key, value) {
    const sql = pg();
    await ready;
    await sql`INSERT INTO app_state (key, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  },
  async listSubs() {
    const sql = pg();
    await ready;
    const rows = (await sql`SELECT data FROM push_subscriptions`) as { data: StoredSub }[];
    return rows.map((r) => r.data);
  },
  async addSub(sub) {
    const sql = pg();
    await ready;
    await sql`INSERT INTO push_subscriptions (endpoint, data) VALUES (${sub.endpoint}, ${JSON.stringify(sub)}::jsonb)
      ON CONFLICT (endpoint) DO UPDATE SET data = EXCLUDED.data`;
  },
  async removeSub(endpoint) {
    const sql = pg();
    await ready;
    await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
  },
};

// ---------------------------------------------------------------- Yerel dosya
const dir = path.join(process.cwd(), ".data");
const fileOf = (p: string) => path.join(dir, `period-${p}.json`);
async function readJson<T>(f: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(f, "utf8")) as T;
  } catch {
    return null;
  }
}
async function writeJson(f: string, v: unknown) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(f, JSON.stringify(v, null, 2));
}

const fileStore: Store = {
  async listPeriods() {
    await fs.mkdir(dir, { recursive: true });
    const files = (await fs.readdir(dir)).filter((f) => f.startsWith("period-")).sort().reverse();
    const out: PeriodSummary[] = [];
    for (const f of files) {
      const d = await readJson<PeriodData>(path.join(dir, f));
      if (d) out.push(summarize(normalizePeriod(d)));
    }
    return out;
  },
  async getPeriod(period) {
    const d = await readJson<PeriodData>(fileOf(period));
    return d ? normalizePeriod(d) : null;
  },
  savePeriod: (data) => writeJson(fileOf(data.period), data),
  async deletePeriod(period) {
    await fs.rm(fileOf(period), { force: true });
  },
  async getState() {
    return (await readJson<AppState>(path.join(dir, "state.json"))) ?? { activePeriod: null };
  },
  setState: (s) => writeJson(path.join(dir, "state.json"), s),
  async getKV<T>(key: string) {
    return readJson<T>(path.join(dir, `kv-${key}.json`));
  },
  setKV: (key, value) => writeJson(path.join(dir, `kv-${key}.json`), value),
  async listSubs() {
    return (await readJson<StoredSub[]>(path.join(dir, "subs.json"))) ?? [];
  },
  async addSub(sub) {
    const all = (await fileStore.listSubs()).filter((x) => x.endpoint !== sub.endpoint);
    await writeJson(path.join(dir, "subs.json"), [...all, sub]);
  },
  async removeSub(endpoint) {
    const all = (await fileStore.listSubs()).filter((x) => x.endpoint !== endpoint);
    await writeJson(path.join(dir, "subs.json"), all);
  },
};

export class StorageNotConfigured extends Error {}

export function store(): Store {
  if (url) return pgStore;
  if (process.env.VERCEL) {
    throw new StorageNotConfigured(
      "Veritabanı bağlı değil. Vercel projesinde Storage → Neon (Postgres) ekleyin ve yeniden dağıtın.",
    );
  }
  return fileStore;
}
