import "server-only";
import { store } from "./db";
import type { GAccount, GChatMsg, GChatSpace, GEvent, GMail, GMeeting, GoogleSnapshot, GoogleStatus } from "./google-types";

/**
 * Google Workspace entegrasyonu (salt okunur): Takvim, Gmail, Chat, Meet.
 * OAuth 2.0 yetkilendirme kodu akışı; yenileme belirteci şifrelenip KV'de ("google-auth") tutulur,
 * son senkron görüntüsü KV'de ("google-data") saklanır.
 */

export const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.messages.readonly",
  "https://www.googleapis.com/auth/chat.memberships.readonly",
  "https://www.googleapis.com/auth/meetings.space.readonly",
  "https://www.googleapis.com/auth/directory.readonly",
];

const CLIENT_ID = () => process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
const CLIENT_SECRET = () => process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
export const googleConfigured = () => !!(CLIENT_ID() && CLIENT_SECRET());
export const redirectUri = (origin: string) => process.env.GOOGLE_REDIRECT_URI?.trim() || `${origin}/api/google/callback`;

const AUTH_KEY = "google-auth";
const DATA_KEY = "google-data";
const PEOPLE_KEY = "google-people";

export interface StoredAuth {
  /** AES-GCM ile şifreli yenileme belirteci (base64 iv + veri) */
  refresh: string;
  access?: string;
  accessExp?: number;
  sub: string;
  account: GAccount;
  scopes: string[];
  connectedAt: string;
  needsReauth?: boolean;
}

// ------------------------------------------------------------------ şifreleme
async function aesKey() {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${CLIENT_SECRET()}:labiq-google-token`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(text)));
  return Buffer.concat([Buffer.from(iv), Buffer.from(enc)]).toString("base64");
}
async function open(b64: string) {
  const buf = Buffer.from(b64, "base64");
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.subarray(0, 12) }, await aesKey(), buf.subarray(12));
  return new TextDecoder().decode(dec);
}

// ------------------------------------------------------------------ OAuth
export function authUrl(origin: string, state: string, loginHint?: string) {
  const q = new URLSearchParams({
    client_id: CLIENT_ID(),
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) q.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(params: Record<string, string>) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID(), client_secret: CLIENT_SECRET(), ...params }),
    cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
  if (!r.ok || !j.access_token) throw Object.assign(new Error(j.error_description || j.error || `Google belirteç hatası ${r.status}`), { code: j.error });
  return j;
}

/** Callback: kodu belirtece çevirir, hesap bilgisini alır ve kaydeder. */
export async function completeAuth(code: string, origin: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(origin) });
  const prev = await store().getKV<StoredAuth>(AUTH_KEY);
  const refresh = t.refresh_token ?? (prev?.refresh ? await open(prev.refresh) : null);
  if (!refresh) throw new Error("Google yenileme belirteci vermedi. Hesabın izinlerini kaldırıp (myaccount.google.com/permissions) yeniden bağlan.");
  const u = (await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` }, cache: "no-store" })).json()) as {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
  };
  const auth: StoredAuth = {
    refresh: await seal(refresh),
    access: t.access_token,
    accessExp: Date.now() + (t.expires_in ?? 3600) * 1000,
    sub: u.sub,
    account: { email: u.email, name: u.name || u.email, picture: u.picture },
    scopes: (t.scope ?? "").split(" ").filter(Boolean),
    connectedAt: new Date().toISOString(),
  };
  await store().setKV(AUTH_KEY, auth);
  return auth.account;
}

async function accessToken(auth: StoredAuth) {
  if (auth.access && auth.accessExp && auth.accessExp - 90_000 > Date.now()) return auth.access;
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: await open(auth.refresh) });
    auth.access = t.access_token!;
    auth.accessExp = Date.now() + (t.expires_in ?? 3600) * 1000;
    auth.needsReauth = false;
    await store().setKV(AUTH_KEY, auth);
    return auth.access;
  } catch (e) {
    if ((e as { code?: string }).code === "invalid_grant" || (e as Error).name === "OperationError") {
      auth.needsReauth = true;
      await store().setKV(AUTH_KEY, auth);
      throw new Error("Google yetkisi geçersiz oldu (şifre değişikliği ya da izin kaldırma). Hesabı yeniden bağla.");
    }
    throw e;
  }
}

export async function disconnect() {
  const auth = await store().getKV<StoredAuth>(AUTH_KEY);
  if (auth?.refresh) {
    try {
      const token = await open(auth.refresh);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", cache: "no-store" });
    } catch {}
  }
  await store().setKV(AUTH_KEY, null);
  await store().setKV(DATA_KEY, null);
}

export async function status(origin: string, withData = true): Promise<GoogleStatus> {
  const configured = googleConfigured();
  const auth = await store().getKV<StoredAuth>(AUTH_KEY);
  return {
    configured,
    connected: !!auth?.refresh,
    needsReauth: auth?.needsReauth,
    account: auth?.account,
    scopes: auth?.scopes,
    snapshot: withData && auth?.refresh ? await store().getKV<GoogleSnapshot>(DATA_KEY) : null,
    redirectUri: redirectUri(origin),
  };
}

export const getSnapshot = () => store().getKV<GoogleSnapshot>(DATA_KEY);

/** Bağlı hesap için geçerli belirteçli istek fonksiyonu. */
export async function authed() {
  const auth = await store().getKV<StoredAuth>(AUTH_KEY);
  if (!auth?.refresh) throw new Error("Google hesabı bağlı değil");
  return { auth, get: api(await accessToken(auth)) };
}

// ------------------------------------------------------------------ API yardımcıları
class GErr extends Error {
  constructor(
    msg: string,
    public status: number,
  ) {
    super(msg);
  }
}

export function api(token: string) {
  return async <T>(url: string): Promise<T> => {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      let msg = t;
      try {
        msg = JSON.parse(t).error?.message ?? t;
      } catch {}
      throw new GErr(msg.slice(0, 300) || `HTTP ${r.status}`, r.status);
    }
    return r.json() as Promise<T>;
  };
}

/** sınırlı eşzamanlılıkla map */
export async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

export function explain(source: string, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  const st = e instanceof GErr ? e.status : 0;
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(msg)) return `${source} API'si Google Cloud projesinde etkin değil. Cloud Console → APIs & Services → Library'den etkinleştir. (${msg.slice(0, 120)})`;
  if (st === 403 && /scope|insufficient/i.test(msg)) return `${source} için izin verilmemiş. Hesabı yeniden bağlarken tüm kutuları işaretle.`;
  if (source === "Chat" && /Chat app not found|configure/i.test(msg)) return "Google Chat API yapılandırması eksik: Cloud Console → Google Chat API → Configuration sayfasında uygulama adı/simge/açıklama girip kaydet.";
  return `${source}: ${msg}`;
}

export const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");

export function parseFrom(v: string) {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim() || m[2], email: m[2] } : { name: v.trim(), email: v.trim() };
}

// ------------------------------------------------------------------ kaynaklar
export type Get = ReturnType<typeof api>;

type RawEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink: string;
  hangoutLink?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: { email: string; displayName?: string; responseStatus?: string; self?: boolean; resource?: boolean }[];
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] };
};

/** Takvim API olayını uygulama modeline çevirir. */
export function mapEvent(raw: unknown): GEvent {
  const e = raw as RawEvent;
  return {
    id: e.id,
    title: e.summary || "(başlıksız)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    allDay: !e.start?.dateTime,
    location: e.location,
    description: e.description ? decode(e.description.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 500) : undefined,
    meet: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri,
    link: e.htmlLink,
    organizer: e.organizer?.self ? undefined : e.organizer?.displayName || e.organizer?.email,
    attendees: (e.attendees ?? []).filter((a) => !a.resource && !a.self).slice(0, 30).map((a) => ({ name: a.displayName || a.email.split("@")[0], email: a.email, status: a.responseStatus })),
    response: e.attendees?.find((a) => a.self)?.responseStatus,
  };
}

async function syncCalendar(get: Get): Promise<GEvent[]> {
  const now = Date.now();
  const q = new URLSearchParams({
    timeMin: new Date(now - 7 * 86400000).toISOString(),
    timeMax: new Date(now + 45 * 86400000).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
    timeZone: "Europe/Istanbul",
  });
  const j = await get<{ items?: RawEvent[] }>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`);
  return (j.items ?? []).filter((e) => e.status !== "cancelled").map(mapEvent);
}

async function syncGmail(get: Get, email: string): Promise<{ items: GMail[]; unread?: number }> {
  const base = "https://gmail.googleapis.com/gmail/v1/users/me";
  const [list, inbox] = await Promise.all([
    get<{ messages?: { id: string; threadId: string }[] }>(`${base}/messages?maxResults=40&q=${encodeURIComponent("in:inbox newer_than:21d")}`),
    get<{ messagesUnread?: number }>(`${base}/labels/INBOX`).catch(() => ({ messagesUnread: undefined })),
  ]);
  type M = { id: string; threadId: string; snippet?: string; labelIds?: string[]; internalDate?: string; payload?: { headers?: { name: string; value: string }[] } };
  const msgs = await pool(list.messages ?? [], 8, (m) =>
    get<M>(`${base}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`).catch(() => null),
  );
  const items = msgs
    .filter((m): m is M => !!m)
    .map((m) => {
      const h = (n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
      const f = parseFrom(h("from"));
      return {
        id: m.id,
        threadId: m.threadId,
        from: f.name,
        fromEmail: f.email,
        subject: h("subject") || "(konu yok)",
        snippet: decode(m.snippet ?? ""),
        date: new Date(Number(m.internalDate ?? 0)).toISOString(),
        unread: !!m.labelIds?.includes("UNREAD"),
        important: !!m.labelIds?.includes("IMPORTANT"),
        link: `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${m.threadId}`,
      };
    });
  return { items, unread: inbox.messagesUnread };
}

/** users/{id} → ad; People API (dizin) ile çözülür, sonuç KV'de önbelleklenir. */
export async function resolveNames(get: Get, ids: string[]) {
  const cache = (await store().getKV<Record<string, string>>(PEOPLE_KEY)) ?? {};
  const missing = [...new Set(ids)].filter((id) => !cache[id]).slice(0, 150);
  if (missing.length) {
    try {
      const q = new URLSearchParams({ personFields: "names,emailAddresses" });
      for (const s of ["READ_SOURCE_TYPE_PROFILE", "READ_SOURCE_TYPE_DOMAIN_CONTACT", "READ_SOURCE_TYPE_CONTACT"]) q.append("sources", s);
      for (const id of missing) q.append("resourceNames", `people/${id}`);
      const j = await get<{ responses?: { requestedResourceName: string; person?: { names?: { displayName: string }[]; emailAddresses?: { value: string }[] } }[] }>(
        `https://people.googleapis.com/v1/people:batchGet?${q}`,
      );
      for (const r of j.responses ?? []) {
        const id = r.requestedResourceName.replace("people/", "");
        const n = r.person?.names?.[0]?.displayName || r.person?.emailAddresses?.[0]?.value;
        if (n) cache[id] = n;
      }
      await store().setKV(PEOPLE_KEY, cache);
    } catch {}
  }
  return cache;
}

async function syncChat(get: Get, sub: string): Promise<GChatSpace[]> {
  const base = "https://chat.googleapis.com/v1";
  type Space = { name: string; displayName?: string; spaceType?: string; type?: string; lastActiveTime?: string; singleUserBotDm?: boolean };
  const j = await get<{ spaces?: Space[] }>(`${base}/spaces?pageSize=100`);
  const since = Date.now() - 21 * 86400000;
  const spaces = (j.spaces ?? [])
    .filter((s) => !s.singleUserBotDm && (!s.lastActiveTime || Date.parse(s.lastActiveTime) > since))
    .sort((a, b) => (b.lastActiveTime ?? "").localeCompare(a.lastActiveTime ?? ""))
    .slice(0, 15);

  type Msg = { name: string; sender?: { name?: string; type?: string }; text?: string; formattedText?: string; createTime: string; attachment?: unknown[] };
  const filter = encodeURIComponent(`createTime > "${new Date(since).toISOString()}"`);
  const raw = await pool(spaces, 5, async (s) => {
    const kind = (s.spaceType ?? (s.type === "DM" ? "DIRECT_MESSAGE" : "SPACE")) as GChatSpace["kind"];
    const [msgs, members] = await Promise.all([
      get<{ messages?: Msg[] }>(`${base}/${s.name}/messages?pageSize=15&orderBy=${encodeURIComponent("createTime desc")}&filter=${filter}`).catch(() => ({ messages: [] as Msg[] })),
      kind !== "SPACE" && !s.displayName
        ? get<{ memberships?: { member?: { name?: string; type?: string } }[] }>(`${base}/${s.name}/members?pageSize=10`).catch(() => ({ memberships: [] }))
        : Promise.resolve({ memberships: [] as { member?: { name?: string; type?: string } }[] }),
    ]);
    return { s, kind, msgs: msgs.messages ?? [], others: (members.memberships ?? []).map((m) => m.member?.name).filter((n): n is string => !!n && n !== `users/${sub}`) };
  });

  const ids = raw.flatMap((r) => [...r.msgs.map((m) => m.sender?.name ?? ""), ...r.others]).filter((n) => n.startsWith("users/")).map((n) => n.slice(6));
  const names = await resolveNames(get, ids);
  const nameOf = (n?: string) => (n ? names[n.replace("users/", "")] ?? "Bir kişi" : "Bilinmeyen");

  return raw
    .map(({ s, kind, msgs, others }) => {
      const id = s.name.replace("spaces/", "");
      const messages: GChatMsg[] = msgs
        .map((m) => ({
          id: m.name,
          sender: m.sender?.name === `users/${sub}` ? "Sen" : m.sender?.type === "BOT" ? "Uygulama" : nameOf(m.sender?.name),
          mine: m.sender?.name === `users/${sub}`,
          text: (m.text || (m.attachment?.length ? "📎 Ek" : "")).slice(0, 1200),
          time: m.createTime,
        }))
        .reverse();
      return {
        id,
        title: s.displayName || others.map(nameOf).join(", ") || "Doğrudan mesaj",
        kind,
        lastActive: s.lastActiveTime ?? messages.at(-1)?.time,
        link: `https://mail.google.com/chat/u/0/#chat/${kind === "DIRECT_MESSAGE" ? "dm" : "space"}/${id}`,
        messages,
      };
    })
    .filter((s) => s.messages.length);
}

async function syncMeet(get: Get, events: GEvent[]): Promise<GMeeting[]> {
  const base = "https://meet.googleapis.com/v2";
  const since = new Date(Date.now() - 21 * 86400000).toISOString();
  type Rec = { name: string; startTime: string; endTime?: string; space?: string };
  const j = await get<{ conferenceRecords?: Rec[] }>(`${base}/conferenceRecords?pageSize=25&filter=${encodeURIComponent(`start_time>="${since}"`)}`);
  const recs = (j.conferenceRecords ?? []).sort((a, b) => b.startTime.localeCompare(a.startTime)).slice(0, 20);

  const byCode = new Map<string, GEvent>();
  for (const e of events) {
    const code = e.meet?.match(/meet\.google\.com\/([a-z-]+)/)?.[1];
    if (code) byCode.set(code, e);
  }
  type Part = { signedinUser?: { displayName?: string }; anonymousUser?: { displayName?: string }; phoneUser?: { displayName?: string } };
  type Tr = { name: string; state?: string; docsDestination?: { exportUri?: string } };

  return pool(recs, 4, async (r): Promise<GMeeting> => {
    const [space, parts, trs, recsOut] = await Promise.all([
      r.space ? get<{ meetingCode?: string }>(`${base}/${r.space}`).catch(() => ({ meetingCode: undefined })) : Promise.resolve({ meetingCode: undefined }),
      get<{ participants?: Part[] }>(`${base}/${r.name}/participants?pageSize=50`).catch(() => ({ participants: [] as Part[] })),
      get<{ transcripts?: Tr[] }>(`${base}/${r.name}/transcripts`).catch(() => ({ transcripts: [] as Tr[] })),
      get<{ recordings?: { driveDestination?: { exportUri?: string } }[] }>(`${base}/${r.name}/recordings`).catch(() => ({ recordings: [] })),
    ]);
    const ev = space.meetingCode ? byCode.get(space.meetingCode) : undefined;
    return {
      id: r.name,
      code: space.meetingCode,
      title: ev?.title,
      start: r.startTime,
      end: r.endTime,
      participants: [...new Set((parts.participants ?? []).map((p) => p.signedinUser?.displayName || p.anonymousUser?.displayName || p.phoneUser?.displayName || "").filter(Boolean))],
      transcripts: (trs.transcripts ?? []).map((t) => ({ url: t.docsDestination?.exportUri, state: t.state, name: t.name })),
      recordings: (recsOut.recordings ?? []).map((x) => ({ url: x.driveDestination?.exportUri })),
    };
  }).then(async (meetings) => {
    // son 4 toplantının transkript metni (asistanın okuyabilmesi için)
    await pool(meetings.slice(0, 4), 2, async (m) => {
      const tr = m.transcripts.find((t) => t.name && t.state !== "STARTED");
      if (!tr?.name) return;
      try {
        type Entry = { participant?: string; text?: string };
        const e = await get<{ transcriptEntries?: Entry[] }>(`${base}/${tr.name}/entries?pageSize=100`);
        const pids = [...new Set((e.transcriptEntries ?? []).map((x) => x.participant).filter((p): p is string => !!p))];
        const pn: Record<string, string> = {};
        await pool(pids.slice(0, 12), 4, async (p) => {
          const x = await get<Part>(`${base}/${p}`).catch(() => null);
          pn[p] = x?.signedinUser?.displayName || x?.anonymousUser?.displayName || "Katılımcı";
        });
        m.transcriptText = (e.transcriptEntries ?? [])
          .map((x) => `${pn[x.participant ?? ""] ?? "Katılımcı"}: ${x.text ?? ""}`)
          .join("\n")
          .slice(0, 6000);
      } catch {}
    });
    for (const m of meetings) m.transcripts = m.transcripts.map(({ url, state }) => ({ url, state }));
    return meetings;
  });
}

// ------------------------------------------------------------------ senkron
let running: Promise<GoogleSnapshot> | null = null;

export async function sync(opts: { force?: boolean } = {}): Promise<GoogleSnapshot> {
  const auth = await store().getKV<StoredAuth>(AUTH_KEY);
  if (!auth?.refresh) throw new Error("Google hesabı bağlı değil");
  if (!opts.force) {
    const prev = await getSnapshot();
    if (prev && Date.now() - Date.parse(prev.syncedAt) < 30_000) return prev;
  }
  running ??= (async () => {
    const t0 = Date.now();
    const get = api(await accessToken(auth));
    const settle = async <T>(source: string, p: Promise<T>) => {
      try {
        return { v: await p };
      } catch (e) {
        return { error: explain(source, e) };
      }
    };
    const cal = await settle("Takvim", syncCalendar(get));
    const [gm, ch, mt] = await Promise.all([
      settle("Gmail", syncGmail(get, auth.account.email)),
      settle("Chat", syncChat(get, auth.sub)),
      settle("Meet", syncMeet(get, cal.v ?? [])),
    ]);
    const snap: GoogleSnapshot = {
      syncedAt: new Date().toISOString(),
      ms: Date.now() - t0,
      account: auth.account,
      calendar: { items: cal.v ?? [], error: cal.error },
      gmail: { items: gm.v?.items ?? [], unread: gm.v?.unread, error: gm.error },
      chat: { items: ch.v ?? [], error: ch.error },
      meet: { items: mt.v ?? [], error: mt.error },
    };
    await store().setKV(DATA_KEY, snap);
    return snap;
  })().finally(() => {
    running = null;
  });
  return running;
}

// ------------------------------------------------------------------ asistan bağlamı
const trTime = (s: string) => new Date(s).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function googleSection(s: GoogleSnapshot) {
  const L = [`### Google Workspace (${s.account.email}) — son senkron ${trTime(s.syncedAt)}`];
  const now = Date.now();
  const upcoming = s.calendar.items.filter((e) => Date.parse(e.end) >= now - 3600000 && Date.parse(e.start) <= now + 10 * 86400000).slice(0, 40);
  if (upcoming.length) {
    L.push("", "#### Takvim (bugün + 10 gün)");
    for (const e of upcoming)
      L.push(
        `- ${e.allDay ? e.start + " (tüm gün)" : trTime(e.start) + "–" + new Date(e.end).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" })} · ${e.title}` +
          `${e.meet ? " · Meet" : ""}${e.location ? ` · yer: ${e.location}` : ""}${e.organizer ? ` · düzenleyen: ${e.organizer}` : ""}` +
          `${e.attendees.length ? ` · katılımcı: ${e.attendees.slice(0, 8).map((a) => a.name).join(", ")}${e.attendees.length > 8 ? "…" : ""}` : ""}` +
          `${e.response && e.response !== "accepted" ? ` · yanıtın: ${e.response}` : ""}${e.description ? ` · açıklama: ${e.description.slice(0, 200)}` : ""}`,
      );
  }
  if (s.gmail.items.length) {
    L.push("", `#### Gmail gelen kutusu — okunmamış ${s.gmail.unread ?? s.gmail.items.filter((m) => m.unread).length} (son e-postalar)`);
    for (const m of s.gmail.items.slice(0, 30))
      L.push(`- ${m.unread ? "[OKUNMADI] " : ""}${m.important ? "[ÖNEMLİ] " : ""}${trTime(m.date)} · ${m.from} <${m.fromEmail}> · "${m.subject}" — ${m.snippet.slice(0, 220)}`);
  }
  if (s.chat.items.length) {
    L.push("", "#### Google Chat (son mesajlar)");
    for (const sp of s.chat.items.slice(0, 10)) {
      L.push(`- ${sp.kind === "DIRECT_MESSAGE" ? "DM" : "Alan"}: ${sp.title}`);
      for (const m of sp.messages.slice(-6)) L.push(`  - ${trTime(m.time)} ${m.sender}: ${m.text.replace(/\s+/g, " ").slice(0, 280)}`);
    }
  }
  if (s.meet.items.length) {
    L.push("", "#### Google Meet (son toplantılar)");
    for (const m of s.meet.items.slice(0, 10)) {
      L.push(`- ${trTime(m.start)} · ${m.title ?? m.code ?? "Toplantı"}${m.participants.length ? ` · katılanlar: ${m.participants.join(", ")}` : ""}${m.transcripts.length ? " · transkript var" : ""}`);
      if (m.transcriptText) L.push(`  Transkript (başı):\n  ${m.transcriptText.slice(0, 3500).replace(/\n/g, "\n  ")}`);
    }
  }
  const errs = (["calendar", "gmail", "chat", "meet"] as const).filter((k) => s[k].error);
  if (errs.length) L.push("", `(Senkron edilemeyen kaynaklar: ${errs.map((k) => s[k].error).join(" | ")})`);
  return L.join("\n");
}
