"use client";

import type { Choice, Lesson } from "./brain-types";

/** Seçimi sunucuya bildirir (öğrenme için). Sebep verilirse sunucu hemen öğrenir ve öğrendiklerini döndürür. */
export async function noteChoice(...choices: Omit<Choice, "id" | "at">[]): Promise<Lesson[]> {
  try {
    const r = await fetch("/api/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "record", choices }), keepalive: true });
    const j = await r.json().catch(() => ({}));
    return (j.learned as Lesson[]) ?? [];
  } catch {
    return [];
  }
}

export const lessonToast = (l: Lesson[]) => (l.length ? `🎓 Belleğe yazdım: ${l[0].entry}${l.length > 1 ? ` (+${l.length - 1})` : ""}` : null);
