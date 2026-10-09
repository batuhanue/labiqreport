"use client";

import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { LEAVES, type Env, type Season } from "./env";
import { PEN, WELL, freeSpot, heightAt, rng } from "./terrain";

const tmp = new THREE.Object3D();
const tc = new THREE.Color();

interface Tree {
  x: number;
  z: number;
  y: number;
  kind: "blob" | "tall" | "pine";
  h: number;
  c: number;
}

function useTrees(quality: "low" | "mid" | "high") {
  return useMemo(() => {
    const r = rng(42);
    const want = quality === "low" ? 28 : quality === "mid" ? 40 : 50;
    const trees: Tree[] = [];
    let guard = 0;
    while (trees.length < want && guard++ < 6000) {
      const x = (r() - 0.5) * 22;
      const z = (r() - 0.5) * 18;
      if (!freeSpot(x, z)) continue;
      if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 1.15)) continue;
      // tepede ve arka tarafta çam, önde yapraklı
      const kind: Tree["kind"] = z < -2.5 && r() < 0.55 ? "pine" : r() < 0.22 ? "tall" : "blob";
      trees.push({ x, z, y: heightAt(x, z), kind, h: 0.55 + r() * 0.4, c: Math.floor(r() * 100) });
    }
    return trees;
  }, [quality]);
}

/** Ağaçlar: gövde + taç (örneklenmiş/instanced; mevsime göre renk) */
export function Trees({ season, quality, env }: { season: Season; quality: "low" | "mid" | "high"; env: React.RefObject<Env> }) {
  const trees = useTrees(quality);
  const blobs = trees.filter((t) => t.kind !== "pine");
  const pines = trees.filter((t) => t.kind === "pine");
  const trunk = useRef<THREE.InstancedMesh>(null);
  const crown = useRef<THREE.InstancedMesh>(null);
  const cone = useRef<THREE.InstancedMesh>(null);
  const crownCount = blobs.reduce((n, t) => n + (t.kind === "tall" ? 1 : 3), 0);
  const palette = LEAVES[season];

  useLayoutEffect(() => {
    if (!trunk.current || !crown.current || !cone.current) return;
    let k = 0;
    trees.forEach((t, i) => {
      const th = t.kind === "pine" ? 0.5 : t.kind === "tall" ? 0.9 : 0.85;
      tmp.position.set(t.x, t.y + (th * t.h) / 2, t.z);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(t.h, th * t.h, t.h);
      tmp.updateMatrix();
      trunk.current!.setMatrixAt(i, tmp.matrix);
    });
    trunk.current.instanceMatrix.needsUpdate = true;
    for (const t of blobs) {
      const color = palette[t.c % palette.length];
      const parts: [number, number, number, number, number][] =
        t.kind === "tall"
          ? [[0, 1.6, 0, 0.48, 1.05]]
          : [
              [0, 1.45, 0, 0.72, 0.62],
              [0.38, 1.25, 0.15, 0.48, 0.42],
              [-0.3, 1.3, -0.18, 0.5, 0.44],
            ];
      for (const [dx, dy, dz, sxz, sy] of parts) {
        tmp.position.set(t.x + dx * t.h, t.y + dy * t.h, t.z + dz * t.h);
        tmp.scale.set(sxz * t.h, sy * t.h * 1.25, sxz * t.h);
        tmp.rotation.set(0, t.c, 0);
        tmp.updateMatrix();
        crown.current.setMatrixAt(k, tmp.matrix);
        crown.current.setColorAt(k, tc.set(color).offsetHSL(0, 0, (dy - 1.4) * 0.15));
        k++;
      }
    }
    crown.current.instanceMatrix.needsUpdate = true;
    if (crown.current.instanceColor) crown.current.instanceColor.needsUpdate = true;
    let c = 0;
    for (const t of pines) {
      for (let l = 0; l < 3; l++) {
        tmp.position.set(t.x, t.y + (0.65 + l * 0.48) * t.h * 1.1, t.z);
        const s = (0.62 - l * 0.15) * t.h;
        tmp.scale.set(s, 0.75 * t.h, s);
        tmp.rotation.set(0, t.c + l, 0);
        tmp.updateMatrix();
        cone.current.setMatrixAt(c, tmp.matrix);
        cone.current.setColorAt(c, tc.set(season === "winter" ? (l === 2 ? "#eef3f5" : "#3d6b4a") : ["#3f7d4a", "#2f6b3f", "#4b8a52"][t.c % 3]));
        c++;
      }
    }
    cone.current.instanceMatrix.needsUpdate = true;
    if (cone.current.instanceColor) cone.current.instanceColor.needsUpdate = true;
  }, [trees, blobs, pines, palette, season]);

  // rüzgârda hafif salınım
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!g.current) return;
    const w = env.current.wind;
    g.current.rotation.z = Math.sin(clock.elapsedTime * 1.3) * 0.004 * (0.3 + w);
  });

  return (
    <group ref={g}>
      <instancedMesh ref={trunk} args={[undefined, undefined, trees.length]} castShadow>
        <cylinderGeometry args={[0.07, 0.11, 1, 6]} />
        <meshStandardMaterial color="#7a5235" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={crown} args={[undefined, undefined, crownCount]} castShadow receiveShadow>
        <icosahedronGeometry args={[1, 3]} />
        <meshStandardMaterial roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={cone} args={[undefined, undefined, pines.length * 3]} castShadow>
        <coneGeometry args={[1, 1, 9]} />
        <meshStandardMaterial roughness={0.95} />
      </instancedMesh>
    </group>
  );
}

/** çim öbekleri */
export function Grass({ season, quality }: { season: Season; quality: "low" | "mid" | "high" }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const items = useMemo(() => {
    if (quality === "low") return [];
    const r = rng(77);
    const out: [number, number, number, number][] = [];
    let guard = 0;
    while (out.length < (quality === "high" ? 260 : 150) && guard++ < 8000) {
      const x = (r() - 0.5) * 21;
      const z = (r() - 0.5) * 17;
      if (!freeSpot(x, z, -0.6)) continue;
      out.push([x, heightAt(x, z), z, 0.6 + r() * 0.7]);
    }
    return out;
  }, [quality]);
  useLayoutEffect(() => {
    if (!ref.current) return;
    items.forEach(([x, y, z, s], i) => {
      tmp.position.set(x, y + 0.06 * s, z);
      tmp.scale.set(0.07 * s, 0.16 * s, 0.07 * s);
      tmp.rotation.set(0, i, 0);
      tmp.updateMatrix();
      ref.current!.setMatrixAt(i, tmp.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  }, [items]);
  if (!items.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]}>
      <coneGeometry args={[1, 1, 4]} />
      <meshStandardMaterial color={season === "winter" ? "#c9d6dc" : season === "autumn" ? "#6f9a3c" : "#5f9a37"} roughness={1} />
    </instancedMesh>
  );
}

/* ------------------------------------------------------------------ koyunlar ve çit */
function Sheep({ seed }: { seed: number }) {
  const g = useRef<THREE.Group>(null);
  const st = useRef({ x: PEN.x + Math.cos(seed) * 0.8, z: PEN.z + Math.sin(seed) * 0.8, tx: PEN.x, tz: PEN.z, wait: seed });
  useFrame(({ clock }, dt) => {
    const s = st.current;
    if (!g.current) return;
    s.wait -= dt;
    if (s.wait < 0) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * (PEN.r - 0.55);
      s.tx = PEN.x + Math.cos(a) * d;
      s.tz = PEN.z + Math.sin(a) * d;
      s.wait = 3 + Math.random() * 5;
    }
    const dx = s.tx - s.x;
    const dz = s.tz - s.z;
    const dist = Math.hypot(dx, dz);
    const moving = dist > 0.05;
    if (moving) {
      const sp = Math.min(dist, dt * 0.35);
      s.x += (dx / dist) * sp;
      s.z += (dz / dist) * sp;
      g.current.rotation.y = Math.atan2(dx, dz);
    }
    g.current.position.set(s.x, heightAt(s.x, s.z) + (moving ? Math.abs(Math.sin(clock.elapsedTime * 8 + seed)) * 0.04 : 0), s.z);
  });
  return (
    <group ref={g} scale={0.55}>
      {[
        [0, 0.55, 0, 0.42],
        [0, 0.6, 0.28, 0.36],
        [0, 0.58, -0.28, 0.36],
        [0.18, 0.7, 0, 0.3],
        [-0.18, 0.7, 0, 0.3],
      ].map(([x, y, z, s], i) => (
        <mesh key={i} position={[x, y, z]} scale={s} castShadow>
          <icosahedronGeometry args={[1, 2]} />
          <meshStandardMaterial color="#f6f3ec" roughness={1} />
        </mesh>
      ))}
      <mesh position={[0, 0.66, 0.58]} scale={[0.2, 0.22, 0.24]} castShadow>
        <sphereGeometry args={[1, 12, 8]} />
        <meshStandardMaterial color="#3b3a40" roughness={0.9} />
      </mesh>
      {[
        [0.18, 0.2],
        [-0.18, 0.2],
        [0.18, -0.2],
        [-0.18, -0.2],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.17, z]}>
          <cylinderGeometry args={[0.05, 0.05, 0.34, 6]} />
          <meshStandardMaterial color="#3b3a40" />
        </mesh>
      ))}
    </group>
  );
}

export function Pen() {
  const posts = useMemo(() => {
    const out: { x: number; z: number; a: number }[] = [];
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      // patika tarafında kapı boşluğu
      if (a > 5.6 || a < 0.05) continue;
      out.push({ x: PEN.x + Math.cos(a) * PEN.r, z: PEN.z + Math.sin(a) * PEN.r, a });
    }
    return out;
  }, []);
  return (
    <group>
      {posts.map((p, i) => {
        const y = heightAt(p.x, p.z);
        const nx = posts[i + 1];
        return (
          <group key={i}>
            <mesh position={[p.x, y + 0.25, p.z]} castShadow>
              <boxGeometry args={[0.08, 0.5, 0.08]} />
              <meshStandardMaterial color="#8a5c3a" roughness={1} />
            </mesh>
            {nx &&
              [0.18, 0.36].map((h) => {
                const mx = (p.x + nx.x) / 2;
                const mz = (p.z + nx.z) / 2;
                const len = Math.hypot(nx.x - p.x, nx.z - p.z);
                return (
                  <mesh key={h} position={[mx, heightAt(mx, mz) + h, mz]} rotation-y={-Math.atan2(nx.z - p.z, nx.x - p.x)} castShadow>
                    <boxGeometry args={[len, 0.05, 0.04]} />
                    <meshStandardMaterial color="#9c6b45" roughness={1} />
                  </mesh>
                );
              })}
          </group>
        );
      })}
      {[0.4, 1.9, 3.3, 4.6, 5.5].map((s) => (
        <Sheep key={s} seed={s} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ kuyu, fenerler, kumsal süsleri */
export function Well() {
  const y = heightAt(WELL.x, WELL.z);
  return (
    <group position={[WELL.x, y, WELL.z]}>
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.5, 0.55, 0.5, 14]} />
        <meshStandardMaterial color="#b9b2a8" roughness={1} />
      </mesh>
      <mesh position={[0, 0.49, 0]}>
        <cylinderGeometry args={[0.4, 0.4, 0.03, 14]} />
        <meshStandardMaterial color="#3d6f9c" roughness={0.4} />
      </mesh>
      {[-0.45, 0.45].map((x) => (
        <mesh key={x} position={[x, 0.75, 0]} castShadow>
          <boxGeometry args={[0.08, 1.0, 0.08]} />
          <meshStandardMaterial color="#7a5235" />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 1.33, s * 0.28]} rotation-x={s * 0.75} castShadow>
          <boxGeometry args={[1.25, 0.06, 0.72]} />
          <meshStandardMaterial color="#cf5d3c" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

const LAMPS: [number, number][] = [
  [-0.6, -1.9],
  [1.9, 1.2],
  [-1.8, 1.0],
  [4.6, 3.9],
  [-2.6, -2.2],
  [0.9, -3.2],
];
export function Lamps({ env }: { env: React.RefObject<Env> }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ffe7b0", emissive: new THREE.Color("#ffb64d"), emissiveIntensity: 0 }), []);
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  useFrame(() => {
    const n = env.current.night;
    mat.emissiveIntensity = n * 3.2;
    lights.current.forEach((l) => l && (l.intensity = n * 3));
  });
  return (
    <>
      {LAMPS.map(([x, z], i) => {
        const y = heightAt(x, z);
        return (
          <group key={i} position={[x, y, z]}>
            <mesh position={[0, 0.5, 0]} castShadow>
              <cylinderGeometry args={[0.03, 0.04, 1.0, 6]} />
              <meshStandardMaterial color="#3b3a44" />
            </mesh>
            <mesh position={[0, 1.05, 0]} material={mat}>
              <boxGeometry args={[0.14, 0.18, 0.14]} />
            </mesh>
            {i < 3 && <pointLight ref={(l) => void (lights.current[i] = l)} position={[0, 1.1, 0]} color="#ffb85c" distance={4.5} decay={1.6} intensity={0} />}
          </group>
        );
      })}
    </>
  );
}

export function BeachProps({ env }: { env: React.RefObject<Env> }) {
  const floaty = useRef<THREE.Group>(null);
  const boat = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (floaty.current) {
      floaty.current.position.y = 0.06 + Math.sin(t * 1.4) * 0.05;
      floaty.current.rotation.y = t * 0.15;
    }
    if (boat.current) {
      boat.current.position.y = 0.08 + Math.sin(t * 1.1 + 1) * 0.05;
      boat.current.rotation.z = Math.sin(t * 0.9) * 0.05;
    }
    void env;
  });
  const by = heightAt(6.2, 3.7);
  return (
    <>
      {/* şemsiye + havlu */}
      <group position={[6.2, by, 3.7]}>
        <mesh position={[0, 0.6, 0]} rotation-z={0.15} castShadow>
          <cylinderGeometry args={[0.025, 0.025, 1.2, 6]} />
          <meshStandardMaterial color="#e9e4dc" />
        </mesh>
        {Array.from({ length: 8 }, (_, i) => (
          <mesh key={i} position={[0.1, 1.17, 0]} rotation={[0, (i / 8) * Math.PI * 2, 0.15]} castShadow>
            <coneGeometry args={[0.75, 0.3, 3, 1, true, 0, Math.PI / 4]} />
            <meshStandardMaterial color={i % 2 ? "#f4efe8" : "#e2574c"} side={THREE.DoubleSide} />
          </mesh>
        ))}
        <mesh position={[0.6, 0.02, 0.35]} rotation-y={0.4}>
          <boxGeometry args={[0.6, 0.02, 1.0]} />
          <meshStandardMaterial color="#5b8fd6" />
        </mesh>
      </group>
      {/* flamingo simidi */}
      <group ref={floaty} position={[8.6, 0.06, 9.4]}>
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.42, 0.16, 10, 24]} />
          <meshStandardMaterial color="#f29ab8" roughness={0.6} />
        </mesh>
        <mesh position={[0.42, 0.35, 0]} rotation-z={-0.2}>
          <cylinderGeometry args={[0.07, 0.09, 0.7, 8]} />
          <meshStandardMaterial color="#f29ab8" />
        </mesh>
        <mesh position={[0.46, 0.7, 0.08]}>
          <sphereGeometry args={[0.12, 10, 8]} />
          <meshStandardMaterial color="#f29ab8" />
        </mesh>
      </group>
      {/* kayık */}
      <group ref={boat} position={[10.4, 0.08, 6.6]} rotation-y={0.9}>
        <mesh scale={[1.0, 0.32, 0.42]} castShadow>
          <sphereGeometry args={[1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          <meshStandardMaterial color="#c4573f" roughness={0.8} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, -0.02, 0]} rotation-x={-Math.PI / 2} scale={[0.95, 0.38, 1]}>
          <circleGeometry args={[1, 20]} />
          <meshStandardMaterial color="#9a6a45" />
        </mesh>
      </group>
    </>
  );
}
