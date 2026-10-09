"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Env } from "./env";
import { SPOTS, heightAt, type BuildingId } from "./terrain";

export interface BuildingInfo {
  name: string;
  /** kısa açıklama (üzerine gelince) */
  sub: string;
  /** canlı rozet: "%38", "4 okunmamış" */
  badge?: string;
  tone?: "ok" | "warn" | "alert" | "info";
  color: string;
  busy?: boolean;
}

export const TONE: Record<NonNullable<BuildingInfo["tone"]>, string> = { ok: "#22b07d", warn: "#f59e0b", alert: "#ef4d5a", info: "#5b7cff" };

/** gece yanan pencere malzemesi (tüm binalar paylaşır) */
function useWindowMat(env: React.RefObject<Env>, day = "#56708f") {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: day, emissive: new THREE.Color("#ffc25a"), emissiveIntensity: 0, roughness: 0.4 }), [day]);
  const dayC = useMemo(() => new THREE.Color(day), [day]);
  const nightC = useMemo(() => new THREE.Color("#ffd68a"), []);
  useFrame(() => {
    const n = env.current.night;
    mat.emissiveIntensity = n * 2.4;
    mat.color.copy(dayC).lerp(nightC, n);
  });
  return mat;
}

const M = (c: string, r = 0.95) => <meshStandardMaterial color={c} roughness={r} />;

/* ------------------------------------------------------------------ çatı (üçgen prizma) */
function Gable({ w, h, d, color, y }: { w: number; h: number; d: number; color: string; y: number }) {
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(0, h);
    s.lineTo(-w / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 });
    g.translate(0, 0, -d / 2);
    return g;
  }, [w, h, d]);
  return (
    <mesh geometry={geo} position={[0, y, 0]} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ deniz feneri → Denetim */
function Lighthouse({ env }: { env: React.RefObject<Env> }) {
  const win = useWindowMat(env);
  const lamp = useMemo(() => new THREE.MeshStandardMaterial({ color: "#fff3c4", emissive: new THREE.Color("#ffd66b"), emissiveIntensity: 0.4, transparent: true, opacity: 0.85 }), []);
  const beam = useRef<THREE.Group>(null);
  const beamMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#fff2b0", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), []);
  useFrame((_, dt) => {
    const n = env.current.night;
    lamp.emissiveIntensity = 0.4 + n * 3;
    beamMat.opacity = n * 0.09 + env.current.rain * n * 0.04;
    if (beam.current) beam.current.rotation.y += dt * 0.6;
  });
  const bands = 6;
  const H = 4.2;
  return (
    <group>
      <mesh position={[0, 0.2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.25, 1.35, 0.4, 18]} />
        {M("#b8b2aa")}
      </mesh>
      {Array.from({ length: bands }, (_, i) => {
        const r0 = 1.0 - (i / bands) * 0.32;
        const r1 = 1.0 - ((i + 1) / bands) * 0.32;
        return (
          <mesh key={i} position={[0, 0.4 + (H / bands) * (i + 0.5), 0]} castShadow receiveShadow>
            <cylinderGeometry args={[r1, r0, H / bands, 20]} />
            {M(i % 2 ? "#e0663d" : "#f6f1e8", 0.8)}
          </mesh>
        );
      })}
      <mesh position={[0, 0.85, 0.98]} castShadow>
        <boxGeometry args={[0.42, 0.75, 0.12]} />
        {M("#7a4f34")}
      </mesh>
      {[1.9, 3.1].map((y) => (
        <mesh key={y} position={[0, y, 0.9 - (y / H) * 0.3]} material={win}>
          <boxGeometry args={[0.22, 0.32, 0.08]} />
        </mesh>
      ))}
      <mesh position={[0, 4.68, 0]} castShadow>
        <cylinderGeometry args={[0.95, 0.95, 0.14, 20]} />
        {M("#3c4250", 0.7)}
      </mesh>
      <mesh position={[0, 4.95, 0]}>
        <torusGeometry args={[0.9, 0.025, 6, 28]} />
        {M("#3c4250", 0.7)}
      </mesh>
      <mesh position={[0, 5.12, 0]} material={lamp}>
        <cylinderGeometry args={[0.5, 0.5, 0.7, 14]} />
      </mesh>
      <mesh position={[0, 5.72, 0]} castShadow>
        <coneGeometry args={[0.66, 0.6, 14]} />
        {M("#d6573a", 0.8)}
      </mesh>
      <mesh position={[0, 6.08, 0]}>
        <sphereGeometry args={[0.1, 10, 8]} />
        {M("#3c4250")}
      </mesh>
      <group ref={beam} position={[0, 5.12, 0]}>
        <mesh position={[7, 0, 0]} rotation-z={Math.PI / 2} material={beamMat}>
          <coneGeometry args={[1.1, 14, 16, 1, true]} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ yel değirmeni → Analiz */
function Windmill({ env }: { env: React.RefObject<Env> }) {
  const win = useWindowMat(env);
  const sails = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (sails.current) sails.current.rotation.z -= dt * (0.5 + env.current.wind * 2.4);
  });
  return (
    <group>
      <mesh position={[0, 0.2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.18, 1.25, 0.4, 16]} />
        {M("#a7a19a")}
      </mesh>
      <mesh position={[0, 1.95, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.72, 1.05, 3.1, 16]} />
        {M("#ece5d9")}
      </mesh>
      <mesh position={[0, 3.75, 0]} castShadow>
        <coneGeometry args={[0.95, 1.05, 16]} />
        {M("#b65a3c", 0.85)}
      </mesh>
      <mesh position={[0, 0.75, 1.0]} castShadow>
        <boxGeometry args={[0.4, 0.7, 0.12]} />
        {M("#6f4a32")}
      </mesh>
      {[1.8, 2.7].map((y) => (
        <mesh key={y} position={[0, y, 1.0 - y * 0.09]} material={win}>
          <boxGeometry args={[0.2, 0.28, 0.1]} />
        </mesh>
      ))}
      <group position={[0, 3.35, 0.95]}>
        <mesh rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.13, 0.13, 0.35, 10]} />
          {M("#5a4636")}
        </mesh>
        <group ref={sails} position={[0, 0, 0.2]}>
          {[0, 1, 2, 3].map((i) => (
            <group key={i} rotation-z={(i * Math.PI) / 2}>
              <mesh position={[0, 1.15, 0]} castShadow>
                <boxGeometry args={[0.07, 2.3, 0.06]} />
                {M("#6b4a34")}
              </mesh>
              <mesh position={[0.24, 1.35, 0]} castShadow>
                <boxGeometry args={[0.42, 1.75, 0.03]} />
                <meshStandardMaterial color="#f2ebdf" roughness={0.9} transparent opacity={0.92} />
              </mesh>
              {[0.65, 1.05, 1.45, 1.85].map((y) => (
                <mesh key={y} position={[0.24, y, 0.02]}>
                  <boxGeometry args={[0.44, 0.03, 0.03]} />
                  {M("#6b4a34")}
                </mesh>
              ))}
            </group>
          ))}
        </group>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ kırmızı çatılı ofis → Google */
function Cottage({ env }: { env: React.RefObject<Env> }) {
  const win = useWindowMat(env);
  const smoke = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = smoke.current;
    if (!g) return;
    g.children.forEach((c, i) => {
      const k = (clock.elapsedTime * 0.35 + i / 3) % 1;
      c.position.set(Math.sin(k * 4 + i) * 0.15 + k * 0.4 * (0.4 + env.current.wind), k * 1.6, 0);
      c.scale.setScalar(0.12 + k * 0.28);
      ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = (1 - k) * 0.7;
    });
  });
  return (
    <group>
      <mesh position={[0, 0.12, 0]} receiveShadow castShadow>
        <boxGeometry args={[2.5, 0.24, 1.9]} />
        {M("#a8a198")}
      </mesh>
      <mesh position={[0, 0.85, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.3, 1.25, 1.7]} />
        {M("#ebe6dd")}
      </mesh>
      <Gable w={2.7} h={1.1} d={2.0} color="#d4603d" y={1.47} />
      <mesh position={[0.65, 2.15, -0.35]} castShadow>
        <boxGeometry args={[0.28, 0.75, 0.28]} />
        {M("#9c8f84")}
      </mesh>
      <group ref={smoke} position={[0.65, 2.6, -0.35]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i}>
            <icosahedronGeometry args={[1, 1]} />
            <meshStandardMaterial color="#e8e8ea" transparent opacity={0.5} depthWrite={false} roughness={1} />
          </mesh>
        ))}
      </group>
      <mesh position={[0.15, 0.62, 0.86]} castShadow>
        <boxGeometry args={[0.42, 0.78, 0.06]} />
        {M("#4f7fbf", 0.6)}
      </mesh>
      {[-0.65, 0.75].map((x) => (
        <mesh key={x} position={[x, 0.95, 0.86]} material={win}>
          <boxGeometry args={[0.38, 0.36, 0.06]} />
        </mesh>
      ))}
      <mesh position={[-1.16, 0.95, 0.1]} material={win}>
        <boxGeometry args={[0.06, 0.36, 0.42]} />
      </mesh>
      {/* posta kutusu */}
      <group position={[1.45, 0, 1.3]}>
        <mesh position={[0, 0.35, 0]} castShadow>
          <boxGeometry args={[0.06, 0.7, 0.06]} />
          {M("#6b4a34")}
        </mesh>
        <mesh position={[0, 0.72, 0]} castShadow>
          <boxGeometry args={[0.22, 0.2, 0.34]} />
          {M("#e2574c", 0.6)}
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ gözlemevi → Beyin */
function Observatory({ env, busy }: { env: React.RefObject<Env>; busy?: boolean }) {
  const win = useWindowMat(env);
  const orb = useMemo(() => new THREE.MeshStandardMaterial({ color: "#c9b8ff", emissive: new THREE.Color("#8b5cf6"), emissiveIntensity: 1 }), []);
  const light = useRef<THREE.PointLight>(null);
  const dome = useRef<THREE.Group>(null);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const pulse = busy ? 0.6 + 0.4 * Math.sin(t * 5) : 0.5 + 0.2 * Math.sin(t * 1.5);
    orb.emissiveIntensity = 0.8 + pulse * 1.6 + env.current.night * 1.2;
    if (light.current) light.current.intensity = (0.4 + pulse) * (0.6 + env.current.night * 2.5);
    if (dome.current) dome.current.rotation.y += dt * (busy ? 0.5 : 0.08);
  });
  return (
    <group>
      <mesh position={[0, 0.2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.15, 1.2, 0.4, 18]} />
        {M("#a8a198")}
      </mesh>
      <mesh position={[0, 1.15, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.95, 1.0, 1.6, 18]} />
        {M("#eae3d6")}
      </mesh>
      <mesh position={[0, 1.98, 0]}>
        <cylinderGeometry args={[1.02, 1.02, 0.12, 18]} />
        {M("#8a7a6a")}
      </mesh>
      <group ref={dome} position={[0, 2.02, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.98, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          {M("#7d6fd8", 0.6)}
        </mesh>
        <mesh position={[0, 0.45, 0.62]} rotation-x={-0.7}>
          <boxGeometry args={[0.24, 0.9, 0.12]} />
          {M("#2b2f45")}
        </mesh>
      </group>
      <mesh position={[0, 3.35, 0]} material={orb}>
        <icosahedronGeometry args={[0.28, 2]} />
      </mesh>
      <mesh position={[0, 3.0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.5, 6]} />
        {M("#3c4250")}
      </mesh>
      <pointLight ref={light} position={[0, 3.4, 0]} color="#a78bfa" distance={6} decay={1.5} />
      <mesh position={[0, 0.72, 0.97]} castShadow>
        <boxGeometry args={[0.4, 0.66, 0.1]} />
        {M("#5a4a8a")}
      </mesh>
      {[-0.6, 0.6].map((x) => (
        <mesh key={x} position={[x, 1.3, 0.78]} rotation-y={x * 0.7} material={win}>
          <boxGeometry args={[0.24, 0.3, 0.08]} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ pazar tezgâhı → Aksiyonlar */
function Stall() {
  return (
    <group>
      <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.84, 0.8]} />
        {M("#b07a4a")}
      </mesh>
      <mesh position={[0, 0.86, 0]} castShadow>
        <boxGeometry args={[1.85, 0.06, 0.95]} />
        {M("#8d5d38")}
      </mesh>
      {[
        [-0.85, -0.42],
        [0.85, -0.42],
        [-0.85, 0.42],
        [0.85, 0.42],
      ].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 1.05, z]} castShadow>
          <boxGeometry args={[0.07, 2.1, 0.07]} />
          {M("#7a5235")}
        </mesh>
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={i} position={[-0.9 + i * 0.3 + 0.15, 2.0, 0.08]} rotation-x={0.42} castShadow>
          <boxGeometry args={[0.3, 0.05, 1.25]} />
          {M(i % 2 ? "#f6f1e8" : "#e05a4f", 0.85)}
        </mesh>
      ))}
      {/* kasalar */}
      {[
        [-0.45, 0.98, "#e9a23b"],
        [0.05, 0.98, "#9cc25a"],
        [0.5, 0.98, "#e0613e"],
      ].map(([x, y, c]) => (
        <mesh key={String(x)} position={[x as number, y as number, 0.1]} castShadow>
          <boxGeometry args={[0.38, 0.2, 0.42]} />
          {M(c as string)}
        </mesh>
      ))}
      <mesh position={[1.2, 0.3, 0.3]} castShadow>
        <cylinderGeometry args={[0.24, 0.26, 0.6, 12]} />
        {M("#8b5a36")}
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ kayıkhane (iskelede, suyun üstünde) → Geçmiş */
function Boathouse({ env }: { env: React.RefObject<Env> }) {
  const win = useWindowMat(env);
  return (
    <group>
      {[
        [-1, -0.8],
        [1, -0.8],
        [-1, 0.8],
        [1, 0.8],
        [0, -0.8],
        [0, 0.8],
      ].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, -0.2, z]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 1.4, 8]} />
          {M("#6e4a33")}
        </mesh>
      ))}
      <mesh position={[0, 0.48, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.1, 2.0]} />
        {M("#a66d45")}
      </mesh>
      <mesh position={[0, 1.15, -0.1]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 1.25, 1.5]} />
        {M("#b98257")}
      </mesh>
      <Gable w={2.2} h={0.95} d={1.8} color="#c9553a" y={1.77} />
      <mesh position={[0, 0.98, 0.66]} castShadow>
        <boxGeometry args={[0.5, 0.85, 0.06]} />
        {M("#6f4a32")}
      </mesh>
      <mesh position={[0.55, 1.25, 0.66]} material={win}>
        <boxGeometry args={[0.3, 0.3, 0.06]} />
      </mesh>
      {/* adaya bağlayan iskele */}
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[0, 0.46, 1.1 + i * 0.3]} castShadow receiveShadow>
          <boxGeometry args={[0.9, 0.07, 0.25]} />
          {M(i % 2 ? "#a66d45" : "#b07a4f")}
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ yerleşim + etkileşim */
const MODELS: Record<BuildingId, (p: { env: React.RefObject<Env>; busy?: boolean }) => React.ReactNode> = {
  denetim: ({ env }) => <Lighthouse env={env} />,
  analiz: ({ env }) => <Windmill env={env} />,
  google: ({ env }) => <Cottage env={env} />,
  beyin: ({ env, busy }) => <Observatory env={env} busy={busy} />,
  aksiyonlar: () => <Stall />,
  gecmis: ({ env }) => <Boathouse env={env} />,
};

export function Buildings({ env, info, hover, onHover, onPick }: { env: React.RefObject<Env>; info: Record<BuildingId, BuildingInfo>; hover: BuildingId | null; onHover: (id: BuildingId | null) => void; onPick: (id: BuildingId) => void }) {
  return (
    <>
      {SPOTS.map((sp) => (
        <Site key={sp.id} id={sp.id} env={env} info={info[sp.id]} hovered={hover === sp.id} onHover={onHover} onPick={onPick} />
      ))}
    </>
  );
}

function Site({ id, env, info, hovered, onHover, onPick }: { id: BuildingId; env: React.RefObject<Env>; info: BuildingInfo; hovered: boolean; onHover: (id: BuildingId | null) => void; onPick: (id: BuildingId) => void }) {
  const sp = SPOTS.find((s) => s.id === id)!;
  const g = useRef<THREE.Group>(null);
  const y = id === "gecmis" ? 0 : heightAt(sp.x, sp.z) - 0.05;
  useFrame((_, dt) => {
    if (!g.current) return;
    const target = hovered ? 1.06 : 1;
    const s = g.current.scale.x + (target - g.current.scale.x) * Math.min(1, dt * 10);
    g.current.scale.setScalar(s);
  });
  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onHover(id);
    document.body.style.cursor = "pointer";
  };
  const out = () => {
    onHover(null);
    document.body.style.cursor = "";
  };
  return (
    <group position={[sp.x, y, sp.z]} rotation-y={sp.rot}>
      <group
        ref={g}
        onPointerOver={over}
        onPointerOut={out}
        onClick={(e) => {
          e.stopPropagation();
          onPick(id);
        }}
      >
        {MODELS[id]({ env, busy: info.busy })}
      </group>
    </group>
  );
}
