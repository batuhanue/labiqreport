import { handle } from "@/lib/api";
import { chatThreads, clearArchive, listByLink, listMonth, months, search } from "@/lib/archive";
import { archiveStep, progress, resetArchiveState } from "@/lib/google-archive";
import type { ArchiveSource } from "@/lib/google-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOURCES = ["gmail", "chat", "meet", "calendar", "drive"];

/**
 * İlerleme; ?q= / source / after / before → arama;
 * ?months=gmail → ay listesi; ?source=gmail&month=YYYY-MM → o ayın kayıtları;
 * ?source=chat&link=…[&before=ISO] → bir sohbetin mesajları.
 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const src = p.get("source") ?? p.get("months");
  const valid = src && SOURCES.includes(src) ? (src as ArchiveSource) : null;
  if (p.has("threads")) return handle(async () => ({ threads: await chatThreads() }));
  if (p.has("months") && valid) return handle(async () => ({ months: await months(valid) }));
  if (p.has("month") && valid) return handle(async () => ({ rows: await listMonth(valid, p.get("month")!) }));
  if (p.has("link") && valid) return handle(async () => ({ rows: await listByLink(valid, p.get("link")!, p.get("before") ?? undefined) }));
  if (p.has("q") || p.has("source") || p.has("after") || p.has("before")) {
    const source = p.get("source");
    return handle(async () => ({
      hits: await search({
        query: p.get("q") ?? undefined,
        source: source && SOURCES.includes(source) ? (source as ArchiveSource) : undefined,
        after: p.get("after") ?? undefined,
        before: p.get("before") ?? undefined,
        limit: 30,
      }),
    }));
  }
  return handle(progress);
}

/** Geçmişten bir parça daha indirir (≈40 sn). */
export async function POST() {
  return handle(() => archiveStep({ budgetMs: 40000 }));
}

/** Arşivi tamamen siler (bağlantı kalır; sonraki adımlar baştan indirir). */
export async function DELETE() {
  return handle(async () => {
    await clearArchive();
    await resetArchiveState();
    return progress();
  });
}
