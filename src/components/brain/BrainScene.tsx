"use client";

import { AdaptiveDpr, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { AgentId } from "@/lib/brain-types";
import { Blink, Bob, Box, Chair, Desk, Person, Plant, RoundTable, Stack, type OfficePal } from "../office/Furniture";
import { BrainCore, Ground, ViewOffset } from "./BrainCore";
import { DEPTS, HALF, POD_D, POD_W, deptById, deskPos, type Dept } from "./layout";

export interface CameraApi {
  zoom: (f: number) => void;
  reset: () => void;
  rotate: (rad: number) => void;
}
/** DOM etiketlerinin ekran konumu (kartlar, masa adları, kablolar) */
export type Screen = React.RefObject<Record<string, { x: number; y: number; on: boolean }>>;
export type LabelRefs = React.RefObject<Record<string, HTMLDivElement | null>>;

const CENTER = new THREE.Vector3(0, 0, 0);
const HOME_DIR = new THREE.Vector3(0.5, 1.05, 0.95).normalize();

function homePos(width: number, height: number, panelPx: number, fov: number) {
  const aspect = Math.max(0.6, (width - panelPx) / Math.max(1, height));
  const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect);
  const dist = THREE.MathUtils.clamp((HALF * 1.22) / Math.tan(hfov / 2), 60, 260);
  return CENTER.clone().add(HOME_DIR.clone().multiplyScalar(dist));
}

function CameraRig({ focus, api, panelPx }: { focus: AgentId | null; api: React.RefObject<CameraApi | null>; panelPx: number }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const fly = useRef<{ target: THREE.Vector3; pos: THREE.Vector3 } | null>(null);
  const home = () => homePos(size.width, size.height, panelPx, camera.fov);
  const goTo = (target: THREE.Vector3, pos: THREE.Vector3) => (fly.current = { target, pos });
  useEffect(() => {
    const d = deptById(focus);
    if (!d) return void goTo(CENTER.clone(), home());
    const target = new THREE.Vector3(d.x, 0.8, d.z);
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

/** Kart, masa adı ve beyin etiketlerini her karede ekran koordinatına taşır. */
function LabelProjector({ labels, screen }: { labels: LabelRefs; screen: Screen }) {
  const anchors = useMemo(() => {
    const a: [string, THREE.Vector3, boolean?][] = [["hub", new THREE.Vector3(0, 4.2, 0)]];
    for (const d of DEPTS) {
      // üst yarıdaki pod'larda kart pod'un arkasında (üstte); alt yarıdakilerde Beyin'i örtmesin diye dış kenarda (altta)
      if (d.z > 2) a.push([d.id, new THREE.Vector3(d.x, 0, d.z + POD_D / 2 + 0.4), true]);
      else a.push([d.id, new THREE.Vector3(d.x, 2.4, d.z - POD_D / 2 + 0.4)]);
      d.desks.forEach((_, i) => {
        const [dx, dz] = deskPos(i);
        a.push([`${d.id}:${i}`, new THREE.Vector3(d.x + dx, 1.85, d.z + dz - 0.3)]);
      });
    }
    return a;
  }, []);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const [id, p, below] of anchors) {
      v.copy(p).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15;
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      if (screen.current) screen.current[id] = { x, y, on: visible };
      const el = labels.current?.[id];
      if (!el) continue;
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, ${below ? "10px" : "-100%"})`;
      el.style.opacity = visible ? "" : "0";
      el.style.zIndex = id === "hub" ? "1500" : String(Math.round((1 - v.z) * 1000));
    }
  });
  return null;
}

function Sun({ pal }: { pal: OfficePal }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = ref.current;
    if (!l) return;
    const c = l.shadow.camera as THREE.OrthographicCamera;
    c.left = -55;
    c.right = 55;
    c.top = 45;
    c.bottom = -45;
    c.near = 1;
    c.far = 220;
    c.updateProjectionMatrix();
  }, []);
  return <directionalLight ref={ref} position={[30, 70, 45]} intensity={pal.sun} color={pal.dark ? "#9db2ff" : "#fff4e4"} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.04} />;
}

/** Departmana özgü eşya (pod'un arka köşesinde) */
function Prop({ d, pal, active }: { d: Dept; pal: OfficePal; active: boolean }) {
  const bx = POD_W / 2 - 1.3;
  const bz = -POD_D / 2 + 1;
  switch (d.id) {
    case "posta":
      return (
        <group position={[bx, 0, bz]}>
          <Box p={[0, 0.5, 0]} s={[1.2, 0.7, 0.8]} c={d.color} />
          <Stack x={0} y={0.86} z={0} n={6} pal={pal} size={[0.5, 0.34]} step={0.06} colors={["#fff", "#ffd2d6", "#fff", "#fff3d6", "#fff", "#ffd2d6"]} />
        </group>
      );
    case "takvim":
      return (
        <group position={[bx - 0.3, 0, bz]}>
          <Box p={[0, 1.35, 0]} s={[2.2, 1.5, 0.08]} c="#ffffff" />
          {[0, 1, 2, 3, 4].map((k) => (
            <Box key={k} p={[-0.8 + k * 0.4, 1.45 - (k % 2) * 0.4, 0.06]} s={[0.3, 0.26, 0.02]} c={["#ffd54a", "#9cc3ff", "#b6f0c2", "#ffc9de", "#ffd54a"][k]} cast={false} />
          ))}
          <Box p={[0, 0.3, 0]} s={[0.08, 0.6, 0.08]} c={pal.metal} cast={false} />
        </group>
      );
    case "toplanti":
      return <RoundTable x={bx - 0.6} z={bz + 0.8} rad={0.8} pal={pal} chairs={3} chairColor={d.color} />;
    case "denetim":
      return (
        <group position={[bx, 0, bz]}>
          <Box p={[0, 0.9, 0]} s={[1.4, 1.8, 0.6]} c={pal.dark ? "#566079" : "#d7dce5"} />
          {[0.5, 0.95, 1.4].map((y) => (
            <Box key={y} p={[0, y, 0.31]} s={[0.5, 0.05, 0.02]} c={pal.metal} cast={false} />
          ))}
          <Box p={[0, 1.95, 0]} s={[0.5, 0.12, 0.4]} c="#34c26b" e="#34c26b" ei={0.4} cast={false} />
        </group>
      );
    case "dosya":
      return (
        <group position={[bx - 0.4, 0, bz]}>
          <Box p={[0, 1, 0]} s={[2.4, 2, 0.5]} c={pal.woodDark} />
          {[0.55, 1.25].map((y) =>
            Array.from({ length: 7 }, (_, k) => <Box key={`${y}${k}`} p={[-0.95 + k * 0.32, y + 0.2, 0.08]} s={[0.24, 0.5, 0.4]} c={["#4f7bff", "#2fbf71", "#ff9f43", "#ff5e6c", "#9aa3b5"][(k + y * 10) % 5 | 0]} cast={false} />),
          )}
        </group>
      );
    case "sohbet":
      return (
        <group position={[bx, 2.3, bz + 0.4]}>
          <Bob amp={active ? 0.16 : 0.07} speed={active ? 2.4 : 1.2}>
            <Box p={[0, 0, 0]} s={[1.1, 0.6, 0.12]} c={active ? d.color : "#ffffff"} e={active ? d.color : undefined} ei={0.5} cast={false} />
            {[-0.25, 0, 0.25].map((dx) => (
              <Box key={dx} p={[dx, 0, 0.07]} s={[0.1, 0.1, 0.02]} c={active ? "#fff" : "#9aa3b5"} cast={false} />
            ))}
          </Bob>
        </group>
      );
    default:
      return (
        <group position={[bx - 0.3, 0, bz]}>
          <Box p={[0, 1.2, 0]} s={[2, 1.4, 0.08]} c="#ffffff" />
          {[0, 1, 2].map((c) =>
            [0, 1].map((r) => <Box key={`${c}${r}`} p={[-0.6 + c * 0.6, 1.4 - r * 0.45, 0.06]} s={[0.4, 0.3, 0.02]} c={["#ffd54a", "#9cc3ff", "#b6f0c2"][c]} cast={false} />),
          )}
        </group>
      );
  }
}

const SHIRTS = ["#5b7cff", "#ff7a59", "#2ec4b6", "#8b5cf6", "#ffa53d", "#34c26b", "#e85d9b"];

/** Departman pod'u: kaide, pastel zemin, masalar, oturan çalışanlar, lider yıldızı. */
function DeptPod({ d, pal, active, selected, onSelect }: { d: Dept; pal: OfficePal; active: boolean; selected: boolean; onSelect: (id: AgentId) => void }) {
  const star = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (star.current) star.current.rotation.y += dt * (active ? 4 : 1);
  });
  const floor = pal.dark ? d.floorDark : d.floor;
  return (
    <group position={[d.x, 0, d.z]}>
      <Box p={[0, -0.45, 0]} s={[POD_W + 0.5, 0.9, POD_D + 0.5]} c={pal.slab} />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelect(d.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        <planeGeometry args={[POD_W + 0.5, POD_D + 0.5]} />
        <meshStandardMaterial color={floor} emissive={d.color} emissiveIntensity={selected ? (pal.dark ? 0.12 : 0.18) : 0} roughness={0.95} />
      </mesh>
      {d.desks.map((desk, i) => {
        const [dx, dz] = deskPos(i);
        return (
          <group key={i}>
            <Desk x={dx} z={dz} pal={pal} screen={active ? d.color : i === 0 ? "#ffffff" : "#e8ecf6"} glow={active ? 0.9 : 0.35} />
            <Chair x={dx} z={dz + 0.85} pal={pal} />
            <Person x={dx} z={dz + 0.62} shirt={i === 0 ? d.color : SHIRTS[(i + d.desks.length) % SHIRTS.length]} active={active} phase={i * 1.7} hair={["#3b2a20", "#1f1b18", "#7a4a2a", "#2b2b2b"][i % 4]} />
            {desk.lead && (
              <mesh ref={star} position={[dx, 2.25, dz]}>
                <octahedronGeometry args={[0.18, 0]} />
                <meshStandardMaterial color="#ffc23d" emissive="#ffc23d" emissiveIntensity={0.7} />
              </mesh>
            )}
          </group>
        );
      })}
      <Prop d={d} pal={pal} active={active} />
      <Plant x={-POD_W / 2 + 0.7} z={-POD_D / 2 + 0.7} pal={pal} h={0.8} />
      {active && <Blink p={[0, 0.03, POD_D / 2 + 0.1]} s={[POD_W, 0.04, 0.12]} color={d.color} speed={5} />}
    </group>
  );
}

function Walkways({ pal }: { pal: OfficePal }) {
  return (
    <group>
      {DEPTS.map((d) => {
        const len = Math.hypot(d.x, d.z);
        const ang = Math.atan2(d.x, d.z);
        return (
          <group key={d.id} position={[d.x / 2, -0.1, d.z / 2]} rotation={[0, ang, 0]}>
            <Box p={[0, 0, 0]} s={[2.2, 0.2, len - 6]} c={pal.wallTop} />
          </group>
        );
      })}
    </group>
  );
}

export function BrainScene({
  pal,
  focus,
  onSelect,
  api,
  panelPx,
  labels,
  screen,
  busy,
  active,
}: {
  pal: OfficePal;
  focus: AgentId | null;
  onSelect: (id: AgentId | null) => void;
  api: React.RefObject<CameraApi | null>;
  panelPx: number;
  labels: LabelRefs;
  screen: Screen;
  busy: boolean;
  /** şu an çalışan ajanlar */
  active: Set<string>;
}) {
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 1.75]}
      camera={{ fov: 30, near: 1, far: 600, position: HOME_DIR.clone().multiplyScalar(150).toArray() }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={[pal.dark ? "#121620" : "#f3f0e9"]} />
      <fog attach="fog" args={[pal.dark ? "#121620" : "#f3f0e9", 170, 360]} />
      <ambientLight intensity={pal.ambient} />
      <hemisphereLight args={[pal.dark ? "#a9bbf0" : "#ffffff", pal.dark ? "#1a1f2c" : "#d9cfbf", pal.dark ? 0.5 : 0.85]} />
      <Sun pal={pal} />
      <Ground pal={pal} />
      <group scale={1.3}>
        <BrainCore pal={pal} busy={busy} onSelect={() => onSelect(null)} />
      </group>
      <Walkways pal={pal} />
      {DEPTS.map((d) => (
        <DeptPod key={d.id} d={d} pal={pal} active={active.has(d.id)} selected={focus === d.id} onSelect={onSelect} />
      ))}
      <OrbitControls makeDefault target={CENTER.toArray()} enableDamping dampingFactor={0.08} minDistance={10} maxDistance={300} minPolarAngle={0.25} maxPolarAngle={1.2} screenSpacePanning={false} zoomSpeed={0.8} />
      <CameraRig focus={focus} api={api} panelPx={panelPx} />
      <ViewOffset px={panelPx} />
      <LabelProjector labels={labels} screen={screen} />
      <AdaptiveDpr pixelated={false} />
    </Canvas>
  );
}
