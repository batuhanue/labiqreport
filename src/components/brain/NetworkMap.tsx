"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HEALTH_COLOR, HEALTH_LABEL, KIND_LABEL_ORG, type OrgAgent, type OrgDept, type OrgProcess, type OrgState } from "@/lib/org-types";

/*
 * Ajan ağı (MAP): merkezde Bilgi Çekirdeği, çevresinde departman kümeleri ve ajanlar, arşiv büyüklüğüne göre
 * bilgi parçacıkları, çekirdekten departmanlara ve çalışan ajanlara akan darbeler, uyarıda sarı üçgen.
 * Sağda sistem sağlığı, departmanlar (ajan başına durum noktası) ve süreç analitiği; bir ajana tıkla → ayrıntı.
 */

interface Node {
  id: string;
  x: number;
  y: number;
  r: number;
  dept: number;
  agent?: OrgAgent;
  lead?: boolean;
}
interface Layout {
  w: number;
  h: number;
  cx: number;
  cy: number;
  R: number;
  /** dar ekran: kısa etiket, alt yazı yok */
  compact: boolean;
  depts: { x: number; y: number; ang: number; d: OrgDept }[];
  nodes: Node[];
  stars: [number, number, number][];
  parts: { r: number; a: number; s: number; c: string; tw: number; w: number }[];
}

const WARM = ["#ff7a1a", "#ff5a1f", "#ffb02e", "#ff8f3f", "#ff4f4f", "#ffd166", "#f78fb3", "#b388ff"];
const SIDE = 372;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function computeLayout(org: OrgState, w: number, h: number, wide: boolean): Layout {
  const mapW = wide ? w - SIDE - 24 : w;
  const cx = mapW / 2 + (wide ? 0 : 0);
  const cy = h / 2;
  const R = Math.min(mapW, h) * 0.44;
  const compact = R < 210;
  const n = org.depts.length;
  const depts = org.depts.map((d, i) => {
    const ang = -Math.PI / 2 + (i / n) * Math.PI * 2 + Math.PI / n;
    return { x: cx + Math.cos(ang) * R * 0.6, y: cy + Math.sin(ang) * R * 0.6, ang, d };
  });
  const nodes: Node[] = [];
  depts.forEach((dp, i) => {
    const lead = dp.d.agents.find((a) => a.lead) ?? dp.d.agents[0];
    nodes.push({ id: lead.id, x: dp.x, y: dp.y, r: compact ? 14 : 17, dept: i, agent: lead, lead: true });
    const rest = dp.d.agents.filter((a) => a !== lead);
    const scale = Math.min(1, R / 300);
    rest.forEach((a, k) => {
      const side = k % 2 ? 1 : -1;
      const step = Math.floor(k / 2);
      const off = side * (0.32 + step * (rest.length > 8 ? 0.26 : 0.36));
      const rad = (40 + step * (rest.length > 8 ? 9 : 12) + (k % 2) * 4) * scale + 8;
      nodes.push({ id: a.id, x: dp.x + Math.cos(dp.ang + off) * rad, y: dp.y + Math.sin(dp.ang + off) * rad, r: compact ? 5.5 : 6.5, dept: i, agent: a });
    });
  });
  const r = rng(17);
  const stars: [number, number, number][] = Array.from({ length: 220 }, () => [r() * w, r() * h, r()]);
  const count = Math.round(Math.min(1600, Math.max(650, 650 + org.core.archive / 10 + org.core.memory * 6)));
  const parts = Array.from({ length: count }, () => {
    const t = Math.pow(r(), 0.75);
    return { r: t * R * 0.97, a: r() * Math.PI * 2, s: 0.5 + r() * 1.5, c: WARM[Math.floor(r() * WARM.length)], tw: r() * 6.28, w: (0.02 + r() * 0.05) * (r() < 0.5 ? 1 : -1) };
  });
  return { w, h, cx, cy, R, compact, depts, nodes, stars, parts };
}

export default function NetworkMap() {
  const [org, setOrg] = useState<OrgState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [focusDept, setFocusDept] = useState<number | null>(null);
  const [hover, setHover] = useState<{ n: Node; x: number; y: number } | null>(null);
  const [wide, setWide] = useState(true);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layout = useRef<Layout | null>(null);
  const state = useRef({ sel: null as string | null, dept: null as number | null, hover: null as string | null });
  state.current = { sel, dept: focusDept, hover: hover?.n.id ?? null };

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/org", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setOrg(j);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, org?.totals.working ? 8000 : 45000);
    return () => clearInterval(t);
  }, [load, org?.totals.working]);

  // boyut + yerleşim
  useEffect(() => {
    const el = wrap.current;
    if (!el || !org) return;
    const fit = () => {
      const w = el.clientWidth;
      const isWide = w >= 1024;
      setWide(isWide);
      const h = isWide ? el.clientHeight : Math.min(640, Math.max(420, w * 1.2));
      layout.current = computeLayout(org, w, h, isWide);
      const c = canvas.current!;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = w * dpr;
      c.height = h * dpr;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      c.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [org]);

  // çizim döngüsü
  useEffect(() => {
    const c = canvas.current;
    if (!c || !org) return;
    const ctx = c.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // canvas yazı tipi CSS değişkenini çözmez → gerçek aileyi bir kez oku
    const FF = getComputedStyle(c).fontFamily || "sans-serif";
    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      const L = layout.current;
      if (!L) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const t = ((now - t0) / 1000) * (reduce ? 0.15 : 1);
      const { cx, cy, R } = L;
      const S = state.current;
      ctx.clearRect(0, 0, L.w, L.h);
      // zemin
      const bg = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, Math.max(L.w, L.h) * 0.75);
      bg.addColorStop(0, "#2a0f06");
      bg.addColorStop(0.45, "#12070a");
      bg.addColorStop(1, "#06070c");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, L.w, L.h);
      for (const [x, y, k] of L.stars) {
        ctx.globalAlpha = 0.25 + 0.35 * Math.abs(Math.sin(t * 0.6 + k * 20));
        ctx.fillStyle = "#cfd6ff";
        ctx.fillRect(x, y, k > 0.85 ? 1.6 : 1, k > 0.85 ? 1.6 : 1);
      }
      ctx.globalAlpha = 1;
      // küre çizgileri
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,140,70,0.28)";
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,140,70,0.07)";
      for (let k = 0; k < 6; k++) {
        const ph = t * 0.06 + (k * Math.PI) / 6;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(Math.cos(ph)) * R, R, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const la of [-0.6, -0.3, 0.3, 0.6]) {
        ctx.beginPath();
        ctx.ellipse(cx, cy + Math.sin(la) * R, Math.cos(la) * R, Math.cos(la) * R * 0.18, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // bilgi parçacıkları
      for (const p of L.parts) {
        const a = p.a + (t * p.w * 60) / Math.max(40, p.r);
        const x = cx + Math.cos(a) * p.r;
        const y = cy + Math.sin(a) * p.r;
        ctx.globalAlpha = 0.35 + 0.45 * Math.abs(Math.sin(t * 0.8 + p.tw)) * (1 - (p.r / R) * 0.35);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(x, y, p.s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // çekirdek → departman bağlantıları ve darbeler
      L.depts.forEach((dp, i) => {
        const dim = S.dept != null && S.dept !== i ? 0.25 : 1;
        const mx = (cx + dp.x) / 2 + Math.cos(dp.ang + Math.PI / 2) * 24;
        const my = (cy + dp.y) / 2 + Math.sin(dp.ang + Math.PI / 2) * 24;
        ctx.strokeStyle = dp.d.color;
        ctx.globalAlpha = 0.35 * dim;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(mx, my, dp.x, dp.y);
        ctx.stroke();
        const busy = dp.d.agents.some((a) => a.health === "working");
        const pulses = busy ? 4 : 2;
        for (let k = 0; k < pulses; k++) {
          const u = (t * (busy ? 0.55 : 0.22) + k / pulses + i * 0.13) % 1;
          const qx = (1 - u) * (1 - u) * cx + 2 * (1 - u) * u * mx + u * u * dp.x;
          const qy = (1 - u) * (1 - u) * cy + 2 * (1 - u) * u * my + u * u * dp.y;
          ctx.globalAlpha = dim * (0.5 + 0.5 * Math.sin(u * Math.PI));
          ctx.fillStyle = "#ffe0a8";
          ctx.beginPath();
          ctx.arc(qx, qy, busy ? 2.6 : 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      // departman → ajan bağlantıları
      ctx.lineWidth = 0.8;
      for (const n of L.nodes) {
        if (n.lead) continue;
        const dp = L.depts[n.dept];
        const dim = S.dept != null && S.dept !== n.dept ? 0.2 : 1;
        ctx.globalAlpha = 0.28 * dim;
        ctx.strokeStyle = dp.d.color;
        ctx.beginPath();
        ctx.moveTo(dp.x, dp.y);
        ctx.lineTo(n.x, n.y);
        ctx.stroke();
        if (n.agent?.health === "working") {
          const u = (t * 0.9) % 1;
          ctx.globalAlpha = dim;
          ctx.fillStyle = "#ffd28a";
          ctx.beginPath();
          ctx.arc(dp.x + (n.x - dp.x) * u, dp.y + (n.y - dp.y) * u, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      // çekirdek
      const pulse = 1 + 0.06 * Math.sin(t * 2);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 70 * pulse);
      g.addColorStop(0, "rgba(255,214,102,0.95)");
      g.addColorStop(0.25, "rgba(255,170,60,0.55)");
      g.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, 70 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffd166";
      ctx.beginPath();
      ctx.arc(cx, cy, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff6dc";
      ctx.beginPath();
      ctx.arc(cx, cy, 5 + Math.sin(t * 3) * 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,230,200,0.92)";
      ctx.font = `800 12px ${FF}`;
      ctx.fillText("BİLGİ ÇEKİRDEĞİ", cx, cy + 32);
      ctx.fillStyle = "rgba(255,210,170,0.55)";
      ctx.font = `600 10px ${FF}`;
      if (!L.compact) ctx.fillText(`${org.core.files} dosya · ${org.core.memory} anı · ${org.core.archive.toLocaleString("tr-TR")} kayıt`, cx, cy + 47);
      // ajanlar
      for (const n of L.nodes) {
        const a = n.agent!;
        const dp = L.depts[n.dept];
        const dim = S.dept != null && S.dept !== n.dept ? 0.3 : 1;
        const col = a.health === "ok" ? dp.d.color : HEALTH_COLOR[a.health];
        const hot = a.health === "working";
        const isSel = S.sel === a.id || S.hover === a.id;
        ctx.globalAlpha = dim;
        // parıltı
        const gr = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * (hot ? 3.4 + Math.sin(t * 6) * 0.5 : 2.4));
        gr.addColorStop(0, `${col}aa`);
        gr.addColorStop(1, `${col}00`);
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * (hot ? 3.6 : 2.6), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#14090a";
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = a.health === "idle" ? "rgba(160,170,190,0.6)" : col;
        ctx.lineWidth = n.lead ? 3 : 2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.stroke();
        if (isSel) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 5 + Math.sin(t * 4), 0, Math.PI * 2);
          ctx.stroke();
        }
        if (n.lead) {
          ctx.fillStyle = "#fff4e6";
          ctx.font = `800 12px ${FF}`;
          ctx.fillText(String(dp.d.agents.length), n.x, n.y + 0.5);
          // departman etiketi (çekirdek tarafında; yandakiler yatay hizalı, üst/alttakiler ortalı)
          const ux = -Math.cos(dp.ang);
          const uy = -Math.sin(dp.ang);
          const side = Math.abs(ux) > 0.8;
          const lx = side ? n.x + ux * (n.r + 10) : L.compact ? n.x : n.x + ux * 22;
          const ly = side ? n.y - (L.compact ? 0 : 7) : uy > 0 ? n.y + n.r + 16 : n.y - n.r - (L.compact ? 14 : 30);
          ctx.textAlign = side ? (ux > 0 ? "left" : "right") : "center";
          ctx.lineJoin = "round";
          ctx.strokeStyle = "rgba(10,6,8,0.85)";
          ctx.lineWidth = 4;
          ctx.font = `800 ${L.compact ? 10.5 : 12}px ${FF}`;
          const name = (L.compact ? dp.d.name.split(" & ")[0] : dp.d.name).toLocaleUpperCase("tr");
          ctx.strokeText(name, lx, ly);
          ctx.fillStyle = "rgba(255,240,225,0.95)";
          ctx.fillText(name, lx, ly);
          if (!L.compact) {
            ctx.font = `600 10.5px ${FF}`;
            ctx.strokeText(dp.d.sub, lx, ly + 15);
            ctx.fillStyle = "rgba(255,210,170,0.7)";
            ctx.fillText(dp.d.sub, lx, ly + 15);
          }
          ctx.textAlign = "center";
        } else if (a.health === "working") {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        if (a.health === "alert" || a.health === "error") {
          const tx = n.x + n.r * 0.9;
          const ty = n.y - n.r * 1.1;
          const bob = Math.sin(t * 3 + n.x) * 1.2;
          ctx.fillStyle = a.health === "error" ? "#ff4d5e" : "#ffc53d";
          ctx.beginPath();
          ctx.moveTo(tx, ty - 6 + bob);
          ctx.lineTo(tx + 5.5, ty + 4 + bob);
          ctx.lineTo(tx - 5.5, ty + 4 + bob);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#2a1600";
          ctx.font = "900 7px sans-serif";
          ctx.fillText("!", tx, ty + 0.8 + bob);
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [org]);

  const pick = (e: { clientX: number; clientY: number }) => {
    const L = layout.current;
    const c = canvas.current;
    if (!L || !c) return null;
    const b = c.getBoundingClientRect();
    const x = e.clientX - b.left;
    const y = e.clientY - b.top;
    let best: Node | null = null;
    let bd = 16;
    for (const n of L.nodes) {
      const d = Math.hypot(n.x - x, n.y - y) - n.r;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best ? { n: best, x, y } : null;
  };

  const selected = useMemo(() => org?.depts.flatMap((d) => d.agents.map((a) => ({ a, d }))).find((x) => x.a.id === sel) ?? null, [org, sel]);

  if (err && !org) return <div className="clay p-6 text-sm text-fail">Ajan ağı okunamadı: {err}</div>;
  return (
    <div className="space-y-4">
      <div ref={wrap} className={`relative overflow-hidden rounded-[30px] bg-[#06070c] ${wide ? "h-[calc(100dvh-12rem)] min-h-[620px]" : ""}`}>
        <canvas
          ref={canvas}
          className="block cursor-crosshair touch-none"
          onPointerMove={(e) => setHover(pick(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            const h = pick(e);
            setSel(h ? h.n.id : null);
            if (h) setFocusDept(h.n.dept);
            else setFocusDept(null);
          }}
        />
        {!org && <div className="absolute inset-0 grid place-items-center text-sm font-bold text-white/60">Ajan ağı kuruluyor…</div>}
        {/* üst sol başlık */}
        {org && (
          <div className="pointer-events-none absolute left-5 top-4 text-white">
            <div className="text-[11px] font-extrabold tracking-[0.3em] text-[#ffb27a]">AJAN AĞI</div>
            <div className="mt-0.5 text-xs font-semibold text-white/55">
              {org.totals.agents} ajan · {org.totals.working} çalışıyor · {org.totals.alerts} uyarı
            </div>
          </div>
        )}
        {/* üzerine gelince */}
        {hover?.n.agent && (
          <div className="pointer-events-none absolute z-10 max-w-[240px] -translate-x-1/2 rounded-xl border border-white/10 bg-[#140b0b]/90 px-3 py-2 text-xs text-white shadow-xl backdrop-blur" style={{ left: hover.x, top: hover.y + 18 }}>
            <div className="font-extrabold">{hover.n.agent.name}</div>
            <div className="text-white/60">{hover.n.agent.status || hover.n.agent.role}</div>
            {hover.n.agent.alert && <div className="mt-0.5 font-semibold text-[#ffc53d]">▲ {hover.n.agent.alert}</div>}
          </div>
        )}
        {org && wide && (
          <div className="absolute bottom-4 right-4 top-4 w-[372px] overflow-y-auto overscroll-contain rounded-[24px] border border-white/10 bg-[#120a0c]/80 p-4 text-white shadow-2xl backdrop-blur-xl">
            <Side org={org} selected={selected} onSel={(id, di) => (setSel(id), setFocusDept(di))} focusDept={focusDept} onDept={(i) => (setFocusDept((d) => (d === i ? null : i)), setSel(null))} onClose={() => setSel(null)} />
          </div>
        )}
      </div>
      {org && !wide && (
        <div className="rounded-[26px] bg-[#120a0c] p-4 text-white">
          <Side org={org} selected={selected} onSel={(id, di) => (setSel(id), setFocusDept(di))} focusDept={focusDept} onDept={(i) => (setFocusDept((d) => (d === i ? null : i)), setSel(null))} onClose={() => setSel(null)} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ yan panel */
function Side({ org, selected, onSel, focusDept, onDept, onClose }: { org: OrgState; selected: { a: OrgAgent; d: OrgDept } | null; onSel: (id: string, dept: number) => void; focusDept: number | null; onDept: (i: number) => void; onClose: () => void }) {
  const h = org.totals.health;
  return (
    <div className="space-y-5">
      <AnimatePresence mode="wait" initial={false}>
        {selected ? (
          <motion.div key={selected.a.id} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <AgentCard a={selected.a} d={selected.d} onClose={onClose} />
          </motion.div>
        ) : (
          <motion.div key="health" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[10.5px] font-extrabold tracking-[0.24em] text-white/50">SİSTEM SAĞLIĞI</div>
                <div className="text-xs font-semibold text-white/55">
                  Bugün {org.totals.runsToday} çağrı · ${org.totals.costToday.toFixed(3)}
                </div>
              </div>
              <div className="text-[34px] font-extrabold leading-none tabular-nums" style={{ color: h >= 80 ? "#3ddc97" : h >= 60 ? "#ff8a3d" : "#ff4d5e" }}>
                %{h}
              </div>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <motion.div className="h-full rounded-full" style={{ background: "linear-gradient(90deg,#ff5a1f,#ffb02e)" }} initial={{ width: 0 }} animate={{ width: `${h}%` }} transition={{ type: "spring", stiffness: 80, damping: 20 }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section>
        <div className="mb-1.5 text-[10.5px] font-extrabold tracking-[0.24em] text-white/50">DEPARTMANLAR</div>
        <div className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl bg-white/[0.04]">
          {org.depts.map((d, i) => (
            <div key={d.id} className={`px-3 py-2.5 transition-colors ${focusDept === i ? "bg-white/[0.07]" : ""}`}>
              <button onClick={() => onDept(i)} className="flex w-full items-center gap-2 text-left">
                <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                <span className="flex-1 text-[13px] font-extrabold">{d.name}</span>
                <span className="text-[11px] font-bold tabular-nums text-white/55">%{Math.round(d.health * 100)}</span>
              </button>
              <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-4">
                {d.agents.map((a) => (
                  <button key={a.id} title={`${a.name} — ${HEALTH_LABEL[a.health]}${a.alert ? `: ${a.alert}` : ""}`} onClick={() => onSel(a.id, i)} className="grid h-4 w-4 place-items-center rounded-full hover:scale-125">
                    <span className={`h-2.5 w-2.5 rounded-full ${a.health === "working" ? "animate-pulse" : ""} ${a.lead ? "ring-2 ring-white/30" : ""}`} style={{ background: HEALTH_COLOR[a.health] }} />
                  </button>
                ))}
              </div>
              {focusDept === i && (
                <div className="mt-2 space-y-1 pl-4">
                  {d.agents.map((a) => (
                    <button key={a.id} onClick={() => onSel(a.id, i)} className="flex w-full items-baseline gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-white/[0.06]">
                      <span className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full" style={{ background: HEALTH_COLOR[a.health] }} />
                      <span className="w-[118px] shrink-0 truncate text-xs font-bold">{a.name}</span>
                      <span className={`truncate text-[11px] ${a.alert ? "text-[#ffc53d]" : "text-white/50"}`}>{a.alert ?? a.status}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-1.5 text-[10.5px] font-extrabold tracking-[0.24em] text-white/50">SÜREÇLER</div>
        <div className="space-y-2">
          {org.processes.map((p) => (
            <Process key={p.id} p={p} />
          ))}
        </div>
      </section>
      <div className="text-[10.5px] leading-relaxed text-white/35">Her ajan uygulamadaki gerçek bir işleve karşılık gelir; durumlar canlı veriden ölçülür. Şef yardımcısı bu ölçümleri her düşünmede okur ve kararlarına dayandırır.</div>
    </div>
  );
}

const PROC_TONE = { ok: { c: "#3ddc97", l: "akıyor" }, warn: { c: "#ffc53d", l: "dikkat" }, alert: { c: "#ff4d5e", l: "risk" } };

function Process({ p }: { p: OrgProcess }) {
  const [open, setOpen] = useState(p.health !== "ok");
  const max = Math.max(1, ...p.stages.map((s) => s.of ?? s.count));
  const tone = PROC_TONE[p.health];
  return (
    <div className="rounded-2xl bg-white/[0.04] p-3">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <span className="flex-1">
          <span className="block text-[13px] font-extrabold">{p.name}</span>
          <span className="block text-[10.5px] text-white/45">{p.sub}</span>
        </span>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider" style={{ color: tone.c, background: `${tone.c}1f` }}>
          {tone.l}
        </span>
      </button>
      {open && (
        <div className="mt-2.5 space-y-2.5">
          <div className="space-y-1">
            {p.stages.map((s) => (
              <div key={s.name} className="flex items-center gap-2 text-[11px]">
                <span className="w-[92px] shrink-0 truncate font-semibold text-white/65">{s.name}</span>
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                  {s.of != null && <div className="absolute inset-y-0 left-0 rounded-full bg-white/[0.06]" style={{ width: `${(s.of / max) * 100}%` }} />}
                  <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: "linear-gradient(90deg,#ff5a1f,#ffb02e)" }} initial={{ width: 0 }} animate={{ width: `${(s.count / max) * 100}%` }} transition={{ type: "spring", stiffness: 90, damping: 20 }} />
                </div>
                <span className="w-12 shrink-0 text-right font-bold tabular-nums">
                  {s.count}
                  {s.of != null ? <span className="text-white/40">/{s.of}</span> : null}
                </span>
              </div>
            ))}
          </div>
          {p.metrics.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {p.metrics.map((m) => (
                <div key={m.label} className="rounded-xl bg-white/[0.04] px-2.5 py-1.5">
                  <div className="text-[10px] font-semibold text-white/45">{m.label}</div>
                  <div className="text-xs font-extrabold">{m.value}</div>
                </div>
              ))}
            </div>
          )}
          {p.forecast && <div className="text-[11.5px] leading-snug text-white/75">↗ {p.forecast}</div>}
          {p.bottleneck && <div className="text-[11.5px] font-semibold leading-snug text-[#ffc53d]">▲ Darboğaz: {p.bottleneck}</div>}
          {p.href && (
            <Link href={p.href} className="inline-block text-[11px] font-extrabold text-[#ffb27a]">
              Aç →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function AgentCard({ a, d, onClose }: { a: OrgAgent; d: OrgDept; onClose: () => void }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-extrabold tracking-[0.2em]" style={{ color: d.color }}>
            {d.name.toLocaleUpperCase("tr")}
            {a.lead ? " · LİDER" : ""}
          </div>
          <div className="text-[17px] font-extrabold leading-tight">{a.name}</div>
          <div className="mt-0.5 text-[11px] text-white/50">{KIND_LABEL_ORG[a.kind]}</div>
        </div>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider" style={{ color: HEALTH_COLOR[a.health], background: `${HEALTH_COLOR[a.health]}1f` }}>
          {HEALTH_LABEL[a.health]}
        </span>
        <button onClick={onClose} className="-mr-1 -mt-1 grid h-7 w-7 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white" aria-label="Kapat">
          ✕
        </button>
      </div>
      <p className="mt-2 text-[12.5px] leading-snug text-white/75">{a.role}</p>
      {a.status && <p className="mt-1.5 text-[12.5px] font-semibold leading-snug">{a.status}</p>}
      {a.alert && <p className="mt-1.5 text-[12px] font-semibold leading-snug text-[#ffc53d]">▲ {a.alert}</p>}
      {a.kpis.length > 0 && (
        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          {a.kpis.map((k) => (
            <div key={k.label} className="rounded-xl bg-white/[0.05] px-2.5 py-1.5">
              <div className="truncate text-[10px] font-semibold text-white/45">{k.label}</div>
              <div className="truncate text-xs font-extrabold">{k.value}</div>
            </div>
          ))}
        </div>
      )}
      {a.href && (
        <Link href={a.href} className="mt-2.5 inline-block text-[11.5px] font-extrabold text-[#ffb27a]">
          İlgili sayfayı aç →
        </Link>
      )}
    </div>
  );
}
