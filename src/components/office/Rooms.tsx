"use client";

import { useMemo } from "react";
import type { ArchiveProgress, ArchiveSource, GoogleSnapshot } from "@/lib/google-types";
import { Blink, Bob, Box, Chair, Desk, Plant, Stack, type OfficePal } from "./Furniture";
import { ROOM_D, ROOM_W, type Zone, type ZoneStat } from "./layout";

/*
 * Odaların içeriği. Her oda kendi verisini kendi iş mantığıyla gösterir:
 *  Planlama: duvar panosunda 7 günlük yapışkan notlar, masada bugünün kartları
 *  Posta odası: masalarda okunmamış zarf yığını (önemliler kırmızı), duvarda posta gözleri
 *  İletişim: her aktif sohbet bir masa; üstünde konuşma balonu (yeni mesaj varsa parlar)
 *  Toplantı salonu: duvar ekranı (toplantı sürüyorsa kırmızı yanıp söner), transkript kâğıtları
 *  Dosya arşivi: rafta son dosyalar türüne göre renkli klasörler, masada bugün değişenler
 *  Hafıza: her kaynak için bir sunucu dolabı; LED'ler indirme durumunu gösterir
 * Koltuklar boş: ileride agent'lar bu masalara atanacak.
 */

const BACK = -ROOM_D / 2 + 0.7; // odanın arka (kuzey) tarafı, yerel z
const HW = ROOM_W / 2;

const FILE_COLOR = (mime: string) =>
  /folder$/.test(mime)
    ? "#ffb44d"
    : /document|wordprocessing|msword/.test(mime)
      ? "#4f7bff"
      : /spreadsheet|ms-excel|csv/.test(mime)
        ? "#2fbf71"
        : /presentation|powerpoint/.test(mime)
          ? "#ff9f43"
          : /pdf$/.test(mime)
            ? "#ff5e6c"
            : "#9aa3b5";

interface RoomProps {
  zone: Zone;
  pal: OfficePal;
  snap: GoogleSnapshot;
  stat: ZoneStat;
}

// ------------------------------------------------------------------ Planlama (Takvim)
function CalendarRoom({ zone, pal, snap }: RoomProps) {
  const days = useMemo(() => {
    const key = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
    const base = Date.now();
    return Array.from({ length: 7 }, (_, i) => {
      const k = key(new Date(base + i * 86400_000));
      return snap.calendar.items.filter((e) => e.response !== "declined" && (e.allDay ? e.start : key(new Date(e.start))) === k).length;
    });
  }, [snap]);
  const today = days[0];
  return (
    <group>
      {/* duvar panosu: 7 sütun, her etkinlik bir yapışkan not */}
      <Box p={[0, 1.9, BACK - 0.55]} s={[8.6, 2.6, 0.08]} c={pal.dark ? "#e8eaf0" : "#ffffff"} />
      <Box p={[0, 1.9, BACK - 0.6]} s={[8.9, 2.9, 0.04]} c={pal.frame} />
      {days.map((n, d) => {
        const x = -3.66 + d * 1.22;
        return (
          <group key={d}>
            <Box p={[x, 3.0, BACK - 0.49]} s={[1.0, 0.22, 0.02]} c={d === 0 ? zone.color : pal.wall} e={d === 0 ? zone.color : undefined} ei={0.3} cast={false} />
            {Array.from({ length: Math.min(n, 5) }, (_, k) => (
              <Box key={k} p={[x, 2.55 - k * 0.42, BACK - 0.48]} s={[0.78, 0.34, 0.03]} c={d === 0 ? "#ffd54a" : ["#9cc3ff", "#b6f0c2", "#ffc9de"][(d + k) % 3]} cast={false} />
            ))}
          </group>
        );
      })}
      {/* duvar saati */}
      <mesh position={[5.6, 2.4, BACK - 0.5]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.45, 0.45, 0.06, 24]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <Box p={[5.6, 2.52, BACK - 0.46]} s={[0.04, 0.26, 0.02]} c="#2a2f3a" cast={false} />
      <Box p={[5.7, 2.4, BACK - 0.46]} s={[0.2, 0.04, 0.02]} c="#2a2f3a" cast={false} />
      {/* masalar panoya bakar */}
      <Desk x={-2.6} z={0.4} pal={pal} screen={today ? zone.color : undefined} />
      <Chair x={-2.6} z={1.25} pal={pal} />
      <Desk x={2.6} z={0.4} pal={pal} screen={today ? "#9cc3ff" : undefined} />
      <Chair x={2.6} z={1.25} pal={pal} />
      <Stack x={-3.2} z={0.45} n={Math.min(today, 8)} pal={pal} colors={Array.from({ length: 8 }, (_, i) => (i % 2 ? "#ffd54a" : "#ffe58f"))} size={[0.4, 0.4]} step={0.06} />
      <Plant x={-HW + 0.8} z={BACK} pal={pal} />
      <Plant x={HW - 0.8} z={ROOM_D / 2 - 0.9} pal={pal} h={0.8} />
    </group>
  );
}

// ------------------------------------------------------------------ Posta odası (Gmail)
function GmailRoom({ zone, pal, snap }: RoomProps) {
  const unread = snap.gmail.items.filter((m) => m.unread);
  const total = snap.gmail.unread ?? unread.length;
  const important = unread.filter((m) => m.important).length;
  // okunmamışlar üç masaya dağıtılır; önemliler yığının üstünde kırmızı
  const piles = [0, 1, 2].map((i) => Math.min(12, Math.floor(total / 3) + (i < total % 3 ? 1 : 0)));
  const env = (n: number, first: boolean) => Array.from({ length: n }, (_, k) => (first && k >= n - important ? "#ff8a95" : k % 3 === 0 ? "#fff3d6" : "#ffffff"));
  const slots = Math.min(snap.gmail.items.length, 18);
  return (
    <group>
      {/* posta gözleri (duvar dolabı) */}
      <Box p={[0, 1.55, BACK - 0.35]} s={[6.2, 2.4, 0.5]} c={pal.woodDark} />
      {Array.from({ length: 18 }, (_, i) => {
        const col = i % 6;
        const row = Math.floor(i / 6);
        const x = -2.5 + col * 1.0;
        const y = 2.35 - row * 0.72;
        return (
          <group key={i}>
            <Box p={[x, y, BACK - 0.08]} s={[0.86, 0.58, 0.05]} c={pal.wood} cast={false} />
            {i < slots && <Box p={[x, y - 0.12, BACK - 0.02]} s={[0.6, 0.3, 0.04]} c={i < important ? "#ff8a95" : "#ffffff"} cast={false} />}
          </group>
        );
      })}
      {[-4.6, 0, 4.6].map((x, i) => (
        <group key={x}>
          <Desk x={x} z={1.1} pal={pal} screen={total ? (i === 0 && important ? zone.color : "#ffd2d6") : undefined} glow={0.45} />
          <Chair x={x} z={1.95} pal={pal} />
          {/* gelen kutusu tepsisi + zarflar */}
          <Box p={[x - 0.62, 0.8, 1.1]} s={[0.56, 0.04, 0.44]} c={pal.metal} cast={false} />
          <Stack x={x - 0.62} y={0.82} z={1.1} n={piles[i]} pal={pal} colors={env(piles[i], i === 0)} size={[0.46, 0.32]} step={0.06} />
        </group>
      ))}
      {/* posta arabası */}
      <Box p={[HW - 1.4, 0.55, ROOM_D / 2 - 1.6]} s={[1.2, 0.7, 0.8]} c={zone.color} />
      <Stack x={HW - 1.4} y={0.9} z={ROOM_D / 2 - 1.6} n={Math.min(Math.max(0, total - 36), 8)} pal={pal} size={[0.5, 0.34]} />
      <Plant x={-HW + 0.8} z={ROOM_D / 2 - 0.9} pal={pal} h={0.9} />
    </group>
  );
}

// ------------------------------------------------------------------ İletişim (Chat)
function ChatRoom({ zone, pal, snap }: RoomProps) {
  const now = Date.now();
  const spaces = snap.chat.items.slice(0, 6);
  const pos: [number, number][] = [
    [-5, -1.6],
    [0, -1.6],
    [5, -1.6],
    [-5, 2.6],
    [0, 2.6],
    [5, 2.6],
  ];
  return (
    <group>
      {/* ekip panosu */}
      <Box p={[0, 1.7, BACK - 0.5]} s={[5, 1.6, 0.08]} c={pal.screenOff} />
      <Box p={[0, 1.7, BACK - 0.45]} s={[4.7, 1.35, 0.02]} c={zone.color} e={zone.color} ei={0.35} cast={false} />
      {pos.map(([x, z], i) => {
        const sp = spaces[i];
        const last = sp?.messages.at(-1);
        const fresh = !!sp?.messages.some((m) => !m.mine && now - Date.parse(m.time) < 3600_000);
        const active = !!sp?.lastActive && now - Date.parse(sp.lastActive) < 86400_000;
        const theirs = !!last && !last.mine;
        return (
          <group key={i}>
            <Desk x={x} z={z} pal={pal} screen={active ? (fresh ? zone.color : "#bfeee9") : undefined} glow={fresh ? 0.8 : 0.4} />
            <Chair x={x} z={z + 0.85} pal={pal} />
            {active && (
              <group position={[x + 0.3, 2.2, z - 0.2]}>
                <Bob phase={i * 1.3} amp={fresh ? 0.16 : 0.07} speed={fresh ? 2.4 : 1.2}>
                  <Box p={[0, 0, 0]} s={[1.0, 0.6, 0.12]} c={fresh ? zone.color : "#ffffff"} e={fresh ? zone.color : undefined} ei={0.5} cast={false} />
                  <Box p={[-0.28, -0.36, 0]} s={[0.18, 0.18, 0.1]} r={0.6} c={fresh ? zone.color : "#ffffff"} cast={false} />
                  {/* üç nokta: son söz karşı taraftaysa yanıt bekliyor */}
                  {[-0.22, 0, 0.22].map((dx) => (
                    <Box key={dx} p={[dx, 0, 0.07]} s={[0.1, 0.1, 0.02]} c={theirs ? (fresh ? "#ffffff" : "#ffa53d") : "#9aa3b5"} cast={false} />
                  ))}
                </Bob>
              </group>
            )}
          </group>
        );
      })}
      <Plant x={HW - 0.8} z={BACK} pal={pal} />
      <Plant x={-HW + 0.8} z={ROOM_D / 2 - 0.9} pal={pal} h={0.8} />
    </group>
  );
}

// ------------------------------------------------------------------ Toplantı salonu (Meet)
function MeetRoom({ zone, pal, snap }: RoomProps) {
  const now = Date.now();
  const live = snap.calendar.items.find((e) => e.meet && !e.allDay && Date.parse(e.start) <= now && Date.parse(e.end) > now);
  const soon = snap.calendar.items.find((e) => e.meet && !e.allDay && Date.parse(e.start) > now && Date.parse(e.start) - now < 3600_000);
  const transcripts = Math.min(snap.meet.items.filter((m) => m.transcripts.length).length, 10);
  return (
    <group>
      {/* batı duvarında ekran */}
      <Box p={[-HW + 0.25, 1.8, 0]} s={[0.12, 2.1, 3.6]} c={pal.screenOff} />
      {live ? (
        <Blink p={[-HW + 0.33, 1.8, 0]} s={[0.02, 1.85, 3.35]} color="#ff4d5e" speed={3} />
      ) : (
        <Box p={[-HW + 0.33, 1.8, 0]} s={[0.02, 1.85, 3.35]} c={soon ? zone.color : "#1d2230"} e={soon ? zone.color : undefined} ei={0.6} cast={false} />
      )}
      {/* uzun toplantı masası + 8 koltuk */}
      <Box p={[0.6, 0.74, 0]} s={[6.4, 0.1, 2.4]} c={pal.wood} />
      <Box p={[-1.8, 0.36, 0]} s={[0.25, 0.72, 1.6]} c={pal.woodDark} />
      <Box p={[3.0, 0.36, 0]} s={[0.25, 0.72, 1.6]} c={pal.woodDark} />
      {[-1.8, -0.2, 1.4, 3.0].map((x) => (
        <group key={x}>
          <Chair x={x} z={-1.75} r={Math.PI} pal={pal} color={live ? zone.color : undefined} />
          <Chair x={x} z={1.75} pal={pal} color={live ? zone.color : undefined} />
        </group>
      ))}
      {/* konferans hoparlörü */}
      <mesh position={[0.6, 0.84, 0]}>
        <cylinderGeometry args={[0.3, 0.34, 0.08, 16]} />
        <meshStandardMaterial color="#2a2f3a" />
      </mesh>
      {live && <Blink p={[0.6, 0.9, 0]} s={[0.16, 0.03, 0.16]} color="#ff4d5e" speed={4} />}
      {/* transkriptler yan sehpada */}
      <Box p={[HW - 1.4, 0.45, BACK + 0.2]} s={[1.4, 0.9, 0.8]} c={pal.woodDark} />
      <Stack x={HW - 1.4} y={0.9} z={BACK + 0.2} n={transcripts} pal={pal} size={[0.5, 0.36]} step={0.06} />
      <Plant x={HW - 0.8} z={ROOM_D / 2 - 0.9} pal={pal} />
    </group>
  );
}

// ------------------------------------------------------------------ Dosya arşivi (Drive)
function DriveRoom({ zone, pal, snap }: RoomProps) {
  const files = snap.drive?.items ?? [];
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
  const changed = files.filter((f) => new Date(f.modified).toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }) === today);
  return (
    <group>
      {/* dosya dolapları */}
      {[-5.7, -4.55, -3.4, -2.25].map((x) => (
        <group key={x}>
          <Box p={[x, 0.7, BACK - 0.1]} s={[1.1, 1.4, 0.8]} c={pal.dark ? "#566079" : "#d7dce5"} />
          {[0.35, 0.75, 1.15].map((y) => (
            <Box key={y} p={[x, y, BACK + 0.31]} s={[0.4, 0.05, 0.02]} c={pal.metal} cast={false} />
          ))}
        </group>
      ))}
      {/* raf: son dosyalar türüne göre renkli klasörler */}
      <Box p={[3.4, 1.3, BACK - 0.1]} s={[5.4, 2.6, 0.7]} c={pal.woodDark} />
      {[0.55, 1.35, 2.15].map((y, row) => (
        <group key={y}>
          <Box p={[3.4, y - 0.27, BACK + 0.1]} s={[5.2, 0.06, 0.6]} c={pal.wood} cast={false} />
          {files.slice(row * 10, row * 10 + 10).map((f, i) => (
            <Box key={f.id} p={[1.15 + i * 0.48, y + 0.05, BACK + 0.12]} s={[0.34, 0.6, 0.5]} c={FILE_COLOR(f.mime)} cast={false} />
          ))}
        </group>
      ))}
      <Desk x={-2.6} z={1.6} pal={pal} screen={changed.length ? zone.color : undefined} />
      <Chair x={-2.6} z={2.45} pal={pal} />
      <Desk x={2.6} z={1.6} pal={pal} screen={files.length ? "#ffe0b0" : undefined} glow={0.35} />
      <Chair x={2.6} z={2.45} pal={pal} />
      {/* bugün değişen dosyalar masada klasör yığını */}
      <Stack x={-3.2} z={1.65} n={Math.min(changed.length, 10)} pal={pal} colors={changed.map((f) => FILE_COLOR(f.mime))} size={[0.46, 0.34]} step={0.05} />
      <Plant x={HW - 0.8} z={ROOM_D / 2 - 0.9} pal={pal} h={1.1} />
    </group>
  );
}

// ------------------------------------------------------------------ Hafıza (Arşiv)
const RACKS: { src: ArchiveSource; label: string }[] = [
  { src: "gmail", label: "Gmail" },
  { src: "chat", label: "Chat" },
  { src: "meet", label: "Meet" },
  { src: "calendar", label: "Takvim" },
  { src: "drive", label: "Drive" },
];
function ArchiveRoom({ pal, archive, archiving }: RoomProps & { archive: ArchiveProgress | null; archiving: boolean }) {
  return (
    <group>
      {RACKS.map((r, i) => {
        const x = -5.2 + i * 2.6;
        const count = archive?.stats.bySource[r.src]?.count ?? 0;
        const leds = Math.max(1, Math.min(12, Math.ceil(Math.log10(count + 1) * 3)));
        const needs = archive?.needsScope?.includes(r.src);
        const done = archive?.done[r.src];
        const color = needs ? "#ffa53d" : done ? "#34c26b" : "#2f80ff";
        return (
          <group key={r.src}>
            <Box p={[x, 1.25, -1.6]} s={[1.3, 2.5, 1.1]} c={pal.dark ? "#1d2230" : "#2b3140"} />
            <Box p={[x, 1.25, -1.03]} s={[1.14, 2.3, 0.02]} c={pal.dark ? "#272d3d" : "#363d50"} cast={false} />
            {Array.from({ length: leds }, (_, k) => (
              <Blink key={k} p={[x - 0.36 + (k % 2) * 0.12, 0.35 + Math.floor(k / 2) * 0.32, -1.01]} s={[0.07, 0.07, 0.02]} color={color} speed={done ? 1 : archiving ? 7 : 3} phase={k * 0.9 + i} on={!needs} />
            ))}
            {Array.from({ length: 6 }, (_, k) => (
              <Box key={k} p={[x + 0.18, 0.4 + k * 0.32, -1.01]} s={[0.55, 0.05, 0.02]} c="#4b5366" cast={false} />
            ))}
          </group>
        );
      })}
      {/* yönetim masası */}
      <Desk x={0} z={3} pal={pal} screen="#34c26b" glow={archiving ? 0.9 : 0.4} />
      <Chair x={0} z={3.85} pal={pal} />
      {/* kablo kanalı */}
      <Box p={[0, 2.62, -1.6]} s={[13, 0.12, 0.3]} c={pal.metal} cast={false} />
      <Plant x={-HW + 0.8} z={ROOM_D / 2 - 0.9} pal={pal} />
    </group>
  );
}

export function Room(props: RoomProps & { archive: ArchiveProgress | null; archiving: boolean }) {
  const { zone } = props;
  return (
    <group position={[zone.x, 0, zone.z]}>
      {zone.id === "calendar" && <CalendarRoom {...props} />}
      {zone.id === "gmail" && <GmailRoom {...props} />}
      {zone.id === "chat" && <ChatRoom {...props} />}
      {zone.id === "meet" && <MeetRoom {...props} />}
      {zone.id === "drive" && <DriveRoom {...props} />}
      {zone.id === "archive" && <ArchiveRoom {...props} />}
    </group>
  );
}
