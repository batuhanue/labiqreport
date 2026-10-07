"use client";

import { getStroke } from "perfect-freehand";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { InkColor, InkTool, NoteInk, Stroke } from "@/lib/types";

/**
 * Düşük gecikmeli el yazısı tuvali.
 * - İki katman: alt katmanda kaydedilmiş çizgiler (önbellekli Path2D), üst katmanda yalnızca çizilen çizgi.
 * - Pointer Events + getCoalescedEvents (120–240 Hz kalem örnekleri) + getPredictedEvents (gecikme telafisi).
 * - desynchronized canvas bağlamı (Chrome/Edge'de ekran gecikmesini düşürür).
 * - Avuç içi reddi: kalem algılandıktan sonra parmak çizmez, kaydırır. İki parmak her zaman kaydırır.
 * - Koordinatlar mantıksal (sayfa genişliği 800) — her cihazda aynı oranla görünür.
 */

export const LOGICAL_W = 800;
const MIN_SCALE = 0.7; // telefonda yazı çok küçülmesin; gerekirse yatay kaydırılır
const MAX_H = 6000;
const GROW_STEP = 800;

export type EditTool = InkTool | "eraser";
export type FingerMode = "auto" | "draw" | "scroll";

const COLORS: Record<InkColor, string> = {
  ink: "", // temadan
  blue: "#3f63f0",
  red: "#ef4459",
  green: "#22a55a",
  orange: "#f08a24",
  yellow: "#f5c518",
};
export const INK_COLORS = Object.keys(COLORS) as InkColor[];
export const colorOf = (c: InkColor) => (c === "ink" ? getComputedStyle(document.documentElement).getPropertyValue("--color-ink").trim() || "#1f2330" : COLORS[c]);

function strokeOptions(s: Pick<Stroke, "size" | "tool" | "pen">, scale: number, last: boolean) {
  const marker = s.tool === "marker";
  return {
    size: s.size * scale,
    thinning: marker ? 0 : s.pen ? 0.62 : 0.5,
    smoothing: 0.55,
    streamline: s.pen ? 0.32 : 0.45,
    simulatePressure: !s.pen && !marker,
    start: { taper: marker ? 0 : 0, cap: true },
    end: { taper: marker ? 0 : s.pen ? 0 : 6 * scale, cap: true },
    last,
  };
}

function outlineToPath(points: number[][]): Path2D {
  const path = new Path2D();
  if (points.length < 2) return path;
  const [x0, y0] = points[0];
  path.moveTo(x0, y0);
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    path.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
  }
  path.closePath();
  return path;
}

function toInput(pts: number[], scale: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < pts.length; i += 3) out.push([pts[i] * scale, pts[i + 1] * scale, pts[i + 2]]);
  return out;
}

// Çizgi başına önbellek (ölçek değişince geçersiz)
const pathCache = new WeakMap<Stroke, { scale: number; path: Path2D }>();
function pathOf(s: Stroke, scale: number) {
  const c = pathCache.get(s);
  if (c && c.scale === scale) return c.path;
  const path = outlineToPath(getStroke(toInput(s.pts, scale), strokeOptions(s, scale, true)));
  pathCache.set(s, { scale, path });
  return path;
}

const bboxCache = new WeakMap<Stroke, [number, number, number, number]>();
function bboxOf(s: Stroke) {
  let b = bboxCache.get(s);
  if (!b) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < s.pts.length; i += 3) {
      const x = s.pts[i], y = s.pts[i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    b = [x0, y0, x1, y1];
    bboxCache.set(s, b);
  }
  return b;
}

function paint(ctx: CanvasRenderingContext2D, s: Stroke, path: Path2D) {
  ctx.globalAlpha = s.tool === "marker" ? 0.38 : 1;
  ctx.fillStyle = colorOf(s.color);
  ctx.fill(path);
  ctx.globalAlpha = 1;
}

export interface InkCanvasHandle {
  scrollToTop: () => void;
}

interface Props {
  ink: NoteInk;
  onChange: (ink: NoteInk) => void;
  tool: EditTool;
  color: InkColor;
  size: number;
  finger: FingerMode;
  onPenDetected?: () => void;
}

export const InkCanvas = forwardRef<InkCanvasHandle, Props>(function InkCanvas({ ink, onChange, tool, color, size, finger, onPenDetected }, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const [cssW, setCssW] = useState(0);
  const [boxH, setBoxH] = useState(0);
  const [themeTick, setThemeTick] = useState(0);
  const scale = cssW / LOGICAL_W;

  // en güncel değerler (olay işleyicilerinde stale closure olmasın)
  const st = useRef({ ink, tool, color, size, finger, scale, onChange });
  st.current = { ink, tool, color, size, finger, scale, onChange };

  const live = useRef<{ id: number; stroke: Stroke; predicted: number[] } | null>(null);
  const penSeen = useRef(false);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const panning = useRef(false);
  const erasing = useRef<number | null>(null);
  const raf = useRef(0);
  const dirty = useRef<[number, number, number, number] | null>(null);

  useImperativeHandle(ref, () => ({ scrollToTop: () => scrollRef.current?.scrollTo({ top: 0 }) }));

  // genişlik takibi
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setCssW(Math.max(el.clientWidth, LOGICAL_W * MIN_SCALE));
      setBoxH(el.clientHeight);
    });
    ro.observe(el);
    setCssW(Math.max(el.clientWidth, LOGICAL_W * MIN_SCALE));
    setBoxH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // tema değişince mürekkep rengini yeniden çiz
  useEffect(() => {
    const mo = new MutationObserver(() => setThemeTick((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  // kâğıt en az görünür alan kadar uzun olsun; altına bir parça kaydırma payı
  const cssH = Math.max(ink.height * scale, boxH + (boxH ? 240 : 0));
  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2.5) : 1;

  // tuval boyutları
  useLayoutEffect(() => {
    for (const c of [baseRef.current, liveRef.current]) {
      if (!c || !cssW) continue;
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
    }
  }, [cssW, cssH, dpr]);

  // alt katmanı tamamen yeniden çiz
  const redrawBase = useCallback(() => {
    const c = baseRef.current;
    if (!c || !scale) return;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    for (const s of st.current.ink.strokes) paint(ctx, s, pathOf(s, scale));
  }, [scale, dpr]);

  useLayoutEffect(() => {
    redrawBase();
  }, [redrawBase, ink.strokes, cssH, themeTick]);

  // üst katman: yalnızca çizilmekte olan çizgi
  const drawLive = useCallback(() => {
    raf.current = 0;
    const c = liveRef.current;
    if (!c) return;
    let ctx = (c as HTMLCanvasElement & { _ctx?: CanvasRenderingContext2D })._ctx;
    if (!ctx) {
      ctx = (c.getContext("2d", { desynchronized: true }) ?? c.getContext("2d"))!;
      (c as HTMLCanvasElement & { _ctx?: CanvasRenderingContext2D })._ctx = ctx;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // yalnızca önceki çizimin kapladığı alanı temizle (büyük tuvalde tam temizlemekten çok daha hızlı)
    const prev = dirty.current;
    if (prev) ctx.clearRect(prev[0], prev[1], prev[2] - prev[0], prev[3] - prev[1]);
    dirty.current = null;
    const l = live.current;
    if (!l) return;
    const sc = st.current.scale;
    const input = toInput(l.stroke.pts.concat(l.predicted), sc);
    const path = outlineToPath(getStroke(input, strokeOptions(l.stroke, sc, false)));
    paint(ctx, l.stroke, path);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of input) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const pad = l.stroke.size * sc * 2 + 4;
    dirty.current = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }, [dpr]);

  const schedule = () => {
    if (!raf.current) raf.current = requestAnimationFrame(drawLive);
  };

  const toLogical = (e: { clientX: number; clientY: number }) => {
    const r = liveRef.current!.getBoundingClientRect();
    const sc = st.current.scale || 1;
    return [(e.clientX - r.left) / sc, (e.clientY - r.top) / sc] as const;
  };

  const pressureOf = (e: PointerEvent) => (e.pointerType === "pen" ? Math.max(0.05, e.pressure || 0.5) : 0.5);

  const eraseAt = (x: number, y: number) => {
    const s = st.current;
    const r = 14;
    const keep = s.ink.strokes.filter((k) => {
      const [x0, y0, x1, y1] = bboxOf(k);
      const pad = r + k.size;
      if (x < x0 - pad || x > x1 + pad || y < y0 - pad || y > y1 + pad) return true;
      const rr = (r + k.size / 2) ** 2;
      for (let i = 0; i < k.pts.length; i += 3) {
        const dx = k.pts[i] - x, dy = k.pts[i + 1] - y;
        if (dx * dx + dy * dy < rr) return false;
      }
      return true;
    });
    if (keep.length !== s.ink.strokes.length) s.onChange({ ...s.ink, strokes: keep });
  };

  const commit = () => {
    const l = live.current;
    live.current = null;
    if (!l) return;
    const s = st.current;
    const stroke = l.stroke;
    // yuvarla (veri boyutu)
    stroke.pts = stroke.pts.map((v, i) => (i % 3 === 2 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10));
    // alt katmana hemen çiz (titreme olmasın)
    const c = baseRef.current;
    if (c && s.scale) {
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(ctx, stroke, pathOf(stroke, s.scale));
    }
    schedule();
    let maxY = 0;
    for (let i = 1; i < stroke.pts.length; i += 3) maxY = Math.max(maxY, stroke.pts[i]);
    const visibleH = Math.max(s.ink.height, (liveRef.current?.clientHeight ?? 0) / (s.scale || 1));
    const height = maxY > visibleH - 220 ? Math.min(MAX_H, Math.round(visibleH + GROW_STEP)) : s.ink.height;
    s.onChange({ ...s.ink, strokes: [...s.ink.strokes, stroke], height });
  };

  // olay dinleyicileri (passive: false — kaydırma/zoom'u engelleyebilmek için)
  useEffect(() => {
    const el = liveRef.current;
    if (!el) return;

    const down = (e: PointerEvent) => {
      if (e.pointerType === "pen" && !penSeen.current) {
        penSeen.current = true;
        onPenDetected?.();
      }
      if (e.pointerType === "touch") {
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const fm = st.current.finger;
        const fingerScrolls = fm === "scroll" || (fm === "auto" && penSeen.current);
        if (touches.current.size >= 2 || fingerScrolls) {
          // iki parmak: çizimi iptal et, kaydır
          if (live.current && live.current.id !== -1 && touches.current.size >= 2) {
            live.current = null;
            schedule();
          }
          panning.current = true;
          return;
        }
      }
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
      const [x, y] = toLogical(e);
      const s = st.current;
      if (s.tool === "eraser") {
        erasing.current = e.pointerId;
        eraseAt(x, y);
        return;
      }
      live.current = {
        id: e.pointerId,
        predicted: [],
        stroke: { tool: s.tool, color: s.color, size: s.tool === "marker" ? s.size * 3.2 : s.size, pen: e.pointerType === "pen", pts: [x, y, pressureOf(e)] },
      };
      schedule();
    };

    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch" && touches.current.has(e.pointerId)) {
        const prev = touches.current.get(e.pointerId)!;
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (panning.current) {
          const n = Math.max(1, touches.current.size);
          scrollRef.current?.scrollBy({ left: (prev.x - e.clientX) / n, top: (prev.y - e.clientY) / n });
          return;
        }
      }
      if (erasing.current === e.pointerId) {
        const evs = e.getCoalescedEvents?.() ?? [e];
        for (const ev of evs.length ? evs : [e]) {
          const [x, y] = toLogical(ev);
          eraseAt(x, y);
        }
        return;
      }
      const l = live.current;
      if (!l || l.id !== e.pointerId) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents?.() ?? [];
      for (const ev of evs.length ? evs : [e]) {
        const [x, y] = toLogical(ev);
        l.stroke.pts.push(x, y, pressureOf(ev));
      }
      l.predicted = [];
      for (const ev of e.getPredictedEvents?.() ?? []) {
        const [x, y] = toLogical(ev);
        l.predicted.push(x, y, pressureOf(ev));
      }
      schedule();
    };

    const up = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        touches.current.delete(e.pointerId);
        if (touches.current.size === 0) panning.current = false;
      }
      if (erasing.current === e.pointerId) erasing.current = null;
      if (live.current?.id === e.pointerId) {
        if (e.type === "pointercancel") {
          live.current = null;
          schedule();
        } else commit();
      }
    };

    // iOS: uzun basma menüsü / büyüteç / çift dokunma zoom'unu engelle
    const blockTouch = (e: TouchEvent) => {
      if (!panning.current) e.preventDefault();
    };

    el.addEventListener("pointerdown", down, { passive: false });
    el.addEventListener("pointermove", move, { passive: false });
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("touchstart", blockTouch, { passive: false });
    el.addEventListener("touchmove", blockTouch, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("touchstart", blockTouch);
      el.removeEventListener("touchmove", blockTouch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpr]);

  const line = Math.max(8, 44 * scale);
  const paperBg =
    ink.paper === "lined"
      ? `repeating-linear-gradient(to bottom, transparent 0, transparent ${line - 1}px, var(--color-line) ${line - 1}px, var(--color-line) ${line}px)`
      : ink.paper === "grid"
        ? `linear-gradient(var(--color-line) 1px, transparent 1px) 0 0 / ${line}px ${line}px, linear-gradient(90deg, var(--color-line) 1px, transparent 1px) 0 0 / ${line}px ${line}px`
        : "none";

  const cursor = tool === "eraser" ? "cell" : "crosshair";

  return (
    <div ref={scrollRef} className="relative h-full w-full overflow-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
      <div className="relative" style={{ width: cssW || "100%", height: cssH || 600, background: paperBg, backgroundPositionY: `${line * 2}px` }}>
        <canvas ref={baseRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        <canvas
          ref={liveRef}
          className="absolute inset-0 h-full w-full select-none"
          style={{ touchAction: "none", cursor, WebkitUserSelect: "none", WebkitTouchCallout: "none" } as React.CSSProperties}
        />
      </div>
    </div>
  );
});
