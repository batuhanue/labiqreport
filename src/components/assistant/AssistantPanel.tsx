"use client";

import { Marked } from "marked";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { dueLabel, newTodo, parseQuick, PRIORITY } from "@/lib/todo";
import { periodLabel } from "@/lib/period";
import { inkToJpeg } from "../notes/InkCanvas";
import { usePeriod } from "../PeriodProvider";
import { useTodos } from "../todos/TodoProvider";
import { useGoogle } from "../google/GoogleProvider";
import { Icon } from "../ui";
import { spring } from "@/lib/motion";
import { noteChoice } from "@/lib/learn-client";

/* ------------------------------------------------------------------ bağlam */
interface AssistantCtx {
  open: boolean;
  ask: (prompt?: string) => void;
  toggle: () => void;
  close: () => void;
}
const Ctx = createContext<AssistantCtx | null>(null);
export const useAssistant = () => useContext(Ctx)!;

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  error?: boolean;
  at: string;
  usage?: { prompt: number; cached: number; output: number; model?: string; rounds?: number; cost?: number | null };
  /** asistanın yaptığı arşiv aramaları (durum satırları) */
  steps?: string[];
}

const LS_CHAT = "lq:chat";
const LS_CHAT_ID = "lq:chat-id";
const LS_PREFS = "lq:assistant";

interface ChatMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  count: number;
}
const MEMORIZE = "🧠 Bu sohbette öğrendiklerini belleğe ekle.";

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<{ text: string; n: number } | null>(null);
  const ask = useCallback((prompt?: string) => {
    if (prompt) setSeed((s) => ({ text: prompt, n: (s?.n ?? 0) + 1 }));
    setOpen(true);
  }, []);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  // Kısayol: J (yazı alanında değilken) veya Alt/Option + J
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyJ" || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.altKey || !isTyping(e.target)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo(() => ({ open, ask, toggle, close }), [open, ask, toggle, close]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <AssistantPanel open={open} onClose={close} seed={seed} />
    </Ctx.Provider>
  );
}

/* ------------------------------------------------------------------ markdown */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    // ham HTML asla çalıştırılmaz
    html(t) {
      return esc(t.text ?? t.raw ?? "");
    },
    link(t) {
      const href = /^(https?:|mailto:)/i.test(t.href) ? t.href : "#";
      return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(t.text)}</a>`;
    },
    image(t) {
      return esc(t.text ?? "");
    },
  },
});

/** Yanıttan ```gorevler bloklarını ayırır. */
function splitTasks(text: string) {
  const tasks: string[] = [];
  const body = text.replace(/```gorevler\s*\n([\s\S]*?)(```|$)/g, (_, block: string) => {
    for (const l of block.split("\n")) {
      const t = l.replace(/^[-*•\d.)\s]+/, "").trim();
      if (t) tasks.push(t);
    }
    return "";
  });
  return { body: body.trim(), tasks };
}

/* ------------------------------------------------------------------ panel */
function AssistantPanel({ open, onClose, seed }: { open: boolean; onClose: () => void; seed: { text: string; n: number } | null }) {
  const { data } = usePeriod();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(false);
  const [sendInk, setSendInk] = useState(true);
  const [withGoogle, setWithGoogle] = useState(true);
  const googleOn = !!useGoogle()?.status?.connected;
  const [status, setStatus] = useState<{ configured: boolean; model: string } | null>(null);
  const [view, setView] = useState<"chat" | "knowledge" | "usage" | "chats">("chat");
  // sunucudaki sohbet: her cihazdan aynı sohbete devam edilir
  const [chatId, setChatId] = useState("");
  const synced = useRef<{ id: string; at: string }>({ id: "", at: "" });
  const dirty = useRef(false);
  const [diag, setDiag] = useState<Diag | null>(null);
  const runDiag = useCallback(async () => {
    setDiag({ loading: true });
    /** JSON beklenen bir isteği yapar; JSON gelmezse durum kodunu ve gövdenin başını hata olarak döndürür. */
    const get = async (url: string, ms: number): Promise<Record<string, unknown>> => {
      const t0 = Date.now();
      try {
        const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(ms) });
        const raw = await r.text();
        try {
          return { ...JSON.parse(raw), _status: r.status, _ms: Date.now() - t0 };
        } catch {
          return { _status: r.status, _ms: Date.now() - t0, _raw: raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240) || "(boş gövde)" };
        }
      } catch (e) {
        const err = e as Error;
        return { _ms: Date.now() - t0, _raw: err.name === "TimeoutError" ? `${ms / 1000} sn içinde yanıt gelmedi` : `${err.name}: ${err.message}` };
      }
    };
    // 1) sunucu ayakta mı (modele gitmeden)
    const ping = await get("/api/assistant", 15000);
    if (ping.configured === undefined) {
      setDiag({ server: { ok: false, detail: `HTTP ${ping._status ?? "—"} · ${String(ping.error ?? ping._raw ?? "")}` } });
    } else if (!ping.configured) {
      setDiag({ server: { ok: true, detail: `${ping._ms} ms` }, configured: false });
    } else {
      setDiag({ loading: true, server: { ok: true, detail: `${ping._ms} ms` } });
      // 2) Claude teşhisi
      const t = await get("/api/assistant?test=1", 70000);
      const server = { ok: true, detail: `${ping._ms} ms` };
      if (t.configured === undefined) setDiag({ server, configured: true, keyHint: ping.keyHint as string, model: ping.model as string, testError: `HTTP ${t._status ?? "—"} · ${String(t.error ?? t._raw ?? "")}` });
      else setDiag({ ...(t as Diag), server });
    }
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }));
  }, []);
  const [mounted, setMounted] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const userStopped = useRef(false);
  const stop = () => {
    userStopped.current = true;
    abort.current?.abort();
  };
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMounted(true);
    try {
      // sunucudan gelene kadar bu cihazdaki son kopya gösterilir
      setMsgs(JSON.parse(localStorage.getItem(LS_CHAT) || "[]"));
      setChatId(localStorage.getItem(LS_CHAT_ID) || crypto.randomUUID());
      const p = JSON.parse(localStorage.getItem(LS_PREFS) || "{}");
      if (typeof p.deep === "boolean") setDeep(p.deep);
      if (typeof p.sendInk === "boolean") setSendInk(p.sendInk);
      if (typeof p.google === "boolean") setWithGoogle(p.google);
    } catch {}
  }, []);
  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(LS_CHAT, JSON.stringify(msgs.slice(-60)));
      if (chatId) localStorage.setItem(LS_CHAT_ID, chatId);
      localStorage.setItem(LS_PREFS, JSON.stringify({ deep, sendInk, google: withGoogle }));
    } catch {}
  }, [msgs, chatId, deep, sendInk, withGoogle, mounted]);

  /** Sohbeti sunucudan yükler. */
  const loadChat = useCallback(async (id: string) => {
    const r = await fetch(`/api/assistant/chats?id=${id}`, { cache: "no-store" });
    const j = r.ok ? await r.json() : null;
    if (!j?.chat) return false;
    setChatId(id);
    setMsgs(j.chat.messages);
    synced.current = { id, at: j.chat.updatedAt };
    return true;
  }, []);

  const newChat = useCallback(() => {
    // yeni sohbet: yalnızca başka cihazda bundan sonra konuşulursa oraya geçilir
    const id = crypto.randomUUID();
    setChatId(id);
    setMsgs([]);
    synced.current = { id, at: new Date().toISOString() };
    setView("chat");
  }, []);

  /** Sohbeti sunucuya kaydeder (son yazan kazanır). */
  const saveChat = useCallback((id: string, messages: Msg[]) => {
    fetch("/api/assistant/chats", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, messages }) })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => {
        if (j?.chat) synced.current = { id, at: j.chat.updatedAt };
      })
      .catch(() => (dirty.current = true));
  }, []);

  // panel açılınca: başka cihazda daha yeni bir konuşma olduysa ona geç, bu sohbet başka yerde güncellendiyse yenile
  useEffect(() => {
    if (!open || !mounted || !chatId || busy) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/assistant/chats", { cache: "no-store" });
        if (!r.ok || cancelled) return;
        const list: ChatMeta[] = (await r.json()).chats ?? [];
        const latest = list[0];
        const mine = list.find((c) => c.id === chatId);
        const own = synced.current.id === chatId;
        if (!mine && msgs.length && !own) return saveChat(chatId, msgs); // bu cihazdaki kayıtsız (eski) sohbeti taşı
        const base = mine?.updatedAt ?? (own ? synced.current.at : "");
        if (latest && latest.id !== chatId && latest.updatedAt > base) await loadChat(latest.id);
        else if (mine && (!own || mine.updatedAt > synced.current.at)) await loadChat(mine.id);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted]);

  // her tamamlanan yanıttan sonra sohbeti sunucuya kaydet
  useEffect(() => {
    if (busy || !dirty.current || !chatId || !msgs.length) return;
    dirty.current = false;
    saveChat(chatId, msgs);
  }, [busy, msgs, chatId, saveChat]);

  useEffect(() => {
    if (!open || status) return;
    fetch("/api/assistant", { cache: "no-store" })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ configured: false, model: "" }));
  }, [open, status]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 250);
  }, [open]);

  const scrollDown = () => requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }));

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      const user: Msg = { id: crypto.randomUUID(), role: "user", text: q, at: new Date().toISOString() };
      const bot: Msg = { id: crypto.randomUUID(), role: "assistant", text: "", at: new Date().toISOString() };
      const history = [...msgs, user];
      setMsgs([...history, bot]);
      dirty.current = true;
      setInput("");
      setBusy(true);
      scrollDown();

      // el yazısı notları görüntü olarak
      const images: { mime: string; data: string; label: string }[] = [];
      if (sendInk && data?.notes) {
        for (const n of data.notes.filter((x) => x.ink.strokes.length).slice(-6)) {
          const img = inkToJpeg(n.ink);
          if (img) images.push({ ...img, label: `${n.title || "El yazısı not"}${n.areaCode ? ` (${n.areaCode})` : ""}` });
        }
      }

      const ctrl = new AbortController();
      abort.current = ctrl;
      userStopped.current = false;
      const payload = {
        messages: history.filter((m) => !m.error && m.text.trim()).map((m) => ({ role: m.role, text: m.text.replace(/\n\n_\((durduruldu|bağlantı kesildi)[^)]*\)_$/, "") })),
        period: data?.period,
        images,
        deep,
        google: withGoogle,
      };
      const setBot = (patch: Partial<Msg>) => setMsgs((m) => m.map((x) => (x.id === bot.id ? { ...x, ...patch } : x)));

      /** tek istek: akışlı ya da akışsız. Dönen metni ve kullanım bilgisini verir. */
      const run = async (stream: boolean) => {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, stream }),
          signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(75000)]),
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: `Sunucu hatası ${res.status}` }));
          throw Object.assign(new Error(err.error || `Sunucu hatası ${res.status}`), { server: true });
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          const [raw, meta] = acc.split("\u001eMETA");
          let usage: Msg["usage"];
          try {
            usage = meta ? JSON.parse(meta) : undefined;
          } catch {}
          setBot({ text: clean(raw), usage, steps: stepsOf(raw) });
          scrollDown();
        }
        return clean(acc.split("\u001eMETA")[0]);
      };

      try {
        let text = "";
        try {
          text = await run(true);
          // sunucu ile Claude arasındaki akış koptuysa akışsız yeniden dene
          if (/_\(bağlantı kesildi[^)]*\)_\s*$/.test(text)) throw new Error("akış koptu");
        } catch (e) {
          // kullanıcı durdurmadıysa ve sunucu açık bir hata vermediyse: akışsız yeniden dene
          if (userStopped.current || (e as { server?: boolean }).server || (e as Error).name === "TimeoutError") throw e;
          setBot({ text: "" });
          text = await run(false);
        }
        if (!text.trim()) {
          setBot({ text: "" });
          text = await run(false);
        }
        if (!text.trim()) setBot({ text: "_(boş yanıt)_" });
      } catch (e) {
        if (userStopped.current) {
          setMsgs((m) => m.map((x) => (x.id === bot.id ? { ...x, text: (x.text || "") + "\n\n_(durduruldu)_" } : x)));
        } else {
          const msg = (e as Error).message;
          const friendly = (e as Error).name === "TimeoutError"
            ? "Yanıt 75 sn içinde gelmedi. “Bağlantıyı test et” ile nerede takıldığına bakalım."
            : /failed to fetch|network|load failed|aborted/i.test(msg)
            ? "Sunucuyla bağlantı kurulamadı ya da yarıda kesildi. İnternet bağlantını kontrol edip tekrar dene; sürerse “Bağlantıyı test et”."
            : msg;
          setBot({ text: friendly, error: true });
        }
      } finally {
        setBusy(false);
        abort.current = null;
      }
    },
    [busy, msgs, data, deep, sendInk, withGoogle],
  );

  // dışarıdan gelen soru (ör. "Asistana sor")
  const lastSeed = useRef(0);
  useEffect(() => {
    if (open && seed && seed.n !== lastSeed.current) {
      lastSeed.current = seed.n;
      setView("chat");
      send(seed.text);
    }
  }, [open, seed, send]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (busy) stop();
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const p = data ? periodLabel(data.period) : "bu dönem";
  const SUGGEST = [
    googleOn ? "Bugün ne yapmalıyım? Toplantılarımı, e-postalarımı ve görevlerimi birlikte değerlendir." : "Bugün ne yapmalıyım? Öncelik sırasıyla söyle.",
    `${p} kapanışının durumu ne? Hangi alanlar geride?`,
    "Açık bulguları ve anomali notlarını sorumlulara göre listele.",
    "Cuma toplantısı için tek sayfa özet hazırla.",
    "Termini geçen veya yaklaşan alanlar için görev öner.",
    "R-05'te hangi kontroller eksik, neye dikkat etmeliyim?",
  ];

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[56] flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-scrim" onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-label="Asistan"
            className="glass-strong relative flex h-dvh w-full flex-col overflow-hidden sm:m-3 sm:h-[calc(100dvh-24px)] sm:max-w-[720px] sm:rounded-[32px]"
            initial={{ x: 80, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
          >
            {/* başlık */}
            <div className="flex items-center gap-3 border-b border-line px-4 pb-3 pt-[max(14px,env(safe-area-inset-top))]">
              <motion.div
                className="clay-color grid h-11 w-11 place-items-center text-xl text-white"
                style={{ borderRadius: 16, background: "linear-gradient(135deg,#8b5cf6,#5b7cff 60%,#2ec4b6)", ["--glow" as string]: "rgba(139,92,246,.5)" }}
                animate={busy ? { rotate: [0, 8, -8, 0], scale: [1, 1.06, 1] } : {}}
                transition={{ repeat: busy ? Infinity : 0, duration: 1.2 }}
              >
                ✨
              </motion.div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-extrabold leading-tight">Asistan</div>
                <div className="truncate text-xs font-semibold text-ink-3">
                  {status?.model || "Claude"} · {data ? periodLabel(data.period) : "dönem seçili değil"} verisiyle
                </div>
              </div>
              <button onClick={() => setView(view === "usage" ? "chat" : "usage")} className={`grid h-10 w-10 place-items-center rounded-full ${view === "usage" ? "clay-pressed text-blue" : "clay-sm"}`} title="Token kullanımı" aria-label="Kullanım">
                <Icon name="chart" size={18} />
              </button>
              <button onClick={() => setView(view === "chat" ? "knowledge" : "chat")} className={`grid h-10 w-10 place-items-center rounded-full ${view === "knowledge" ? "clay-pressed text-blue" : "clay-sm"}`} title="Bilgi dosyaları (.md)" aria-label="Bilgi dosyası">
                <Icon name="note" size={18} />
              </button>
              <button onClick={() => setView(view === "chats" ? "chat" : "chats")} className={`grid h-10 w-10 place-items-center rounded-full ${view === "chats" ? "clay-pressed text-blue" : "clay-sm"}`} title="Geçmiş sohbetler" aria-label="Sohbetler">
                <Icon name="history" size={18} />
              </button>
              {msgs.length > 0 && view === "chat" && (
                <button onClick={() => !busy && newChat()} className="clay-sm grid h-10 w-10 place-items-center rounded-full" title="Yeni sohbet" aria-label="Yeni sohbet">
                  <Icon name="plus" size={18} />
                </button>
              )}
              <button onClick={onClose} className="clay-sm grid h-10 w-10 place-items-center rounded-full" aria-label="Kapat (Esc)">
                <Icon name="close" size={18} />
              </button>
            </div>

            {view === "knowledge" ? (
              <KnowledgeEditor />
            ) : view === "chats" ? (
              <ChatList
                current={chatId}
                onOpen={async (id) => {
                  if (busy) return;
                  if (id !== chatId) await loadChat(id);
                  setView("chat");
                }}
                onNew={() => !busy && newChat()}
                onDeleted={(id) => id === chatId && newChat()}
              />
            ) : view === "usage" ? (
              <UsageView />
            ) : (
              <>
                {/* mesajlar */}
                <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
                  {status && !status.configured && (
                    <div className="clay-sm bg-tint-warn p-4 text-sm">
                      <b>Anthropic API anahtarı tanımlı değil.</b> Vercel → Settings → Environment Variables'a <code>ANTHROPIC_API_KEY</code> ekleyip yeniden dağıtın.
                      Anahtarı <a className="font-bold text-blue underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">Anthropic Console</a>'dan alabilirsiniz.
                    </div>
                  )}
                  {msgs.length === 0 && (
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="pt-4 text-center">
                      <div className="text-4xl">👋</div>
                      <div className="mt-2 text-xl font-extrabold">Merhaba Batuhan</div>
                      <p className="mx-auto mt-1 max-w-md text-sm text-ink-2">
                        İş tanımını, 10 başlığın güncel durumunu, anomali notlarını, aksiyonları, notlarını ve görevlerini okuyarak yanıt veririm.
                      </p>
                      <button onClick={runDiag} className="mt-3 text-xs font-bold text-blue underline">Bağlantıyı test et</button>
                      <div className="mt-5 grid gap-2 text-left sm:grid-cols-2">
                        {SUGGEST.map((s, i) => (
                          <motion.button
                            key={s}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.05 * i, ...spring.enter }}
                            whileHover={{ y: -2 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => send(s)}
                            className="clay-sm rounded-2xl px-4 py-3 text-sm font-semibold"
                          >
                            {s}
                          </motion.button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                  {msgs.map((m, i) => (
                    <Bubble
                      key={m.id}
                      m={m}
                      streaming={busy && i === msgs.length - 1}
                      onRetry={
                        m.error && i === msgs.length - 1 && !busy
                          ? () => {
                              const q = [...msgs.slice(0, i)].reverse().find((x) => x.role === "user")?.text;
                              if (!q) return;
                              setMsgs(msgs.slice(0, Math.max(0, i - 1)));
                              setTimeout(() => send(q), 0);
                            }
                          : undefined
                      }
                      onTest={m.error ? runDiag : undefined}
                    />
                  ))}
                  {diag && <DiagCard d={diag} onClose={() => setDiag(null)} />}
                </div>

                {/* giriş */}
                <div className="border-t border-line px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 sm:px-5">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-bold text-ink-3">
                    <button onClick={() => setDeep((v) => !v)} className={`rounded-full px-3 py-1.5 ${deep ? "bg-blue text-white" : "bg-track"}`} title="Daha uzun düşünür, daha yavaş yanıt verir">
                      🧠 Derin düşün {deep ? "açık" : "kapalı"}
                    </button>
                    <button onClick={() => setSendInk((v) => !v)} className={`rounded-full px-3 py-1.5 ${sendInk ? "bg-blue text-white" : "bg-track"}`} title="Dönemdeki el yazısı notları görüntü olarak gönderilir">
                      ✍️ El yazısı notları {sendInk ? "dahil" : "hariç"}
                    </button>
                    {googleOn && (
                      <button onClick={() => setWithGoogle((v) => !v)} className={`rounded-full px-3 py-1.5 ${withGoogle ? "bg-blue text-white" : "bg-track"}`} title="Takvim, Gmail, Chat ve Meet verisi asistana gönderilir">
                        📬 Google {withGoogle ? "dahil" : "hariç"}
                      </button>
                    )}
                    {msgs.some((m) => m.role === "assistant" && !m.error) && (
                      <button
                        onClick={() => send(MEMORIZE)}
                        disabled={busy}
                        className="rounded-full bg-tint-info px-3 py-1.5 text-blue disabled:opacity-40"
                        title="Sohbette öğrenilen süreç, kural, tercih ve kararları kalıcı belleğe (gelistirme.md) yazar"
                      >
                        🧠 Belleğe ekle
                      </button>
                    )}
                    <span className="ml-auto hidden sm:inline">Enter gönder · Shift+Enter satır · Esc kapat</span>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      send(input);
                    }}
                    className="clay-pressed flex items-end gap-2 rounded-[24px] p-2"
                  >
                    <textarea
                      ref={inputRef}
                      rows={1}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          send(input);
                        }
                      }}
                      placeholder="Sor: “R-02'deki anomaliler ne, kime yazmalıyım?”"
                      className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] outline-none placeholder:text-ink-3"
                      style={{ fieldSizing: "content" } as React.CSSProperties}
                    />
                    {busy ? (
                      <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={stop} className="clay-sm grid h-11 w-11 shrink-0 place-items-center rounded-full text-fail" aria-label="Durdur">
                        <span className="h-3.5 w-3.5 rounded-sm bg-current" />
                      </motion.button>
                    ) : (
                      <motion.button type="submit" whileTap={{ scale: 0.9 }} disabled={!input.trim()} className="clay-dark grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:opacity-40" aria-label="Gönder">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 19V5M5 12l7-7 7 7" />
                        </svg>
                      </motion.button>
                    )}
                  </form>
                </div>
              </>
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ------------------------------------------------------------------ bağlantı teşhisi */
interface Diag {
  loading?: boolean;
  server?: { ok: boolean; detail: string };
  configured?: boolean;
  model?: string;
  keyHint?: string | null;
  warning?: string;
  listStatus?: number;
  listError?: string;
  modelFound?: boolean;
  testStatus?: number;
  testText?: string;
  testError?: string;
  ms?: number;
  ok?: boolean;
}

function DiagCard({ d, onClose }: { d: Diag; onClose: () => void }) {
  const row = (ok: boolean | undefined, label: string, detail?: React.ReactNode) => (
    <div className="flex gap-2.5 py-1.5">
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-extrabold text-white ${ok ? "bg-ok" : ok === false ? "bg-fail" : "bg-na"}`}>{ok ? "✓" : ok === false ? "✗" : "–"}</span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-bold">{label}</div>
        {detail && <div className="break-words text-xs text-ink-2">{detail}</div>}
      </div>
    </div>
  );
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="clay-sm relative rounded-[22px] p-4">
      <button onClick={onClose} className="absolute right-3 top-3 text-ink-3" aria-label="Kapat">
        <Icon name="close" size={14} />
      </button>
      <div className="mb-1 font-extrabold">🔌 Bağlantı testi</div>
      {d.server && row(d.server.ok, "Uygulama sunucusu yanıt veriyor", d.server.ok ? d.server.detail : `${d.server.detail} · Vercel → Deployments → son deploy → Logs`)}
      {d.loading ? (
        <div className="py-2 text-sm text-ink-3">{d.server ? "Claude'a bağlanılıyor…" : "Sunucu kontrol ediliyor…"}</div>
      ) : d.server && !d.server.ok ? null : (
        <>
          {row(d.configured, "ANTHROPIC_API_KEY tanımlı", d.configured ? d.keyHint : "Vercel → Settings → Environment Variables (Production) + Redeploy")}
          {d.warning && row(false, "Anahtar biçimi", d.warning)}
          {d.configured && row(d.listStatus === 200, "Anahtar geçerli", d.listStatus === 200 ? "Anthropic API anahtarı doğrulandı" : `HTTP ${d.listStatus ?? "?"} · ${d.listError ?? ""}`)}
          {d.configured && d.listStatus === 200 && row(d.modelFound, `Model: ${d.model}`, d.modelFound ? "Hesabında kullanılabilir" : `Bu model bulunamadı · Vercel'de ANTHROPIC_MODEL ile değiştirebilirsin (ör. claude-haiku-5-5)`)}
          {d.configured && row(d.ok, "Deneme isteği", d.ok ? `“${d.testText}” · ${d.ms} ms` : `HTTP ${d.testStatus ?? "?"} · ${d.testError ?? ""}`)}
          {d.ok && <div className="mt-2 rounded-xl bg-tint-info px-3 py-2 text-xs">Bağlantı sağlam. Sorun sürerse yanıt süresi uzun olabilir; “Derin düşün”ü kapatıp tekrar dene.</div>}
        </>
      )}
    </motion.div>
  );
}

/** sunucunun \u001fS…\u001f durum satırları (arşiv aramaları) */
const stepsOf = (raw: string) => [...raw.matchAll(/\u001fS([^\u001f]*)\u001f/g)].map((m) => m[1]);
/** Metni durum işaretlerinden arındırır; \u001fX<n>\u001f gelince (yarıda kopan tur) son n karakter silinir. */
const clean = (raw: string) => {
  let out = "";
  for (const seg of raw.replace(/\u001f[^\u001f]*$/, "").split(/(\u001f[^\u001f]*\u001f)/)) {
    if (seg.startsWith("\u001f")) {
      const m = seg.match(/^\u001fX(\d+)\u001f$/);
      if (m) out = out.slice(0, Math.max(0, out.length - Number(m[1])));
    } else out += seg;
  }
  return out;
};

/** Arşiv aramaları: yanıt beklerken son adım canlı, sonra katlanmış özet. */
function Steps({ steps, live }: { steps: string[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const searches = steps.filter((x) => /^(🔎|📄)/u.test(x)).length;
  const memory = steps.filter((x) => x.startsWith("🧠")).length;
  if (live) {
    return (
      <motion.div key={steps.length} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-ink-3">
        <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="inline-block h-3 w-3 rounded-full border-2 border-blue border-t-transparent" />
        {steps.at(-1)}
      </motion.div>
    );
  }
  return (
    <div className="mb-2 text-xs text-ink-3">
      <button onClick={() => setOpen((v) => !v)} className="font-bold hover:text-blue">
        {[
          searches && `📚 Arşivde ${searches} arama`,
          memory && `🧠 Belleğe ${memory} kayıt`,
          !searches && !memory && `${steps.length} adım`,
        ]
          .filter(Boolean)
          .join(" · ")}{" "}
        {open ? "▴" : "▾"}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-1">
          {steps.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ mesaj balonu */
function Bubble({ m, streaming, onRetry, onTest }: { m: Msg; streaming: boolean; onRetry?: () => void; onTest?: () => void }) {
  const { body, tasks } = useMemo(() => (m.role === "assistant" ? splitTasks(m.text) : { body: m.text, tasks: [] }), [m]);
  const html = useMemo(() => (m.role === "assistant" ? md.parse(body) : ""), [m.role, body]);
  const [copied, setCopied] = useState(false);

  if (m.role === "user") {
    return (
      <motion.div initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring.enter} className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-[22px] rounded-br-md bg-blue px-4 py-2.5 text-[15px] font-medium text-white shadow-md">{m.text}</div>
      </motion.div>
    );
  }
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring.enter} className="flex gap-2.5">
      <div className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#5b7cff)" }}>
        ✨
      </div>
      <div className="min-w-0 flex-1">
        <div className={`clay-sm rounded-[22px] rounded-tl-md px-4 py-3 ${m.error ? "bg-tint-fail" : ""}`}>
          {!!m.steps?.length && !m.error && <Steps steps={m.steps} live={streaming && !m.text.trim()} />}
          {!m.text && streaming ? (
            <div className="flex gap-1.5 py-1.5">
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="h-2 w-2 rounded-full bg-ink-3" animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.15 }} />
              ))}
            </div>
          ) : m.error ? (
            <div>
              <div className="text-sm font-semibold text-fail">⚠️ {m.text}</div>
              {(onRetry || onTest) && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {onRetry && (
                    <button onClick={onRetry} className="clay-dark rounded-full px-3.5 py-1.5 text-xs font-bold">
                      Tekrar dene
                    </button>
                  )}
                  {onTest && (
                    <button onClick={onTest} className="clay-sm rounded-full px-3.5 py-1.5 text-xs font-bold">
                      Bağlantıyı test et
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="md text-[15px] leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
          )}
          {streaming && m.text && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-blue align-middle" />}
        </div>
        {tasks.length > 0 && !streaming && <TaskSuggestions tasks={tasks} />}
        {!streaming && m.usage && (
          <span className="ml-2 text-[11px] font-semibold text-ink-3" title="Sabit bilgi dosyaları Claude istem önbelleğinden okunur (~%90 indirimli). Her arşiv araması bir tur daha ekler.">
            {Math.round(m.usage.prompt / 1000)}k token{m.usage.cached ? ` · ${Math.round(m.usage.cached / 1000)}k önbellekten ⚡` : ""}
            {m.usage.rounds && m.usage.rounds > 1 ? ` · ${m.usage.rounds} tur` : ""}
            {m.usage.cost != null ? ` · $${m.usage.cost < 0.01 ? m.usage.cost.toFixed(4) : m.usage.cost.toFixed(3)}` : ""}
          </span>
        )}
        {!streaming && m.text && !m.error && (
          <button
            onClick={() => {
              navigator.clipboard?.writeText(m.text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="mt-1 px-2 text-xs font-bold text-ink-3 hover:text-ink"
          >
            {copied ? "Kopyalandı ✓" : "Kopyala"}
          </button>
        )}
      </div>
    </motion.div>
  );
}

function TaskSuggestions({ tasks }: { tasks: string[] }) {
  const { add } = useTodos();
  const { toast } = usePeriod();
  const [added, setAdded] = useState<Set<number>>(new Set());
  const parsed = useMemo(() => tasks.map((t) => parseQuick(t)), [tasks]);
  const addOne = (i: number) => {
    if (added.has(i) || !parsed[i].title) return;
    add(newTodo({ ...parsed[i] }));
    setAdded((s) => new Set(s).add(i));
    noteChoice({ where: "asistan", kind: "todo_add", title: parsed[i].title, detail: tasks[i] });
  };
  return (
    <div className="clay-sm mt-2 rounded-[22px] p-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-extrabold uppercase tracking-wide text-ink-3">Önerilen görevler</span>
        {added.size < parsed.length && (
          <button
            onClick={() => {
              parsed.forEach((_, i) => addOne(i));
              toast(`${parsed.length - added.size} görev eklendi`);
            }}
            className="rounded-full bg-blue px-3 py-1 text-xs font-bold text-white"
          >
            Hepsini ekle
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {parsed.map((p, i) => (
          <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="flex items-center gap-2 rounded-2xl bg-track px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{p.title}</div>
              <div className="flex flex-wrap gap-x-2 text-[11px] font-semibold text-ink-3">
                {p.due && <span>📅 {dueLabel(p.due, p.time)}</span>}
                {p.priority < 4 && <span style={{ color: PRIORITY[p.priority].color }}>● {PRIORITY[p.priority].label}</span>}
                {p.person && <span>👤 {p.person}</span>}
                {p.areaCode && <span>{p.areaCode}</span>}
                {p.tags.map((t) => (
                  <span key={t}>#{t}</span>
                ))}
              </div>
            </div>
            <motion.button
              whileTap={{ scale: 0.85 }}
              onClick={() => addOne(i)}
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${added.has(i) ? "bg-ok text-white" : "clay-sm text-blue"}`}
              aria-label="Görevlere ekle"
            >
              <Icon name={added.has(i) ? "check" : "plus"} size={16} stroke={2.8} />
            </motion.button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ bilgi dosyaları düzenleyici */
interface KFile {
  name: string;
  md: string;
  source: "default" | "edited" | "custom";
  updatedAt?: string;
}
const SOURCE_LABEL: Record<KFile["source"], string> = { default: "Varsayılan (depoda)", edited: "Düzenlendi", custom: "Eklenen dosya" };

function KnowledgeEditor() {
  const { toast } = usePeriod();
  const [files, setFiles] = useState<KFile[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [md, setMd] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = (list: KFile[], pick?: string) => {
    setFiles(list);
    const name = pick && list.some((f) => f.name === pick) ? pick : sel && list.some((f) => f.name === sel) ? sel : list[0]?.name ?? null;
    setSel(name);
    setMd(list.find((f) => f.name === name)?.md ?? "");
    setDirty(false);
  };

  useEffect(() => {
    fetch("/api/assistant/knowledge", { cache: "no-store" })
      .then((r) => r.json())
      .then((k) => apply(k.files ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cur = files.find((f) => f.name === sel);

  const save = async (name: string, text: string) => {
    setBusy(true);
    const r = await fetch("/api/assistant/knowledge", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, md: text }) });
    setBusy(false);
    if (!r.ok) return toast((await r.json().catch(() => ({}))).error || "Kaydedilemedi");
    const k = await r.json();
    apply(k.files, (k.files as KFile[]).find((f) => f.name.toLowerCase() === name.toLowerCase() || f.name.startsWith(name.replace(/\.md$/i, "")))?.name ?? name);
    toast("Bilgi dosyası kaydedildi");
  };

  const remove = async () => {
    if (!cur) return;
    const msg = cur.source === "edited" ? `${cur.name} varsayılan haline dönsün mü?` : `${cur.name} silinsin mi?`;
    if (!confirm(msg)) return;
    const r = await fetch(`/api/assistant/knowledge?name=${encodeURIComponent(cur.name)}`, { method: "DELETE" });
    if (r.ok) apply((await r.json()).files, cur.source === "edited" ? cur.name : undefined);
  };

  const total = files.reduce((a, f) => a + f.md.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-extrabold">Bilgi dosyaları — asistan seni bunlardan tanır</div>
          <div className="text-xs text-ink-3">
            {files.length} dosya · {Math.round(total / 1000)} bin karakter · her soruda hepsi sırayla okunur
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          className="hidden"
          onChange={async (e) => {
            const list = [...(e.target.files ?? [])];
            for (const f of list) await save(f.name, await f.text());
            e.target.value = "";
          }}
        />
        <button onClick={() => fileRef.current?.click()} className="clay-sm flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold">
          <Icon name="upload" size={15} /> .md ekle
        </button>
      </div>

      {/* dosya sekmeleri */}
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {files.map((f) => (
          <button
            key={f.name}
            onClick={() => {
              if (dirty && !confirm("Kaydedilmemiş değişiklikler kaybolsun mu?")) return;
              setSel(f.name);
              setMd(f.md);
              setDirty(false);
            }}
            className={`relative shrink-0 rounded-2xl px-3.5 py-2 text-left text-xs font-bold ${sel === f.name ? "clay-dark" : "clay-sm"}`}
          >
            <div className="max-w-[220px] truncate">{f.name}</div>
            <div className={`text-[10px] font-semibold ${sel === f.name ? "opacity-70" : "text-ink-3"}`}>
              {SOURCE_LABEL[f.source]} · {Math.round(f.md.length / 1000)}k
            </div>
          </button>
        ))}
      </div>

      <textarea
        className="field min-h-0 flex-1 resize-none font-mono text-[13px] leading-relaxed"
        value={md}
        onChange={(e) => {
          setMd(e.target.value);
          setDirty(true);
        }}
        spellCheck={false}
        disabled={!cur}
      />
      <div className="flex items-center justify-between gap-3">
        {cur && cur.source !== "default" ? (
          <button onClick={remove} className="rounded-full px-3 py-2 text-sm font-bold text-ink-3 hover:text-fail">
            {cur.source === "edited" ? "Varsayılana dön" : "Dosyayı sil"}
          </button>
        ) : (
          <span className="text-xs text-ink-3">{md.length.toLocaleString("tr-TR")} karakter</span>
        )}
        <button disabled={!dirty || busy || !cur} onClick={() => cur && save(cur.name, md)} className="clay-dark rounded-full px-6 py-3 font-extrabold disabled:opacity-40">
          {busy ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ geçmiş sohbetler */
function ChatList({ current, onOpen, onNew, onDeleted }: { current: string; onOpen: (id: string) => void; onNew: () => void; onDeleted: (id: string) => void }) {
  const [list, setList] = useState<ChatMeta[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    fetch("/api/assistant/chats", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => setList(j.chats ?? []))
      .catch((e) => setErr(e.message));
  }, []);
  const remove = async (c: ChatMeta) => {
    if (!confirm(`“${c.title}” sohbeti silinsin mi?`)) return;
    const r = await fetch(`/api/assistant/chats?id=${c.id}`, { method: "DELETE" });
    if (!r.ok) return;
    setList((l) => l?.filter((x) => x.id !== c.id) ?? null);
    onDeleted(c.id);
  };
  const day = (s: string) => new Date(s).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
  const shown = (list ?? []).filter((c) => !q.trim() || c.title.toLocaleLowerCase("tr").includes(q.trim().toLocaleLowerCase("tr")));
  const groups = shown.reduce<[string, ChatMeta[]][]>((g, c) => {
    const d = day(c.updatedAt);
    if (g.at(-1)?.[0] === d) g.at(-1)![1].push(c);
    else g.push([d, [c]]);
    return g;
  }, []);

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sohbetlerde ara…" className="clay-pressed min-w-0 flex-1 rounded-full px-4 py-2.5 text-sm outline-none" />
        <button onClick={onNew} className="clay-dark shrink-0 rounded-full px-4 py-2.5 text-sm font-extrabold">
          + Yeni sohbet
        </button>
      </div>
      {err && <div className="text-sm text-fail">Sohbetler okunamadı: {err}</div>}
      {!list && !err && <div className="text-sm text-ink-3">Yükleniyor…</div>}
      {list && !shown.length && <div className="pt-6 text-center text-sm text-ink-3">{q ? "Eşleşen sohbet yok." : "Henüz kayıtlı sohbet yok."}</div>}
      {groups.map(([d, cs]) => (
        <div key={d}>
          <div className="mb-1.5 px-1 text-[11px] font-extrabold uppercase tracking-wide text-ink-3">{d}</div>
          <div className="space-y-1.5">
            {cs.map((c) => (
              <div key={c.id} className={`clay-sm flex items-center gap-2 rounded-2xl pr-2 ${c.id === current ? "ring-2 ring-blue/60" : ""}`}>
                <button onClick={() => onOpen(c.id)} className="min-w-0 flex-1 px-4 py-3 text-left">
                  <div className="truncate text-sm font-bold">{c.title}</div>
                  <div className="text-[11px] font-semibold text-ink-3">
                    {new Date(c.updatedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} · {c.count} mesaj{c.id === current ? " · açık" : ""}
                  </div>
                </button>
                <button onClick={() => remove(c)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-3 hover:text-fail" aria-label="Sohbeti sil" title="Sil">
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ token kullanımı */
interface UsageData {
  days: Record<string, { requests: number; prompt: number; cached: number; output: number; cost: number; errors: number }>;
  recent: { at: string; model: string; rounds: number; prompt: number; cached: number; written: number; output: number; cost: number | null; ms: number; error?: string; retries?: number; label?: string }[];
  model: string;
}

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const usd = (n: number | null | undefined) => (n == null ? "—" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

function UsageView() {
  const [u, setU] = useState<UsageData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/assistant?usage=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setU)
      .catch((e) => setErr(e.message));
  }, []);
  if (err) return <div className="p-6 text-sm text-fail">Kullanım okunamadı: {err}</div>;
  if (!u) return <div className="p-6 text-sm text-ink-3">Yükleniyor…</div>;

  const dayKey = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
  const empty = { requests: 0, prompt: 0, cached: 0, output: 0, cost: 0, errors: 0 };
  const today = u.days[dayKey(new Date())] ?? empty;
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400_000);
    return { key: dayKey(d), label: d.toLocaleDateString("tr-TR", { weekday: "short" }), v: u.days[dayKey(d)] };
  });
  const month = Object.entries(u.days)
    .filter(([d]) => d.slice(0, 7) === dayKey(new Date()).slice(0, 7))
    .reduce((s, [, v]) => s + v.cost, 0);
  const max = Math.max(1, ...last7.map((x) => (x.v ? x.v.prompt + x.v.output : 0)));
  const week = last7.reduce((s, x) => ({ req: s.req + (x.v?.requests ?? 0), tok: s.tok + (x.v ? x.v.prompt + x.v.output : 0), cached: s.cached + (x.v?.cached ?? 0), prompt: s.prompt + (x.v?.prompt ?? 0), cost: s.cost + (x.v?.cost ?? 0) }), { req: 0, tok: 0, cached: 0, prompt: 0, cost: 0 });
  const ok = u.recent.filter((r) => !r.error);
  const avg = ok.length ? ok.reduce((s, r) => s + (r.cost ?? 0), 0) / ok.length : 0;

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          { l: "Bugün", v: `${today.requests} soru`, s: usd(today.cost) },
          { l: "Bu ay", v: usd(month), s: "tahmini maliyet" },
          { l: "Önbellek oranı (bugün)", v: today.prompt ? `%${Math.round((today.cached / today.prompt) * 100)}` : "—", s: `${k(today.prompt + today.output)} token` },
          { l: "Soru başına ort.", v: avg ? usd(avg) : "—", s: ok.length ? `son ${ok.length} soru` : "" },
        ].map((x) => (
          <div key={x.l} className="clay-sm rounded-2xl p-3">
            <div className="text-[11px] font-bold text-ink-3">{x.l}</div>
            <div className="text-xl font-extrabold tabular-nums">{x.v}</div>
            <div className="text-[11px] text-ink-3">{x.s}</div>
          </div>
        ))}
      </div>

      <div className="clay-sm rounded-2xl p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <div className="text-sm font-extrabold">Son 7 gün</div>
          <div className="text-[11px] font-semibold text-ink-3">
            {week.req} soru · {k(week.tok)} token · {week.prompt ? `%${Math.round((week.cached / week.prompt) * 100)}` : "—"} önbellekten · {usd(week.cost)}
          </div>
        </div>
        <div className="flex h-28 items-end gap-2">
          {last7.map((x) => {
            const tot = x.v ? x.v.prompt + x.v.output : 0;
            const h = (tot / max) * 100;
            return (
              <div key={x.key} className="flex flex-1 flex-col items-center gap-1" title={x.v ? `${x.v.requests} soru · ${k(tot)} token · ${k(x.v.cached)} önbellekten · ${usd(x.v.cost)} · ${x.v.errors} hata` : "kullanım yok"}>
                <div className="relative flex h-20 w-full items-end">
                  <div className="relative w-full overflow-hidden rounded-t-md bg-blue/80" style={{ height: `${h}%`, minHeight: tot ? 3 : 0 }}>
                    <div className="absolute inset-x-0 bottom-0 bg-ok/80" style={{ height: `${tot && x.v ? (x.v.cached / tot) * 100 : 0}%` }} />
                  </div>
                </div>
                <div className="text-[10px] font-bold text-ink-3">{x.label}</div>
                {x.v?.errors ? <div className="text-[9px] font-bold text-fail">{x.v.errors}⚠</div> : <div className="h-[13px]" />}
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex gap-3 text-[10px] font-bold text-ink-3">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-ok/80" /> önbellekten (~%90 indirimli)
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-blue/80" /> tam fiyat + çıktı
          </span>
        </div>
      </div>

      <div className="clay-sm rounded-2xl p-4">
        <div className="mb-2 text-sm font-extrabold">Son istekler</div>
        {!u.recent.length && <div className="text-xs text-ink-3">Henüz kayıt yok.</div>}
        <div className="space-y-1.5">
          {u.recent.slice(0, 12).map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
              <span className="w-[86px] shrink-0 font-bold tabular-nums text-ink-3">{new Date(r.at).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              {r.error ? (
                <details className="min-w-0 flex-1 font-semibold text-fail">
                  <summary className="cursor-pointer truncate">⚠ {r.error}</summary>
                  <div className="mt-1 whitespace-pre-wrap break-words font-medium">{r.error}</div>
                </details>
              ) : (
                <span className="min-w-0 flex-1 font-semibold tabular-nums">
                  {r.label ? `${r.label} · ` : ""}
                  {k(r.prompt)} giriş ({k(r.cached)} önbellekten{r.written ? ` · ${k(r.written)} önbelleğe yazıldı` : ""}) · {k(r.output)} çıkış · {r.rounds} tur · {(r.ms / 1000).toFixed(1)} sn
                </span>
              )}
              {!!r.retries && <span className="rounded-full bg-track px-1.5 font-bold">{r.retries} tekrar</span>}
              <span className="rounded-full bg-tint-info px-1.5 font-bold text-blue">{usd(r.cost)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1 px-1 text-[11px] text-ink-3">
        <div>
          Model: <b>{u.model}</b> · fiyatlar Anthropic liste fiyatından tahmin edilir; kesin tutar Anthropic Console → Usage'dadır.
        </div>
        <div>Sabit bilgi dosyaları önbellekten okunur; her arşiv araması bir “tur” ekler.</div>
      </div>
    </div>
  );
}
