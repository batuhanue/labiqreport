"use client";

import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AREAS, areaByCode } from "@/lib/checklist";
import { MONTHS_SHORT, periodLabel } from "@/lib/period";
import type { InkColor, Note, NoteInk, Stroke } from "@/lib/types";
import { usePeriod } from "../PeriodProvider";
import { Icon } from "../ui";
import { colorOf, INK_COLORS, InkCanvas, type EditTool, type FingerMode, type InkCanvasHandle } from "./InkCanvas";

/* ------------------------------------------------------------------ bağlam */
interface NotesCtx {
  open: boolean;
  openNotes: (opts?: { areaCode?: string }) => void;
  close: () => void;
  toggle: () => void;
}
const Ctx = createContext<NotesCtx | null>(null);
export const useNotes = () => useContext(Ctx)!;

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export const NOTES_SHORTCUT = "N";

export function NotesProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [seedArea, setSeedArea] = useState<string | undefined>();
  const openNotes = useCallback((o?: { areaCode?: string }) => {
    setSeedArea(o?.areaCode);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // Genel kısayol: N (yazı alanında değilken) veya Alt/Option + N her yerde
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyN" || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.altKey) {
        e.preventDefault();
        setSeedArea(undefined);
        setOpen((v) => !v);
      } else if (!open && !isTyping(e.target)) {
        e.preventDefault();
        setSeedArea(undefined);
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const value = useMemo(() => ({ open, openNotes, close, toggle }), [open, openNotes, close, toggle]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <NotesPanel open={open} onClose={close} seedArea={seedArea} />
    </Ctx.Provider>
  );
}

/* ------------------------------------------------------------------ yardımcılar */
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const blankInk = (): NoteInk => ({ strokes: [], height: 1400, paper: "lined" });
const newNote = (areaCode?: string, mode: Note["mode"] = "text"): Note => {
  const now = new Date().toISOString();
  return { id: uid(), title: "", text: "", ink: blankInk(), areaCode, mode, createdAt: now, updatedAt: now };
};
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const titleOf = (n: Note) => n.title.trim() || n.text.trim().split("\n")[0]?.slice(0, 60) || (n.ink.strokes.length ? "El yazısı not" : "Yeni not");

const isEmpty = (n: Note) => !n.title.trim() && !n.text.trim() && n.ink.strokes.length === 0;
/** Boş notları at (keep hariç) */
const pruned = (list: Note[], keep?: string) => list.filter((n) => n.id === keep || !isEmpty(n));

const SIZES = [2.2, 3.6, 6];
const PREFS_KEY = "lq:ink";

/* ------------------------------------------------------------------ panel */
function NotesPanel({ open, onClose, seedArea }: { open: boolean; onClose: () => void; seedArea?: string }) {
  const { data, update } = usePeriod();
  const notes = useMemo(() => [...(data?.notes ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [data?.notes]);
  const [selId, setSelId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mobileView, setMobileView] = useState<"list" | "editor">("editor");
  const [mounted, setMounted] = useState(false);

  // araç tercihleri (cihazda hatırlanır)
  const [tool, setTool] = useState<EditTool>("pen");
  const [color, setColor] = useState<InkColor>("ink");
  const [size, setSize] = useState(SIZES[1]);
  const [finger, setFinger] = useState<FingerMode>("auto");
  const [penDetected, setPenDetected] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (p.color) setColor(p.color);
      if (p.size) setSize(p.size);
      if (p.finger) setFinger(p.finger);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ color, size, finger }));
    } catch {}
  }, [color, size, finger]);

  const sel = notes.find((n) => n.id === selId) ?? null;

  // açılışta: alan için yeni not veya son not
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current && data) {
      if (seedArea) {
        const n = newNote(seedArea);
        update((d) => ({ ...d, notes: [...pruned(d.notes), n] }));
        setSelId(n.id);
      } else if (!selId || !notes.some((n) => n.id === selId)) {
        setSelId(notes[0]?.id ?? null);
      }
      setMobileView(notes.length || seedArea ? "editor" : "list");
    }
    if (!open && wasOpen.current && data?.notes.some(isEmpty)) update((d) => ({ ...d, notes: pruned(d.notes) }));
    wasOpen.current = open;
  }, [open, seedArea, data, notes, selId, update]);

  /* ------- düzenleme */
  const history = useRef(new Map<string, { past: Stroke[][]; future: Stroke[][] }>());
  const hist = (id: string) => {
    let h = history.current.get(id);
    if (!h) history.current.set(id, (h = { past: [], future: [] }));
    return h;
  };

  const patch = useCallback(
    (id: string, fn: (n: Note) => Note) =>
      update((d) => ({ ...d, notes: d.notes.map((n) => (n.id === id ? { ...fn(n), updatedAt: new Date().toISOString() } : n)) })),
    [update],
  );

  const setInk = (ink: NoteInk) => {
    if (!sel) return;
    if (ink.strokes !== sel.ink.strokes) {
      const h = hist(sel.id);
      h.past.push(sel.ink.strokes);
      if (h.past.length > 200) h.past.shift();
      h.future = [];
    }
    patch(sel.id, (n) => ({ ...n, ink }));
  };

  const undo = useCallback(() => {
    if (!sel) return;
    const h = hist(sel.id);
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(sel.ink.strokes);
    patch(sel.id, (n) => ({ ...n, ink: { ...n.ink, strokes: prev } }));
  }, [sel, patch]);
  const redo = useCallback(() => {
    if (!sel) return;
    const h = hist(sel.id);
    const next = h.future.pop();
    if (!next) return;
    h.past.push(sel.ink.strokes);
    patch(sel.id, (n) => ({ ...n, ink: { ...n.ink, strokes: next } }));
  }, [sel, patch]);

  const create = useCallback(
    (mode: Note["mode"] = "text") => {
      if (!data) return;
      const n = newNote(undefined, mode);
      update((d) => ({ ...d, notes: [...pruned(d.notes), n] }));
      setSelId(n.id);
      setMobileView("editor");
      if (mode === "text") setTimeout(() => document.getElementById("note-text")?.focus(), 60);
    },
    [data, update],
  );

  const remove = () => {
    if (!sel || !confirm("Bu not silinsin mi?")) return;
    update((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== sel.id) }));
    const rest = notes.filter((n) => n.id !== sel.id);
    setSelId(rest[0]?.id ?? null);
    if (!rest.length) setMobileView("list");
  };

  const setMode = (mode: Note["mode"]) => {
    if (!sel) return;
    patch(sel.id, (n) => ({ ...n, mode }));
    if (mode === "text") setTimeout(() => document.getElementById("note-text")?.focus(), 60);
  };

  /* ------- panel içi kısayollar */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = isTyping(e.target);
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        if (typing) (e.target as HTMLElement).blur();
        else onClose();
        e.preventDefault();
        return;
      }
      if (mod && e.key.toLowerCase() === "z" && !typing && sel?.mode === "ink") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key === "Enter") {
        e.preventDefault();
        create("text");
        return;
      }
      if (typing || mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        create("text");
      } else if (k === "t") {
        e.preventDefault();
        setMode("text");
      } else if (k === "p" || k === "k") {
        setTool("pen");
        setMode("ink");
      } else if (k === "h") {
        setTool("marker");
        setMode("ink");
      } else if (k === "e") {
        setTool("eraser");
        setMode("ink");
      } else if (["1", "2", "3", "4", "5", "6"].includes(k)) {
        setColor(INK_COLORS[Number(k) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sel, undo, redo, create, onClose]);

  const canvasRef = useRef<InkCanvasHandle>(null);
  const filtered = notes.filter((n) => !query || `${n.title} ${n.text}`.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr")));

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[55] flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-scrim" onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-label="Notlar"
            className="relative flex h-dvh w-full flex-col overflow-hidden border border-line bg-card shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] sm:m-3 sm:h-[calc(100dvh-24px)] sm:max-w-[1100px] sm:rounded-[32px]"
            initial={{ x: 80, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
          >
            {!data ? (
              <div className="grid flex-1 place-items-center p-8 text-center">
                <div>
                  <div className="text-5xl">🗒️</div>
                  <div className="mt-3 text-lg font-extrabold">Önce bir dönem aç</div>
                  <p className="text-sm text-ink-3">Notlar dönemle birlikte saklanır.</p>
                  <button onClick={onClose} className="clay-dark mt-4 rounded-full px-5 py-2.5 font-bold">Kapat</button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1">
                {/* ------------ liste */}
                <div className={`${mobileView === "list" ? "flex" : "hidden"} w-full shrink-0 flex-col border-line md:flex md:w-72 md:border-r`}>
                  <div className="flex items-center gap-2 px-4 pb-2 pt-[max(16px,env(safe-area-inset-top))]">
                    <div className="min-w-0 flex-1">
                      <div className="text-xl font-extrabold">Notlar</div>
                      <div className="text-xs font-semibold text-ink-3">{periodLabel(data.period)} · {notes.length} not</div>
                    </div>
                    <button onClick={onClose} className="clay-sm grid h-10 w-10 place-items-center rounded-full md:hidden" aria-label="Kapat">
                      <Icon name="close" size={18} />
                    </button>
                  </div>
                  <div className="flex gap-2 px-4 pb-3">
                    <button onClick={() => create("text")} className="clay-dark flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-sm font-bold" title="Yeni yazılı not (N)">
                      <Icon name="edit" size={16} /> Yazı
                    </button>
                    <button onClick={() => create("ink")} className="clay-sm flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-sm font-bold" title="Yeni el yazısı not">
                      <PenGlyph /> Kalem
                    </button>
                  </div>
                  <div className="px-4 pb-2">
                    <input className="field py-2.5 text-sm" placeholder="Notlarda ara" value={query} onChange={(e) => setQuery(e.target.value)} />
                  </div>
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-4 pt-1">
                    {filtered.length === 0 && <div className="px-2 py-8 text-center text-sm text-ink-3">{notes.length ? "Sonuç yok" : "Henüz not yok. N ile hızlıca başla."}</div>}
                    {filtered.map((n) => {
                      const a = n.areaCode ? areaByCode(n.areaCode) : null;
                      const active = n.id === selId;
                      return (
                        <button
                          key={n.id}
                          onClick={() => {
                            if (sel && sel.id !== n.id && isEmpty(sel)) update((d) => ({ ...d, notes: pruned(d.notes, n.id) }));
                            setSelId(n.id);
                            setMobileView("editor");
                          }}
                          className={`w-full rounded-[20px] px-3.5 py-3 text-left transition ${active ? "clay-pressed" : "hover:bg-track"}`}
                        >
                          <div className="flex items-center gap-1.5">
                            {n.ink.strokes.length > 0 && <span className="text-xs">✍️</span>}
                            <span className="min-w-0 flex-1 truncate text-sm font-extrabold">{titleOf(n)}</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
                            <span>{fmtDate(n.updatedAt)}</span>
                            {a && (
                              <span className="rounded-full px-1.5 font-bold text-white" style={{ background: a.color }}>
                                {a.code}
                              </span>
                            )}
                            <span className="min-w-0 truncate">{n.text.replace(/\s+/g, " ").slice(0, 60)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <ShortcutHint />
                </div>

                {/* ------------ düzenleyici */}
                <div className={`${mobileView === "editor" ? "flex" : "hidden"} min-w-0 flex-1 flex-col md:flex`}>
                  {!sel ? (
                    <div className="grid flex-1 place-items-center p-8 text-center">
                      <div>
                        <div className="text-5xl">✍️</div>
                        <div className="mt-3 text-lg font-extrabold">Yeni bir not başlat</div>
                        <p className="text-sm text-ink-3">Klavyeyle yaz ya da kalemle el yazısı not al.</p>
                        <div className="mt-4 flex justify-center gap-2">
                          <button onClick={() => create("text")} className="clay-dark rounded-full px-5 py-2.5 font-bold">Yazı</button>
                          <button onClick={() => create("ink")} className="clay-sm rounded-full px-5 py-2.5 font-bold">Kalem</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* üst bar */}
                      <div className="flex items-center gap-2 border-b border-line px-3 pb-2 pt-[max(12px,env(safe-area-inset-top))] sm:px-4">
                        <button onClick={() => setMobileView("list")} className="clay-sm grid h-10 w-10 shrink-0 place-items-center rounded-full md:hidden" aria-label="Notlar">
                          <Icon name="back" size={18} />
                        </button>
                        <input
                          className="min-w-0 flex-1 bg-transparent text-lg font-extrabold outline-none placeholder:text-ink-3"
                          placeholder="Başlık"
                          value={sel.title}
                          onChange={(e) => patch(sel.id, (n) => ({ ...n, title: e.target.value }))}
                        />
                        <select
                          className="clay-sm max-w-[120px] rounded-full bg-card px-3 py-2 text-xs font-bold outline-none"
                          value={sel.areaCode ?? ""}
                          onChange={(e) => patch(sel.id, (n) => ({ ...n, areaCode: e.target.value || undefined }))}
                          title="Rapor alanına bağla"
                        >
                          <option value="">Alan yok</option>
                          {AREAS.map((a) => (
                            <option key={a.code} value={a.code}>
                              {a.code} · {a.title}
                            </option>
                          ))}
                        </select>
                        <button onClick={remove} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-3 hover:text-fail" aria-label="Notu sil">
                          <Icon name="trash" size={18} />
                        </button>
                        <button onClick={onClose} className="clay-sm hidden h-10 w-10 shrink-0 place-items-center rounded-full md:grid" aria-label="Kapat (Esc)" title="Kapat (Esc)">
                          <Icon name="close" size={18} />
                        </button>
                      </div>

                      {/* mod + araçlar */}
                      <div className="no-scrollbar flex items-center gap-2 overflow-x-auto border-b border-line px-3 py-2 sm:px-4">
                        <div className="clay-pressed flex shrink-0 rounded-full p-1">
                          {(["text", "ink"] as const).map((m) => (
                            <button
                              key={m}
                              onClick={() => setMode(m)}
                              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold transition ${sel.mode === m ? "bg-blue text-white shadow" : "text-ink-2"}`}
                              title={m === "text" ? "Yazı (T)" : "Kalem (P)"}
                            >
                              {m === "text" ? <Icon name="edit" size={15} /> : <PenGlyph />}
                              {m === "text" ? "Yazı" : "Kalem"}
                            </button>
                          ))}
                        </div>
                        {sel.mode === "ink" && (
                          <InkToolbar
                            tool={tool}
                            setTool={setTool}
                            color={color}
                            setColor={setColor}
                            size={size}
                            setSize={setSize}
                            finger={finger}
                            setFinger={setFinger}
                            penDetected={penDetected}
                            paper={sel.ink.paper}
                            setPaper={(paper) => patch(sel.id, (n) => ({ ...n, ink: { ...n.ink, paper } }))}
                            onUndo={undo}
                            onRedo={redo}
                            onClear={() => {
                              if (sel.ink.strokes.length && confirm("Sayfadaki tüm çizimler silinsin mi?")) setInk({ ...sel.ink, strokes: [] });
                            }}
                          />
                        )}
                      </div>

                      {/* içerik */}
                      {/* çizim alanı opak ve ayrı katmanda: cam efekti her karede yeniden hesaplanmasın */}
                      <div className={`relative min-h-0 flex-1 ${sel.mode === "ink" ? "bg-card [contain:strict] [will-change:transform]" : ""}`}>
                        {sel.mode === "text" ? (
                          <textarea
                            id="note-text"
                            className="h-full w-full resize-none bg-transparent px-5 py-4 text-[17px] leading-[1.65] outline-none placeholder:text-ink-3 sm:px-8 sm:py-6"
                            placeholder={"Notunu yaz…\n\niPad'de kalemle doğrudan bu alana da yazabilirsin (Scribble)."}
                            value={sel.text}
                            onChange={(e) => patch(sel.id, (n) => ({ ...n, text: e.target.value }))}
                            autoFocus
                          />
                        ) : (
                          <InkCanvas
                            key={sel.id}
                            ref={canvasRef}
                            ink={sel.ink}
                            onChange={setInk}
                            tool={tool}
                            color={color}
                            size={size}
                            finger={finger}
                            onPenDetected={() => setPenDetected(true)}
                          />
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2 text-[11px] text-ink-3">
                        <span>{sel.text.length ? `${sel.text.trim().split(/\s+/).filter(Boolean).length} kelime · ` : ""}{sel.ink.strokes.length ? `${sel.ink.strokes.length} çizgi · ` : ""}{fmtDate(sel.updatedAt)}</span>
                        <span className="hidden sm:inline">Otomatik kaydedilir</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ------------------------------------------------------------------ araç çubuğu */
function InkToolbar(p: {
  tool: EditTool;
  setTool: (t: EditTool) => void;
  color: InkColor;
  setColor: (c: InkColor) => void;
  size: number;
  setSize: (n: number) => void;
  finger: FingerMode;
  setFinger: (f: FingerMode) => void;
  penDetected: boolean;
  paper: NoteInk["paper"];
  setPaper: (p: NoteInk["paper"]) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}) {
  const tools: { t: EditTool; label: string; key: string; icon: React.ReactNode }[] = [
    { t: "pen", label: "Kalem", key: "P", icon: <PenGlyph /> },
    { t: "marker", label: "Fosforlu", key: "H", icon: <MarkerGlyph /> },
    { t: "eraser", label: "Silgi", key: "E", icon: <EraserGlyph /> },
  ];
  const fingerNext: Record<FingerMode, FingerMode> = { auto: "draw", draw: "scroll", scroll: "auto" };
  const fingerLabel: Record<FingerMode, string> = {
    auto: p.penDetected ? "Parmak: kaydırır (kalem algılandı)" : "Parmak: çizer (kalem yoksa)",
    draw: "Parmak: her zaman çizer",
    scroll: "Parmak: her zaman kaydırır",
  };
  const btn = (active: boolean) => `grid h-9 w-9 shrink-0 place-items-center rounded-full transition ${active ? "clay-pressed text-blue" : "text-ink-2 hover:bg-track"}`;
  const [, force] = useState(0);
  useEffect(() => {
    // tema değişince "ink" rengini yenile
    const mo = new MutationObserver(() => force((x) => x + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  return (
    <>
      <span className="mx-0.5 h-6 w-px shrink-0 bg-line" />
      {tools.map((x) => (
        <button key={x.t} onClick={() => p.setTool(x.t)} className={btn(p.tool === x.t)} title={`${x.label} (${x.key})`} aria-label={x.label}>
          {x.icon}
        </button>
      ))}
      <span className="mx-0.5 h-6 w-px shrink-0 bg-line" />
      {INK_COLORS.map((c, i) => (
        <button
          key={c}
          onClick={() => {
            p.setColor(c);
            if (p.tool === "eraser") p.setTool("pen");
          }}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
          title={`Renk ${i + 1}`}
          aria-label={`Renk ${i + 1}`}
        >
          <span
            className="block rounded-full transition-all"
            style={{
              width: p.color === c ? 22 : 16,
              height: p.color === c ? 22 : 16,
              background: colorOf(c),
              boxShadow: p.color === c ? `0 0 0 2px var(--color-card), 0 0 0 4px ${colorOf(c)}` : "inset 0 0 0 1px rgba(0,0,0,.1)",
            }}
          />
        </button>
      ))}
      <span className="mx-0.5 h-6 w-px shrink-0 bg-line" />
      {SIZES.map((s) => (
        <button key={s} onClick={() => p.setSize(s)} className={btn(p.size === s)} title="Kalınlık" aria-label="Kalınlık">
          <span className="rounded-full bg-current" style={{ width: s * 2.2, height: s * 2.2 }} />
        </button>
      ))}
      <span className="mx-0.5 h-6 w-px shrink-0 bg-line" />
      <button onClick={p.onUndo} className={btn(false)} title="Geri al (Ctrl/⌘+Z)" aria-label="Geri al">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
      </button>
      <button onClick={p.onRedo} className={btn(false)} title="Yinele (Ctrl/⌘+Shift+Z)" aria-label="Yinele">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
      </button>
      <span className="mx-0.5 h-6 w-px shrink-0 bg-line" />
      <button onClick={() => p.setFinger(fingerNext[p.finger])} className={btn(p.finger !== "auto")} title={fingerLabel[p.finger]} aria-label={fingerLabel[p.finger]}>
        <span className="text-base">{p.finger === "scroll" ? "🖐️" : p.finger === "draw" ? "☝️" : "🤚"}</span>
      </button>
      <button
        onClick={() => p.setPaper(p.paper === "lined" ? "grid" : p.paper === "grid" ? "blank" : "lined")}
        className={btn(false)}
        title={`Kâğıt: ${p.paper === "lined" ? "çizgili" : p.paper === "grid" ? "kareli" : "boş"}`}
        aria-label="Kâğıt"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="4" y="3.5" width="16" height="17" rx="3" />
          {p.paper !== "blank" && <path d="M7 9h10M7 13h10M7 17h10" />}
          {p.paper === "grid" && <path d="M10 6v12M14 6v12" />}
        </svg>
      </button>
      <button onClick={p.onClear} className={btn(false)} title="Sayfayı temizle" aria-label="Sayfayı temizle">
        <Icon name="trash" size={17} />
      </button>
    </>
  );
}

function ShortcutHint() {
  return (
    <div className="hidden border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ink-3 md:block">
      <b className="text-ink-2">Kısayollar</b>
      <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2">
        <Kbd>N</Kbd><span>aç / yeni not · <Kbd>Alt+N</Kbd> her yerden</span>
        <Kbd>T</Kbd><span>yazı · <Kbd>P</Kbd> kalem · <Kbd>H</Kbd> fosforlu · <Kbd>E</Kbd> silgi</span>
        <Kbd>1–6</Kbd><span>renk · <Kbd>⌘/Ctrl+Z</Kbd> geri al</span>
        <Kbd>Esc</Kbd><span>kapat</span>
      </div>
    </div>
  );
}

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded-md bg-track px-1.5 py-0.5 font-sans text-[10px] font-bold text-ink-2">{children}</kbd>
);

export function PenGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.5 4.5 19.5 8.5 9 19H5v-4z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}
function MarkerGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 15-3 3 1.5 1.5L5 22h5l1.5-1.5L13 22l3-3" />
      <path d="m9 15 8.5-8.5a2.1 2.1 0 0 1 3 3L12 18z" />
    </svg>
  );
}
function EraserGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 20h13" />
      <path d="m4.5 15.5 9.9-9.9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 18H7z" />
      <path d="m9 11 5.5 5.5" />
    </svg>
  );
}
