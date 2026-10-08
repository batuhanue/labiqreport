"use client";

import { AdaptiveDpr, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { ItemState } from "@/lib/types";
import { Building, type BuildingStats } from "./Building";
import { Ground, Headquarters, Lamps, Trees, Yard } from "./Environment";
import { BOUNDS, HQ, LOTS, dockX, lotByCode } from "./layout";
import type { Palette } from "./palette";
import { Forklift, Traffic, slotX } from "./Vehicles";

export interface CameraApi {
  zoom: (f: number) => void;
  reset: () => void;
  rotate: (rad: number) => void;
}

const CENTER = new THREE.Vector3((BOUNDS.minX - 4 + HQ.x + 7) / 2, 0, 0);
const HOME_DIR = new THREE.Vector3(0.24, 0.62, 0.75).normalize();
const HOME_POS = CENTER.clone().add(HOME_DIR.clone().multiplyScalar(150));
const CAMPUS_W = HQ.x + 7 - (BOUNDS.minX - 4);

/** Görünen alana (panel hariç) bütün binaları sığdıran kamera konumu. */
function homePos(width: number, height: number, panelPx: number, fov: number) {
  const aspect = Math.max(0.6, (width - panelPx) / Math.max(1, height));
  const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect);
  const dist = THREE.MathUtils.clamp((CAMPUS_W * 0.56) / Math.tan(hfov / 2), 70, 210);
  return CENTER.clone().add(HOME_DIR.clone().multiplyScalar(dist));
}

/** Yumuşak kamera uçuşu: hedef değişince kontrol hedefini ve kamerayı ona doğru kaydırır; kullanıcı sürüklerse bırakır. */
function CameraRig({ focus, api, panelPx }: { focus: string | null; api: React.RefObject<CameraApi | null>; panelPx: number }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const home = () => homePos(size.width, size.height, panelPx, camera.fov);
  const fly = useRef<{ target: THREE.Vector3; pos: THREE.Vector3 } | null>(null);

  const goTo = (target: THREE.Vector3, pos: THREE.Vector3) => {
    fly.current = { target, pos };
  };

  useEffect(() => {
    if (!focus) return goTo(CENTER.clone(), home());
    if (focus === "HQ") return goTo(new THREE.Vector3(HQ.x, 3, HQ.z), new THREE.Vector3(HQ.x + 18, 24, HQ.z + 28));
    const lot = lotByCode(focus);
    if (!lot) return;
    const front = 1;
    const target = new THREE.Vector3(lot.x, 1.2, lot.z + front * 3);
    const dist = Math.max(30, lot.w * 2.1);
    goTo(target, new THREE.Vector3(lot.x + dist * 0.3, dist * 0.62, lot.z + front * dist));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, size.width, size.height, panelPx]);

  useEffect(() => {
    if (!controls) return;
    const stop = () => (fly.current = null);
    controls.addEventListener("start", stop);
    api.current = {
      zoom: (f) => {
        fly.current = null;
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
    const k = 1 - Math.exp(-3.2 * Math.min(dt, 0.05));
    controls.target.lerp(f.target, k);
    camera.position.lerp(f.pos, k);
    controls.update();
    if (camera.position.distanceTo(f.pos) < 0.05 && controls.target.distanceTo(f.target) < 0.05) fly.current = null;
  });
  return null;
}

/**
 * Sağdaki cam panel sahnenin bir kısmını örttüğü için görüntü merkezini sola kaydırır
 * (kamera izdüşümü kaydırılır; böylece seçilen bina görünen alanın ortasına gelir).
 */
function ViewOffset({ px }: { px: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  useEffect(() => {
    if (px > 0) camera.setViewOffset(size.width, size.height, px / 2, 0, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [camera, size, px]);
  return null;
}

/** Gölge kamerasını tüm kampüsü kapsayacak şekilde ayarlar. */
function Sun({ pal }: { pal: Palette }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = ref.current;
    if (!l) return;
    const c = l.shadow.camera as THREE.OrthographicCamera;
    c.left = -95;
    c.right = 95;
    c.top = 60;
    c.bottom = -60;
    c.near = 1;
    c.far = 260;
    c.updateProjectionMatrix();
    l.target.position.copy(CENTER);
    l.target.updateMatrixWorld();
  }, []);
  return (
    <directionalLight
      ref={ref}
      position={[CENTER.x + 40, 80, 55]}
      intensity={pal.sun}
      color={pal.dark ? "#9db2ff" : "#fff6ea"}
      castShadow
      shadow-mapSize={[3072, 3072]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.04}
      shadow-radius={4}
    />
  );
}

export interface SceneProps {
  pal: Palette;
  items: Record<string, ItemState>;
  stats: Record<string, BuildingStats>;
  focus: string | null;
  selectedItem: string | null;
  onSelect: (code: string | null) => void;
  onSelectItem: (code: string, itemId: string) => void;
  api: React.RefObject<CameraApi | null>;
  /** sağ panelin genişliği (px) — görüntü merkezi bunun yarısı kadar sola kayar */
  panelPx: number;
}

export function Scene({ pal, items, stats, focus, selectedItem, onSelect, onSelectItem, api, panelPx }: SceneProps) {
  // forkliftlerin dolaşacağı bekleyen palet yerleri
  const pending = useMemo(() => {
    const out: Record<string, number[]> = {};
    for (const lot of LOTS) {
      out[lot.area.code] = lot.area.items.flatMap((it, i) =>
        (["bursa", "basaksehir"] as const).flatMap((h, k) => (items[it.id]?.[h] == null ? [slotX(dockX(lot, i), k)] : [])),
      );
    }
    return out;
  }, [items]);

  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 1.75]}
      camera={{ fov: 30, near: 1, far: 600, position: HOME_POS.toArray() }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={[pal.bg]} />
      <fog attach="fog" args={[pal.bg, 150, 330]} />
      <ambientLight intensity={pal.ambient} />
      <hemisphereLight args={[pal.hemiSky, pal.hemiGround, pal.dark ? 0.5 : 0.9]} />
      <Sun pal={pal} />

      <Ground pal={pal} />
      <Trees pal={pal} />
      <Lamps pal={pal} />
      <Yard pal={pal} />
      <Headquarters pal={pal} selected={focus === "HQ"} onSelect={() => onSelect("HQ")} />

      {LOTS.map((lot) => (
        <Building
          key={lot.area.code}
          lot={lot}
          items={items}
          stats={stats[lot.area.code]}
          pal={pal}
          selected={focus === lot.area.code}
          selectedItem={selectedItem}
          dimmed={false}
          onSelect={onSelect}
          onSelectItem={onSelectItem}
        />
      ))}
      {LOTS.map((lot) => (
        <Forklift key={lot.area.code} lot={lot} pending={pending[lot.area.code]} />
      ))}
      <Traffic pal={pal} />

      <OrbitControls
        makeDefault
        target={CENTER.toArray()}
        enableDamping
        dampingFactor={0.08}
        minDistance={12}
        maxDistance={220}
        minPolarAngle={0.25}
        maxPolarAngle={1.18}
        screenSpacePanning={false}
        zoomSpeed={0.8}
      />
      <CameraRig focus={focus} api={api} panelPx={panelPx} />
      <ViewOffset px={panelPx} />
      <AdaptiveDpr pixelated={false} />
    </Canvas>
  );
}
