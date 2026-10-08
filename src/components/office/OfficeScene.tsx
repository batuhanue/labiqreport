"use client";

import { AdaptiveDpr, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { ArchiveProgress, GoogleSnapshot } from "@/lib/google-types";
import { Box, type OfficePal } from "./Furniture";
import { BRAIN_R, HALF_X, HALF_Z, ROOM_D, ROOM_W, ZONES, zoneById, type ZoneId, type ZoneStat } from "./layout";
import { Room } from "./Rooms";

export interface CameraApi {
  zoom: (f: number) => void;
  reset: () => void;
  rotate: (rad: number) => void;
}
export type LabelRefs = React.RefObject<Record<string, HTMLDivElement | null>>;

const CENTER = new THREE.Vector3(0, 0, 0);
const HOME_DIR = new THREE.Vector3(0.55, 0.95, 0.85).normalize();

function homePos(width: number, height: number, panelPx: number, fov: number) {
  const aspect = Math.max(0.6, (width - panelPx) / Math.max(1, height));
  const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect);
  const dist = THREE.MathUtils.clamp((HALF_X * 1.3) / Math.tan(hfov / 2), 55, 220);
  return CENTER.clone().add(HOME_DIR.clone().multiplyScalar(dist));
}

/** Yumuşak kamera uçuşu (kampüsteki ile aynı davranış). */
function CameraRig({ focus, api, panelPx }: { focus: ZoneId | null; api: React.RefObject<CameraApi | null>; panelPx: number }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const fly = useRef<{ target: THREE.Vector3; pos: THREE.Vector3 } | null>(null);
  const home = () => homePos(size.width, size.height, panelPx, camera.fov);
  const goTo = (target: THREE.Vector3, pos: THREE.Vector3) => (fly.current = { target, pos });

  useEffect(() => {
    const z = zoneById(focus);
    if (!z) return void goTo(CENTER.clone(), home());
    const target = new THREE.Vector3(z.x, 0.8, z.z);
    goTo(target, target.clone().add(HOME_DIR.clone().multiplyScalar(30)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, size.width, size.height, panelPx]);

  useEffect(() => {
    if (!controls) return;
    const stop = () => (fly.current = null);
    controls.addEventListener("start", stop);
    api.current = {
      zoom: (f) => {
        const dir = camera.position.clone().sub(controls.target);
        const len = THREE.MathUtils.clamp(dir.length() * f, controls.minDistance, controls.maxDistance);
        goTo(controls.target.clone(), controls.target.clone().add(dir.setLength(len)));
      },
      reset: () => goTo(CENTER.clone(), home()),
      rotate: (rad) => {
        const dir = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), rad);
        goTo(controls.target.clone(), controls.target.clone().add(dir));
      },
    };
    return () => controls.removeEventListener("start", stop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, camera, api, size, panelPx]);

  useFrame((_, dt) => {
    const f = fly.current;
    if (!f || !controls) return;
    const k = 1 - Math.exp(-3.2 * Math.min(dt, 0.12));
    controls.target.lerp(f.target, k);
    camera.position.lerp(f.pos, k);
    controls.update();
    if (camera.position.distanceTo(f.pos) < 0.05 && controls.target.distanceTo(f.target) < 0.05) fly.current = null;
  });
  return null;
}

function ViewOffset({ px }: { px: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  useEffect(() => {
    if (px > 0) camera.setViewOffset(size.width, size.height, px / 2, 0, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [camera, size, px]);
  return null;
}

/** Bir pod'un (ya da Beyin'in) ekrandaki bağlantı noktası: kartlar ve kablolar buraya bağlanır. */
export type Screen = React.RefObject<Record<string, { x: number; y: number; on: boolean }>>;

/**
 * Pod kartları (DOM) için: her karede 3B bağlantı noktalarını ekran koordinatına çevirir.
 * Kartlar pod'un arka kenarının üstünde durur; ekran konumları kabloların çizimi için de paylaşılır.
 */
function LabelProjector({ labels, screen }: { labels: LabelRefs; screen: Screen }) {
  const anchors = useMemo(() => [...ZONES.map((z) => [z.id, new THREE.Vector3(z.x, 2.8, z.z + (z.north ? -ROOM_D / 2 + 1 : -ROOM_D / 2 + 1.5))] as const), ["hub", new THREE.Vector3(BRAIN_R + 2.6, 1.2, -1.2)] as const], []);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const [id, p] of anchors) {
      v.copy(p).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15;
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      if (screen.current) screen.current[id] = { x, y, on: visible };
      const el = labels.current?.[id];
      if (!el) continue;
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
      el.style.opacity = visible ? "1" : "0";
      el.style.zIndex = id === "hub" ? "2000" : String(Math.round((1 - v.z) * 1000));
    }
  });
  return null;
}

/** Ahşap parke dokusu (tuvalde çizilir). */
function useFloorTexture(pal: OfficePal) {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = pal.floor;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = pal.floorLine;
    for (let i = 0; i < 8; i++) {
      g.fillRect(0, i * 32, 256, 2);
      const off = (i % 2) * 96 + 40;
      g.fillRect(off, i * 32, 2, 32);
      g.fillRect(off + 128, i * 32, 2, 32);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(ROOM_W / 6, ROOM_D / 6);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [pal]);
}

/** Yüzen platform (pod): kaide + ahşap zemin + alçak kenar; Beyin'e bakan kenarda giriş boşluğu. */
function Pod({ x, z, north, pal, tex }: { x: number; z: number; north: boolean; pal: OfficePal; tex: THREE.Texture }) {
  const W = ROOM_W;
  const D = ROOM_D;
  const rim = 0.32;
  const t = 0.18;
  const gap = 3.2;
  // Beyin'e bakan kenar: kuzey pod'larda güney, güney pod'larda kuzey
  const inner = north ? D / 2 : -D / 2;
  const outer = -inner;
  const seg = (W - gap) / 2;
  return (
    <group position={[x, 0, z]}>
      <Box p={[0, -0.45, 0]} s={[W + 0.5, 0.9, D + 0.5]} c={pal.slab} />
      <Box p={[0, -0.02, 0]} s={[W + 0.5, 0.06, D + 0.5]} c={pal.wallTop} cast={false} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={tex} roughness={0.9} />
      </mesh>
      {/* kenarlar */}
      <Box p={[0, rim / 2, outer]} s={[W, rim, t]} c={pal.wall} />
      <Box p={[-W / 2, rim / 2, 0]} s={[t, rim, D]} c={pal.wall} />
      <Box p={[W / 2, rim / 2, 0]} s={[t, rim, D]} c={pal.wall} />
      <Box p={[-W / 2 + seg / 2, rim / 2, inner]} s={[seg, rim, t]} c={pal.wall} />
      <Box p={[W / 2 - seg / 2, rim / 2, inner]} s={[seg, rim, t]} c={pal.wall} />
    </group>
  );
}

/** Pod'ları Beyin platformuna bağlayan yürüme yolları. */
function Walkways({ pal }: { pal: OfficePal }) {
  return (
    <group>
      {ZONES.map((z) => {
        // pod girişinin ortası → Beyin platformunun kenarı
        const ex = z.x;
        const ez = z.z + (z.north ? ROOM_D / 2 : -ROOM_D / 2);
        const dir = new THREE.Vector2(-ex, -ez);
        const len0 = dir.length();
        dir.normalize();
        const sx = -dir.x * BRAIN_R;
        const sz = -dir.y * BRAIN_R;
        const len = Math.hypot(ex - sx, ez - sz) + 0.4;
        const ang = Math.atan2(ex - sx, ez - sz);
        void len0;
        return (
          <group key={z.id} position={[(ex + sx) / 2, -0.08, (ez + sz) / 2]} rotation={[0, ang, 0]}>
            <Box p={[0, 0, 0]} s={[2.4, 0.22, len]} c={pal.wallTop} />
            <Box p={[0, -0.25, 0]} s={[2.2, 0.3, len]} c={pal.slab} cast={false} />
          </group>
        );
      })}
    </group>
  );
}

/** Beyin: platform + üstünde yavaşça dönen not ağı (düğümler ve bağlar); düşünürken parlar. */
function BrainCore({ pal, busy, onSelect }: { pal: OfficePal; busy: boolean; onSelect: () => void }) {
  const g = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const { nodes, lines } = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 46; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 0.6 + rnd() * 2.9;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0.8 + rnd() * 1.6, Math.sin(a) * r));
    }
    const seg: number[] = [];
    pts.forEach((p, i) => {
      pts
        .map((q, k) => ({ k, d: p.distanceTo(q) }))
        .filter((x) => x.k > i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
        .forEach((x) => seg.push(p.x, p.y, p.z, pts[x.k].x, pts[x.k].y, pts[x.k].z));
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
    return { nodes: pts, lines: geo };
  }, []);
  useFrame(({ clock }, dt) => {
    if (g.current) g.current.rotation.y += dt * (busy ? 0.5 : 0.12);
    if (mat.current) mat.current.emissiveIntensity = busy ? 0.9 + 0.6 * Math.sin(clock.elapsedTime * 4) : 0.55;
  });
  const glow = "#8b5cf6";
  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "")}
    >
      <mesh position={[0, -0.45, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[BRAIN_R, BRAIN_R + 0.2, 0.9, 48]} />
        <meshStandardMaterial color={pal.slab} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[BRAIN_R - 0.15, 48]} />
        <meshStandardMaterial color={pal.dark ? "#2a2440" : "#efe9fb"} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[BRAIN_R - 0.55, BRAIN_R - 0.35, 64]} />
        <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={0.5} />
      </mesh>
      <group ref={g}>
        <lineSegments geometry={lines}>
          <lineBasicMaterial color={glow} transparent opacity={pal.dark ? 0.7 : 0.45} />
        </lineSegments>
        {nodes.map((p, i) => (
          <mesh key={i} position={p}>
            <sphereGeometry args={[i % 7 === 0 ? 0.13 : 0.07, 10, 10]} />
            <meshStandardMaterial ref={i === 0 ? mat : undefined} color={i % 5 === 0 ? "#2ec4b6" : glow} emissive={i % 5 === 0 ? "#2ec4b6" : glow} emissiveIntensity={0.6} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Pod'ların altındaki zemin (gölge yakalayıcı). */
function Ground({ pal }: { pal: OfficePal }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.9, 0]} receiveShadow>
      <planeGeometry args={[400, 400]} />
      <shadowMaterial transparent opacity={pal.dark ? 0.35 : 0.14} />
    </mesh>
  );
}

/** İki rengi sRGB'de karıştırır (doğrusal uzayda karıştırınca koyu zeminde renk fazla doygun çıkıyor). */
function mixHex(a: string, b: string, t: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** Oda zemini (halı): tıklanabilir; seçili/üzerinde iken hafif parlar. */
function Carpet({ id, x, z, color, pal, selected, hovered, onSelect, onHover }: { id: ZoneId; x: number; z: number; color: string; pal: OfficePal; selected: boolean; hovered: boolean; onSelect: (id: ZoneId) => void; onHover: (id: ZoneId | null) => void }) {
  const base = useMemo(() => mixHex(pal.floor, color, pal.dark ? 0.14 : 0.16), [pal, color]);
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[x, 0.012, z]}
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        onSelect(id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(id);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        onHover(null);
        document.body.style.cursor = "";
      }}
    >
      <planeGeometry args={[ROOM_W - 0.4, ROOM_D - 0.4]} />
      <meshStandardMaterial color={base} emissive={color} emissiveIntensity={(selected ? 0.22 : hovered ? 0.12 : 0) * (pal.dark ? 0.3 : 1)} roughness={0.95} transparent opacity={selected || hovered ? 0.75 : 0.45} depthWrite={false} />
    </mesh>
  );
}

function Sun({ pal }: { pal: OfficePal }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = ref.current;
    if (!l) return;
    const c = l.shadow.camera as THREE.OrthographicCamera;
    c.left = -50;
    c.right = 50;
    c.top = 40;
    c.bottom = -40;
    c.near = 1;
    c.far = 200;
    c.updateProjectionMatrix();
  }, []);
  return (
    <directionalLight
      ref={ref}
      position={[30, 60, 40]}
      intensity={pal.sun}
      color={pal.dark ? "#9db2ff" : "#fff4e4"}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.04}
    />
  );
}

export interface OfficeSceneProps {
  pal: OfficePal;
  snap: GoogleSnapshot;
  stats: Record<ZoneId, ZoneStat>;
  archive: ArchiveProgress | null;
  archiving: boolean;
  focus: ZoneId | null;
  onSelect: (id: ZoneId | null) => void;
  api: React.RefObject<CameraApi | null>;
  panelPx: number;
  labels: LabelRefs;
  screen: Screen;
  onHover: (id: ZoneId | null) => void;
  /** beyin düşünüyor ya da bir ajan çalışıyor */
  busy: boolean;
}

export function OfficeScene({ pal, snap, stats, archive, archiving, focus, onSelect, api, panelPx, labels, screen, onHover, busy }: OfficeSceneProps) {
  const tex = useFloorTexture(pal);
  const [hover, setHover] = useState<ZoneId | null>(null);
  const hov = (id: ZoneId | null) => {
    setHover(id);
    onHover(id);
  };
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 1.75]}
      camera={{ fov: 30, near: 1, far: 500, position: HOME_DIR.clone().multiplyScalar(120).toArray() }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={[pal.bg]} />
      <fog attach="fog" args={[pal.bg, 140, 300]} />
      <ambientLight intensity={pal.ambient} />
      <hemisphereLight args={[pal.dark ? "#a9bbf0" : "#ffffff", pal.dark ? "#1a1f2c" : "#d9cfbf", pal.dark ? 0.5 : 0.85]} />
      <Sun pal={pal} />

      <Ground pal={pal} />
      <BrainCore pal={pal} busy={busy} onSelect={() => onSelect(null)} />
      <Walkways pal={pal} />
      {ZONES.map((z) => (
        <Pod key={z.id} x={z.x} z={z.z} north={z.north} pal={pal} tex={tex} />
      ))}
      {ZONES.map((z) => (
        <Carpet key={z.id} id={z.id} x={z.x} z={z.z} color={z.color} pal={pal} selected={focus === z.id} hovered={hover === z.id} onSelect={onSelect} onHover={hov} />
      ))}
      {ZONES.map((z) => (
        <Room key={z.id} zone={z} pal={pal} snap={snap} stat={stats[z.id]} archive={archive} archiving={archiving} />
      ))}

      <OrbitControls
        makeDefault
        target={CENTER.toArray()}
        enableDamping
        dampingFactor={0.08}
        minDistance={10}
        maxDistance={240}
        minPolarAngle={0.25}
        maxPolarAngle={1.2}
        screenSpacePanning={false}
        zoomSpeed={0.8}
      />
      <CameraRig focus={focus} api={api} panelPx={panelPx} />
      <ViewOffset px={panelPx} />
      <LabelProjector labels={labels} screen={screen} />
      <AdaptiveDpr pixelated={false} />
    </Canvas>
  );
}
