"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

/** Referanslardaki gibi sıcak, voxel/low-poly ofis paleti; koyu temada gece ofisi. */
export interface OfficePal {
  dark: boolean;
  bg: string;
  floor: string;
  floorLine: string;
  slab: string;
  wall: string;
  wallTop: string;
  glass: string;
  frame: string;
  wood: string;
  woodDark: string;
  metal: string;
  chair: string;
  screenOff: string;
  paper: string;
  leaf: string;
  pot: string;
  sofa: string;
  sun: number;
  ambient: number;
}
export const OFFICE_LIGHT: OfficePal = {
  dark: false,
  bg: "#e9edf3",
  floor: "#efe2c8",
  floorLine: "#e3d3b4",
  slab: "#9aa1ae",
  wall: "#c3c8d1",
  wallTop: "#e4e7ec",
  glass: "#a9d1ff",
  frame: "#8d96a6",
  wood: "#c9905b",
  woodDark: "#8a5a35",
  metal: "#6b7385",
  chair: "#59627a",
  screenOff: "#1f2533",
  paper: "#fbfbf7",
  leaf: "#6cc07a",
  pot: "#e8e4dc",
  sofa: "#6672a8",
  sun: 2.3,
  ambient: 0.6,
};
export const OFFICE_DARK: OfficePal = {
  dark: true,
  bg: "#121620",
  floor: "#4a4032",
  floorLine: "#40372b",
  slab: "#2a303c",
  wall: "#3a4152",
  wallTop: "#4b5367",
  glass: "#7fb2ff",
  frame: "#5d6780",
  wood: "#8f6440",
  woodDark: "#5c3e27",
  metal: "#4b5366",
  chair: "#3f465a",
  screenOff: "#10141d",
  paper: "#e9e7df",
  leaf: "#4c9459",
  pot: "#6b6760",
  sofa: "#4a5384",
  sun: 1.1,
  ambient: 0.75,
};

type V3 = [number, number, number];

export function Box({ p, s, c, e, ei = 0.6, r = 0, cast = true, receive = true, opacity }: { p: V3; s: V3; c: string; e?: string; ei?: number; r?: number; cast?: boolean; receive?: boolean; opacity?: number }) {
  return (
    <mesh position={p} rotation={[0, r, 0]} castShadow={cast} receiveShadow={receive}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} emissive={e ?? "#000000"} emissiveIntensity={e ? ei : 0} roughness={0.85} transparent={opacity != null} opacity={opacity ?? 1} />
    </mesh>
  );
}

/** Masa + monitör + klavye. screen: ekran rengi (iş varsa parlar). */
export function Desk({ x, z, r = 0, pal, screen, glow = 0.5 }: { x: number; z: number; r?: number; pal: OfficePal; screen?: string; glow?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, r, 0]}>
      <Box p={[0, 0.74, 0]} s={[2, 0.08, 1]} c={pal.wood} />
      {[
        [-0.92, -0.42],
        [0.92, -0.42],
        [-0.92, 0.42],
        [0.92, 0.42],
      ].map(([a, b], i) => (
        <Box key={i} p={[a, 0.36, b]} s={[0.07, 0.72, 0.07]} c={pal.woodDark} cast={false} />
      ))}
      {/* monitör */}
      <Box p={[0, 0.82, -0.32]} s={[0.24, 0.04, 0.16]} c={pal.metal} cast={false} />
      <Box p={[0, 0.98, -0.32]} s={[0.05, 0.3, 0.05]} c={pal.metal} cast={false} />
      <Box p={[0, 1.18, -0.3]} s={[0.86, 0.5, 0.05]} c={pal.metal} />
      <Box p={[0, 1.18, -0.272]} s={[0.78, 0.42, 0.01]} c={screen ?? pal.screenOff} e={screen} ei={glow} cast={false} />
      <Box p={[0, 0.79, 0.08]} s={[0.6, 0.02, 0.18]} c={pal.dark ? "#2a2f3a" : "#e8ebf0"} cast={false} />
    </group>
  );
}

/** Boş ofis koltuğu — ileride agent'lar oturacak. */
export function Chair({ x, z, r = 0, pal, color }: { x: number; z: number; r?: number; pal: OfficePal; color?: string }) {
  const c = color ?? pal.chair;
  return (
    <group position={[x, 0, z]} rotation={[0, r, 0]}>
      <Box p={[0, 0.06, 0]} s={[0.5, 0.06, 0.5]} c={pal.metal} cast={false} />
      <Box p={[0, 0.25, 0]} s={[0.06, 0.38, 0.06]} c={pal.metal} cast={false} />
      <Box p={[0, 0.48, 0]} s={[0.52, 0.09, 0.5]} c={c} />
      <Box p={[0, 0.8, 0.24]} s={[0.5, 0.58, 0.07]} c={c} />
    </group>
  );
}

export function Plant({ x, z, pal, h = 1 }: { x: number; z: number; pal: OfficePal; h?: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.2, 0.5, 10]} />
        <meshStandardMaterial color={pal.pot} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.5 + 0.45 * h, 0]} castShadow>
        <coneGeometry args={[0.4, 1.1 * h, 7]} />
        <meshStandardMaterial color={pal.leaf} roughness={0.8} flatShading />
      </mesh>
      <mesh position={[0.12, 0.4 + 0.75 * h, 0.05]} castShadow>
        <coneGeometry args={[0.28, 0.8 * h, 6]} />
        <meshStandardMaterial color={pal.leaf} roughness={0.8} flatShading />
      </mesh>
    </group>
  );
}

/** Kağıt / zarf / klasör yığını: n adet ince kutu, hafif rastgele dönük. */
export function Stack({ x, y = 0.78, z, n, pal, colors, size = [0.42, 0.3] as [number, number], step = 0.035 }: { x: number; y?: number; z: number; n: number; pal: OfficePal; colors?: string[]; size?: [number, number]; step?: number }) {
  const rots = useMemo(() => Array.from({ length: n }, (_, i) => Math.sin(i * 12.9898 + x * 3.1) * 0.25), [n, x]);
  return (
    <group position={[x, y, z]}>
      {rots.map((r, i) => (
        <Box key={i} p={[0, i * step + step / 2, 0]} s={[size[0], step * 0.8, size[1]]} r={r} c={colors?.[i] ?? pal.paper} cast={i === n - 1} receive={false} />
      ))}
    </group>
  );
}

/** Yanıp sönen küçük ışık (sunucu LED'i, canlı ekran). */
export function Blink({ p, s, color, speed = 2, phase = 0, on = true }: { p: V3; s: V3; color: string; speed?: number; phase?: number; on?: boolean }) {
  const m = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (m.current) m.current.emissiveIntensity = on ? 0.4 + 0.9 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * speed + phase)) : 0.25;
  });
  return (
    <mesh position={p}>
      <boxGeometry args={s} />
      <meshStandardMaterial ref={m} color={color} emissive={color} emissiveIntensity={0.8} />
    </mesh>
  );
}

/** Yukarı-aşağı süzülen grup (konuşma balonları vb.). */
export function Bob({ children, amp = 0.12, speed = 1.6, phase = 0 }: { children: React.ReactNode; amp?: number; speed?: number; phase?: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (g.current) g.current.position.y = Math.sin(clock.elapsedTime * speed + phase) * amp;
  });
  return <group ref={g}>{children}</group>;
}

export function Sofa({ x, z, r = 0, pal }: { x: number; z: number; r?: number; pal: OfficePal }) {
  return (
    <group position={[x, 0, z]} rotation={[0, r, 0]}>
      <Box p={[0, 0.25, 0]} s={[2.2, 0.4, 0.9]} c={pal.sofa} />
      <Box p={[0, 0.6, 0.36]} s={[2.2, 0.5, 0.2]} c={pal.sofa} />
      <Box p={[-1.02, 0.45, 0]} s={[0.18, 0.3, 0.9]} c={pal.sofa} />
      <Box p={[1.02, 0.45, 0]} s={[0.18, 0.3, 0.9]} c={pal.sofa} />
    </group>
  );
}

export function RoundTable({ x, z, rad = 1.2, pal, chairs = 4, chairColor }: { x: number; z: number; rad?: number; pal: OfficePal; chairs?: number; chairColor?: string }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[rad, rad, 0.08, 28]} />
        <meshStandardMaterial color={pal.wood} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.37, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.2, 0.72, 10]} />
        <meshStandardMaterial color={pal.woodDark} />
      </mesh>
      {Array.from({ length: chairs }, (_, i) => {
        const a = (i / chairs) * Math.PI * 2;
        return <Chair key={i} x={Math.sin(a) * (rad + 0.55)} z={Math.cos(a) * (rad + 0.55)} r={a} pal={pal} color={chairColor} />;
      })}
    </group>
  );
}

/** Masada oturan çalışan (voxel tarzı). active: çalışırken yazıyor gibi kıpırdar. */
export function Person({ x, z, r = 0, shirt, active = false, phase = 0, skin = "#f2c9a0", hair = "#3b2a20" }: { x: number; z: number; r?: number; shirt: string; active?: boolean; phase?: number; skin?: string; hair?: string }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!g.current) return;
    const t = clock.elapsedTime * (active ? 9 : 1.4) + phase;
    g.current.position.y = active ? Math.abs(Math.sin(t)) * 0.035 : Math.sin(t) * 0.012;
    g.current.rotation.y = active ? Math.sin(t * 0.25) * 0.08 : 0;
  });
  return (
    <group position={[x, 0, z]} rotation={[0, r, 0]}>
      <group ref={g}>
        {/* bacaklar (oturur) */}
        <Box p={[-0.1, 0.56, -0.12]} s={[0.14, 0.12, 0.4]} c="#2f3446" cast={false} />
        <Box p={[0.1, 0.56, -0.12]} s={[0.14, 0.12, 0.4]} c="#2f3446" cast={false} />
        {/* gövde */}
        <Box p={[0, 0.86, 0.05]} s={[0.42, 0.5, 0.26]} c={shirt} />
        {/* kollar masaya uzanır */}
        <Box p={[-0.25, 0.86, -0.12]} s={[0.1, 0.12, 0.38]} c={shirt} cast={false} />
        <Box p={[0.25, 0.86, -0.12]} s={[0.1, 0.12, 0.38]} c={shirt} cast={false} />
        {/* baş */}
        <Box p={[0, 1.27, 0.04]} s={[0.3, 0.3, 0.3]} c={skin} />
        <Box p={[0, 1.43, 0.07]} s={[0.32, 0.1, 0.32]} c={hair} cast={false} />
      </group>
    </group>
  );
}
