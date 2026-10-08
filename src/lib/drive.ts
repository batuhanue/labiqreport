import "server-only";
import { GErr, type Get } from "./google";
import type { GFile } from "./google-types";
import { OFFICE_MIME, officeText } from "./officetext";

/**
 * Google Drive (salt okunur): dosya listeleme/arama, klasör gezinme ve dosya metni.
 * Metin: Google Dokümanlar/E-Tablolar/Slaytlar dışa aktarımla; Word/Excel/PowerPoint dosyaları indirilip
 * içindeki metin çıkarılır; düz metin dosyaları doğrudan okunur. PDF ve görsellerin yalnızca adı/bilgisi kullanılır.
 */
export const DRIVE = "https://www.googleapis.com/drive/v3";
const FIELDS = "id,name,mimeType,modifiedTime,webViewLink,size,owners(displayName,emailAddress),ownedByMe,lastModifyingUser(displayName),starred,driveId";
export const FOLDER = "application/vnd.google-apps.folder";

export const KIND: Record<string, string> = {
  "application/vnd.google-apps.document": "Google Dokümanlar",
  "application/vnd.google-apps.spreadsheet": "Google E-Tablolar",
  "application/vnd.google-apps.presentation": "Google Slaytlar",
  "application/vnd.google-apps.form": "Google Formlar",
  [FOLDER]: "Klasör",
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.ms-excel": "Excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
  "text/csv": "CSV",
  "text/plain": "Metin",
};
export const kindOf = (mime: string) => KIND[mime] ?? (mime.startsWith("image/") ? "Görsel" : mime.startsWith("video/") ? "Video" : mime.split("/").pop() ?? "Dosya");

type Raw = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
  size?: string;
  owners?: { displayName?: string; emailAddress?: string }[];
  ownedByMe?: boolean;
  lastModifyingUser?: { displayName?: string };
  starred?: boolean;
  driveId?: string;
};

export function mapFile(f: Raw): GFile {
  return {
    id: f.id,
    name: f.name,
    mime: f.mimeType,
    modified: f.modifiedTime,
    modifiedBy: f.lastModifyingUser?.displayName,
    owner: f.owners?.[0]?.displayName,
    link: f.webViewLink ?? `https://drive.google.com/open?id=${f.id}`,
    size: f.size ? Number(f.size) : undefined,
    folder: f.mimeType === FOLDER || undefined,
    shared: f.ownedByMe === false && !f.driveId ? true : undefined,
    starred: f.starred || undefined,
    drive: f.driveId,
  };
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export type DriveView = "recent" | "shared" | "starred" | "folder" | "search";

/** Liste / arama / klasör içeriği. */
export async function listFiles(get: Get, opts: { view: DriveView; q?: string; folder?: string; pageToken?: string; pageSize?: number; modifiedAfter?: string }) {
  const p = new URLSearchParams({
    fields: `nextPageToken,files(${FIELDS})`,
    pageSize: String(opts.pageSize ?? 50),
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const cond = ["trashed = false"];
  if (opts.view === "search" && opts.q?.trim()) {
    const t = esc(opts.q.trim());
    cond.push(`(name contains '${t}' or fullText contains '${t}')`);
    p.set("corpora", "allDrives");
  } else if (opts.view === "folder") {
    cond.push(`'${esc(opts.folder || "root")}' in parents`);
    p.set("orderBy", "folder,name");
  } else {
    if (opts.view === "shared") cond.push("sharedWithMe = true");
    else if (opts.view === "starred") cond.push("starred = true");
    else p.set("corpora", "allDrives");
    cond.push(`mimeType != '${FOLDER}'`);
    p.set("orderBy", "modifiedTime desc");
  }
  if (opts.modifiedAfter) cond.push(`modifiedTime > '${opts.modifiedAfter}'`);
  p.set("q", cond.join(" and "));
  if (opts.pageToken) p.set("pageToken", opts.pageToken);
  const j = await get<{ files?: Raw[]; nextPageToken?: string }>(`${DRIVE}/files?${p}`);
  return { files: (j.files ?? []).map(mapFile), next: j.nextPageToken ?? null };
}

export async function getFileMeta(get: Get, id: string) {
  return mapFile(await get<Raw>(`${DRIVE}/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${FIELDS}`));
}

const EXPORT: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};
const MAX_DOWNLOAD = 15 * 1024 * 1024;

/** Dosya metni okunabilir mi (dışa aktarma / Office / düz metin). */
export const readable = (f: Pick<GFile, "mime" | "size">) =>
  !!EXPORT[f.mime] || ((!!OFFICE_MIME[f.mime] || /^text\/|^application\/json$/.test(f.mime)) && (f.size ?? 0) <= MAX_DOWNLOAD);

async function raw(token: string, url: string) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(25000) });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    let msg = t;
    try {
      msg = JSON.parse(t).error?.message ?? t;
    } catch {}
    throw new GErr(msg.slice(0, 300) || `HTTP ${r.status}`, r.status);
  }
  return Buffer.from(await r.arrayBuffer());
}

/** Dosyanın düz metni; okunamıyorsa null. */
export async function fileText(token: string, f: Pick<GFile, "id" | "mime" | "size">, max = 200_000): Promise<string | null> {
  const id = encodeURIComponent(f.id);
  if (EXPORT[f.mime]) return (await raw(token, `${DRIVE}/files/${id}/export?mimeType=${encodeURIComponent(EXPORT[f.mime])}`)).toString("utf8").slice(0, max);
  if (!readable(f)) return null;
  const buf = await raw(token, `${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`);
  const office = OFFICE_MIME[f.mime];
  return (office ? officeText(buf, office) : buf.toString("utf8")).slice(0, max);
}
