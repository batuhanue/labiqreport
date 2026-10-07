"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAssistant } from "@/components/assistant/AssistantPanel";
import { useGoogle } from "@/components/google/GoogleProvider";
import { usePeriod } from "@/components/PeriodProvider";
import { TiltCard } from "@/components/TiltCard";
import { useTodos } from "@/components/todos/TodoProvider";
import { Skeleton } from "@/components/fx";
import { Icon, Segmented, Sheet } from "@/components/ui";
import { spring } from "@/lib/motion";
import { iso, newTodo } from "@/lib/todo";

/** Türkçe duyarsız karşılaştırma */
const norm = (s: string) => s.toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
import type { ArchiveHit, ArchiveProgress, ArchiveSource, GChatSpace, GEvent, GMail, GMeeting, GoogleSnapshot } from "@/lib/google-types";

type Tab = "calendar" | "gmail" | "chat" | "meet" | "archive";

// ------------------------------------------------------------------ zaman yardımcıları
const hm = (s: string) => new Date(s).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
const dayKey = (s: string) => (s.length === 10 ? s : iso(new Date(s)));
function dayLabel(key: string) {
  const today = iso(new Date());
  const d = new Date(`${key}T12:00:00`);
  const diff = Math.round((d.getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000);
  const base = d.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  return diff === 0 ? `Bugün · ${base}` : diff === 1 ? `Yarın · ${base}` : diff === -1 ? `Dün · ${base}` : base;
}
function ago(s: string, now = Date.now()) {
  const m = Math.round((now - Date.parse(s)) / 60000);
  if (m < 1) return "az önce";
  if (m < 60) return `${m} dk önce`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} sa önce`;
  return new Date(s).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}
function relIn(s: string, now = Date.now()) {
  const m = Math.round((Date.parse(s) - now) / 60000);
  if (m <= 0) return "şimdi";
  if (m < 60) return `${m} dk sonra`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} sa ${m % 60 ? `${m % 60} dk ` : ""}sonra` : `${Math.round(h / 24)} gün sonra`;
}
const isNow = (e: GEvent, now = Date.now()) => !e.allDay && Date.parse(e.start) <= now && Date.parse(e.end) > now;

const AVATAR = ["#5b7cff", "#34c26b", "#ff7a59", "#8b5cf6", "#ffa53d", "#2ec4b6", "#ff5e6c"];
const colorOf = (s: string) => AVATAR[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const ini = name.replace(/[^\p{L}\s]/gu, "").trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || "?";
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-extrabold text-white" style={{ width: size, height: size, background: colorOf(name), fontSize: size * 0.38 }}>
      {ini}
    </span>
  );
}

// ------------------------------------------------------------------ sayfa
export default function GooglePage() {
  const { status, syncing, error, sync, disconnect, archive } = useGoogle();
  const { toast } = usePeriod();
  const [tab, setTab] = useState<Tab>("calendar");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // OAuth dönüşü (?connected=1 / ?error=…)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("connected")) setNotice({ ok: true, text: "Google hesabın bağlandı. Veriler çekiliyor…" });
    else if (q.get("error")) setNotice({ ok: false, text: q.get("error") === "not-configured" ? "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET tanımlı değil." : q.get("error")! });
    if (q.size) window.history.replaceState(null, "", "/google");
  }, []);
  useEffect(() => {
    if (notice?.ok && status?.connected && !status.snapshot && !syncing) sync(true);
  }, [notice, status, syncing, sync]);

  if (!status) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-44 rounded-[28px]" />
        <Skeleton className="h-14 rounded-full" />
        <Skeleton className="h-64 rounded-[28px]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AnimatePresence>
        {notice && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className={`clay-sm flex items-start gap-3 px-4 py-3 text-sm ${notice.ok ? "bg-tint-info" : "bg-tint-fail"}`}>
            <span>{notice.ok ? "✅" : "⚠️"}</span>
            <div className="min-w-0 flex-1 break-words font-semibold">{notice.text}</div>
            <button onClick={() => setNotice(null)} className="text-ink-3" aria-label="Kapat">
              <Icon name="close" size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {!status.configured ? (
        <SetupCard redirectUri={status.redirectUri} />
      ) : !status.connected ? (
        <ConnectCard />
      ) : (
        <>
          {status.needsReauth && (
            <div className="clay-sm flex flex-wrap items-center gap-3 bg-tint-warn px-4 py-3 text-sm">
              <span className="text-xl">🔑</span>
              <div className="min-w-0 flex-1 font-semibold">Google yetkisi sona ermiş. Senkronun devam etmesi için hesabı yeniden bağla.</div>
              <a href={`/api/google/auth?hint=${encodeURIComponent(status.account?.email ?? "")}`} className="clay-dark rounded-full px-4 py-2 font-bold">
                Yeniden bağla
              </a>
            </div>
          )}
          <Hero snap={status.snapshot ?? null} email={status.account?.email ?? ""} picture={status.account?.picture} syncing={syncing} onSync={() => sync(true)} error={error} archive={archive} onArchive={() => setTab("archive")} />
          {status.snapshot ? (
            <>
              <NextUp snap={status.snapshot} />
              <Segmented
                value={tab}
                onChange={setTab}
                options={[
                  { value: "calendar", label: <TabLabel icon="calendar" text="Takvim" /> },
                  { value: "gmail", label: <TabLabel icon="mail" text="Gmail" n={status.snapshot.gmail.unread} /> },
                  { value: "chat", label: <TabLabel icon="chat" text="Chat" /> },
                  { value: "meet", label: <TabLabel icon="video" text="Meet" /> },
                  { value: "archive", label: <TabLabel icon="history" text="Arşiv" /> },
                ]}
              />
              <AnimatePresence mode="wait">
                <motion.div key={tab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                  {tab === "calendar" && <CalendarTab snap={status.snapshot} />}
                  {tab === "gmail" && <GmailTab snap={status.snapshot} />}
                  {tab === "chat" && <ChatTab snap={status.snapshot} />}
                  {tab === "meet" && <MeetTab snap={status.snapshot} />}
                  {tab === "archive" && <ArchiveTab />}
                </motion.div>
              </AnimatePresence>
            </>
          ) : (
            <div className="clay flex flex-col items-center gap-3 px-6 py-12 text-center">
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }} className="text-blue">
                <Icon name="refresh" size={32} />
              </motion.div>
              <div className="font-extrabold">İlk senkron yapılıyor…</div>
              <div className="text-sm text-ink-2">Takvim, Gmail, Chat ve Meet verileri çekiliyor. Bu birkaç saniye sürebilir.</div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-2 text-xs text-ink-3">
            <span>Salt okunur bağlantı · uygulama açıkken 5 dakikada bir, ayrıca her sabah otomatik senkron.</span>
            <button
              onClick={async () => {
                if (!confirm("Google bağlantısı kaldırılsın mı? Senkron verisi silinir.")) return;
                await disconnect();
                toast("Google bağlantısı kaldırıldı");
              }}
              className="font-bold text-fail underline"
            >
              Bağlantıyı kaldır
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TabLabel({ icon, text, n }: { icon: "calendar" | "mail" | "chat" | "video" | "history"; text: string; n?: number }) {
  return (
    <span className="inline-flex items-center justify-center gap-1.5">
      <Icon name={icon} size={16} className="hidden sm:block" />
      {text}
      {!!n && <span className="rounded-full bg-fail px-1.5 text-[10px] leading-4 text-white">{n > 99 ? "99+" : n}</span>}
    </span>
  );
}

// ------------------------------------------------------------------ kurulum / bağlanma
function SetupCard({ redirectUri }: { redirectUri?: string }) {
  const steps = [
    <>
      <a className="font-bold text-blue underline" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">
        Google Cloud Console
      </a>
      &apos;da şirket hesabınla bir proje oluştur.
    </>,
    <>
      <b>APIs &amp; Services → Library</b>&apos;den etkinleştir: Gmail API, Google Calendar API, Google Chat API, Google Meet REST API, People API.
    </>,
    <>
      <b>OAuth consent screen</b>: Kullanıcı türü <b>Internal</b> (yalnızca şirket hesapları; Google incelemesi gerekmez).
    </>,
    <>
      <b>Credentials → Create credentials → OAuth client ID → Web application</b>. Yetkili yönlendirme URI&apos;si:
      <code className="mt-1 block break-all rounded-lg bg-track px-2 py-1 text-xs">{redirectUri}</code>
    </>,
    <>
      <b>Google Chat API → Configuration</b>: uygulama adı, simge URL&apos;si ve açıklama gir, kaydet (Chat okumak için zorunlu).
    </>,
    <>
      Vercel → Settings → Environment Variables: <code className="rounded bg-track px-1">GOOGLE_CLIENT_ID</code> ve <code className="rounded bg-track px-1">GOOGLE_CLIENT_SECRET</code> ekle, Redeploy.
    </>,
  ];
  return (
    <div className="clay space-y-4 p-5 sm:p-7">
      <div className="flex items-center gap-3">
        <GoogleMark size={44} />
        <div>
          <div className="text-xl font-extrabold">Google Workspace kurulumu</div>
          <div className="text-sm text-ink-2">Bir kerelik, ~10 dakika. Sonra tek tıkla bağlanırsın.</div>
        </div>
      </div>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <motion.li key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring.enter, delay: i * 0.05 }} className="flex gap-3 text-sm">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue text-xs font-extrabold text-white">{i + 1}</span>
            <div className="min-w-0 flex-1 pt-1">{s}</div>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

function ConnectCard() {
  const items = [
    { icon: "📅", t: "Takvim", d: "Toplantıların, Meet bağlantıları, katılımcılar" },
    { icon: "✉️", t: "Gmail", d: "Gelen kutusu, okunmamış ve önemli e-postalar" },
    { icon: "💬", t: "Chat", d: "Alanlar ve doğrudan mesajlardaki son yazışmalar" },
    { icon: "🎥", t: "Meet", d: "Yapılan toplantılar, katılımcılar, transkript ve kayıtlar" },
  ];
  return (
    <TiltCard className="clay relative overflow-hidden p-6 sm:p-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <motion.div initial={{ scale: 0.6, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={spring.pop}>
          <GoogleMark size={64} />
        </motion.div>
        <div>
          <div className="text-2xl font-extrabold">Google hesabını bağla</div>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-2">Şirket hesabındaki takvim, e-posta, sohbet ve toplantılar burada senkron görünür; asistan da bunları okuyarak yanıt verir.</p>
        </div>
        <div className="grid w-full max-w-2xl gap-2.5 text-left sm:grid-cols-2">
          {items.map((x, i) => (
            <motion.div key={x.t} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.enter, delay: 0.1 + i * 0.06 }} className="clay-sm flex items-start gap-3 rounded-2xl p-3.5">
              <span className="text-2xl">{x.icon}</span>
              <div>
                <div className="font-extrabold">{x.t}</div>
                <div className="text-xs text-ink-2">{x.d}</div>
              </div>
            </motion.div>
          ))}
        </div>
        <motion.a whileHover={{ y: -2 }} whileTap={{ scale: 0.96 }} href="/api/google/auth" className="clay-dark mt-2 flex items-center gap-2.5 rounded-full px-6 py-3.5 font-extrabold">
          <GoogleMark size={20} /> Google ile bağlan
        </motion.a>
        <div className="text-xs text-ink-3">Salt okunur erişim · hiçbir şey gönderilmez veya silinmez · istediğinde bağlantıyı kaldırabilirsin</div>
      </div>
    </TiltCard>
  );
}

function GoogleMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

// ------------------------------------------------------------------ üst kart
function Hero({
  snap,
  email,
  picture,
  syncing,
  onSync,
  error,
  archive,
  onArchive,
}: {
  snap: GoogleSnapshot | null;
  email: string;
  picture?: string;
  syncing: boolean;
  onSync: () => void;
  error: string | null;
  archive: ArchiveProgress | null;
  onArchive: () => void;
}) {
  const today = iso(new Date());
  const todayEvents = snap?.calendar.items.filter((e) => dayKey(e.start) === today && e.response !== "declined") ?? [];
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const chips = snap
    ? [
        `📅 Bugün ${todayEvents.length} etkinlik`,
        `✉️ ${snap.gmail.unread ?? snap.gmail.items.filter((m) => m.unread).length} okunmamış`,
        `💬 ${snap.chat.items.length} aktif sohbet`,
        `🎥 ${snap.meet.items.length} toplantı kaydı`,
      ]
    : [];
  return (
    <TiltCard className="clay-color relative overflow-hidden p-5 text-white sm:p-7" style={{ background: "linear-gradient(135deg,#4285f4 0%,#5b7cff 45%,#34a853 130%)", ["--glow" as string]: "rgba(66,133,244,.5)" }}>
      <div className="pointer-events-none absolute -right-10 -top-10 h-52 w-52 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-16 right-24 h-40 w-40 rounded-full bg-[#fbbc05]/25 blur-2xl" />
      <div className="relative flex items-center gap-4">
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={picture} alt="" referrerPolicy="no-referrer" className="h-16 w-16 shrink-0 rounded-full border-4 border-white/30 object-cover" />
        ) : (
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-white">
            <GoogleMark size={34} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold uppercase tracking-wider text-white/75">Google Workspace</div>
          <div className="truncate text-xl font-extrabold sm:text-2xl">{email}</div>
          <div className="mt-0.5 text-sm text-white/85">{syncing ? "Senkronlanıyor…" : snap ? `Son senkron ${ago(snap.syncedAt)}` : "Henüz senkron yok"}</div>
        </div>
        <motion.button whileTap={{ scale: 0.9 }} onClick={onSync} disabled={syncing} className="glass-on-color grid h-12 w-12 shrink-0 place-items-center rounded-full" aria-label="Şimdi senkronla" title="Şimdi senkronla">
          <motion.span animate={syncing ? { rotate: 360 } : { rotate: 0 }} transition={syncing ? { repeat: Infinity, duration: 1, ease: "linear" } : { duration: 0.2 }}>
            <Icon name="refresh" size={22} />
          </motion.span>
        </motion.button>
      </div>
      {chips.length > 0 && (
        <div className="relative mt-5 flex flex-wrap gap-2.5">
          {chips.map((c, i) => (
            <motion.span key={c} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.enter, delay: i * 0.05 }} className="glass-on-color rounded-full px-3 py-1.5 text-sm font-bold">
              {c}
            </motion.span>
          ))}
          {archive && (
            <motion.button whileTap={{ scale: 0.95 }} onClick={onArchive} className="glass-on-color rounded-full px-3 py-1.5 text-sm font-bold">
              📚 {archive.stats.total.toLocaleString("tr-TR")} kayıt hafızada{allDone(archive) ? "" : " · indiriliyor"}
            </motion.button>
          )}
        </div>
      )}
      {error && <div className="relative mt-4 rounded-2xl bg-black/20 px-3 py-2 text-sm font-semibold">⚠️ {error}</div>}
    </TiltCard>
  );
}

/** Sıradaki / şu anki toplantı */
function NextUp({ snap }: { snap: GoogleSnapshot }) {
  const now = Date.now();
  const ev = snap.calendar.items.find((e) => !e.allDay && e.response !== "declined" && Date.parse(e.end) > now && Date.parse(e.start) < now + 18 * 3600000);
  if (!ev) return null;
  const live = isNow(ev, now);
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`clay flex flex-wrap items-center gap-4 p-4 sm:p-5 ${live ? "bg-tint-fail" : "bg-tint-info"}`}>
      <div className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white" style={{ background: live ? "var(--color-fail)" : "var(--color-blue)" }}>
        <Icon name={ev.meet ? "video" : "calendar"} />
        {live && <motion.span className="absolute inset-0 rounded-2xl border-2 border-fail" animate={{ scale: [1, 1.35], opacity: [0.8, 0] }} transition={{ repeat: Infinity, duration: 1.4 }} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold uppercase tracking-wider text-ink-3">{live ? "Şu an devam ediyor" : `Sıradaki · ${relIn(ev.start, now)}`}</div>
        <div className="truncate text-lg font-extrabold">{ev.title}</div>
        <div className="text-sm text-ink-2">
          {hm(ev.start)}–{hm(ev.end)}
          {ev.attendees.length ? ` · ${ev.attendees.length + 1} kişi` : ""}
          {ev.location ? ` · ${ev.location}` : ""}
        </div>
      </div>
      {ev.meet && (
        <motion.a whileTap={{ scale: 0.95 }} whileHover={{ y: -2 }} href={ev.meet} target="_blank" rel="noreferrer" className="clay-color flex items-center gap-2 rounded-full bg-[#00897b] px-5 py-3 font-extrabold text-white" style={{ ["--glow" as string]: "rgba(0,137,123,.45)" }}>
          <Icon name="video" size={18} /> Katıl
        </motion.a>
      )}
    </motion.div>
  );
}

function SourceError({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="clay-sm mb-4 flex items-start gap-3 bg-tint-warn px-4 py-3 text-sm">
      <Icon name="alert" className="mt-0.5 shrink-0 text-warn" />
      <div className="min-w-0 break-words">{text}</div>
    </div>
  );
}

function TaskButton({ make }: { make: () => ReturnType<typeof newTodo> }) {
  const { add } = useTodos();
  const { toast } = usePeriod();
  return (
    <motion.button
      whileTap={{ scale: 0.88 }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        add(make());
        toast("Görevlere eklendi");
      }}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-track hover:text-blue"
      title="Görev yap"
      aria-label="Görev yap"
    >
      <Icon name="todo" size={18} />
    </motion.button>
  );
}

// ------------------------------------------------------------------ Takvim
const CAL_VIEW_KEY = "lq:cal-view";

function CalendarTab({ snap }: { snap: GoogleSnapshot }) {
  const [view, setView] = useState<"list" | "month">("list");
  useEffect(() => {
    try {
      if (localStorage.getItem(CAL_VIEW_KEY) === "month") setView("month");
    } catch {}
  }, []);
  const pick = (v: "list" | "month") => {
    setView(v);
    try {
      localStorage.setItem(CAL_VIEW_KEY, v);
    } catch {}
  };
  return (
    <div>
      <SourceError text={snap.calendar.error} />
      <div className="mb-3 flex justify-end">
        <div className="clay-pressed flex rounded-full p-1">
          {(
            [
              ["list", "Liste"],
              ["month", "Takvim"],
            ] as const
          ).map(([v, l]) => (
            <button key={v} onClick={() => pick(v)} className={`relative rounded-full px-4 py-1.5 text-xs font-bold ${view === v ? "text-white" : "text-ink-2"}`}>
              {view === v && <motion.span layoutId="cal-view" className="absolute inset-0 rounded-full bg-blue" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span className="relative">{l}</span>
            </button>
          ))}
        </div>
      </div>
      {view === "list" ? <AgendaList snap={snap} /> : <MonthView snap={snap} />}
    </div>
  );
}

function AgendaList({ snap }: { snap: GoogleSnapshot }) {
  const [past, setPast] = useState(false);
  const today = iso(new Date());
  const groups = useMemo(() => {
    const m = new Map<string, GEvent[]>();
    for (const e of snap.calendar.items) {
      const k = dayKey(e.start);
      if (!past && k < today) continue;
      if (past && k >= today) continue;
      (m.get(k) ?? m.set(k, []).get(k)!).push(e);
    }
    const arr = [...m.entries()];
    return past ? arr.reverse() : arr.slice(0, 21);
  }, [snap, past, today]);
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button onClick={() => setPast((v) => !v)} className="clay-sm rounded-full px-4 py-2 text-xs font-bold text-ink-2">
          {past ? "← Yaklaşanlar" : "Geçen hafta"}
        </button>
      </div>
      {!groups.length && <Empty emoji="🌤️" text={past ? "Geçen hafta etkinlik yok." : "Önümüzdeki günlerde takvimin boş."} />}
      <div className="space-y-5">
        {groups.map(([k, evs], gi) => (
          <motion.section key={k} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.enter, delay: Math.min(gi, 6) * 0.04 }}>
            <div className={`mb-2 px-1 text-sm font-extrabold ${k === today ? "text-blue" : "text-ink-2"}`}>{dayLabel(k)}</div>
            <div className="clay divide-y divide-line overflow-hidden">
              {evs.map((e) => (
                <EventRow key={e.id} e={e} />
              ))}
            </div>
          </motion.section>
        ))}
      </div>
    </div>
  );
}

/** Arşivdeki takvim kaydını etkinlik modeline çevirir (eski kayıtlarda meta yoksa gövdeden çıkarır). */
function eventFromArchive(r: ArchiveRow): GEvent {
  const meta = r.meta ?? {};
  const allDay = (meta.allDay as boolean | undefined) ?? r.preview.startsWith("Tüm gün");
  const start = allDay ? iso(new Date(r.ts)) : r.ts;
  const end = (meta.end as string | undefined) ?? r.preview.match(/Bitiş: (\S+)/)?.[1] ?? r.ts;
  const organizer = meta.organizer as string | undefined;
  const names = r.who ? r.who.split(", ").filter((n) => n && n !== organizer) : [];
  return {
    id: r.id,
    title: r.title,
    start,
    end,
    allDay,
    location: (meta.location as string | undefined) ?? r.preview.match(/Yer: ([^\n]+?)(?: Google Meet|$)/)?.[1],
    meet: meta.meet as string | undefined,
    link: r.link ?? "",
    organizer,
    attendees: names.map((n) => ({ name: n, email: n })),
    response: meta.response as string | undefined,
  };
}

const WD = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Ay görünümü: 7 sütunlu ızgara, gün seçilince o günün etkinlikleri altta. */
function MonthView({ snap }: { snap: GoogleSnapshot }) {
  const today = iso(new Date());
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState(today);
  const [archived, setArchived] = useState<Record<string, GEvent[]>>({});
  const [dir, setDir] = useState(0);
  const mk = monthKey(cursor);

  // önceki/sonraki ay taşan günler için komşu aylar da yüklenir
  useEffect(() => {
    const keys = [-1, 0, 1].map((o) => monthKey(new Date(cursor.getFullYear(), cursor.getMonth() + o, 1)));
    for (const k of keys) {
      if (archived[k]) continue;
      fetch(`/api/google/archive?source=calendar&month=${k}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((j) => setArchived((a) => ({ ...a, [k]: (j.rows as ArchiveRow[]).map(eventFromArchive) })))
        .catch(() => setArchived((a) => ({ ...a, [k]: [] })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mk]);

  // gün → etkinlikler (anlık görüntü daha ayrıntılı olduğu için önceliklidir)
  const byDay = useMemo(() => {
    const all = new Map<string, GEvent>();
    for (const list of Object.values(archived)) for (const e of list) all.set(e.id, e);
    for (const e of snap.calendar.items) all.set(e.id, e);
    const m = new Map<string, GEvent[]>();
    for (const e of all.values()) {
      if (e.allDay) {
        // çok günlü tüm gün etkinlikleri her güne yayılır (bitiş günü hariç)
        const s = new Date(`${dayKey(e.start)}T12:00:00`);
        const end = e.end && e.end.length === 10 ? new Date(`${e.end}T12:00:00`) : new Date(s.getTime() + 86400000);
        for (let d = s; d < end && d.getTime() - s.getTime() < 62 * 86400000; d = new Date(d.getTime() + 86400000)) {
          const k = iso(d);
          (m.get(k) ?? m.set(k, []).get(k)!).push(e);
        }
      } else {
        const k = dayKey(e.start);
        (m.get(k) ?? m.set(k, []).get(k)!).push(e);
      }
    }
    for (const list of m.values()) list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
    return m;
  }, [archived, snap]);

  // ızgara: ayın ilk gününün haftasının Pazartesi'sinden başlayarak 6 hafta
  const cells = useMemo(() => {
    const first = new Date(cursor);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    const weeks = Math.ceil((offset + new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [cursor]);

  const go = (n: number) => {
    setDir(n);
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));
  };
  const loading = !archived[mk];
  const dayEvents = byDay.get(selected) ?? [];

  return (
    <div className="space-y-4">
      <div className="clay overflow-hidden p-3 sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => go(-1)} className="clay-sm grid h-10 w-10 place-items-center rounded-full" aria-label="Önceki ay">
            <Icon name="back" size={18} />
          </motion.button>
          <div className="flex-1 text-center">
            <div className="text-lg font-extrabold capitalize">{cursor.toLocaleDateString("tr-TR", { month: "long", year: "numeric" })}</div>
            {loading && <div className="text-[11px] text-ink-3">yükleniyor…</div>}
          </div>
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => go(1)} className="clay-sm grid h-10 w-10 place-items-center rounded-full" aria-label="Sonraki ay">
            <Icon name="chevron" size={18} />
          </motion.button>
        </div>
        {mk !== monthKey(new Date()) && (
          <div className="mb-2 text-center">
            <button
              onClick={() => {
                const d = new Date();
                setDir(0);
                setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
                setSelected(today);
              }}
              className="rounded-full bg-track px-3 py-1 text-[11px] font-bold text-ink-2"
            >
              Bugüne dön
            </button>
          </div>
        )}
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-ink-3">
          {WD.map((d) => (
            <div key={d} className="py-1 sm:px-2 sm:text-left">
              {d}
            </div>
          ))}
        </div>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={mk}
            initial={{ opacity: 0, x: dir * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -40 }}
            transition={{ duration: 0.22 }}
            className="grid grid-cols-7 gap-1"
          >
            {cells.map((d) => {
              const k = iso(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const evs = byDay.get(k) ?? [];
              const isSel = k === selected;
              const isToday = k === today;
              const weekend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <button
                  key={k}
                  onClick={() => setSelected(k)}
                  className={`relative flex min-h-[54px] flex-col items-stretch rounded-xl p-1 text-left transition-colors sm:min-h-[92px] sm:p-1.5 ${
                    isSel ? "bg-tint-info ring-2 ring-blue" : "hover:bg-track/60"
                  } ${inMonth ? "" : "opacity-40"}`}
                >
                  <span
                    className={`mx-auto grid h-6 w-6 place-items-center rounded-full text-xs font-extrabold sm:mx-0 ${
                      isToday ? "bg-blue text-white" : weekend ? "text-ink-3" : ""
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  {/* mobil: noktalar */}
                  <span className="mt-1 flex flex-wrap justify-center gap-0.5 sm:hidden">
                    {evs.slice(0, 4).map((e) => (
                      <span key={e.id} className="h-1.5 w-1.5 rounded-full" style={{ background: e.meet ? "#00897b" : e.allDay ? "var(--color-warn)" : "var(--color-blue)" }} />
                    ))}
                  </span>
                  {/* masaüstü: başlıklar */}
                  <span className="mt-1 hidden min-w-0 flex-col gap-0.5 sm:flex">
                    {evs.slice(0, 3).map((e) => (
                      <span
                        key={e.id}
                        className="truncate rounded-md px-1 py-0.5 text-[10px] font-semibold leading-tight"
                        style={{
                          background: e.allDay ? "color-mix(in srgb, var(--color-warn) 22%, transparent)" : e.meet ? "color-mix(in srgb, #00897b 18%, transparent)" : "color-mix(in srgb, var(--color-blue) 16%, transparent)",
                        }}
                        title={e.title}
                      >
                        {!e.allDay && <span className="text-ink-3">{hm(e.start)} </span>}
                        {e.title}
                      </span>
                    ))}
                    {evs.length > 3 && <span className="px-1 text-[10px] font-bold text-ink-3">+{evs.length - 3} daha</span>}
                  </span>
                </button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>

      <div>
        <div className={`mb-2 px-1 text-sm font-extrabold ${selected === today ? "text-blue" : "text-ink-2"}`}>{dayLabel(selected)}</div>
        {dayEvents.length ? (
          <div className="clay divide-y divide-line overflow-hidden">
            {dayEvents.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </div>
        ) : (
          <Empty emoji="🌤️" text="Bu gün için etkinlik yok." />
        )}
      </div>
    </div>
  );
}

function EventRow({ e }: { e: GEvent }) {
  const [open, setOpen] = useState(false);
  const live = isNow(e);
  const declined = e.response === "declined";
  return (
    <div className={`${declined ? "opacity-50" : ""}`}>
      <div role="button" tabIndex={0} onClick={() => setOpen((v) => !v)} className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-track/50">
        <div className="w-14 shrink-0 text-right text-sm font-extrabold tabular-nums">
          {e.allDay ? <span className="text-xs text-ink-3">tüm gün</span> : (
            <>
              <div>{hm(e.start)}</div>
              <div className="text-xs font-semibold text-ink-3">{hm(e.end)}</div>
            </>
          )}
        </div>
        <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ background: live ? "var(--color-fail)" : e.meet ? "#00897b" : "var(--color-blue)" }} />
        <div className="min-w-0 flex-1">
          <div className={`truncate font-bold ${declined ? "line-through" : ""}`}>
            {live && <span className="mr-1.5 rounded-full bg-fail px-1.5 py-0.5 text-[10px] font-extrabold text-white">CANLI</span>}
            {e.title}
          </div>
          <div className="truncate text-xs text-ink-3">
            {[e.meet && "Google Meet", e.location, e.attendees.length && `${e.attendees.length + 1} kişi`, e.organizer && `düzenleyen ${e.organizer}`, e.response === "needsAction" && "yanıt bekliyor", e.response === "tentative" && "belki"].filter(Boolean).join(" · ")}
          </div>
        </div>
        {e.meet && Date.parse(e.end) > Date.now() && (
          <a href={e.meet} target="_blank" rel="noreferrer" onClick={(x) => x.stopPropagation()} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#00897b] text-white" title="Meet'e katıl" aria-label="Meet'e katıl">
            <Icon name="video" size={16} />
          </a>
        )}
        <TaskButton make={() => newTodo({ title: `Hazırlık: ${e.title}`, due: dayKey(e.start), time: e.allDay ? undefined : hm(e.start), tags: ["toplantı"], notes: e.link })} />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-2 px-4 pb-4 pl-[92px] text-sm">
              {e.description && <p className="whitespace-pre-wrap text-ink-2">{e.description}</p>}
              {e.attendees.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {e.attendees.map((a) => (
                    <span key={a.email} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${a.status === "accepted" ? "bg-tint-info" : a.status === "declined" ? "bg-tint-fail line-through" : "bg-track"}`} title={a.email}>
                      {a.name}
                    </span>
                  ))}
                </div>
              )}
              <a href={e.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-blue">
                Takvimde aç <Icon name="external" size={12} />
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ------------------------------------------------------------------ Gmail
/** Liste satırı (son gelenler ya da arşivden bir ay) */
interface MailLite {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  important: boolean;
}
const fromSnapshot = (m: GMail): MailLite => ({ id: m.id, from: m.from, subject: m.subject, snippet: m.snippet, date: m.date, unread: m.unread, important: m.important });
const fromArchive = (r: ArchiveRow): MailLite => {
  const labels = (r.meta?.labels as string[] | undefined) ?? [];
  const sent = !!r.meta?.sent;
  const [fromPart, to] = r.who.split(" → ");
  const name = fromPart.replace(/\s*<[^>]*>\s*$/, "");
  return {
    id: r.id,
    from: sent ? `Sen → ${(to ?? "").replace(/\s*<[^>]*>/g, "").split(",")[0]}` : name,
    subject: r.title,
    snippet: r.preview,
    date: r.ts,
    unread: labels.includes("UNREAD"),
    important: labels.includes("IMPORTANT"),
  };
};
interface ArchiveRow {
  source: ArchiveSource;
  id: string;
  ts: string;
  title: string;
  who: string;
  preview: string;
  link?: string;
  meta?: Record<string, unknown> | null;
}
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });

function GmailTab({ snap }: { snap: GoogleSnapshot }) {
  const [f, setF] = useState<"all" | "unread" | "important">("all");
  const [month, setMonth] = useState<string>("recent");
  const [monthList, setMonthList] = useState<{ month: string; count: number }[]>([]);
  const [rows, setRows] = useState<MailLite[] | null>(null);
  const [open, setOpen] = useState<MailLite | null>(null);
  const { ask } = useAssistant();

  useEffect(() => {
    fetch("/api/google/archive?months=gmail", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.months && setMonthList(j.months))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (month === "recent") return;
    setRows(null);
    fetch(`/api/google/archive?source=gmail&month=${month}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((j) => setRows((j.rows as ArchiveRow[]).map(fromArchive)))
      .catch(() => setRows([]));
  }, [month]);

  const base = month === "recent" ? snap.gmail.items.map(fromSnapshot) : rows;
  const list = base?.filter((m) => (f === "unread" ? m.unread : f === "important" ? m.important : true)) ?? null;
  const groups = useMemo(() => {
    if (!list) return [];
    const m = new Map<string, MailLite[]>();
    for (const x of list) {
      const k = iso(new Date(x.date));
      (m.get(k) ?? m.set(k, []).get(k)!).push(x);
    }
    return [...m.entries()];
  }, [list]);

  return (
    <div>
      <SourceError text={snap.gmail.error} />
      {/* ay seçici */}
      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {[{ month: "recent", count: snap.gmail.items.length }, ...monthList].map((m) => (
          <button
            key={m.month}
            onClick={() => setMonth(m.month)}
            className={`clay-sm shrink-0 rounded-full px-4 py-2 text-xs font-bold ${month === m.month ? "bg-blue text-white" : "text-ink-2"}`}
          >
            {m.month === "recent" ? "Son gelenler" : monthLabel(m.month)}
            <span className={`ml-1.5 ${month === m.month ? "text-white/75" : "text-ink-3"}`}>{m.count.toLocaleString("tr-TR")}</span>
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(
          [
            ["all", "Tümü"],
            ["unread", "Okunmamış"],
            ["important", "Önemli"],
          ] as const
        ).map(([v, l]) => (
          <button key={v} onClick={() => setF(v)} className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${f === v ? "bg-ink text-paper" : "bg-track text-ink-2"}`}>
            {l}
          </button>
        ))}
        <button
          onClick={() =>
            ask(
              month === "recent"
                ? "Gelen kutumdaki okunmamış ve önemli e-postaları özetle; hangilerine yanıt vermem ya da aksiyon almam gerekiyor?"
                : `${monthLabel(month)} ayındaki e-postalarımı arşivden incele: önemli konular, kimden ne geldi, açık kalan işler neler?`,
            )
          }
          className="ml-auto rounded-full bg-track px-3.5 py-1.5 text-xs font-bold text-ink-2"
        >
          ✨ Asistana özetlet
        </button>
      </div>
      {!monthList.length && month === "recent" && (
        <div className="mb-3 px-1 text-xs text-ink-3">Geçmiş e-postalar arşive indikçe burada ay ay listelenir (Arşiv sekmesinden ilerlemeyi görebilirsin).</div>
      )}
      {!list ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : !list.length ? (
        <Empty emoji="📭" text="Bu görünümde e-posta yok." />
      ) : (
        <div className="space-y-4">
          {groups.map(([day, mails]) => (
            <section key={day}>
              <div className="mb-1.5 px-1 text-xs font-extrabold text-ink-3">{dayLabel(day)}</div>
              <div className="clay divide-y divide-line overflow-hidden">
                {mails.map((m, i) => (
                  <MailRow key={m.id} m={m} i={i} onOpen={() => setOpen(m)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <MailReader mail={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function MailRow({ m, i, onOpen }: { m: MailLite; i: number; onOpen: () => void }) {
  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: Math.min(i, 12) * 0.02 }}
      className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-track/50"
    >
      <Avatar name={m.from} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`truncate ${m.unread ? "font-extrabold" : "font-semibold text-ink-2"}`}>{m.from}</span>
          {m.important && <span className="text-xs text-warn" title="Önemli">●</span>}
          <span className="ml-auto shrink-0 text-xs text-ink-3">{hm(m.date)}</span>
        </div>
        <div className={`truncate text-sm ${m.unread ? "font-bold" : "text-ink-2"}`}>
          {m.unread && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-blue align-middle" />}
          {m.subject}
        </div>
        <div className="line-clamp-1 text-xs text-ink-3">{m.snippet}</div>
      </div>
      <TaskButton make={() => newTodo({ title: `E-posta: ${m.subject} (${m.from})`, due: iso(new Date()), tags: ["eposta"] })} />
    </motion.div>
  );
}

interface FullMail {
  id: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: string;
  cc: string;
  date: string;
  html: string;
  text: string;
  files: { name: string; size: number }[];
  link?: string;
  live: boolean;
}

/** E-postayı uygulama içinde açar; HTML gövde betik çalıştırmayan korumalı iframe'de gösterilir. */
function MailReader({ mail, onClose }: { mail: MailLite | null; onClose: () => void }) {
  const [full, setFull] = useState<FullMail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { ask } = useAssistant();
  useEffect(() => {
    if (!mail) return;
    setFull(null);
    setErr(null);
    fetch(`/api/google/mail?id=${mail.id}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "E-posta açılamadı");
        setFull(j);
      })
      .catch((e) => setErr(e.message));
  }, [mail]);

  return (
    <Sheet open={!!mail} onClose={onClose} wide title={<span className="line-clamp-2 text-lg">{mail?.subject}</span>}>
      {mail && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Avatar name={full?.from ?? mail.from} size={44} />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-extrabold">{full?.from ?? mail.from}</div>
              {full && <div className="truncate text-xs text-ink-3">{full.fromEmail}</div>}
              {full?.to && <div className="mt-0.5 line-clamp-2 text-xs text-ink-3">Kime: {full.to}</div>}
              {full?.cc && <div className="line-clamp-1 text-xs text-ink-3">Bilgi: {full.cc}</div>}
            </div>
            <div className="shrink-0 text-right text-xs text-ink-3">
              {new Date(full?.date ?? mail.date).toLocaleString("tr-TR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
          {!!full?.files.length && (
            <div className="flex flex-wrap gap-2">
              {full.files.map((f, i) => (
                <span key={i} className="rounded-full bg-track px-3 py-1.5 text-xs font-bold text-ink-2">
                  📎 {f.name} {f.size ? `· ${Math.max(1, Math.round(f.size / 1024))} KB` : ""}
                </span>
              ))}
            </div>
          )}
          {err ? (
            <div className="rounded-2xl bg-tint-fail px-4 py-3 text-sm">⚠️ {err}</div>
          ) : !full ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4 rounded" />
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-5/6 rounded" />
              <Skeleton className="h-40 w-full rounded-2xl" />
            </div>
          ) : full.html ? (
            <MailFrame html={full.html} />
          ) : (
            <div className="whitespace-pre-wrap break-words rounded-2xl bg-card p-4 text-[15px] leading-relaxed">{full.text || "(boş)"}</div>
          )}
          {full && !full.live && <div className="text-xs text-ink-3">Gmail'e şu an ulaşılamadığı için arşivdeki metin gösteriliyor.</div>}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                onClose();
                ask(`"${mail.subject}" konulu, ${mail.from} kaynaklı e-postayı (arşiv kimliği gmail/${mail.id}) oku ve özetle: benden ne bekleniyor, nasıl yanıt vermeliyim?`);
              }}
              className="clay-color rounded-full bg-blue px-4 py-2.5 text-sm font-bold text-white"
            >
              ✨ Asistana özetlet
            </button>
            <TaskButtonWide make={() => newTodo({ title: `E-posta: ${mail.subject} (${mail.from})`, due: iso(new Date()), tags: ["eposta"], notes: full?.link ?? "" })} />
            {full?.link && (
              <a href={full.link} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-full bg-track px-4 py-2.5 text-sm font-bold text-ink-2">
                Gmail'de aç <Icon name="external" size={14} />
              </a>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function MailFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(320);
  const doc = useMemo(
    () => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; frame-src 'none'">
<base target="_blank"><style>html,body{margin:0;background:#fff;color:#1f2330;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-wrap:anywhere}
body{padding:14px}img{max-width:100%!important;height:auto!important}table{max-width:100%!important}pre{white-space:pre-wrap}a{color:#3f5ef0}</style></head><body>${html}</body></html>`,
    [html],
  );
  const fit = () => {
    const d = ref.current?.contentDocument;
    if (d?.body) setH(Math.min(Math.max(d.documentElement.scrollHeight, 120), 20000));
  };
  return (
    <iframe
      ref={ref}
      title="E-posta içeriği"
      srcDoc={doc}
      // betik yok; yalnızca yükseklik ölçümü için aynı köken ve bağlantıların yeni sekmede açılması
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      onLoad={() => {
        fit();
        setTimeout(fit, 400);
        setTimeout(fit, 1500);
      }}
      className="w-full rounded-2xl border border-line bg-white"
      style={{ height: h }}
    />
  );
}

function TaskButtonWide({ make }: { make: () => ReturnType<typeof newTodo> }) {
  const { add } = useTodos();
  const { toast } = usePeriod();
  return (
    <button
      onClick={() => {
        add(make());
        toast("Görevlere eklendi");
      }}
      className="flex items-center gap-1.5 rounded-full bg-track px-4 py-2.5 text-sm font-bold text-ink-2"
    >
      <Icon name="todo" size={16} /> Görev yap
    </button>
  );
}

// ------------------------------------------------------------------ Chat
interface Thread {
  link: string;
  title: string;
  kind?: string;
  last: string;
  count?: number;
  lastWho: string;
  lastText: string;
  fallback?: GChatSpace;
}

function ChatTab({ snap }: { snap: GoogleSnapshot }) {
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [open, setOpen] = useState<Thread | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    fetch("/api/google/archive?threads=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { threads: [] }))
      .then((j) => setThreads(j.threads ?? []))
      .catch(() => setThreads([]));
  }, []);
  // anlık görüntüdeki (en güncel) sohbetler + arşivdeki tüm sohbetler, tekilleştirilmiş
  const list = useMemo(() => {
    const m = new Map<string, Thread>();
    for (const s of snap.chat.items) {
      const last = s.messages.at(-1);
      m.set(s.link, { link: s.link, title: s.title, kind: s.kind, last: last?.time ?? s.lastActive ?? "", lastWho: last?.sender ?? "", lastText: last?.text ?? "", fallback: s });
    }
    for (const t of threads ?? []) {
      const cur = m.get(t.link);
      if (!cur) m.set(t.link, t);
      else m.set(t.link, { ...cur, count: t.count, ...(t.last > cur.last ? { last: t.last, lastWho: t.lastWho, lastText: t.lastText } : {}) });
    }
    const n = norm(q);
    return [...m.values()].filter((t) => !n || norm(t.title).includes(n)).sort((a, b) => b.last.localeCompare(a.last));
  }, [snap, threads, q]);

  return (
    <div>
      <SourceError text={snap.chat.error} />
      <div className="clay-pressed mb-3 flex items-center gap-2 rounded-full px-4 py-1">
        <span className="text-ink-3">🔎</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sohbet ara" className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-ink-3" />
      </div>
      {!list.length && threads && <Empty emoji="💬" text="Henüz sohbet yok." />}
      {!threads && !list.length && <Skeleton className="h-48 rounded-[28px]" />}
      <div className="clay divide-y divide-line overflow-hidden">
        {list.map((t, i) => (
          <motion.button
            key={t.link}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: Math.min(i, 15) * 0.02 }}
            onClick={() => setOpen(t)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-track/50"
          >
            {t.kind === "DIRECT_MESSAGE" ? (
              <Avatar name={t.title} size={44} />
            ) : (
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white" style={{ background: colorOf(t.title) }}>
                <Icon name="chat" size={20} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate font-extrabold">{t.title}</span>
                <span className="ml-auto shrink-0 text-xs text-ink-3">{t.last ? ago(t.last) : ""}</span>
              </div>
              <div className="truncate text-sm text-ink-2">
                {t.lastWho && <span className="font-semibold">{t.lastWho}: </span>}
                {t.lastText}
              </div>
            </div>
            <Icon name="chevron" size={16} className="shrink-0 text-ink-3" />
          </motion.button>
        ))}
      </div>
      <ChatSheet thread={open} onClose={() => setOpen(null)} />
    </div>
  );
}

interface CMsg {
  id: string;
  who: string;
  mine: boolean;
  text: string;
  ts: string;
}

function ChatSheet({ thread, onClose }: { thread: Thread | null; onClose: () => void }) {
  const [msgs, setMsgs] = useState<CMsg[] | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const { ask } = useAssistant();
  const endRef = useRef<HTMLDivElement>(null);

  const load = async (before?: string) => {
    if (!thread) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({ source: "chat", link: thread.link });
      if (before) p.set("before", before);
      const r = await fetch(`/api/google/archive?${p}`, { cache: "no-store" });
      const rows: ArchiveRow[] = r.ok ? (await r.json()).rows : [];
      const got = rows.map((x) => ({ id: x.id, who: x.who, mine: !!x.meta?.mine || x.who === "Sen", text: x.preview, ts: x.ts })).reverse();
      setMore(rows.length >= 60);
      setMsgs((cur) => {
        if (before) return [...got, ...(cur ?? [])];
        // arşiv boşsa anlık görüntüdeki son mesajlar
        if (!got.length && thread.fallback) return thread.fallback.messages.map((m) => ({ id: m.id, who: m.sender, mine: m.mine, text: m.text, ts: m.time }));
        return got;
      });
      if (!before) setTimeout(() => endRef.current?.scrollIntoView({ block: "end" }), 350);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setMsgs(null);
    if (thread) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread]);

  let lastDay = "";
  return (
    <Sheet open={!!thread} onClose={onClose} wide title={thread?.title}>
      {thread && (
        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              onClick={() => {
                onClose();
                ask(`Google Chat'teki "${thread.title}" sohbetini arşivden incele ve özetle. Benden beklenen bir şey ya da takip etmem gereken bir konu var mı?`);
              }}
              className="rounded-full bg-blue px-3.5 py-1.5 text-xs font-bold text-white"
            >
              ✨ Özetle
            </button>
            <a href={thread.link} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-full bg-track px-3.5 py-1.5 text-xs font-bold text-ink-2">
              Chat'te aç <Icon name="external" size={12} />
            </a>
          </div>
          {more && (
            <div className="mb-3 text-center">
              <button disabled={loading} onClick={() => msgs?.[0] && load(msgs[0].ts)} className="rounded-full bg-track px-4 py-2 text-xs font-bold text-ink-2">
                {loading ? "Yükleniyor…" : "Daha eski mesajlar"}
              </button>
            </div>
          )}
          {!msgs ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className={`h-12 rounded-2xl ${i % 2 ? "ml-auto w-2/3" : "w-3/4"}`} />
              ))}
            </div>
          ) : !msgs.length ? (
            <Empty emoji="💬" text="Bu sohbetin mesajları henüz arşive inmedi." />
          ) : (
            <div className="space-y-2">
              {msgs.map((m) => {
                const day = iso(new Date(m.ts));
                const sep = day !== lastDay;
                lastDay = day;
                return (
                  <div key={m.id}>
                    {sep && <div className="my-3 text-center text-[11px] font-bold text-ink-3">{dayLabel(day)}</div>}
                    <div className={`flex ${m.mine ? "justify-end" : ""}`}>
                      <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.mine ? "rounded-br-md bg-blue text-white" : "rounded-bl-md bg-track"}`}>
                        {!m.mine && thread.kind !== "DIRECT_MESSAGE" && (
                          <div className="text-[11px] font-extrabold" style={{ color: colorOf(m.who) }}>
                            {m.who}
                          </div>
                        )}
                        <div className="whitespace-pre-wrap break-words">{m.text}</div>
                        <div className={`mt-0.5 text-right text-[10px] ${m.mine ? "text-white/70" : "text-ink-3"}`}>{hm(m.ts)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ Meet
function MeetTab({ snap }: { snap: GoogleSnapshot }) {
  return (
    <div>
      <SourceError text={snap.meet.error} />
      {!snap.meet.items.length && !snap.meet.error && <Empty emoji="🎥" text="Son 3 haftada Meet toplantısı kaydı yok." />}
      <div className="space-y-3">
        {snap.meet.items.map((m, i) => (
          <MeetingCard key={m.id} m={m} i={i} />
        ))}
      </div>
    </div>
  );
}

function MeetingCard({ m, i }: { m: GMeeting; i: number }) {
  const { ask } = useAssistant();
  const mins = m.end ? Math.max(1, Math.round((Date.parse(m.end) - Date.parse(m.start)) / 60000)) : null;
  const title = m.title ?? (m.code ? `meet.google.com/${m.code}` : "Meet toplantısı");
  const d = new Date(m.start);
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.enter, delay: Math.min(i, 8) * 0.04 }} className="clay flex flex-wrap items-start gap-4 p-4">
      <div className="grid w-14 shrink-0 place-items-center rounded-2xl bg-tint-info py-2 text-center">
        <div className="text-xl font-extrabold leading-none">{d.getDate()}</div>
        <div className="text-[11px] font-bold uppercase text-ink-3">{d.toLocaleDateString("tr-TR", { month: "short" })}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-extrabold">{title}</div>
        <div className="text-xs text-ink-3">
          {hm(m.start)}
          {m.end ? `–${hm(m.end)}` : " · devam ediyor"}
          {mins ? ` · ${mins} dk` : ""}
          {m.participants.length ? ` · ${m.participants.length} katılımcı` : ""}
        </div>
        {m.participants.length > 0 && (
          <div className="mt-2 flex -space-x-2">
            {m.participants.slice(0, 8).map((p) => (
              <span key={p} title={p} className="rounded-full ring-2 ring-[var(--color-card)]">
                <Avatar name={p} size={28} />
              </span>
            ))}
            {m.participants.length > 8 && <span className="grid h-7 w-7 place-items-center rounded-full bg-track text-[10px] font-bold ring-2 ring-[var(--color-card)]">+{m.participants.length - 8}</span>}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {m.transcripts.filter((t) => t.url).map((t, k) => (
            <a key={k} href={t.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-full bg-track px-3 py-1.5 text-xs font-bold text-ink-2">
              📝 Transkript
            </a>
          ))}
          {m.recordings.filter((r) => r.url).map((r, k) => (
            <a key={k} href={r.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-full bg-track px-3 py-1.5 text-xs font-bold text-ink-2">
              ▶️ Kayıt
            </a>
          ))}
          {m.transcriptText && (
            <button
              onClick={() => ask(`${d.toLocaleDateString("tr-TR")} tarihli "${title}" toplantısının transkriptini özetle: alınan kararlar, bana düşen aksiyonlar ve takip edilmesi gerekenler.`)}
              className="flex items-center gap-1.5 rounded-full bg-blue px-3 py-1.5 text-xs font-bold text-white"
            >
              ✨ Toplantıyı özetle
            </button>
          )}
          <TaskButton make={() => newTodo({ title: `Toplantı takibi: ${title}`, due: iso(new Date()), tags: ["toplantı"] })} />
        </div>
      </div>
    </motion.div>
  );
}

function Empty({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div className="clay flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="text-4xl">{emoji}</div>
      <div className="text-sm font-semibold text-ink-2">{text}</div>
    </div>
  );
}

// ------------------------------------------------------------------ Arşiv (geriye dönük hafıza)
const allDone = (a: ArchiveProgress) => (["gmail", "chat", "meet", "calendar"] as const).every((k) => a.done[k]);
const SRC: Record<ArchiveSource, { icon: string; label: string; unit: string }> = {
  gmail: { icon: "✉️", label: "Gmail", unit: "e-posta" },
  chat: { icon: "💬", label: "Chat", unit: "mesaj" },
  meet: { icon: "🎥", label: "Meet", unit: "toplantı" },
  calendar: { icon: "📅", label: "Takvim", unit: "etkinlik" },
};
const monthYear = (s: string) => new Date(s).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });

function ArchiveTab() {
  const { archive, archiving, clearArchive } = useGoogle();
  const { ask } = useAssistant();
  const [q, setQ] = useState("");
  const [src, setSrc] = useState<ArchiveSource | "">("");
  const [hits, setHits] = useState<ArchiveHit[] | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setLoading(true);
    try {
      const p = new URLSearchParams({ q });
      if (src) p.set("source", src);
      const r = await fetch(`/api/google/archive?${p}`, { cache: "no-store" });
      setHits(r.ok ? (await r.json()).hits : []);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="clay p-5">
        <div className="flex items-center gap-3">
          <span className="text-3xl">📚</span>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-extrabold">Hafıza</div>
            <div className="text-sm text-ink-2">
              Geçmiş tüm e-postalar, Chat mesajları, toplantı transkriptleri ve takvim kalıcı olarak saklanır; asistan geçmişe dönük sorularda burada arar.
            </div>
          </div>
        </div>
        {archive ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {(Object.keys(SRC) as ArchiveSource[]).map((k) => {
                const s = archive.stats.bySource[k];
                const done = archive.done[k];
                return (
                  <div key={k} className="clay-sm rounded-2xl p-3">
                    <div className="flex items-center justify-between text-xs font-bold text-ink-3">
                      <span>
                        {SRC[k].icon} {SRC[k].label}
                      </span>
                      {done ? <span className="text-ok">✓ tamam</span> : <span className="text-blue">indiriliyor</span>}
                    </div>
                    <div className="mt-1 text-xl font-extrabold tabular-nums">{(s?.count ?? 0).toLocaleString("tr-TR")}</div>
                    <div className="text-[11px] text-ink-3">{s ? `${SRC[k].unit} · ${monthYear(s.oldest)}'den beri` : SRC[k].unit}</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
              {archiving || !allDone(archive) ? (
                <span className="flex items-center gap-1.5 font-semibold text-blue">
                  <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="inline-block h-3 w-3 rounded-full border-2 border-blue border-t-transparent" />
                  Geçmiş indiriliyor — uygulama açıkken arka planda sürer; kapatırsan kaldığı yerden devam eder.
                </span>
              ) : (
                <span className="font-semibold text-ok">Tüm geçmiş indirildi; yeni gelenler otomatik eklenir.</span>
              )}
              {archive.lastError && <span className="w-full break-words text-warn">⚠️ {archive.lastError}</span>}
            </div>
          </>
        ) : (
          <div className="mt-4">
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        )}
      </div>

      <form onSubmit={run} className="clay-pressed flex items-center gap-2 rounded-full p-1.5 pl-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Arşivde ara: kişi, konu, ürün, kod…" className="min-w-0 flex-1 bg-transparent py-2 text-[15px] outline-none placeholder:text-ink-3" />
        <select value={src} onChange={(e) => setSrc(e.target.value as ArchiveSource | "")} className="rounded-full bg-transparent px-1 py-2 text-xs font-bold text-ink-2 outline-none" aria-label="Kaynak">
          <option value="">Tümü</option>
          {(Object.keys(SRC) as ArchiveSource[]).map((k) => (
            <option key={k} value={k}>
              {SRC[k].label}
            </option>
          ))}
        </select>
        <motion.button whileTap={{ scale: 0.92 }} className="clay-color grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue text-white" aria-label="Ara">
          {loading ? <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="inline-block h-4 w-4 rounded-full border-2 border-white border-t-transparent" /> : "🔎"}
        </motion.button>
      </form>

      {hits && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-1 text-sm font-bold text-ink-2">
            <span>{hits.length ? `${hits.length} sonuç` : "Sonuç yok"}</span>
            {q.trim() && (
              <button onClick={() => ask(`Arşivde "${q.trim()}" hakkında ne var? Kronolojik özetle; kim ne zaman ne demiş, açık kalan konu var mı?`)} className="text-xs font-bold text-blue">
                ✨ Asistana özetlet
              </button>
            )}
          </div>
          {hits.map((h, i) => (
            <motion.a
              key={`${h.source}:${h.id}`}
              href={h.link}
              target="_blank"
              rel="noreferrer"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 10) * 0.03 }}
              className="clay-sm block rounded-2xl p-3.5"
            >
              <div className="flex items-center gap-2 text-xs text-ink-3">
                <span>{SRC[h.source].icon}</span>
                <span className="font-bold">{SRC[h.source].label}</span>
                <span>·</span>
                <span>{new Date(h.ts).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" })}</span>
                <span className="min-w-0 truncate">· {h.who}</span>
              </div>
              <div className="mt-0.5 truncate font-extrabold">{h.title}</div>
              <div className="mt-0.5 line-clamp-3 whitespace-pre-line text-sm text-ink-2">{h.excerpt}</div>
            </motion.a>
          ))}
        </div>
      )}

      <div className="flex justify-end px-1">
        <button
          onClick={async () => {
            if (confirm("Arşiv (hafıza) silinsin mi? Bağlantı kalır; geçmiş baştan indirilir.")) await clearArchive();
          }}
          className="text-xs font-bold text-ink-3 underline"
        >
          Arşivi sil ve baştan indir
        </button>
      </div>
    </div>
  );
}
