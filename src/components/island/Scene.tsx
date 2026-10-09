"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitImpl } from "three-stdlib";
import { Birds, Clouds, Lightning, Ocean, Rain, SkyDome, Snow, Stars, flash } from "./Atmosphere";
import { Buildings, type BuildingInfo } from "./Buildings";
import { cloneEnv, lerpEnv, type Env, type Quality, type Season } from "./env";
import { Island } from "./Island";
import { BeachProps, Grass, Lamps, Pen, Trees, Well } from "./Nature";
import { SPOTS, heightAt, spotOf, type BuildingId } from "./terrain";

export type LabelRefs = React.RefObject<Partial<Record<BuildingId, HTMLElement | null>>>;

/** bina etiketleri DOM'da; her karede ekrana izdüşürülür (Html bileşeninden hafif) */
function LabelProjector({ labels }: { labels: LabelRefs }) {
  const anchors = useRef(SPOTS.map((sp) => ({ id: sp.id, p: new THREE.Vector3(sp.x, (sp.id === "gecmis" ? 0 : heightAt(sp.x, sp.z)) + sp.top, sp.z) })));
  const v = useRef(new THREE.Vector3());
  useFrame(({ camera, size }) => {
    for (const a of anchors.current) {
      const el = labels.current?.[a.id];
      if (!el) continue;
      v.current.copy(a.p).project(camera);
      const vis = v.current.z < 1 && Math.abs(v.current.x) < 1.1 && Math.abs(v.current.y) < 1.1;
      el.style.transform = `translate3d(${((v.current.x + 1) / 2) * size.width}px, ${((1 - v.current.y) / 2) * size.height}px, 0) translate(-50%, -100%)`;
      el.style.opacity = vis ? "1" : "0";
      el.style.zIndex = String(Math.round((1 - v.current.z) * 10000));
    }
  });
  return null;
}

/** ışıklar + sis: her karede ortama göre */
function Lights({ env, shadows }: { env: React.RefObject<Env>; shadows: boolean }) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const { scene } = useThree();
  useEffect(() => {
    scene.fog = new THREE.Fog("#e6eef2", 40, 150);
  }, [scene]);
  useFrame(() => {
    const e = env.current;
    if (sun.current) {
      sun.current.position.copy(e.sunDir).multiplyScalar(40);
      sun.current.color.copy(e.sunColor);
      sun.current.intensity = e.sunI;
    }
    if (hemi.current) {
      hemi.current.color.copy(e.hemiSky);
      hemi.current.groundColor.copy(e.hemiGround);
      hemi.current.intensity = e.hemiI + flash.v * 2.5;
    }
    const f = scene.fog as THREE.Fog | null;
    if (f) {
      f.color.copy(e.fog);
      f.near = e.fogNear;
      f.far = e.fogFar;
    }
  });
  return (
    <>
      <hemisphereLight ref={hemi} />
      <directionalLight
        ref={sun}
        castShadow={shadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-19}
        shadow-camera-right={19}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-bias={-0.0006}
        shadow-normalBias={0.03}
        shadow-radius={4}
      />
    </>
  );
}

const HOME_TARGET = new THREE.Vector3(-1.4, 2.4, 0.6);
const HOME_DIR = new THREE.Vector3(0.1, 0.42, 1).normalize();

/** kamera: açılışta adayı ekrana sığdırır; binaya tıklanınca oraya uçar */
function CameraRig({ fly, onArrive, controls }: { fly: BuildingId | null; onArrive: (id: BuildingId) => void; controls: React.RefObject<OrbitImpl | null> }) {
  const { camera, size } = useThree();
  const anim = useRef<{ id: BuildingId | null; t: number; dur: number; fromP: THREE.Vector3; fromT: THREE.Vector3; toP: THREE.Vector3; toT: THREE.Vector3 } | null>(null);
  const intro = useRef(true);
  const homeDist = () => {
    const aspect = size.width / size.height;
    return aspect >= 1.5 ? 50 : aspect >= 1 ? 58 : 70 + (1 - aspect) * 40;
  };
  useEffect(() => {
    const d = homeDist();
    // dikey ekranda ada biraz aşağıda dursun (üstte hava bilgisi var)
    const target = HOME_TARGET.clone().add(new THREE.Vector3(1.4, size.width < size.height ? 5 : 0, 0).multiplyScalar(size.width < size.height ? 1 : 0));
    const home = target.clone().addScaledVector(HOME_DIR, d);
    if (intro.current) {
      // açılış: yukarıdan ve yandan süzülerek adaya iner
      intro.current = false;
      const from = target.clone().add(HOME_DIR.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.9).multiplyScalar(d * 1.7)).add(new THREE.Vector3(0, 26, 0));
      camera.position.copy(from);
      controls.current?.target.copy(target).add(new THREE.Vector3(0, -2, 0));
      anim.current = { id: null, t: 0, dur: 2.6, fromP: from, fromT: target.clone().add(new THREE.Vector3(0, -2, 0)), toP: home, toT: target.clone() };
    } else {
      camera.position.copy(home);
      controls.current?.target.copy(target);
    }
    controls.current?.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);
  useEffect(() => {
    if (!fly || !controls.current) return;
    const sp = spotOf(fly);
    const y = fly === "gecmis" ? 0.5 : heightAt(sp.x, sp.z);
    const toT = new THREE.Vector3(sp.x, y + sp.top * 0.45, sp.z);
    const dir = camera.position.clone().sub(controls.current.target).normalize();
    anim.current = { id: fly, t: 0, dur: 0.75, fromP: camera.position.clone(), fromT: controls.current.target.clone(), toP: toT.clone().addScaledVector(dir, 11), toT };
  }, [fly, camera, controls]);
  useFrame((_, dt) => {
    const a = anim.current;
    if (!a || !controls.current) return;
    a.t = Math.min(1, a.t + dt / a.dur);
    // varış: kübik yavaşlama; açılış: daha uzun, yumuşak (quint)
    const k = a.id ? 1 - Math.pow(1 - a.t, 3) : 1 - Math.pow(1 - a.t, 5);
    camera.position.lerpVectors(a.fromP, a.toP, k);
    controls.current.target.lerpVectors(a.fromT, a.toT, k);
    controls.current.update();
    if (a.t >= 1) {
      anim.current = null;
      if (a.id) onArrive(a.id);
    }
  });
  return null;
}

/** hedef ortama yumuşak geçiş (her karede, diğerlerinden önce) */
function Smooth({ target, env }: { target: React.RefObject<Env>; env: React.RefObject<Env> }) {
  useFrame((_, dt) => lerpEnv(env.current, target.current, Math.min(1, dt * 1.8)), -1);
  return null;
}

export default function IslandScene({
  env: target,
  season,
  quality,
  info,
  hover,
  onHover,
  onPick,
  fly,
  onArrive,
  labels,
}: {
  env: React.RefObject<Env>;
  season: Season;
  quality: Quality;
  info: Record<BuildingId, BuildingInfo>;
  hover: BuildingId | null;
  onHover: (id: BuildingId | null) => void;
  onPick: (id: BuildingId) => void;
  fly: BuildingId | null;
  onArrive: (id: BuildingId) => void;
  labels: LabelRefs;
}) {
  const controls = useRef<OrbitImpl | null>(null);
  const env = useRef<Env>(cloneEnv(target.current));
  const shadows = quality !== "low";
  return (
    <Canvas
      shadows={shadows ? "soft" : false}
      dpr={quality === "high" ? [1, 2] : quality === "mid" ? [1, 1.5] : [0.75, 1]}
      camera={{ fov: 30, near: 0.5, far: 700, position: [0, 22, 34] }}
      gl={{ antialias: quality !== "low", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      onPointerMissed={() => onHover(null)}
    >
      <Smooth target={target} env={env} />
      <Lights env={env} shadows={shadows} />
      <SkyDome env={env} />
      <Stars env={env} />
      <Clouds env={env} />
      <Ocean env={env} />
      <Island env={env} season={season} />
      <Trees env={env} season={season} quality={quality} />
      <Grass season={season} quality={quality} />
      <Pen />
      <Well />
      <Lamps env={env} />
      <BeachProps env={env} />
      <Buildings env={env} info={info} hover={hover} onHover={onHover} onPick={onPick} />
      <Birds env={env} />
      <Rain env={env} />
      <Snow env={env} />
      <Lightning env={env} />
      <OrbitControls
        ref={controls}
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.5}
        zoomSpeed={0.7}
        minDistance={14}
        maxDistance={95}
        minPolarAngle={0.35}
        maxPolarAngle={1.22}
        autoRotate={!hover && !fly}
        autoRotateSpeed={0.18}
      />
      <CameraRig fly={fly} onArrive={onArrive} controls={controls} />
      <LabelProjector labels={labels} />
    </Canvas>
  );
}
