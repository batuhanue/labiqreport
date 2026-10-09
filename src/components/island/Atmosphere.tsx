"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Env } from "./env";
import { R, SX, rng } from "./terrain";

/* ------------------------------------------------------------------ okyanus */
const waterVert = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const waterFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform float uNight;
uniform float uRain;
varying vec3 vW;
float radiusAt(float t) {
  return ${R.toFixed(2)} * (1.0 + 0.08 * sin(2.0 * t + 0.6) + 0.06 * sin(3.0 * t + 2.1) + 0.035 * sin(5.0 * t + 0.3));
}
float h(vec2 p) {
  return sin(p.x * 0.9 + uTime * 0.8) * 0.5 + sin(p.y * 1.3 - uTime * 0.6) * 0.5 + sin((p.x + p.y) * 2.3 + uTime * 1.4) * 0.25 + sin((p.x - p.y) * 3.7 - uTime * 1.9) * 0.15;
}
void main() {
  vec2 q = vec2(vW.x / ${SX.toFixed(2)}, vW.z);
  float t = atan(q.y, q.x);
  float s = length(q) / radiusAt(t);
  // derinlik: kıyıya yakın açık turkuaz, açıkta koyu mavi
  float shore = smoothstep(1.85, 1.0, s);
  vec3 col = mix(uDeep, uShallow, shore);
  col = mix(col, uDeep * 0.92, smoothstep(2.4, 6.0, s) * 0.35);
  // dalga normali (sinüs toplamı)
  float e = 0.15;
  vec2 p = vW.xz * 0.6;
  vec3 n = normalize(vec3(h(p - vec2(e, 0.0)) - h(p + vec2(e, 0.0)), 6.0, h(p - vec2(0.0, e)) - h(p + vec2(0.0, e))));
  vec3 v = normalize(cameraPosition - vW);
  vec3 r = reflect(-normalize(uSun), n);
  float spec = pow(max(dot(r, v), 0.0), 80.0);
  col += uSunColor * spec * (0.5 - uNight * 0.3) * (1.0 - uRain * 0.6);
  // ışıltı
  float glint = smoothstep(0.92, 1.0, sin(vW.x * 3.1 + uTime * 1.2) * sin(vW.z * 2.7 - uTime * 0.9));
  col += glint * 0.06 * (1.0 - uNight);
  // kıyı köpüğü
  float foamBand = smoothstep(1.13, 1.0, s) * smoothstep(0.96, 1.0, s);
  float foamWave = 0.55 + 0.45 * sin(t * 18.0 + uTime * 1.6) * sin(t * 7.0 - uTime * 0.8);
  col = mix(col, vec3(0.97, 0.99, 1.0) * (1.0 - uNight * 0.55), foamBand * foamWave * 0.85);
  // sis
  float d = distance(cameraPosition, vW);
  col = mix(col, uFog, smoothstep(uFogNear, uFogFar, d));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function Ocean({ env }: { env: React.RefObject<Env> }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: waterVert,
        fragmentShader: waterFrag,
        uniforms: {
          uTime: { value: 0 },
          uShallow: { value: new THREE.Color() },
          uDeep: { value: new THREE.Color() },
          uFog: { value: new THREE.Color() },
          uFogNear: { value: 30 },
          uFogFar: { value: 150 },
          uSun: { value: new THREE.Vector3(1, 1, 1) },
          uSunColor: { value: new THREE.Color() },
          uNight: { value: 0 },
          uRain: { value: 0 },
        },
      }),
    [],
  );
  useFrame((_, dt) => {
    const e = env.current;
    const u = mat.uniforms;
    u.uTime.value += dt;
    u.uShallow.value.copy(e.waterShallow);
    u.uDeep.value.copy(e.waterDeep);
    u.uFog.value.copy(e.fog);
    u.uFogNear.value = e.fogNear;
    u.uFogFar.value = e.fogFar;
    u.uSun.value.copy(e.sunDir);
    u.uSunColor.value.copy(e.sunColor);
    u.uNight.value = e.night;
    u.uRain.value = e.rain;
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0} material={mat} receiveShadow>
      <planeGeometry args={[600, 600, 1, 1]} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ gökyüzü kubbesi */
export function SkyDome({ env }: { env: React.RefObject<Env> }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uFlash: { value: 0 } },
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform float uFlash; varying vec3 vP;
          void main(){ float k = smoothstep(-0.05, 0.55, vP.y); vec3 c = mix(uHor, uTop, k); c += uFlash * vec3(0.55,0.6,0.75); gl_FragColor = vec4(c,1.0);
          #include <colorspace_fragment>
          }`,
      }),
    [],
  );
  useFrame(() => {
    const e = env.current;
    mat.uniforms.uTop.value.copy(e.skyTop);
    mat.uniforms.uHor.value.copy(e.skyHorizon);
    mat.uniforms.uFlash.value = flash.v;
  });
  return (
    <mesh material={mat} renderOrder={-1}>
      <sphereGeometry args={[320, 32, 16]} />
    </mesh>
  );
}

/** şimşek (fırtınada) — ışık ve gökyüzü bunu okur */
export const flash = { v: 0 };
export function Lightning({ env }: { env: React.RefObject<Env> }) {
  const next = useRef(3);
  useFrame((_, dt) => {
    const e = env.current;
    flash.v = Math.max(0, flash.v - dt * 4);
    if (!e.storm) return;
    next.current -= dt;
    if (next.current < 0) {
      flash.v = 1;
      next.current = 2 + Math.random() * 6;
      // çift çakma
      setTimeout(() => (flash.v = 0.8), 140);
    }
  });
  return null;
}

/* ------------------------------------------------------------------ bulutlar */
interface Puff {
  x: number;
  y: number;
  z: number;
  s: number;
  parts: [number, number, number, number][];
}
export function Clouds({ env }: { env: React.RefObject<Env> }) {
  const clouds = useMemo<Puff[]>(() => {
    const r = rng(7);
    return Array.from({ length: 16 }, (_, i) => {
      const n = 5 + Math.floor(r() * 4);
      return {
        x: -75 + r() * 150,
        y: 6 + r() * 7,
        z: -85 + r() * 50,
        s: 1.4 + r() * 1.6,
        parts: Array.from({ length: n }, (_, k) => [(k - n / 2) * 1.1 + (r() - 0.5) * 0.6, r() * 0.7, (r() - 0.5) * 1.6, 1 + r() * 0.9] as [number, number, number, number]),
        i,
      } as Puff;
    });
  }, []);
  const group = useRef<THREE.Group>(null);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, transparent: true, opacity: 0.96 }), []);
  const white = useMemo(() => new THREE.Color("#ffffff"), []);
  useFrame((_, dt) => {
    const e = env.current;
    const g = group.current;
    if (!g) return;
    const n = Math.round(4 + e.clouds * 12);
    g.children.forEach((c, i) => {
      c.visible = i < n;
      c.position.x += dt * (0.4 + e.wind * 2.2);
      if (c.position.x > 80) c.position.x = -80;
    });
    mat.color.copy(white).lerp(new THREE.Color("#8f99a6"), e.cloudDark * 0.7).lerp(new THREE.Color("#5a6a9c"), e.night * 0.7);
  });
  return (
    <group ref={group}>
      {clouds.map((c, i) => (
        <group key={i} position={[c.x, c.y, c.z]} scale={[c.s, c.s * 0.62, c.s]}>
          {c.parts.map(([x, y, z, s], k) => (
            <mesh key={k} position={[x, y, z]} scale={s} material={mat}>
              <icosahedronGeometry args={[1, 2]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ yıldızlar ve ay */
export function Stars({ env }: { env: React.RefObject<Env> }) {
  const geo = useMemo(() => {
    const r = rng(11);
    const pts: number[] = [];
    for (let i = 0; i < 500; i++) {
      const th = r() * Math.PI * 2;
      const ph = 0.08 + r() * 0.9;
      pts.push(Math.cos(th) * Math.cos(ph) * 280, Math.sin(ph) * 280, Math.sin(th) * Math.cos(ph) * 280);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  const mat = useMemo(() => new THREE.PointsMaterial({ color: "#ffffff", size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false }), []);
  const moon = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const e = env.current;
    mat.opacity = e.night * (1 - e.clouds * 0.75);
    if (moon.current) {
      (moon.current.material as THREE.MeshBasicMaterial).opacity = e.night * (1 - e.clouds * 0.5);
      moon.current.visible = e.night > 0.05;
    }
  });
  return (
    <>
      <points geometry={geo} material={mat} />
      <mesh ref={moon} position={[-70, 95, -180]}>
        <sphereGeometry args={[7, 24, 12]} />
        <meshBasicMaterial color="#f4f1dc" transparent fog={false} />
      </mesh>
    </>
  );
}

/* ------------------------------------------------------------------ kuşlar */
function Bird({ phase }: { phase: number }) {
  const l = useRef<THREE.Group>(null);
  const r = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const a = Math.sin(clock.elapsedTime * 9 + phase) * 0.55;
    if (l.current) l.current.rotation.z = a;
    if (r.current) r.current.rotation.z = -a;
  });
  return (
    <group>
      <group ref={l}>
        <mesh position={[-0.22, 0, 0]}>
          <boxGeometry args={[0.44, 0.02, 0.12]} />
          <meshStandardMaterial color="#2b3140" />
        </mesh>
      </group>
      <group ref={r}>
        <mesh position={[0.22, 0, 0]}>
          <boxGeometry args={[0.44, 0.02, 0.12]} />
          <meshStandardMaterial color="#2b3140" />
        </mesh>
      </group>
    </group>
  );
}
export function Birds({ env }: { env: React.RefObject<Env> }) {
  const flocks = useRef<THREE.Group>(null);
  const defs = useMemo(
    () => [
      { r: 22, y: 12, sp: 0.06, off: 0 },
      { r: 27, y: 14.5, sp: -0.05, off: 2.4 },
    ],
    [],
  );
  useFrame(({ clock }) => {
    const e = env.current;
    const g = flocks.current;
    if (!g) return;
    g.visible = e.night < 0.6 && !e.storm && e.snow < 0.5;
    g.children.forEach((f, i) => {
      const d = defs[i];
      const a = clock.elapsedTime * d.sp + d.off;
      f.position.set(Math.cos(a) * d.r * 1.2, d.y + Math.sin(clock.elapsedTime * 0.5 + i) * 0.6, Math.sin(a) * d.r - 4);
      f.rotation.y = -a + (d.sp > 0 ? 0 : Math.PI);
    });
  });
  return (
    <group ref={flocks}>
      {defs.map((d, i) => (
        <group key={i} scale={0.5}>
          {[0, 1, 2, 3, 4].map((k) => (
            <group key={k} position={[0, (k % 2) * 0.15, -Math.abs(k - 2) * 0.55]} >
              <group position={[(k - 2) * 0.55, 0, 0]}>
                <Bird phase={k * 1.3 + i} />
              </group>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ yağmur ve kar */
const BOX = { x: 34, y: 24, z: 30 };
export function Rain({ env }: { env: React.RefObject<Env> }) {
  const N = 1500;
  const { geo, pos } = useMemo(() => {
    const r = rng(5);
    const pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = (r() - 0.5) * BOX.x * 2;
      const y = r() * BOX.y;
      const z = (r() - 0.5) * BOX.z * 2;
      pos.set([x, y, z, x, y - 0.6, z], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return { geo, pos };
  }, []);
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color: "#cfe0f2", transparent: true, opacity: 0.5, depthWrite: false }), []);
  const ref = useRef<THREE.LineSegments>(null);
  useFrame((_, dt) => {
    const e = env.current;
    if (!ref.current) return;
    ref.current.visible = e.rain > 0.01;
    if (!ref.current.visible) return;
    const count = Math.floor(N * e.rain);
    geo.setDrawRange(0, count * 2);
    const vy = 26 * dt;
    const vx = e.wind * 6 * dt;
    for (let i = 0; i < count; i++) {
      const o = i * 6;
      pos[o + 1] -= vy;
      pos[o + 4] -= vy;
      pos[o] += vx;
      pos[o + 3] += vx;
      if (pos[o + 1] < 0) {
        pos[o + 1] = BOX.y;
        pos[o + 4] = BOX.y - 0.6;
        if (pos[o] > BOX.x) {
          pos[o] -= BOX.x * 2;
        }
        pos[o + 3] = pos[o] - e.wind * 0.25;
      }
    }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = 0.22 + 0.18 * (1 - e.night);
  });
  return <lineSegments ref={ref} geometry={geo} material={mat} frustumCulled={false} />;
}

function dotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.6, "rgba(255,255,255,0.8)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
export function Snow({ env }: { env: React.RefObject<Env> }) {
  const N = 1800;
  const { geo, pos, seed } = useMemo(() => {
    const r = rng(9);
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos.set([(r() - 0.5) * BOX.x * 2, r() * BOX.y, (r() - 0.5) * BOX.z * 2], i * 3);
      seed[i] = r() * 10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return { geo, pos, seed };
  }, []);
  const mat = useMemo(() => new THREE.PointsMaterial({ color: "#ffffff", size: 0.16, map: dotTexture(), transparent: true, depthWrite: false }), []);
  const ref = useRef<THREE.Points>(null);
  useFrame(({ clock }, dt) => {
    const e = env.current;
    if (!ref.current) return;
    ref.current.visible = e.snow > 0.01;
    if (!ref.current.visible) return;
    const t = clock.elapsedTime;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      pos[o + 1] -= dt * (1.2 + (seed[i] % 1) * 0.8);
      pos[o] += Math.sin(t * 0.8 + seed[i]) * dt * 0.5 + e.wind * dt * 2;
      if (pos[o + 1] < 0) pos[o + 1] = BOX.y;
      if (pos[o] > BOX.x) pos[o] -= BOX.x * 2;
    }
    geo.attributes.position.needsUpdate = true;
  });
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} />;
}
