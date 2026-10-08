import type { ArchiveProgress, GoogleSnapshot } from "@/lib/google-types";

/**
 * Sanal ofis yerleşimi: kuzey ve güney sırada üçer oda, ortada koridor ve agent merkezi.
 * Kamera güneydoğudan baktığı için kuzey (−z) ve batı (−x) duvarları yüksek, diğerleri alçak (maket kesiti gibi).
 */
export type ZoneId = "calendar" | "gmail" | "chat" | "meet" | "drive" | "archive";

export interface Zone {
  id: ZoneId;
  title: string;
  /** odanın işi */
  role: string;
  emoji: string;
  color: string;
  x: number;
  z: number;
  /** kuzey sırası mı (arka duvar kuzeyde) */
  north: boolean;
}

export const ROOM_W = 14;
export const ROOM_D = 10;
export const CORRIDOR = 6;
const ROW_Z = CORRIDOR / 2 + ROOM_D / 2; // 8
const COL_X = ROOM_W + 2; // 16

export const ZONES: Zone[] = [
  { id: "calendar", title: "Planlama", role: "Takvim", emoji: "📅", color: "#5b7cff", x: -COL_X, z: -ROW_Z, north: true },
  { id: "gmail", title: "Posta odası", role: "Gmail", emoji: "✉️", color: "#ff5e6c", x: 0, z: -ROW_Z, north: true },
  { id: "chat", title: "İletişim", role: "Google Chat", emoji: "💬", color: "#2ec4b6", x: COL_X, z: -ROW_Z, north: true },
  { id: "meet", title: "Toplantı salonu", role: "Meet", emoji: "🎥", color: "#8b5cf6", x: -COL_X, z: ROW_Z, north: false },
  { id: "drive", title: "Dosya arşivi", role: "Drive", emoji: "📁", color: "#ffa53d", x: 0, z: ROW_Z, north: false },
  { id: "archive", title: "Hafıza", role: "Arşiv", emoji: "🗄️", color: "#34c26b", x: COL_X, z: ROW_Z, north: false },
];
export const zoneById = (id: string | null | undefined) => ZONES.find((z) => z.id === id);

/** dış sınırlar */
export const HALF_X = COL_X + ROOM_W / 2 + 0.5; // 23.5
export const HALF_Z = ROW_Z + ROOM_D / 2 + 0.5; // 13.5

// ------------------------------------------------------------------ her odanın kendi iş mantığı
export type ZoneStatus = "busy" | "waiting" | "idle" | "error";
export interface ZoneStat {
  status: ZoneStatus;
  /** rozetteki kısa durum */
  headline: string;
  sub?: string;
  /** bekleyen iş adedi (rozet sayısı) */
  count: number;
}

export const STATUS_LABEL: Record<ZoneStatus, string> = { busy: "ÇALIŞIYOR", waiting: "İŞ BEKLİYOR", idle: "SAKİN", error: "SORUN VAR" };
export const STATUS_COLOR: Record<ZoneStatus, string> = { busy: "#2f80ff", waiting: "#ffa53d", idle: "#34c26b", error: "#ff5e6c" };

const dayKey = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
const hm = (s: string) => new Date(s).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

export function zoneStats(snap: GoogleSnapshot, archive: ArchiveProgress | null, archiving: boolean, now = Date.now()): Record<ZoneId, ZoneStat> {
  const today = dayKey(new Date(now));
  const events = snap.calendar.items.filter((e) => e.response !== "declined");
  const todays = events.filter((e) => (e.allDay ? e.start : dayKey(new Date(e.start))) === today);
  const live = events.find((e) => !e.allDay && Date.parse(e.start) <= now && Date.parse(e.end) > now);
  const next = events.filter((e) => !e.allDay && Date.parse(e.start) > now).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  const pendingRsvp = events.filter((e) => e.response === "needsAction" && Date.parse(e.end) > now).length;
  const soon = next && Date.parse(next.start) - now < 3600_000;

  const unread = snap.gmail.unread ?? snap.gmail.items.filter((m) => m.unread).length;
  const important = snap.gmail.items.filter((m) => m.unread && m.important).length;

  const active = snap.chat.items.filter((s) => s.lastActive && now - Date.parse(s.lastActive) < 86400_000);
  const fresh = snap.chat.items.filter((s) => s.messages.some((m) => !m.mine && now - Date.parse(m.time) < 3600_000));
  const waitingReply = snap.chat.items.filter((s) => s.messages.at(-1) && !s.messages.at(-1)!.mine && now - Date.parse(s.messages.at(-1)!.time) < 86400_000).length;

  const liveMeet = live?.meet ? live : undefined;
  const transcripts = snap.meet.items.filter((m) => m.transcripts.length).length;

  const files = snap.drive?.items ?? [];
  const changedToday = files.filter((f) => dayKey(new Date(f.modified)) === today);
  const changedHour = files.some((f) => now - Date.parse(f.modified) < 3600_000);

  const total = archive?.stats.total ?? 0;
  const pendingSrc = archive ? (Object.keys(archive.done) as (keyof typeof archive.done)[]).filter((k) => !archive.done[k] && !archive.needsScope?.includes(k)) : [];

  const err = (e?: string): ZoneStat | null => (e ? { status: "error", headline: "Senkron hatası", sub: e.slice(0, 90), count: 0 } : null);

  return {
    calendar: err(snap.calendar.error) ?? {
      status: live ? "busy" : soon || pendingRsvp ? "waiting" : "idle",
      headline: live ? `Şimdi: ${live.title}` : `Bugün ${todays.length} etkinlik`,
      sub: next ? `Sıradaki ${hm(next.start)} · ${next.title}` : pendingRsvp ? `${pendingRsvp} davet yanıt bekliyor` : "Yaklaşan toplantı yok",
      count: todays.length,
    },
    gmail: err(snap.gmail.error) ?? {
      status: important ? "busy" : unread ? "waiting" : "idle",
      headline: unread ? `${unread} okunmamış` : "Gelen kutusu temiz",
      sub: important ? `${important} önemli e-posta` : snap.gmail.items[0] ? `Son: ${snap.gmail.items[0].from}` : undefined,
      count: unread,
    },
    chat: err(snap.chat.error) ?? {
      status: fresh.length ? "busy" : waitingReply ? "waiting" : "idle",
      headline: `${active.length} aktif sohbet`,
      sub: waitingReply ? `${waitingReply} sohbette son söz karşı tarafta` : "Yanıt bekleyen yok",
      count: waitingReply,
    },
    meet: err(snap.meet.error) ?? {
      status: liveMeet ? "busy" : soon && next?.meet ? "waiting" : "idle",
      headline: liveMeet ? "Toplantı sürüyor" : `${snap.meet.items.length} toplantı kaydı`,
      sub: liveMeet ? liveMeet.title : `${transcripts} transkript`,
      count: transcripts,
    },
    drive: (snap.drive?.error && !snap.drive.error.startsWith("Drive izni yok") ? err(snap.drive.error) : null) ?? {
      status: !snap.drive || snap.drive.error ? "idle" : changedHour ? "busy" : changedToday.length ? "waiting" : "idle",
      headline: !snap.drive || snap.drive.error ? "Drive izni bekleniyor" : `Bugün ${changedToday.length} dosya değişti`,
      sub: files[0] ? `Son: ${files[0].name}` : undefined,
      count: changedToday.length,
    },
    archive: archive?.lastError
      ? { status: "error", headline: `${total.toLocaleString("tr-TR")} kayıt`, sub: archive.lastError.slice(0, 90), count: pendingSrc.length }
      : {
          status: archiving || pendingSrc.length ? "busy" : "idle",
          headline: `${total.toLocaleString("tr-TR")} kayıt hafızada`,
          sub: pendingSrc.length ? `İndiriliyor: ${pendingSrc.length} kaynak` : "Tüm geçmiş indirildi",
          count: pendingSrc.length,
        },
  };
}
