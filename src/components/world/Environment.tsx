"use client";

import { Html, RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { BOUNDS, HQ, RING, YARD } from "./layout";
import type { Palette } from "./palette";

/* ------------------------------------------------------------------ yardımcı: örneklenmiş (instanced) kutu/kür kümeleri */
function Instances({
  items,
  geometry,
  color,
  castShadow = true,
}: {
  items: { p: [number, number, number]; s?: [number, number, number]; r?: number }[];
  geometry: THREE.BufferGeometry;
  color: string;
  castShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    items.forEach((it, i) => {
      o.position.set(...it.p);
      o.rotation.set(0, it.r ?? 0, 0);
      o.scale.set(...(it.s ?? [1, 1, 1]));
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, items.length]} castShadow={castShadow} receiveShadow>
      <meshStandardMaterial color={color} roughness={0.9} />
    </instancedMesh>
  );
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CROWN = new THREE.IcosahedronGeometry(1, 1);
const TRUNK = new THREE.CylinderGeometry(0.12, 0.16, 1, 6);

// deterministik "rastgele"
const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function Ground({ pal }: { pal: Palette }) {
  const { x0, x1, z0, z1 } = RING;
  const cx = (x0 + x1) / 2;
  const roadW = 5;
  // yol şeritleri (kesikli orta çizgi)
  const dashes = useMemo(() => {
    const out: { p: [number, number, number]; s: [number, number, number]; r?: number }[] = [];
    for (let x = x0 + 4; x < x1 - 4; x += 4) {
      out.push({ p: [x, 0.035, z0], s: [1.6, 0.01, 0.14] }, { p: [x, 0.035, z1], s: [1.6, 0.01, 0.14] });
    }
    for (let z = z0 + 4; z < z1 - 4; z += 4) {
      out.push({ p: [x0, 0.035, z], s: [0.14, 0.01, 1.6] }, { p: [x1, 0.035, z], s: [0.14, 0.01, 1.6] });
    }
    for (let x = BOUNDS.minX - 6; x < BOUNDS.maxX + 6; x += 4) out.push({ p: [x, 0.035, 0], s: [1.6, 0.01, 0.14] });
    return out;
  }, [x0, x1, z0, z1]);

  return (
    <group>
      {/* sonsuz zemin */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[cx, -0.01, 0]}>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color={pal.ground} roughness={1} />
      </mesh>
      {/* kampüs platformu */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[cx, 0, 0]}>
        <planeGeometry args={[x1 - x0 - roadW, z1 - z0 - roadW]} />
        <meshStandardMaterial color={pal.pad} roughness={1} />
      </mesh>
      {/* çevre yolu */}
      {[
        [cx, z0, x1 - x0 + roadW, roadW],
        [cx, z1, x1 - x0 + roadW, roadW],
        [x0, 0, roadW, z1 - z0 + roadW],
        [x1, 0, roadW, z1 - z0 + roadW],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.02, z]} receiveShadow>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial color={pal.road} roughness={1} />
        </mesh>
      ))}
      {/* bulvar */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(BOUNDS.minX + BOUNDS.maxX) / 2 + 3, 0.02, 0]} receiveShadow>
        <planeGeometry args={[BOUNDS.maxX - BOUNDS.minX + 26, 6]} />
        <meshStandardMaterial color={pal.road} roughness={1} />
      </mesh>
      {/* bulvarı çevre yoluna bağlayan kısa yollar */}
      {[x0 + (BOUNDS.minX - 6 - x0) / 2].map((x, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.02, 0]} receiveShadow>
          <planeGeometry args={[BOUNDS.minX - 6 - x0, 6]} />
          <meshStandardMaterial color={pal.road} roughness={1} />
        </mesh>
      ))}
      <Instances items={dashes} geometry={BOX} color={pal.roadLine} castShadow={false} />
      {/* yaya geçitleri */}
      {[BOUNDS.minX - 3, (BOUNDS.minX + BOUNDS.maxX) / 2, BOUNDS.maxX + 3].map((x, k) => (
        <group key={k}>
          {Array.from({ length: 6 }, (_, i) => (
            <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x + (i - 2.5) * 0.7, 0.036, 0]}>
              <planeGeometry args={[0.38, 5]} />
              <meshBasicMaterial color={pal.roadLine} transparent opacity={0.85} />
            </mesh>
          ))}
        </group>
      ))}
      {/* çim şeritleri (çevre yolunun iç kenarı) */}
      {[z0 + 4.2, z1 - 4.2].map((z, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.015, z]} receiveShadow>
          <planeGeometry args={[x1 - x0 - 8, 3]} />
          <meshStandardMaterial color={pal.grass} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

export function Trees({ pal }: { pal: Palette }) {
  const { trunks, crowns, crowns2, posts, rails } = useMemo(() => {
    const { x0, x1, z0, z1 } = RING;
    const pts: [number, number, number][] = [];
    // çevre yolu iç kenarı boyunca ağaç sırası
    for (let x = x0 + 6; x < x1 - 6; x += 5.2) {
      pts.push([x + rnd(x) * 1.2, 0, z0 + 4.2], [x + rnd(x + 7) * 1.2, 0, z1 - 4.2]);
    }
    // dış çevrede seyrek kümeler
    for (let i = 0; i < 70; i++) {
      const side = i % 4;
      const t = rnd(i * 3.1);
      const off = 6 + rnd(i * 5.7) * 14;
      const x = side < 2 ? x0 - 10 + t * (x1 - x0 + 20) : side === 2 ? x0 - off : x1 + off;
      const z = side === 0 ? z0 - off : side === 1 ? z1 + off : z0 - 8 + t * (z1 - z0 + 16);
      pts.push([x, 0, z]);
    }
    const trunks = pts.map((p, i) => ({ p: [p[0], 0.6, p[2]] as [number, number, number], s: [1, 1.2 + rnd(i) * 0.4, 1] as [number, number, number] }));
    const crowns = pts
      .filter((_, i) => i % 2 === 0)
      .map((p, i) => {
        const k = 0.9 + rnd(i + 3) * 0.5;
        return { p: [p[0], 1.7 + k * 0.5, p[2]] as [number, number, number], s: [k, k * 1.15, k] as [number, number, number], r: rnd(i) * 6 };
      });
    const crowns2 = pts
      .filter((_, i) => i % 2 === 1)
      .map((p, i) => {
        const k = 0.8 + rnd(i + 9) * 0.5;
        return { p: [p[0], 1.6 + k * 0.5, p[2]] as [number, number, number], s: [k, k * 1.2, k] as [number, number, number], r: rnd(i + 1) * 6 };
      });
    // kampüs çiti (çevre yolunun dışında)
    const posts: { p: [number, number, number]; s: [number, number, number] }[] = [];
    const rails: { p: [number, number, number]; s: [number, number, number] }[] = [];
    const fz = [z0 - 3.4, z1 + 3.4];
    const fx = [x0 - 3.4, x1 + 3.4];
    for (let x = fx[0]; x <= fx[1]; x += 2.2) for (const z of fz) posts.push({ p: [x, 0.5, z], s: [0.08, 1, 0.08] });
    for (let z = fz[0]; z <= fz[1]; z += 2.2) for (const x of fx) posts.push({ p: [x, 0.5, z], s: [0.08, 1, 0.08] });
    for (const z of fz) rails.push({ p: [(fx[0] + fx[1]) / 2, 0.9, z], s: [fx[1] - fx[0], 0.05, 0.05] });
    for (const x of fx) rails.push({ p: [x, 0.9, (fz[0] + fz[1]) / 2], s: [0.05, 0.05, fz[1] - fz[0]] });
    return { trunks, crowns, crowns2, posts, rails };
  }, []);
  return (
    <group>
      <Instances items={trunks} geometry={TRUNK} color={pal.trunk} />
      <Instances items={crowns} geometry={CROWN} color={pal.leaf} />
      <Instances items={crowns2} geometry={CROWN} color={pal.leaf2} />
      <Instances items={posts} geometry={BOX} color={pal.fence} />
      <Instances items={rails} geometry={BOX} color={pal.fence} castShadow={false} />
    </group>
  );
}

/** Sokak lambaları (bulvar boyunca); gece temasında yanar. */
export function Lamps({ pal }: { pal: Palette }) {
  const xs = useMemo(() => {
    const out: number[] = [];
    for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x += 12) out.push(x);
    return out;
  }, []);
  return (
    <group>
      {xs.flatMap((x) =>
        [3.6].map((z) => (
          <group key={`${x}${z}`} position={[x, 0, z]}>
            <mesh position={[0, 1.6, 0]} castShadow>
              <cylinderGeometry args={[0.05, 0.07, 3.2, 6]} />
              <meshStandardMaterial color={pal.fence} />
            </mesh>
            <mesh position={[0, 3.25, 0]}>
              <sphereGeometry args={[0.17, 12, 10]} />
              <meshStandardMaterial color={pal.dark ? "#ffe2a3" : "#ffffff"} emissive={pal.dark ? "#ffcf7a" : "#000"} emissiveIntensity={pal.dark ? 2 : 0} />
            </mesh>
          </group>
        )),
      )}
    </group>
  );
}

/** Diacore merkez binası: tıklanınca genel özet. */
export function Headquarters({ pal, selected, onSelect }: { pal: Palette; selected: boolean; onSelect: () => void }) {
  const [hover, setHover] = useState(false);
  const g = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Mesh>(null);
  useFrame((st, dt) => {
    if (g.current) g.current.position.y += ((hover || selected ? 0.2 : 0) - g.current.position.y) * (1 - Math.exp(-10 * dt));
    if (beacon.current) (beacon.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + Math.sin(st.clock.elapsedTime * 2) * 0.4;
  });
  const floors = 4;
  return (
    <group position={[HQ.x, 0, HQ.z]}>
      <mesh receiveShadow position={[0, 0.05, 0]}>
        <boxGeometry args={[14, 0.1, 13]} />
        <meshStandardMaterial color={pal.slab} roughness={1} />
      </mesh>
      <group
        ref={g}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = "";
        }}
      >
        <RoundedBox args={[9, 8.5, 8]} radius={0.35} smoothness={3} position={[0, 4.35, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={pal.wall} roughness={0.7} />
        </RoundedBox>
        {/* cam kat bantları */}
        {Array.from({ length: floors }, (_, i) => (
          <mesh key={i} position={[0, 1.6 + i * 1.95, 0]}>
            <boxGeometry args={[9.06, 0.9, 8.06]} />
            <meshStandardMaterial color={pal.window} roughness={0.15} metalness={0.3} emissive={pal.dark ? pal.window : "#000"} emissiveIntensity={pal.dark ? 0.45 : 0} />
          </mesh>
        ))}
        <mesh position={[0, 8.7, 0]}>
          <boxGeometry args={[9.1, 0.25, 8.1]} />
          <meshStandardMaterial color={pal.trim} />
        </mesh>
        {/* çatı işareti */}
        <mesh ref={beacon} position={[0, 9.3, 0]}>
          <cylinderGeometry args={[0.9, 0.9, 0.18, 32]} />
          <meshStandardMaterial color={pal.trim} emissive={pal.trim} emissiveIntensity={0.6} />
        </mesh>
        {/* giriş saçağı */}
        <mesh position={[-4.9, 1.2, 0]} castShadow>
          <boxGeometry args={[1.2, 0.15, 3.4]} />
          <meshStandardMaterial color={pal.trim} />
        </mesh>
      </group>
      <Html position={[0, 11, 0]} center zIndexRange={[8, 0]} style={{ pointerEvents: "none" }}>
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className={`pointer-events-auto flex cursor-pointer select-none items-center gap-2 whitespace-nowrap rounded-full border py-1 pl-1 pr-3 text-[12px] font-extrabold shadow-lg backdrop-blur-md ${
            pal.dark ? "border-white/10 bg-[#1b1e27]/85 text-white" : "border-white/70 bg-white/85 text-[#1f2330]"
          } ${selected ? "scale-110" : ""}`}
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[#2f5bd8] text-[13px] text-white">D</span>
          Diacore Merkez
        </div>
      </Html>
    </group>
  );
}

/** Konteyner sahası (dekor) + otopark */
export function Yard({ pal }: { pal: Palette }) {
  const containers = useMemo(() => {
    const colors = ["#3d6fe0", "#2ec4b6", pal.dark ? "#4a5368" : "#ffffff", "#5b7cff"];
    const out: { p: [number, number, number]; c: string }[] = [];
    let k = 0;
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 3; col++) {
        const stack = 1 + Math.floor(rnd(k + 2) * 2.4);
        for (let s = 0; s < stack; s++) out.push({ p: [YARD.x - 3 + col * 3.4, 0.7 + s * 1.36, -6 + row * 1.6 + (row > 1 ? 6 : 0)], c: colors[(k + s) % colors.length] });
        k++;
      }
    return out;
  }, [pal.dark]);
  const cars = useMemo(() => {
    const colors = ["#ffffff", "#5b7cff", "#ff7a59", "#e3e8f0", "#2ec4b6", "#ffc93c"];
    return Array.from({ length: 10 }, (_, i) => ({ p: [HQ.x - 5 + (i % 5) * 2.4, 0, HQ.z + (i < 5 ? 9 : -9)] as [number, number, number], c: colors[i % colors.length] }));
  }, []);
  return (
    <group>
      {containers.map((c, i) => (
        <mesh key={i} position={c.p} castShadow receiveShadow rotation={[0, Math.PI / 2, 0]}>
          <boxGeometry args={[1.3, 1.3, 3]} />
          <meshStandardMaterial color={c.c} roughness={0.7} />
        </mesh>
      ))}
      {cars.map((c, i) => (
        <group key={i} position={c.p} rotation={[0, Math.PI / 2, 0]}>
          <RoundedBox args={[1.9, 0.55, 0.95]} radius={0.12} position={[0, 0.42, 0]} castShadow>
            <meshStandardMaterial color={c.c} roughness={0.5} />
          </RoundedBox>
          <RoundedBox args={[1.05, 0.42, 0.85]} radius={0.12} position={[-0.1, 0.85, 0]} castShadow>
            <meshStandardMaterial color={pal.dark ? "#1b2030" : "#3a4256"} roughness={0.2} />
          </RoundedBox>
        </group>
      ))}
      {/* otopark çizgileri */}
      {[9, -9].flatMap((z) =>
        Array.from({ length: 6 }, (_, i) => (
          <mesh key={`${z}${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[HQ.x - 6.2 + i * 2.4, 0.03, HQ.z + z]}>
            <planeGeometry args={[0.07, 2.6]} />
            <meshBasicMaterial color={pal.roadLine} />
          </mesh>
        )),
      )}
    </group>
  );
}
