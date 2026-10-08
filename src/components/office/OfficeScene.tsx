"use client";

import { AdaptiveDpr, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { ArchiveProgress, GoogleSnapshot } from "@/lib/google-types";
import { Box, type OfficePal } from "./Furniture";
import { CORRIDOR, HALF_X, HALF_Z, ROOM_D, ROOM_W, ZONES, zoneById, type ZoneId, type ZoneStat } from "./layout";
import { Corridor, Room } from "./Rooms";

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
  const dist = THREE.MathUtils.clamp((HALF_X * 1.1) / Math.tan(hfov / 2), 45, 170);
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

/** Oda rozetleri (DOM): her karede 3B bağlantı noktasını ekran koordinatına çevirir. */
function LabelProjector({ labels }: { labels: LabelRefs }) {
  const anchors = useMemo(() => [...ZONES.map((z) => [z.id, new THREE.Vector3(z.x, 3.4, z.z - 1.5)] as const), ["hub", new THREE.Vector3(0, 2.2, 0)] as const], []);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const [id, p] of anchors) {
      const el = labels.current?.[id];
      if (!el) continue;
      v.copy(p).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15;
      el.style.transform = `translate3d(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px, 0) translate(-50%, -50%)`;
      el.style.opacity = visible ? "1" : "0";
      el.style.zIndex = String(Math.round((1 - v.z) * 1000));
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
    t.repeat.set((HALF_X * 2) / 6, (HALF_Z * 2) / 6);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [pal]);
}

function Shell({ pal }: { pal: OfficePal }) {
  const tex = useFloorTexture(pal);
  const W = HALF_X * 2;
  const D = HALF_Z * 2;
  const tall = 3.2;
  const low = 0.55;
  const t = 0.35;
  return (
    <group>
      {/* zemin döşemesi */}
      <Box p={[0, -0.3, 0]} s={[W + 1, 0.6, D + 1]} c={pal.slab} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={tex} roughness={0.9} />
      </mesh>
      {/* dış duvarlar: kuzey/batı yüksek, güney/doğu alçak (maket kesiti) */}
      <Box p={[0, tall / 2, -HALF_Z - t / 2]} s={[W + t * 2, tall, t]} c={pal.wall} />
      <Box p={[-HALF_X - t / 2, tall / 2, 0]} s={[t, tall, D]} c={pal.wall} />
      <Box p={[0, tall + 0.04, -HALF_Z - t / 2]} s={[W + t * 2, 0.08, t + 0.04]} c={pal.wallTop} cast={false} />
      <Box p={[-HALF_X - t / 2, tall + 0.04, 0]} s={[t + 0.04, 0.08, D]} c={pal.wallTop} cast={false} />
      <Box p={[0, low / 2, HALF_Z + t / 2]} s={[W + t * 2, low, t]} c={pal.wall} />
      <Box p={[HALF_X + t / 2, low / 2, 0]} s={[t, low, D]} c={pal.wall} />
      {/* kuzey duvarında pencereler */}
      {[-19, -11, -3, 5, 13, 20].map((x) => (
        <Box key={x} p={[x, 2.1, -HALF_Z + 0.01]} s={[2.6, 1.2, 0.04]} c={pal.dark ? "#ffd889" : "#bfe0ff"} e={pal.dark ? "#ffd889" : undefined} ei={0.35} cast={false} />
      ))}
    </group>
  );
}

const glassMat = (pal: OfficePal) => new THREE.MeshStandardMaterial({ color: pal.glass, transparent: true, opacity: pal.dark ? 0.16 : 0.22, roughness: 0.1, metalness: 0.1, depthWrite: false });

/** Odaları ayıran cam bölmeler (koridora bakan tarafta kapı boşluğu). */
function Partitions({ pal }: { pal: OfficePal }) {
  const mat = useMemo(() => glassMat(pal), [pal]);
  const h = 1.9;
  const segs: { p: [number, number, number]; s: [number, number, number] }[] = [];
  const zEdge = CORRIDOR / 2;
  // odalar arası (x = ±10), iki sırada
  for (const x of [-(ROOM_W / 2 + 1), ROOM_W / 2 + 1]) {
    for (const sign of [-1, 1]) segs.push({ p: [x, h / 2, sign * (zEdge + ROOM_D / 2)], s: [0.08, h, ROOM_D] });
  }
  // koridor tarafı: her odada ortada 3 m kapı
  for (const zn of ZONES) {
    const zLine = zn.north ? -zEdge : zEdge;
    const half = ROOM_W / 2;
    const seg = half - 1.6;
    segs.push({ p: [zn.x - 1.6 - seg / 2, h / 2, zLine], s: [seg, h, 0.08] });
    segs.push({ p: [zn.x + 1.6 + seg / 2, h / 2, zLine], s: [seg, h, 0.08] });
  }
  return (
    <group>
      {segs.map((g, i) => (
        <group key={i}>
          <mesh position={g.p} material={mat}>
            <boxGeometry args={g.s} />
          </mesh>
          {/* üst ray */}
          <Box p={[g.p[0], h + 0.03, g.p[2]]} s={[Math.max(g.s[0], 0.1), 0.06, Math.max(g.s[2], 0.1)]} c={pal.frame} cast={false} />
        </group>
      ))}
    </group>
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
      <meshStandardMaterial color={base} emissive={color} emissiveIntensity={(selected ? 0.22 : hovered ? 0.12 : 0) * (pal.dark ? 0.3 : 1)} roughness={0.95} />
    </mesh>
  );
}

function Sun({ pal }: { pal: OfficePal }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = ref.current;
    if (!l) return;
    const c = l.shadow.camera as THREE.OrthographicCamera;
    c.left = -45;
    c.right = 45;
    c.top = 35;
    c.bottom = -35;
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
  onHover: (id: ZoneId | null) => void;
}

export function OfficeScene({ pal, snap, stats, archive, archiving, focus, onSelect, api, panelPx, labels, onHover }: OfficeSceneProps) {
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

      <Shell pal={pal} />
      {ZONES.map((z) => (
        <Carpet key={z.id} id={z.id} x={z.x} z={z.z} color={z.color} pal={pal} selected={focus === z.id} hovered={hover === z.id} onSelect={onSelect} onHover={hov} />
      ))}
      <Partitions pal={pal} />
      {ZONES.map((z) => (
        <Room key={z.id} zone={z} pal={pal} snap={snap} stat={stats[z.id]} archive={archive} archiving={archiving} />
      ))}
      <Corridor pal={pal} xMax={HALF_X} />

      <OrbitControls
        makeDefault
        target={CENTER.toArray()}
        enableDamping
        dampingFactor={0.08}
        minDistance={10}
        maxDistance={200}
        minPolarAngle={0.25}
        maxPolarAngle={1.2}
        screenSpacePanning={false}
        zoomSpeed={0.8}
      />
      <CameraRig focus={focus} api={api} panelPx={panelPx} />
      <ViewOffset px={panelPx} />
      <LabelProjector labels={labels} />
      <AdaptiveDpr pixelated={false} />
    </Canvas>
  );
}
