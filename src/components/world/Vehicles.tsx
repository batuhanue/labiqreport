"use client";

import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { BOUNDS, RING, type Lot } from "./layout";
import type { Palette } from "./palette";

/* ------------------------------------------------------------------ kamyon modeli (+x yönüne bakar) */
function TruckModel({ stripe, pal, wheels }: { stripe: string; pal: Palette; wheels: React.RefObject<THREE.Group[]> }) {
  const body = pal.dark ? "#d9dee8" : "#ffffff";
  const wheelPos: [number, number][] = [
    [1.45, 0.62],
    [1.45, -0.62],
    [-0.9, 0.62],
    [-0.9, -0.62],
    [-1.7, 0.62],
    [-1.7, -0.62],
  ];
  return (
    <group>
      {/* dorse */}
      <RoundedBox args={[3.4, 1.55, 1.3]} radius={0.08} smoothness={2} position={[-0.85, 1.25, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={body} roughness={0.55} />
      </RoundedBox>
      <mesh position={[-0.85, 0.62, 0]} castShadow>
        <boxGeometry args={[3.42, 0.32, 1.32]} />
        <meshStandardMaterial color={stripe} roughness={0.5} />
      </mesh>
      {/* kabin */}
      <RoundedBox args={[1.05, 1.25, 1.25]} radius={0.12} smoothness={2} position={[1.5, 1.05, 0]} castShadow>
        <meshStandardMaterial color={body} roughness={0.5} />
      </RoundedBox>
      <mesh position={[2.03, 1.3, 0]}>
        <boxGeometry args={[0.04, 0.45, 1.05]} />
        <meshStandardMaterial color={pal.dark ? "#ffd889" : "#2d3650"} emissive={pal.dark ? "#ffcf7a" : "#000"} emissiveIntensity={pal.dark ? 0.6 : 0} roughness={0.15} />
      </mesh>
      <mesh position={[1.5, 0.6, 0]}>
        <boxGeometry args={[1.07, 0.18, 1.27]} />
        <meshStandardMaterial color={stripe} />
      </mesh>
      {/* tekerler */}
      {wheelPos.map(([x, z], i) => (
        <group
          key={i}
          position={[x, 0.3, z]}
          ref={(g) => {
            if (g && wheels.current) wheels.current[i] = g;
          }}
        >
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.3, 0.3, 0.22, 14]} />
            <meshStandardMaterial color="#2a2f3a" roughness={0.9} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.13, 0.13, 0.24, 10]} />
            <meshStandardMaterial color="#c9d0dc" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Kapalı yol boyunca dolaşan kamyon. */
function Truck({ curve, offset, speed, stripe, pal }: { curve: THREE.CatmullRomCurve3; offset: number; speed: number; stripe: string; pal: Palette }) {
  const g = useRef<THREE.Group>(null);
  const wheels = useRef<THREE.Group[]>([]);
  const len = useMemo(() => curve.getLength(), [curve]);
  const u = useRef(offset);
  const p = useMemo(() => new THREE.Vector3(), []);
  const t = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    u.current = (u.current + (speed * d) / len) % 1;
    curve.getPointAt(u.current, p);
    curve.getTangentAt(u.current, t);
    if (g.current) {
      g.current.position.set(p.x, 0, p.z);
      const target = Math.atan2(-t.z, t.x);
      let diff = target - g.current.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      g.current.rotation.y += diff * (1 - Math.exp(-8 * d));
    }
    for (const w of wheels.current) if (w) w.rotation.z -= (speed * d) / 0.3;
  });
  return (
    <group ref={g}>
      <TruckModel stripe={stripe} pal={pal} wheels={wheels} />
    </group>
  );
}

function roundedLoop(pts: [number, number][], r: number, lane: number) {
  // köşelerde yumuşak dönüş için her köşeye iki ara nokta
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    const [px, pz] = pts[(i - 1 + pts.length) % pts.length];
    const [nx, nz] = pts[(i + 1) % pts.length];
    const a = new THREE.Vector2(px - x, pz - z).normalize().multiplyScalar(r);
    const b = new THREE.Vector2(nx - x, nz - z).normalize().multiplyScalar(r);
    out.push(new THREE.Vector3(x + a.x, 0, z + a.y), new THREE.Vector3(x + b.x, 0, z + b.y));
  }
  void lane;
  return new THREE.CatmullRomCurve3(out, true, "centripetal");
}

export function Traffic({ pal }: { pal: Palette }) {
  const { ring, boulevard } = useMemo(() => {
    const { x0, x1, z0, z1 } = RING;
    const L = 1.25; // sağ şerit
    const ring = roundedLoop(
      [
        [x0 - L, z0 - L],
        [x1 + L, z0 - L],
        [x1 + L, z1 + L],
        [x0 - L, z1 + L],
      ],
      4,
      L,
    );
    // bulvar: doğuya giden şerit z=-1.4, batıya dönen z=+1.4 (uçlarda U dönüşü)
    const a = BOUNDS.minX - 5;
    const b = BOUNDS.maxX + 5;
    const boulevard = roundedLoop(
      [
        [a, -1.4],
        [b, -1.4],
        [b + 1.4, 0],
        [b, 1.4],
        [a, 1.4],
        [a - 1.4, 0],
      ],
      1.2,
      0,
    );
    return { ring, boulevard };
  }, []);
  return (
    <group>
      <Truck curve={ring} offset={0} speed={6} stripe="#2f5bd8" pal={pal} />
      <Truck curve={ring} offset={0.33} speed={6} stripe="#2ec4b6" pal={pal} />
      <Truck curve={ring} offset={0.66} speed={6} stripe="#ff7a59" pal={pal} />
      <Truck curve={boulevard} offset={0.1} speed={4} stripe="#5b7cff" pal={pal} />
      <Truck curve={boulevard} offset={0.6} speed={4} stripe="#34c26b" pal={pal} />
    </group>
  );
}

/* ------------------------------------------------------------------ forklift */
function ForkliftModel({ forks }: { forks: React.RefObject<THREE.Group | null> }) {
  return (
    <group>
      <RoundedBox args={[0.95, 0.5, 0.75]} radius={0.08} position={[-0.1, 0.45, 0]} castShadow>
        <meshStandardMaterial color="#ffc93c" roughness={0.5} />
      </RoundedBox>
      <mesh position={[-0.45, 0.78, 0]} castShadow>
        <boxGeometry args={[0.3, 0.3, 0.7]} />
        <meshStandardMaterial color="#e2a92b" />
      </mesh>
      {/* kabin kafesi */}
      {[
        [0.12, 0.3],
        [0.12, -0.3],
        [-0.32, 0.3],
        [-0.32, -0.3],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 1.1, z]} castShadow>
          <boxGeometry args={[0.05, 0.8, 0.05]} />
          <meshStandardMaterial color="#2a2f3a" />
        </mesh>
      ))}
      <mesh position={[-0.1, 1.5, 0]} castShadow>
        <boxGeometry args={[0.55, 0.05, 0.7]} />
        <meshStandardMaterial color="#2a2f3a" />
      </mesh>
      {/* direk */}
      {[0.22, -0.22].map((z) => (
        <mesh key={z} position={[0.42, 0.9, z]} castShadow>
          <boxGeometry args={[0.07, 1.5, 0.07]} />
          <meshStandardMaterial color="#3a4256" />
        </mesh>
      ))}
      <group ref={forks} position={[0.5, 0.18, 0]}>
        {[0.17, -0.17].map((z) => (
          <mesh key={z} position={[0.32, 0, z]} castShadow>
            <boxGeometry args={[0.65, 0.04, 0.09]} />
            <meshStandardMaterial color="#3a4256" />
          </mesh>
        ))}
        <mesh position={[0, 0.2, 0]}>
          <boxGeometry args={[0.06, 0.45, 0.5]} />
          <meshStandardMaterial color="#3a4256" />
        </mesh>
      </group>
      {[
        [0.25, 0.4],
        [0.25, -0.4],
        [-0.42, 0.4],
        [-0.42, -0.4],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.17, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.17, 0.17, 0.14, 12]} />
          <meshStandardMaterial color="#2a2f3a" />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Binanın önündeki forklift: bekleyen palet yerleri arasında dolaşır, her birinde kısa bir "çalışma" yapar
 * (rampaya döner, çatalını kaldırıp indirir). Bekleyen iş yoksa binanın yanında park eder.
 */
export function Forklift({ lot, pending }: { lot: Lot; pending: number[] }) {
  const g = useRef<THREE.Group>(null);
  const forks = useRef<THREE.Group>(null);
  const lane = lot.d / 2 + 3.5;
  const park = lot.w / 2 + 1.4;
  const s = useRef({ x: park, z: lane, heading: Math.PI, target: 0, phase: "drive" as "drive" | "work", t: 0 });
  const key = pending.join(",");
  const targets = useMemo(() => (pending.length ? pending : [park]), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const st = s.current;
    if (!g.current) return;
    const tx = targets[st.target % targets.length];
    if (st.phase === "drive") {
      const dx = tx - st.x;
      const dz = lane - st.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.05) {
        if (pending.length) {
          st.phase = "work";
          st.t = 0;
        }
      } else {
        const v = Math.min(dist, 2.6 * dt);
        st.x += (dx / dist) * v;
        st.z += (dz / dist) * v;
        const want = Math.atan2(-dz, dx);
        let diff = want - st.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        st.heading += diff * (1 - Math.exp(-10 * dt));
      }
      if (forks.current) forks.current.position.y += (0.18 - forks.current.position.y) * (1 - Math.exp(-6 * dt));
    } else {
      // rampaya dön (yerel −z), ileri git, çatalı kaldır, geri çık
      st.t += dt;
      const want = Math.PI / 2;
      let diff = want - st.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      st.heading += diff * (1 - Math.exp(-8 * dt));
      const p = st.t;
      const inZ = lane - 0.8;
      st.z = p < 1 ? lane - (lane - inZ) * Math.min(1, p) : p < 2.2 ? inZ : inZ + (lane - inZ) * Math.min(1, p - 2.2);
      if (forks.current) forks.current.position.y = p > 0.9 && p < 2.3 ? 0.18 + Math.sin(((p - 0.9) / 1.4) * Math.PI) * 0.75 : 0.18;
      if (p > 3.3) {
        st.phase = "drive";
        st.z = lane;
        st.target = (st.target + 1) % Math.max(1, targets.length);
      }
    }
    g.current.position.set(st.x, 0, st.z);
    g.current.rotation.y = st.heading;
  });

  return (
    <group position={[lot.x, 0, lot.z]} rotation={[0, lot.rot, 0]}>
      <group ref={g}>
        <ForkliftModel forks={forks} />
      </group>
    </group>
  );
}

export const slotX = (lotDockX: number, hospitalIndex: number) => lotDockX + (hospitalIndex === 0 ? -0.58 : 0.58);
