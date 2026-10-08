"use client";

import { RoundedBox } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Hospital } from "@/lib/checklist";
import type { ItemState, Mark } from "@/lib/types";
import { DOCK, dockX, type Lot } from "./layout";
import { FAIL, HOSPITAL_COLOR, OK, type Palette } from "./palette";

const HOSP: Hospital[] = ["bursa", "basaksehir"];
const damp = (cur: number, to: number, k: number, dt: number) => cur + (to - cur) * (1 - Math.exp(-k * dt));

export interface BuildingStats {
  bursa: number;
  basaksehir: number;
  fails: number;
  n: number;
  overdue: boolean;
  dueLabel: string;
}

interface Props {
  lot: Lot;
  items: Record<string, ItemState>;
  stats: BuildingStats;
  pal: Palette;
  selected: boolean;
  selectedItem: string | null;
  dimmed: boolean;
  /** >0 ise (her kutlamada artar) çatıdan havai fişek patlar */
  celebrate: number;
  onSelect: (code: string) => void;
  onSelectItem: (code: string, itemId: string) => void;
}

/** Rapor alanı = depo binası. Ön cephede her madde için bir rampa + iki palet yeri. */
export const Building = memo(function Building({ lot, items, stats, pal, selected, selectedItem, dimmed, celebrate, onSelect, onSelectItem }: Props) {
  const { area, w, h, d } = lot;
  const [hover, setHover] = useState(false);
  const body = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const trim = useMemo(() => new THREE.Color(area.color).lerp(new THREE.Color(pal.trim), 0.35).getStyle(), [area.color, pal.trim]);
  const done = stats.bursa + stats.basaksehir;
  const pct = Math.round((done / (stats.n * 2)) * 100);
  const complete = done === stats.n * 2;
  const fwColors = useMemo(() => [area.color, OK, "#ffc93c", "#ffffff", "#5b7cff", "#ff7a59"], [area.color]);

  // seçili/üzerine gelinen bina hafifçe yükselir; seçim halesi nabız gibi atar
  useFrame((st, dt) => {
    if (body.current) body.current.position.y = damp(body.current.position.y, hover || selected ? 0.18 : 0, 10, dt);
    if (halo.current) {
      const m = halo.current.material as THREE.MeshBasicMaterial;
      m.opacity = damp(m.opacity, selected ? 0.35 + Math.sin(st.clock.elapsedTime * 3) * 0.12 : hover ? 0.18 : 0, 8, dt);
    }
  });

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(true);
    document.body.style.cursor = "pointer";
  };
  const out = () => {
    setHover(false);
    document.body.style.cursor = "";
  };
  const roofUnits = Math.max(1, Math.floor(w / 4.5));

  return (
    <group position={[lot.x, 0, lot.z]} rotation={[0, lot.rot, 0]}>
      {/* seçim halesi (zeminde) */}
      <mesh ref={halo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 1.2]}>
        <planeGeometry args={[w + 3, d + 6.5]} />
        <meshBasicMaterial color={area.color} transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* beton zemin + önlük (rampa önü) */}
      <mesh receiveShadow position={[0, 0.05, 0.9]}>
        <boxGeometry args={[w + 1.6, 0.1, d + 4.6]} />
        <meshStandardMaterial color={pal.slab} roughness={1} />
      </mesh>

      <group
        ref={body}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(area.code);
        }}
        onPointerOver={over}
        onPointerOut={out}
      >
        {/* gövde */}
        <RoundedBox args={[w, h, d]} radius={0.22} smoothness={3} position={[0, h / 2 + 0.1, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={pal.wall} roughness={0.85} transparent={dimmed} opacity={dimmed ? 0.35 : 1} />
        </RoundedBox>
        {/* çatı tablası */}
        <mesh position={[0, h + 0.14, 0]} receiveShadow>
          <boxGeometry args={[w - 0.5, 0.08, d - 0.5]} />
          <meshStandardMaterial color={pal.roof} roughness={1} />
        </mesh>
        {/* çatı klima üniteleri (videodaki gibi) */}
        {Array.from({ length: roofUnits }, (_, i) => (
          <group key={i} position={[-w / 2 + (w / (roofUnits + 1)) * (i + 1), h + 0.18, -d / 4]}>
            <mesh castShadow position={[0, 0.25, 0]}>
              <boxGeometry args={[1.3, 0.5, 1.1]} />
              <meshStandardMaterial color={pal.wall} roughness={0.7} />
            </mesh>
            <mesh position={[0, 0.51, 0]}>
              <cylinderGeometry args={[0.36, 0.36, 0.04, 20]} />
              <meshStandardMaterial color={pal.dark ? "#141821" : "#5d6577"} />
            </mesh>
          </group>
        ))}
        {/* renkli kenar şeritleri */}
        <mesh position={[0, h + 0.02, d / 2 + 0.02]}>
          <boxGeometry args={[w + 0.02, 0.22, 0.08]} />
          <meshStandardMaterial color={trim} roughness={0.5} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[(s * w) / 2, h / 2 + 0.1, d / 2 + 0.02]}>
            <boxGeometry args={[0.16, h, 0.12]} />
            <meshStandardMaterial color={trim} roughness={0.5} />
          </mesh>
        ))}
        {/* yan cephe pencere bandı */}
        {[-1, 1].map((s) => (
          <mesh key={`win${s}`} position={[(s * w) / 2 + s * 0.01, h * 0.72, 0]} rotation={[0, (s * Math.PI) / 2, 0]}>
            <planeGeometry args={[d * 0.7, 0.45]} />
            <meshStandardMaterial color={pal.window} emissive={pal.dark ? pal.window : "#000"} emissiveIntensity={pal.dark ? 0.6 : 0} roughness={0.3} />
          </mesh>
        ))}
      </group>

      {/* tamamlanan bina: çatıda yeşil bayrak; az önce tamamlandıysa havai fişek */}
      {complete && <RoofFlag h={h} w={w} d={d} color={area.color} />}
      {celebrate > 0 && <Fireworks key={celebrate} y={h + 1.5} colors={fwColors} />}

      {/* rampalar */}
      {area.items.map((it, i) => (
        <Dock
          key={it.id}
          x={dockX(lot, i)}
          z={d / 2}
          state={items[it.id]}
          trim={trim}
          pal={pal}
          selected={selectedItem === it.id}
          onClick={() => onSelectItem(area.code, it.id)}
        />
      ))}

    </group>
  );
});

/* ------------------------------------------------------------------ rampa */
function Dock({ x, z, state, trim, pal, selected, onClick }: { x: number; z: number; state?: ItemState; trim: string; pal: Palette; selected: boolean; onClick: () => void }) {
  const door = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);
  const closed = !!state && (state.bursa === "ok" || state.bursa === "fail") && (state.basaksehir === "ok" || state.basaksehir === "fail");
  const W = DOCK - 0.9;
  const H = 2.2;

  // kepenk: iki hastane de kontrol edildiyse iner, yoksa açık (içerisi görünür)
  useFrame((st, dt) => {
    if (door.current) {
      const target = closed ? H / 2 + 0.1 : H + 0.05;
      door.current.position.y = damp(door.current.position.y, target, 4, dt);
      door.current.scale.y = damp(door.current.scale.y, closed ? 1 : 0.12, 4, dt);
    }
    if (ring.current) {
      const m = ring.current.material as THREE.MeshBasicMaterial;
      m.opacity = damp(m.opacity, selected ? 0.75 : hover ? 0.4 : 0, 10, dt);
      ring.current.rotation.z = st.clock.elapsedTime * 0.6;
    }
  });

  return (
    <group
      position={[x, 0, z]}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
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
      {/* iç karanlık / sıcak ışık */}
      <mesh position={[0, H / 2 + 0.1, 0.02]}>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial color={pal.interior} emissive={pal.dark ? pal.interior : "#000"} emissiveIntensity={pal.dark ? 0.5 : 0} roughness={1} />
      </mesh>
      {/* kepenk */}
      <mesh ref={door} position={[0, H + 0.05, 0.05]} scale={[1, 0.12, 1]} castShadow>
        <boxGeometry args={[W, H, 0.06]} />
        <meshStandardMaterial color={pal.door} roughness={0.6} metalness={0.1} />
      </mesh>
      {/* kapı çerçevesi */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * (W + 0.18)) / 2, H / 2 + 0.1, 0.08]} castShadow>
          <boxGeometry args={[0.18, H + 0.1, 0.16]} />
          <meshStandardMaterial color={trim} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, H + 0.2, 0.08]} castShadow>
        <boxGeometry args={[W + 0.36, 0.18, 0.16]} />
        <meshStandardMaterial color={trim} roughness={0.5} />
      </mesh>
      {/* rampa tamponu */}
      <mesh position={[0, 0.2, 0.3]} castShadow receiveShadow>
        <boxGeometry args={[W, 0.3, 0.5]} />
        <meshStandardMaterial color={pal.slab} roughness={0.9} />
      </mesh>
      {/* park çizgileri */}
      {[-1, 1].map((s) => (
        <mesh key={`l${s}`} position={[(s * DOCK) / 2, 0.11, 1.9]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.07, 3.1]} />
          <meshBasicMaterial color={pal.slotLine} />
        </mesh>
      ))}
      {/* seçim halkası */}
      <mesh ref={ring} position={[0, 0.12, 1.9]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.05, 1.22, 40, 1, 0, Math.PI * 1.6]} />
        <meshBasicMaterial color={pal.trim} transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* palet yerleri: sol Bursa, sağ Başakşehir */}
      {HOSP.map((hsp, k) => (
        <group key={hsp} position={[(k === 0 ? -1 : 1) * 0.58, 0.1, 1.95]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
            <planeGeometry args={[0.95, 0.95]} />
            <meshBasicMaterial color={HOSPITAL_COLOR[hsp]} transparent opacity={pal.dark ? 0.35 : 0.22} depthWrite={false} />
          </mesh>
          <Cargo key={state?.[hsp] ?? "none"} mark={state?.[hsp] ?? null} pal={pal} />
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ yük (işaret durumu) */
function Cargo({ mark, pal }: { mark: Mark; pal: Palette }) {
  const g = useRef<THREE.Group>(null);
  const pin = useRef<THREE.Group>(null);
  const born = useRef(-1);
  // işaret değiştiğinde yeniden monte edilir ve "pop" ile belirir
  useFrame((st, dt) => {
    if (born.current < 0) born.current = st.clock.elapsedTime;
    const t = st.clock.elapsedTime - born.current;
    if (g.current) {
      const k = t < 0.6 ? 1 + Math.sin(t * 9) * Math.exp(-t * 6) * 0.35 : 1;
      const s = damp(g.current.scale.x, 1, 12, dt);
      g.current.scale.setScalar(Math.max(0.001, s * k));
    }
    if (pin.current) pin.current.position.y = 1.55 + Math.sin(st.clock.elapsedTime * 2.6) * 0.12;
  });

  if (mark === null) {
    // boş yer: kesik sarı çerçeve
    return (
      <group>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, (i * Math.PI) / 2]} position={[Math.sin((i * Math.PI) / 2) * 0.42, 0.02, Math.cos((i * Math.PI) / 2) * 0.42]}>
            <planeGeometry args={[0.5, 0.06]} />
            <meshBasicMaterial color={pal.slotLine} />
          </mesh>
        ))}
      </group>
    );
  }
  return (
    <group ref={g} scale={0.001}>
      {/* palet */}
      <mesh position={[0, 0.07, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.86, 0.12, 0.86]} />
        <meshStandardMaterial color={pal.pallet} roughness={1} />
      </mesh>
      {mark === "ok" && (
        <>
          {[
            [-0.2, -0.2],
            [0.2, -0.2],
            [-0.2, 0.2],
            [0.2, 0.2],
          ].map(([x, z], i) => (
            <mesh key={i} position={[x, 0.33, z]} castShadow>
              <boxGeometry args={[0.38, 0.38, 0.38]} />
              <meshStandardMaterial color={pal.box} roughness={0.9} />
            </mesh>
          ))}
          <mesh position={[0, 0.71, 0]} castShadow>
            <boxGeometry args={[0.38, 0.38, 0.38]} />
            <meshStandardMaterial color={pal.box} roughness={0.9} />
          </mesh>
          {/* yeşil onay pulu */}
          <mesh position={[0, 0.91, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.13, 20]} />
            <meshBasicMaterial color={OK} />
          </mesh>
        </>
      )}
      {mark === "fail" && (
        <>
          <mesh position={[0, 0.45, 0]} castShadow>
            <boxGeometry args={[0.72, 0.62, 0.72]} />
            <meshStandardMaterial color={FAIL} roughness={0.6} />
          </mesh>
          {/* yüzen uyarı iğnesi */}
          <group ref={pin} position={[0, 1.55, 0]}>
            <mesh>
              <sphereGeometry args={[0.24, 20, 16]} />
              <meshStandardMaterial color={FAIL} emissive={FAIL} emissiveIntensity={0.5} />
            </mesh>
            <mesh position={[0, -0.32, 0]} rotation={[Math.PI, 0, 0]}>
              <coneGeometry args={[0.15, 0.36, 16]} />
              <meshStandardMaterial color={FAIL} emissive={FAIL} emissiveIntensity={0.5} />
            </mesh>
            <mesh position={[0, 0, 0.2]}>
              <boxGeometry args={[0.05, 0.2, 0.05]} />
              <meshBasicMaterial color="#fff" />
            </mesh>
          </group>
        </>
      )}
      {mark === "na" && (
        <mesh position={[0, 0.36, 0]} castShadow>
          <boxGeometry args={[0.78, 0.5, 0.78]} />
          <meshStandardMaterial color={pal.tarp} roughness={1} />
        </mesh>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ tamamlandı bayrağı */
function RoofFlag({ h, w, d, color }: { h: number; w: number; d: number; color: string }) {
  const g = useRef<THREE.Group>(null);
  const flag = useRef<THREE.Mesh>(null);
  useFrame((st, dt) => {
    if (g.current) g.current.scale.y = damp(g.current.scale.y, 1, 3, dt);
    if (flag.current) flag.current.rotation.y = Math.sin(st.clock.elapsedTime * 3) * 0.18;
  });
  return (
    <group ref={g} position={[w / 2 - 1, h + 0.15, d / 2 - 1]} scale={[1, 0.001, 1]}>
      <mesh position={[0, 1.4, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 2.8, 8]} />
        <meshStandardMaterial color="#e3e8f0" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[0, 2.85, 0]}>
        <sphereGeometry args={[0.09, 12, 10]} />
        <meshStandardMaterial color="#ffc93c" metalness={0.5} roughness={0.3} />
      </mesh>
      <mesh ref={flag} position={[0.55, 2.35, 0]} castShadow>
        <boxGeometry args={[1.1, 0.7, 0.03]} />
        <meshStandardMaterial color={OK} roughness={0.6} />
      </mesh>
      <mesh position={[0.55, 2.35, 0.02]}>
        <boxGeometry args={[0.36, 0.08, 0.01]} />
        <meshBasicMaterial color="#fff" />
      </mesh>
      {/* çatı kenarında renkli halka (tamamlandı ışığı) */}
      <mesh position={[-(w / 2 - 1), -0.02, -(d / 2 - 1)]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.min(w, d) * 0.28, Math.min(w, d) * 0.31, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ havai fişek */
const SPARK = new THREE.BoxGeometry(0.16, 0.16, 0.16);
export function Fireworks({ y, colors }: { y: number; colors: string[] }) {
  const N = 260;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const [alive, setAlive] = useState(true);
  // her parçacık: patlama anı, başlangıç noktası, hız, renk
  const parts = useMemo(() => {
    // ~6 sn boyunca art arda patlamalar
    const bursts = [0, 0.5, 1.1, 1.7, 2.4, 3.0, 3.7, 4.4].map((t, i) => ({ t, x: Math.sin(i * 2.3) * 2.4, z: Math.cos(i * 1.7) * 1.2, yy: y + 2 + (i % 3) * 1.1 }));
    return Array.from({ length: N }, (_, i) => {
      const b = bursts[i % bursts.length];
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = 4 + Math.random() * 3;
      return {
        t0: b.t,
        p: new THREE.Vector3(b.x, b.yy, b.z),
        v: new THREE.Vector3(Math.sin(ph) * Math.cos(th) * sp, Math.abs(Math.cos(ph)) * sp * 0.9 + 1.5, Math.sin(ph) * Math.sin(th) * sp),
        c: new THREE.Color(colors[i % colors.length]),
        spin: Math.random() * 6,
      };
    });
  }, [y, colors]);
  const start = useRef(-1);
  const o = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    const m = mesh.current;
    if (m) parts.forEach((p, i) => m.setColorAt(i, p.c));
    if (m?.instanceColor) m.instanceColor.needsUpdate = true;
    const t = setTimeout(() => setAlive(false), 7500);
    return () => clearTimeout(t);
  }, [parts]);

  useFrame((st) => {
    const m = mesh.current;
    if (!m) return;
    if (start.current < 0) start.current = st.clock.elapsedTime;
    const T = st.clock.elapsedTime - start.current;
    parts.forEach((p, i) => {
      const t = T - p.t0;
      if (t < 0 || t > 2.4) {
        o.scale.setScalar(0.0001);
      } else {
        o.position.set(p.p.x + p.v.x * t, p.p.y + p.v.y * t - 4.9 * t * t, p.p.z + p.v.z * t);
        o.rotation.set(p.spin * t, p.spin * t * 0.7, 0);
        o.scale.setScalar(Math.max(0.0001, 1 - t / 2.4));
      }
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });

  if (!alive) return null;
  return (
    <instancedMesh ref={mesh} args={[SPARK, undefined, N]} frustumCulled={false}>
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}
