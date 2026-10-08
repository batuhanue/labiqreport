"use client";

import { Html, RoundedBox } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { memo, useMemo, useRef, useState } from "react";
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
  onSelect: (code: string) => void;
  onSelectItem: (code: string, itemId: string) => void;
}

/** Rapor alanı = depo binası. Ön cephede her madde için bir rampa + iki palet yeri. */
export const Building = memo(function Building({ lot, items, stats, pal, selected, selectedItem, dimmed, onSelect, onSelectItem }: Props) {
  const { area, w, h, d } = lot;
  const [hover, setHover] = useState(false);
  const body = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const trim = useMemo(() => new THREE.Color(area.color).lerp(new THREE.Color(pal.trim), 0.35).getStyle(), [area.color, pal.trim]);
  const done = stats.bursa + stats.basaksehir;
  const pct = Math.round((done / (stats.n * 2)) * 100);
  const complete = done === stats.n * 2;

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

      {/* bina rozeti */}
      <Html position={[0, h + 2.4, 0]} center zIndexRange={[8, 0]} style={{ pointerEvents: "none" }}>
        <div
          className={`pointer-events-auto flex cursor-pointer select-none items-center gap-2 whitespace-nowrap rounded-full border py-1 pl-1 pr-3 text-[12px] font-extrabold shadow-lg backdrop-blur-md transition-transform ${
            selected ? "scale-110" : hover ? "scale-105" : ""
          } ${pal.dark ? "border-white/10 bg-[#1b1e27]/85 text-white" : "border-white/70 bg-white/85 text-[#1f2330]"}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            // sahneye ulaşırsa "boşluğa tıklandı" sayılıp seçim kalkar
            e.stopPropagation();
            onSelect(area.code);
          }}
        >
          <span className="grid h-7 w-7 place-items-center rounded-full text-[13px]" style={{ background: complete ? OK : area.color }}>
            {complete ? "✓" : area.emoji}
          </span>
          <span>{area.code}</span>
          <span className="opacity-60">%{pct}</span>
          {stats.fails > 0 && <span className="rounded-full px-1.5 text-[10px] text-white" style={{ background: FAIL }}>{stats.fails}✗</span>}
          {stats.overdue && !complete && <span className="text-[11px]" title="Termin geçti">⏰</span>}
        </div>
      </Html>
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
