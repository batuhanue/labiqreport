"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OfficePal } from "../office/Furniture";

/** Beyin ofisinin ortak 3B parçaları: not ağı (Beyin), gölge zemini, panel için görüş kaydırma. */
const BRAIN_R = 4.6;

export function ViewOffset({ px }: { px: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  useEffect(() => {
    if (px > 0) camera.setViewOffset(size.width, size.height, px / 2, 0, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [camera, size, px]);
  return null;
}

/** Beyin: platform + üstünde yavaşça dönen not ağı (düğümler ve bağlar); düşünürken parlar. */
export function BrainCore({ pal, busy, onSelect }: { pal: OfficePal; busy: boolean; onSelect: () => void }) {
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
export function Ground({ pal }: { pal: OfficePal }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.9, 0]} receiveShadow>
      <planeGeometry args={[400, 400]} />
      <shadowMaterial transparent opacity={pal.dark ? 0.35 : 0.14} />
    </mesh>
  );
}

