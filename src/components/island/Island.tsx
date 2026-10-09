"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { GRASS, type Env, type Season } from "./env";
import { DOCK, PATHS, RIVER, SX, beachAt, heightAt, polar, radiusAt, rng } from "./terrain";

const col = (h: string) => new THREE.Color(h);

/** Adanın üst yüzeyi (çim + kumsal) ve yanlardaki toprak yamaç. */
function useTerrain(season: Season) {
  return useMemo(() => {
    const RINGS = 34;
    const SEG = 160;
    const [g1, g2] = GRASS[season].map(col);
    const sand = col(season === "winter" ? "#eef1f2" : "#ead6a4");
    const sandWet = col("#d9c089");
    const r = rng(3);
    // üst yüzey: kutupsal ızgara
    const pos: number[] = [];
    const cols: number[] = [];
    const idx: number[] = [];
    pos.push(0, heightAt(0, 0), 0);
    cols.push(g1.r, g1.g, g1.b);
    for (let i = 1; i <= RINGS; i++) {
      const s = Math.pow(i / RINGS, 0.8);
      for (let j = 0; j < SEG; j++) {
        const t = (j / SEG) * Math.PI * 2;
        const rr = radiusAt(t) * s;
        const x = Math.cos(t) * rr * SX;
        const z = Math.sin(t) * rr;
        const y = heightAt(x, z);
        pos.push(x, y, z);
        const n = 0.5 + 0.5 * Math.sin(x * 1.7 + z * 0.9) * Math.cos(z * 1.3 - x * 0.4);
        const c = g1.clone().lerp(g2, n * 0.8 + r() * 0.2);
        const b = beachAt(x, z);
        if (b > 0.05) c.lerp(sand, Math.min(1, b * 1.6));
        // kıyıda kumsal ıslaklığı
        if (b > 0.3 && s > 0.94) c.lerp(sandWet, 0.4);
        cols.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < SEG; j++) idx.push(0, 1 + ((j + 1) % SEG), 1 + j);
    for (let i = 1; i < RINGS; i++) {
      const a0 = 1 + (i - 1) * SEG;
      const a1 = 1 + i * SEG;
      for (let j = 0; j < SEG; j++) {
        const j1 = (j + 1) % SEG;
        idx.push(a0 + j, a0 + j1, a1 + j, a0 + j1, a1 + j1, a1 + j);
      }
    }
    const top = new THREE.BufferGeometry();
    top.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    top.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    top.setIndex(idx);
    top.computeVertexNormals();

    // yamaç: kenardan suyun altına toprak bandı
    const sp: number[] = [];
    const sc: number[] = [];
    const si: number[] = [];
    const LAY = [
      { k: 1.0, dy: 0, c: col("#5f8a3c") },
      { k: 1.012, dy: -0.12, c: col("#6b4429") },
      { k: 1.0, dy: -0.55, c: col("#8b5a36") },
      { k: 0.97, dy: -1.1, c: col("#7a4b2d") },
      { k: 0.9, dy: -2.2, c: col("#5e3a24") },
    ];
    for (let j = 0; j <= SEG; j++) {
      const t = (j / SEG) * Math.PI * 2;
      const rr = radiusAt(t);
      const ex = Math.cos(t) * rr * SX;
      const ez = Math.sin(t) * rr;
      const ey = heightAt(ex, ez);
      const b = beachAt(ex * 0.99, ez * 0.99);
      for (const L of LAY) {
        sp.push(ex * L.k, ey + L.dy, ez * L.k);
        const c = L.c.clone();
        if (L.dy === 0) c.lerp(sand, b);
        else c.lerp(col("#d4bb84"), b * 0.85);
        sc.push(c.r, c.g, c.b);
      }
    }
    const NL = LAY.length;
    for (let j = 0; j < SEG; j++) {
      for (let l = 0; l < NL - 1; l++) {
        const a = j * NL + l;
        const b = (j + 1) * NL + l;
        si.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const side = new THREE.BufferGeometry();
    side.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    side.setAttribute("color", new THREE.Float32BufferAttribute(sc, 3));
    side.setIndex(si);
    side.computeVertexNormals();
    return { top, side };
  }, [season]);
}

/** yüzeye oturan şerit (patika, nehir) */
function ribbon(points: [number, number][], width: number, lift: number, samples = 60) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const pts = curve.getSpacedPoints(samples);
  for (let i = 0; i <= samples; i++) {
    const p = pts[i];
    const tg = curve.getTangentAt(i / samples);
    const nx = -tg.z;
    const nz = tg.x;
    for (const side of [-1, 1]) {
      const x = p.x + nx * width * 0.5 * side;
      const z = p.z + nz * width * 0.5 * side;
      pos.push(x, heightAt(x, z) + lift, z);
      uv.push(side < 0 ? 0 : 1, i / samples);
    }
    if (i < samples) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { g, length: curve.getLength() };
}

const riverFrag = /* glsl */ `
uniform float uTime; uniform float uNight; uniform float uLen;
varying vec2 vUv;
void main(){
  float flow = vUv.y * uLen * 2.2 - uTime * 1.6;
  float stripe = smoothstep(0.82, 1.0, sin(flow + sin(vUv.x * 6.0 + flow * 0.3) * 1.2));
  float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
  vec3 c = mix(vec3(0.33, 0.62, 0.88), vec3(0.42, 0.74, 0.95), edge);
  c = mix(c, vec3(0.92, 0.97, 1.0), stripe * 0.55);
  c *= 1.0 - uNight * 0.62;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export function Island({ env, season }: { env: React.RefObject<Env>; season: Season }) {
  const { top, side } = useTerrain(season);
  const paths = useMemo(() => PATHS.map((p) => ribbon(p, 0.55, 0.035, 30).g), []);
  const river = useMemo(() => ribbon(RIVER, 0.62, 0.05, 90), []);
  const riverMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uLen: { value: river.length } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: riverFrag,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        side: THREE.DoubleSide,
      }),
    [river.length],
  );
  useFrame((_, dt) => {
    riverMat.uniforms.uTime.value += dt;
    riverMat.uniforms.uNight.value = env.current.night;
  });
  const pathColor = season === "winter" ? "#d8d4cb" : "#d6bd8c";
  return (
    <group>
      <mesh geometry={top} receiveShadow castShadow>
        <meshStandardMaterial vertexColors roughness={1} />
      </mesh>
      <mesh geometry={side} receiveShadow>
        <meshStandardMaterial vertexColors roughness={1} />
      </mesh>
      {paths.map((g, i) => (
        <mesh key={i} geometry={g} receiveShadow>
          <meshStandardMaterial color={pathColor} roughness={1} polygonOffset polygonOffsetFactor={-1} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <mesh geometry={river.g} material={riverMat} />
      <Rocks />
      <Dock />
      <Islets season={season} />
    </group>
  );
}

/** kıyıdaki ve sudaki yuvarlak kayalar */
function Rocks() {
  const rocks = useMemo(() => {
    const r = rng(21);
    const out: { p: [number, number, number]; s: [number, number, number]; c: string }[] = [];
    for (let i = 0; i < 14; i++) {
      const t = r() * Math.PI * 2;
      const k = 1.03 + r() * 0.45;
      const rr = radiusAt(t) * k;
      const x = Math.cos(t) * rr * SX;
      const z = Math.sin(t) * rr;
      const s = 0.2 + r() * 0.4;
      out.push({ p: [x, s * 0.1, z], s: [s * 1.3, s * 0.7, s], c: ["#b9b5c6", "#aaa7b9", "#c4c0cf", "#b1aec0"][i % 4] });
    }
    // adanın üstünde birkaç kaya
    for (const [x, z, s] of [
      [-6.4, -1.8, 0.45],
      [4.2, 4.9, 0.4],
      [-1.8, 4.6, 0.32],
      [7.6, -1.2, 0.38],
    ] as [number, number, number][])
      out.push({ p: [x, heightAt(x, z) + s * 0.25, z], s: [s * 1.3, s * 0.9, s], c: "#a29fb2" });
    return out;
  }, []);
  return (
    <>
      {rocks.map((k, i) => (
        <mesh key={i} position={k.p} scale={k.s} castShadow receiveShadow>
          <icosahedronGeometry args={[1, 3]} />
          <meshStandardMaterial color={k.c} roughness={0.95} />
        </mesh>
      ))}
    </>
  );
}

/** kumsaldan denize uzanan iskele */
function Dock() {
  const [[ax, az], [bx, bz]] = DOCK;
  const len = Math.hypot(bx - ax, bz - az);
  const ang = Math.atan2(bz - az, bx - ax);
  const n = Math.floor(len / 0.32);
  return (
    <group position={[ax, 0.32, az]} rotation-y={-ang}>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} position={[i * 0.32 + 0.16, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.27, 0.08, 1.2]} />
          <meshStandardMaterial color={i % 3 ? "#a66d45" : "#b07a4f"} roughness={1} />
        </mesh>
      ))}
      {Array.from({ length: Math.floor(n / 3) + 1 }, (_, i) =>
        [-0.55, 0.55].map((zz) => (
          <mesh key={`${i}${zz}`} position={[i * 0.96 + 0.1, -0.35, zz]} castShadow>
            <cylinderGeometry args={[0.07, 0.07, 1.0, 8]} />
            <meshStandardMaterial color="#6e4a33" roughness={1} />
          </mesh>
        )),
      )}
      {/* uçta fener direği */}
      <mesh position={[len - 0.2, 0.55, 0.5]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 1.1, 8]} />
        <meshStandardMaterial color="#5b4636" />
      </mesh>
    </group>
  );
}

/** uzaktaki küçük adacıklar */
function Islets({ season }: { season: Season }) {
  const grass = GRASS[season][0];
  return (
    <>
      {(
        [
          [-21, -3, 2.0],
          [19, -14, 1.4],
          [-14, 15, 1.1],
        ] as [number, number, number][]
      ).map(([x, z, s], i) => (
        <group key={i} position={[x, 0, z]} scale={s}>
          <mesh position={[0, 0.12, 0]} scale={[1.6, 0.35, 1.3]} receiveShadow castShadow>
            <sphereGeometry args={[1, 20, 10]} />
            <meshStandardMaterial color={season === "winter" ? "#eef1f2" : "#e7d29f"} roughness={1} />
          </mesh>
          <mesh position={[0, 0.3, 0]} scale={[1.1, 0.3, 0.9]} castShadow>
            <sphereGeometry args={[1, 20, 10]} />
            <meshStandardMaterial color={grass} roughness={1} />
          </mesh>
          {i === 0 && (
            <group position={[0.2, 0.4, 0]}>
              <mesh position={[0, 0.7, 0]} rotation-z={0.15} castShadow>
                <cylinderGeometry args={[0.05, 0.08, 1.4, 6]} />
                <meshStandardMaterial color="#8a6a4a" />
              </mesh>
              {[0, 1, 2, 3, 4].map((k) => (
                <mesh key={k} position={[0.1 + Math.cos(k * 1.26) * 0.35, 1.38, Math.sin(k * 1.26) * 0.35]} rotation={[Math.sin(k * 1.26) * 0.6, k * 1.26, -Math.cos(k * 1.26) * 0.6]} scale={[0.75, 0.06, 0.22]} castShadow>
                  <sphereGeometry args={[1, 10, 6]} />
                  <meshStandardMaterial color="#5f9a3b" />
                </mesh>
              ))}
            </group>
          )}
        </group>
      ))}
    </>
  );
}

export { polar };
