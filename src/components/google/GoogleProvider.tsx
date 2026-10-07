"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { GoogleStatus } from "@/lib/google-types";

interface Ctx {
  status: GoogleStatus | null;
  syncing: boolean;
  error: string | null;
  sync: (force?: boolean) => Promise<void>;
  disconnect: () => Promise<void>;
  reload: () => Promise<void>;
}
const GoogleCtx = createContext<Ctx | null>(null);
export const useGoogle = () => useContext(GoogleCtx)!;

/** Uygulama açıkken bu sıklıkla Google'dan yeniden çekilir. */
const STALE_MS = 5 * 60 * 1000;

export function GoogleProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef(status);
  useEffect(() => {
    ref.current = status;
  }, [status]);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/google", { cache: "no-store" });
      if (r.ok) setStatus(await r.json());
    } catch {}
  }, []);

  const sync = useCallback(async (force = false) => {
    if (busy.current || !ref.current?.connected) return;
    busy.current = true;
    setSyncing(true);
    try {
      const r = await fetch(`/api/google/sync${force ? "?force=1" : ""}`, { method: "POST", cache: "no-store" });
      const j = await r.json().catch(() => ({ error: `Sunucu hatası ${r.status}` }));
      if (!r.ok) {
        setError(j.error ?? "Senkron başarısız");
        if (/yeniden bağla/i.test(j.error ?? "")) setStatus((s) => (s ? { ...s, needsReauth: true } : s));
      } else {
        setError(null);
        setStatus((s) => (s ? { ...s, snapshot: j, needsReauth: false } : s));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await fetch("/api/google", { method: "DELETE" }).catch(() => {});
    await reload();
  }, [reload]);

  // ilk yükleme + eskiyse senkron
  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const check = () => {
      const s = ref.current;
      if (!s?.connected || s.needsReauth || document.visibilityState !== "visible") return;
      const at = s.snapshot?.syncedAt ? Date.parse(s.snapshot.syncedAt) : 0;
      if (Date.now() - at > STALE_MS) sync();
    };
    check();
    const t = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [status?.connected, sync]);

  return <GoogleCtx.Provider value={{ status, syncing, error, sync, disconnect, reload }}>{children}</GoogleCtx.Provider>;
}
