import "server-only";
import { existingIds, stats, upsertItems } from "./archive";
import { store } from "./db";
import { fileText, kindOf, listFiles, readable } from "./drive";
import { authed, decode, DRIVE_SCOPE, status as googleStatus, explain, getSnapshot, mapEvent, parseFrom, pool, resolveNames, type Get } from "./google";
import type { ArchiveItem, ArchiveProgress, ArchiveSource, GEvent, GFile } from "./google-types";

/**
 * Geriye dönük arşiv senkronu. Her çağrı bir zaman bütçesi içinde çalışır:
 *  1) ileri: son çalıştırmadan beri gelen yeni e-posta / Chat mesajı / toplantı
 *  2) geri: geçmişi sayfa sayfa indirir (sayfa belirteci KV'de saklanır, kaldığı yerden devam eder)
 * Aynı öğe iki kez gelirse upsert ile üzerine yazılır; böylece kesintiler veri kaybettirmez.
 */

const STATE_KEY = "google-archive-state";
const LOCK_KEY = "google-archive-lock";
const TITLES_KEY = "google-meet-titles";

interface SpaceState {
  title: string;
  kind: string;
  link: string;
  lastActive?: string;
  newest?: string;
  back?: string | null;
  done?: boolean;
}
interface State {
  startedAt: string;
  gmail: { newest?: number; back?: string | null; done?: boolean };
  chat: { spaces: Record<string, SpaceState>; listedAt?: string };
  meet: { back?: string | null; done?: boolean; recentAt?: string };
  calendar: { back?: string | null; done?: boolean };
  drive: { newest?: string; back?: string | null; done?: boolean };
  errors: Partial<Record<ArchiveSource, string>>;
  /** arşive en son işlenen anlık görüntü (takvim değişiklikleri için) */
  snapAt?: string;
  updatedAt?: string;
}

const fresh = (): State => ({ startedAt: new Date().toISOString(), gmail: {}, chat: { spaces: {} }, meet: {}, calendar: {}, drive: {}, errors: {} });

export async function progress(): Promise<ArchiveProgress> {
  const st = await store().getKV<State>(STATE_KEY);
  const lock = await store().getKV<{ until: number }>(LOCK_KEY);
  const g = await googleStatus("", false).catch(() => null);
  const spaces = Object.values(st?.chat.spaces ?? {});
  const errs = Object.values(st?.errors ?? {}).filter(Boolean);
  return {
    stats: await stats(),
    done: {
      gmail: !!st?.gmail.done,
      chat: !!st?.chat.listedAt && spaces.every((s) => s.done),
      meet: !!st?.meet.done,
      calendar: !!st?.calendar.done,
      drive: !!st?.drive?.done,
    },
    needsScope: g?.connected && !g.scopes?.includes(DRIVE_SCOPE) ? ["drive"] : undefined,
    running: !!lock && lock.until > Date.now(),
    lastError: errs.length ? errs.join(" | ") : undefined,
    updatedAt: st?.updatedAt,
  };
}

export async function resetArchiveState() {
  await store().setKV(STATE_KEY, null);
  await store().setKV(LOCK_KEY, null);
}

// ------------------------------------------------------------------ Gmail
type MPart = { mimeType?: string; filename?: string; body?: { data?: string }; parts?: MPart[] };
type FullMsg = {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  snippet?: string;
  payload?: MPart & { headers?: { name: string; value: string }[] };
};

const b64 = (d: string) => Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const stripHtml = (h: string) =>
  decode(
    h
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " "),
  );

function bodyOf(p?: MPart) {
  let plain = "";
  let html = "";
  const files: string[] = [];
  const walk = (x?: MPart) => {
    if (!x) return;
    if (x.filename) files.push(x.filename);
    else if (x.mimeType === "text/plain" && x.body?.data && !plain) plain = b64(x.body.data);
    else if (x.mimeType === "text/html" && x.body?.data && !html) html = b64(x.body.data);
    x.parts?.forEach(walk);
  };
  walk(p);
  let text = (plain || stripHtml(html)).replace(/\r/g, "");
  // alıntılanmış eski yazışmayı kes (aynı içerik zincirde tekrar tekrar saklanmasın)
  const cut = text.search(/\n(?:On .{5,200}wrote:|.{0,200}tarihinde.{0,200}yazdı:|-{2,}\s*(?:Original Message|Orijinal İleti)|From: .+\n(?:Sent|Gönderildi|Date): )/);
  if (cut > 40) text = text.slice(0, cut);
  text = text
    .split("\n")
    .filter((l) => !l.startsWith(">"))
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: text.slice(0, 8000), files: files.slice(0, 20) };
}

function mailItem(m: FullMsg, email: string): ArchiveItem {
  const h = (n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
  const from = parseFrom(h("from"));
  const to = h("to");
  const { text, files } = bodyOf(m.payload);
  const sent = m.labelIds?.includes("SENT");
  return {
    source: "gmail",
    id: m.id,
    ts: new Date(Number(m.internalDate ?? 0)).toISOString(),
    title: h("subject") || "(konu yok)",
    who: `${sent ? "Sen" : from.name} <${from.email}>${to ? ` → ${to.slice(0, 300)}` : ""}`,
    body: (text || decode(m.snippet ?? "")) + (files.length ? `\n[Ekler: ${files.join(", ")}]` : ""),
    link: `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${m.threadId}`,
    meta: { threadId: m.threadId, labels: m.labelIds ?? [], cc: h("cc") || undefined, sent },
  };
}

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_Q = "-in:spam -in:trash -in:chats";

async function fetchMails(get: Get, ids: string[], email: string, left: () => number) {
  const have = await existingIds("gmail", ids);
  const todo = ids.filter((id) => !have.has(id));
  let fetched = 0;
  for (let i = 0; i < todo.length && left() > 6000; i += 24) {
    const batch = todo.slice(i, i + 24);
    const msgs = await pool(batch, 8, (id) => get<FullMsg>(`${GMAIL}/messages/${id}?format=full`).catch(() => null));
    await upsertItems(msgs.filter((m): m is FullMsg => !!m).map((m) => mailItem(m, email)));
    fetched += batch.length;
  }
  return fetched >= todo.length;
}

async function gmailStep(get: Get, st: State, email: string, left: () => number) {
  type List = { messages?: { id: string }[]; nextPageToken?: string };
  // ileri
  if (st.gmail.newest) {
    const q = `${GMAIL_Q} after:${st.gmail.newest - 86400}`;
    let token: string | undefined;
    const startedAt = Math.floor(Date.now() / 1000);
    let complete = true;
    for (let page = 0; page < 5 && left() > 8000; page++) {
      const l = await get<List>(`${GMAIL}/messages?maxResults=100&q=${encodeURIComponent(q)}${token ? `&pageToken=${token}` : ""}`);
      complete = await fetchMails(get, (l.messages ?? []).map((m) => m.id), email, left);
      if (!complete || !l.nextPageToken) break;
      token = l.nextPageToken;
    }
    if (complete) st.gmail.newest = startedAt;
  } else {
    st.gmail.newest = Math.floor(Date.parse(st.startedAt) / 1000);
  }
  // geri (en yeniden en eskiye)
  while (!st.gmail.done && left() > 8000) {
    let l: List;
    try {
      l = await get<List>(`${GMAIL}/messages?maxResults=100&q=${encodeURIComponent(GMAIL_Q)}${st.gmail.back ? `&pageToken=${st.gmail.back}` : ""}`);
    } catch (e) {
      if (st.gmail.back && /token|invalid/i.test(String(e))) {
        st.gmail.back = null;
        continue;
      }
      throw e;
    }
    const complete = await fetchMails(get, (l.messages ?? []).map((m) => m.id), email, left);
    if (!complete) break; // aynı sayfaya sonra devam
    st.gmail.back = l.nextPageToken ?? null;
    if (!l.nextPageToken) st.gmail.done = true;
  }
}

// ------------------------------------------------------------------ Chat
const CHAT = "https://chat.googleapis.com/v1";
type ChatMsg = { name: string; sender?: { name?: string; type?: string }; text?: string; createTime: string; thread?: { name?: string }; attachment?: { contentName?: string }[] };

async function chatItems(get: Get, sub: string, sp: SpaceState, msgs: ChatMsg[]): Promise<ArchiveItem[]> {
  const names = await resolveNames(
    get,
    msgs.map((m) => m.sender?.name ?? "").filter((n) => n.startsWith("users/")).map((n) => n.slice(6)),
  );
  return msgs
    .filter((m) => m.text || m.attachment?.length)
    .map((m) => {
      const mine = m.sender?.name === `users/${sub}`;
      return {
        source: "chat" as const,
        id: m.name,
        ts: m.createTime,
        title: sp.title,
        who: mine ? "Sen" : m.sender?.type === "BOT" ? "Uygulama" : names[(m.sender?.name ?? "").replace("users/", "")] ?? "Bir kişi",
        body: (m.text ?? "").slice(0, 6000) + (m.attachment?.length ? `\n[Ek: ${m.attachment.map((a) => a.contentName ?? "dosya").join(", ")}]` : ""),
        link: sp.link,
        meta: { kind: sp.kind, thread: m.thread?.name, mine },
      };
    });
}

async function chatStep(get: Get, st: State, sub: string, left: () => number) {
  // alan listesini 6 saatte bir yenile
  if (!st.chat.listedAt || Date.now() - Date.parse(st.chat.listedAt) > 6 * 3600000) {
    type Space = { name: string; displayName?: string; spaceType?: string; lastActiveTime?: string; singleUserBotDm?: boolean };
    let token: string | undefined;
    const all: Space[] = [];
    do {
      const j = await get<{ spaces?: Space[]; nextPageToken?: string }>(`${CHAT}/spaces?pageSize=1000${token ? `&pageToken=${token}` : ""}`);
      all.push(...(j.spaces ?? []));
      token = j.nextPageToken;
    } while (token && left() > 8000);
    const unnamed = all.filter((s) => !s.displayName && !s.singleUserBotDm && !st.chat.spaces[s.name]);
    const others: Record<string, string[]> = {};
    await pool(unnamed.slice(0, 60), 6, async (s) => {
      const m = await get<{ memberships?: { member?: { name?: string } }[] }>(`${CHAT}/${s.name}/members?pageSize=20`).catch(() => ({ memberships: [] }));
      others[s.name] = (m.memberships ?? []).map((x) => x.member?.name ?? "").filter((n) => n.startsWith("users/") && n !== `users/${sub}`).map((n) => n.slice(6));
    });
    const names = await resolveNames(get, Object.values(others).flat());
    for (const s of all) {
      if (s.singleUserBotDm) continue;
      const kind = s.spaceType ?? "SPACE";
      const id = s.name.replace("spaces/", "");
      const prev = st.chat.spaces[s.name];
      st.chat.spaces[s.name] = {
        ...prev,
        title: s.displayName || prev?.title || (others[s.name] ?? []).map((u) => names[u] ?? "Bir kişi").join(", ") || "Doğrudan mesaj",
        kind,
        link: `https://mail.google.com/chat/u/0/#chat/${kind === "DIRECT_MESSAGE" ? "dm" : "space"}/${id}`,
        lastActive: s.lastActiveTime,
      };
    }
    st.chat.listedAt = new Date().toISOString();
  }

  const entries = Object.entries(st.chat.spaces).sort((a, b) => (b[1].lastActive ?? "").localeCompare(a[1].lastActive ?? ""));
  // ileri: son kontrolden beri aktif olan alanlar
  for (const [name, sp] of entries) {
    if (left() < 8000) return;
    if (!sp.newest) {
      sp.newest = st.startedAt;
      continue;
    }
    if (sp.lastActive && sp.lastActive <= sp.newest) continue;
    const startedAt = new Date().toISOString();
    const j = await get<{ messages?: ChatMsg[] }>(`${CHAT}/${name}/messages?pageSize=200&filter=${encodeURIComponent(`createTime > "${sp.newest}"`)}`).catch(() => ({ messages: [] }));
    await upsertItems(await chatItems(get, sub, sp, j.messages ?? []));
    sp.newest = startedAt;
  }
  // geri
  for (const [name, sp] of entries) {
    while (!sp.done && left() > 8000) {
      const j = await get<{ messages?: ChatMsg[]; nextPageToken?: string }>(
        `${CHAT}/${name}/messages?pageSize=200&orderBy=${encodeURIComponent("createTime desc")}${sp.back ? `&pageToken=${sp.back}` : ""}`,
      ).catch((e) => {
        if (/not found|permission/i.test(String(e))) return { messages: [] as ChatMsg[], nextPageToken: undefined };
        throw e;
      });
      await upsertItems(await chatItems(get, sub, sp, j.messages ?? []));
      sp.back = j.nextPageToken ?? null;
      if (!j.nextPageToken) sp.done = true;
    }
    if (left() < 8000) return;
  }
}

// ------------------------------------------------------------------ Meet
const MEET = "https://meet.googleapis.com/v2";
type Rec = { name: string; startTime: string; endTime?: string; space?: string };
type Participant = { name?: string; signedinUser?: { displayName?: string }; anonymousUser?: { displayName?: string }; phoneUser?: { displayName?: string } };
const pname = (p?: Participant | null) => p?.signedinUser?.displayName || p?.anonymousUser?.displayName || p?.phoneUser?.displayName || "Katılımcı";

async function meetItem(get: Get, r: Rec, titles: Record<string, string>): Promise<ArchiveItem | null> {
  if (!r.endTime) return null; // devam eden toplantı
  type Tr = { name: string; state?: string; docsDestination?: { exportUri?: string } };
  const [space, parts, trs, recs] = await Promise.all([
    r.space ? get<{ meetingCode?: string }>(`${MEET}/${r.space}`).catch(() => ({ meetingCode: undefined })) : Promise.resolve({ meetingCode: undefined }),
    get<{ participants?: Participant[] }>(`${MEET}/${r.name}/participants?pageSize=100`).catch(() => ({ participants: [] as Participant[] })),
    get<{ transcripts?: Tr[] }>(`${MEET}/${r.name}/transcripts`).catch(() => ({ transcripts: [] as Tr[] })),
    get<{ recordings?: { driveDestination?: { exportUri?: string } }[] }>(`${MEET}/${r.name}/recordings`).catch(() => ({ recordings: [] })),
  ]);
  const pn = new Map((parts.participants ?? []).map((p) => [p.name ?? "", pname(p)]));
  const lines: string[] = [];
  let pending = false;
  for (const t of trs.transcripts ?? []) {
    if (t.state === "STARTED") {
      pending = true;
      continue;
    }
    let token: string | undefined;
    for (let page = 0; page < 15; page++) {
      const e = await get<{ transcriptEntries?: { participant?: string; text?: string }[]; nextPageToken?: string }>(
        `${MEET}/${t.name}/entries?pageSize=100${token ? `&pageToken=${token}` : ""}`,
      ).catch(() => null);
      if (!e) break;
      for (const x of e.transcriptEntries ?? []) {
        let who = pn.get(x.participant ?? "");
        if (!who && x.participant) {
          who = pname(await get<Participant>(`${MEET}/${x.participant}`).catch(() => null));
          pn.set(x.participant, who);
        }
        lines.push(`${who ?? "Katılımcı"}: ${x.text ?? ""}`);
      }
      token = e.nextPageToken;
      if (!token) break;
    }
  }
  const code = space.meetingCode;
  const people = [...new Set([...pn.values()])];
  const mins = Math.round((Date.parse(r.endTime) - Date.parse(r.startTime)) / 60000);
  const links = [...(trs.transcripts ?? []).map((t) => t.docsDestination?.exportUri), ...(recs.recordings ?? []).map((x) => x.driveDestination?.exportUri)].filter(Boolean);
  return {
    source: "meet",
    id: r.name,
    ts: r.startTime,
    title: (code && titles[code]) || (code ? `Meet ${code}` : "Meet toplantısı"),
    who: people.join(", "),
    body: `Süre: ${mins} dk. Katılımcılar: ${people.join(", ") || "—"}.\n` + (lines.length ? `Transkript:\n${lines.join("\n")}`.slice(0, 60000) : "(transkript yok)"),
    link: (links[0] as string | undefined) ?? (code ? `https://meet.google.com/${code}` : undefined),
    meta: { code, end: r.endTime, pending, links },
  };
}

async function meetStep(get: Get, st: State, left: () => number) {
  const titles = (await store().getKV<Record<string, string>>(TITLES_KEY)) ?? {};
  const handle = async (recs: Rec[]) => {
    const have = await existingIds("meet", recs.map((r) => r.name));
    const todo = recs.filter((r) => !have.has(r.name) || Date.now() - Date.parse(r.endTime ?? r.startTime) < 2 * 86400000);
    const items = await pool(todo, 3, (r) => (left() > 6000 ? meetItem(get, r, titles).catch(() => null) : Promise.resolve(null)));
    await upsertItems(items.filter((x): x is ArchiveItem => !!x));
    return items.filter(Boolean).length === todo.filter((r) => r.endTime).length;
  };
  // ileri: 15 dakikada bir son toplantılar (transkriptler sonradan oluşabilir)
  if (!st.meet.recentAt || Date.now() - Date.parse(st.meet.recentAt) > 15 * 60000) {
    const j = await get<{ conferenceRecords?: Rec[] }>(`${MEET}/conferenceRecords?pageSize=20`);
    if (await handle(j.conferenceRecords ?? [])) st.meet.recentAt = new Date().toISOString();
  }
  while (!st.meet.done && left() > 8000) {
    const j = await get<{ conferenceRecords?: Rec[]; nextPageToken?: string }>(`${MEET}/conferenceRecords?pageSize=25${st.meet.back ? `&pageToken=${st.meet.back}` : ""}`);
    if (!(await handle(j.conferenceRecords ?? []))) break;
    st.meet.back = j.nextPageToken ?? null;
    if (!j.nextPageToken) st.meet.done = true;
  }
}

// ------------------------------------------------------------------ Takvim
export function eventItem(e: GEvent): ArchiveItem {
  return {
    source: "calendar",
    id: e.id,
    ts: e.allDay ? `${e.start}T00:00:00+03:00` : e.start,
    title: e.title,
    who: [e.organizer, ...e.attendees.map((a) => a.name)].filter(Boolean).join(", "),
    body: [e.allDay ? `Tüm gün (${e.start} – ${e.end})` : `Bitiş: ${e.end}`, e.location && `Yer: ${e.location}`, e.meet && "Google Meet", e.description].filter(Boolean).join("\n"),
    link: e.link,
    meta: { meet: e.meet, response: e.response, allDay: e.allDay, end: e.end, location: e.location, organizer: e.organizer },
  };
}

export async function rememberMeetTitles(events: GEvent[]) {
  const add: Record<string, string> = {};
  for (const e of events) {
    const code = e.meet?.match(/meet\.google\.com\/([a-z-]+)/)?.[1];
    if (code) add[code] = e.title;
  }
  if (!Object.keys(add).length) return;
  const cur = (await store().getKV<Record<string, string>>(TITLES_KEY)) ?? {};
  await store().setKV(TITLES_KEY, { ...cur, ...add });
}

async function calendarStep(get: Get, st: State, left: () => number) {
  const timeMax = new Date(Date.parse(st.startedAt) + 120 * 86400000).toISOString();
  while (!st.calendar.done && left() > 8000) {
    const q = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", maxResults: "250", timeMax, timeZone: "Europe/Istanbul" });
    if (st.calendar.back) q.set("pageToken", st.calendar.back);
    let j: { items?: unknown[]; nextPageToken?: string };
    try {
      j = await get(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`);
    } catch (e) {
      if (st.calendar.back && /token|invalid|gone/i.test(String(e))) {
        st.calendar.back = null;
        continue;
      }
      throw e;
    }
    const events = (j.items ?? []).filter((x) => (x as { status?: string }).status !== "cancelled").map(mapEvent);
    await upsertItems(events.map(eventItem));
    await rememberMeetTitles(events);
    st.calendar.back = j.nextPageToken ?? null;
    if (!j.nextPageToken) st.calendar.done = true;
  }
}

// ------------------------------------------------------------------ Drive
async function driveItem(token: string, f: GFile): Promise<ArchiveItem> {
  let text: string | null = null;
  let note = "";
  try {
    text = await fileText(token, f, 60_000);
  } catch (e) {
    note = `(içerik okunamadı: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)})`;
  }
  return {
    source: "drive",
    id: f.id,
    ts: f.modified,
    title: f.name,
    who: [f.owner, f.modifiedBy && f.modifiedBy !== f.owner ? `son düzenleyen ${f.modifiedBy}` : ""].filter(Boolean).join(" · "),
    body: [`Tür: ${kindOf(f.mime)}`, text?.trim() || note || (readable(f) ? "(boş)" : "(içerik metin olarak okunamıyor; yalnızca dosya bilgisi)")].join("\n\n"),
    link: f.link,
    meta: { mime: f.mime, size: f.size, owner: f.owner, modifiedBy: f.modifiedBy, drive: f.drive },
  };
}

/** Dosyaları metinleriyle arşive yazar; süre biterse false (sayfaya sonra devam edilir). */
async function driveFiles(token: string, files: GFile[], left: () => number, skipExisting: boolean) {
  let list = files.filter((f) => !f.folder);
  if (skipExisting && list.length) {
    const have = await existingIds("drive", list.map((f) => f.id));
    list = list.filter((f) => !have.has(f.id));
  }
  let done = 0;
  for (let i = 0; i < list.length && left() > 6000; i += 12) {
    const batch = list.slice(i, i + 12);
    await upsertItems(await pool(batch, 6, (f) => driveItem(token, f)));
    done += batch.length;
  }
  return done >= list.length;
}

async function driveStep(get: Get, token: string, st: State, left: () => number) {
  // ileri: son çalıştırmadan beri değişen dosyalar (içerik yeniden okunur)
  if (st.drive.newest) {
    const startedAt = new Date().toISOString();
    const after = new Date(Date.parse(st.drive.newest) - 3600_000).toISOString();
    let pageToken: string | undefined;
    let complete = true;
    for (let page = 0; page < 5 && left() > 8000; page++) {
      const l = await listFiles(get, { view: "recent", modifiedAfter: after, pageToken, pageSize: 100 });
      complete = await driveFiles(token, l.files, left, false);
      if (!complete || !l.next) break;
      pageToken = l.next;
    }
    if (complete) st.drive.newest = startedAt;
  } else {
    st.drive.newest = new Date().toISOString();
  }
  // geri: en son değişenden en eskiye
  while (!st.drive.done && left() > 8000) {
    let l: Awaited<ReturnType<typeof listFiles>>;
    try {
      l = await listFiles(get, { view: "recent", pageToken: st.drive.back ?? undefined, pageSize: 100 });
    } catch (e) {
      if (st.drive.back && /token|invalid/i.test(String(e))) {
        st.drive.back = null;
        continue;
      }
      throw e;
    }
    if (!(await driveFiles(token, l.files, left, true))) break;
    st.drive.back = l.next;
    if (!l.next) st.drive.done = true;
  }
}

// ------------------------------------------------------------------ adım
export async function archiveStep(opts: { budgetMs?: number } = {}): Promise<ArchiveProgress> {
  const budget = opts.budgetMs ?? 40000;
  const lock = await store().getKV<{ until: number }>(LOCK_KEY);
  if (lock && lock.until > Date.now()) return progress();
  await store().setKV(LOCK_KEY, { until: Date.now() + budget + 20000 });
  const t0 = Date.now();
  const left = () => budget - (Date.now() - t0);
  const st: State = { ...fresh(), ...((await store().getKV<State>(STATE_KEY)) ?? {}) };
  st.errors ??= {};
  try {
    const { auth, get, token } = await authed();
    // anlık görüntüdeki yakın takvim (değişen/yeni etkinlikler) arşive
    const snap = await getSnapshot().catch(() => null);
    if (snap && snap.syncedAt !== st.snapAt) {
      await upsertItems(snap.calendar.items.map(eventItem));
      await rememberMeetTitles(snap.calendar.items);
      st.snapAt = snap.syncedAt;
    }
    // Süre kaynaklar arasında paylaştırılır: her kaynak kalan sürenin payını alır; erken biten kaynağın süresi sonrakilere kalır.
    const hasDrive = !!auth.scopes?.includes(DRIVE_SCOPE);
    const order: ArchiveSource[] = ["calendar", "meet", "chat", "gmail", ...(hasDrive ? (["drive"] as const) : [])];
    const run = async (src: ArchiveSource, fn: (sub: () => number) => Promise<void>) => {
      if (left() < 8000) return;
      const share = Math.max(10000, (left() - 8000) / (order.length - order.indexOf(src)));
      const until = Date.now() + share;
      const sub = () => Math.min(left(), until - Date.now() + 8000);
      try {
        await fn(sub);
        delete st.errors[src];
      } catch (e) {
        st.errors[src] = explain({ gmail: "Gmail", chat: "Chat", meet: "Meet", calendar: "Takvim", drive: "Drive" }[src], e);
      }
    };
    // takvim önce (Meet başlıkları için), sonra diğerleri; geri kalan süre sırayla paylaşılır
    await run("calendar", (sub) => calendarStep(get, st, sub));
    await run("meet", (sub) => meetStep(get, st, sub));
    await run("chat", (sub) => chatStep(get, st, auth.sub, sub));
    await run("gmail", (sub) => gmailStep(get, st, auth.account.email, sub));
    if (hasDrive) await run("drive", (sub) => driveStep(get, token, st, sub));
  } finally {
    st.updatedAt = new Date().toISOString();
    await store().setKV(STATE_KEY, st);
    await store().setKV(LOCK_KEY, null);
  }
  return progress();
}
