"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ArchiveProgress, GoogleStatus } from "@/lib/google-types";

interface Ctx {
  status: GoogleStatus | null;
  syncing: boolean;
  error: string | null;
  sync: (force?: boolean) => Promise<void>;
  disconnect: () => Promise<void>;
  reload: () => Promise<void>;
  /** geriye dönük arşiv (hafıza) ilerlemesi */
  archive: ArchiveProgress | null;
  archiving: boolean;
  clearArchive: () => Promise<void>;
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
  const [archive, setArchive] = useState<ArchiveProgress | null>(null);
  const [archiving, setArchiving] = useState(false);
  const archBusy = useRef(false);
  const archTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Bir arşiv adımı çalıştırır; geçmiş bitmediyse ve sayfa görünürse kısa arayla devam eder. */
  const archiveStep = useCallback(async () => {
    if (archBusy.current || !ref.current?.connected || ref.current.needsReauth || document.visibilityState !== "visible") return;
    archBusy.current = true;
    setArchiving(true);
    let again = 0;
    try {
      const r = await fetch("/api/google/archive", { method: "POST", cache: "no-store" });
      const j = (await r.json().catch(() => null)) as ArchiveProgress | null;
      if (r.ok && j?.stats) {
        setArchive(j);
        // izni verilmemiş kaynak (ör. Drive) beklenmez
        const allDone = (Object.keys(j.done) as (keyof typeof j.done)[]).every((k) => j.done[k] || j.needsScope?.includes(k)) && Object.keys(j.done).length >= 5;
        again = allDone ? 0 : j.running ? 20000 : 1500;
      } else again = 60000;
    } catch {
      again = 60000;
    } finally {
      archBusy.current = false;
      setArchiving(false);
    }
    if (archTimer.current) clearTimeout(archTimer.current);
    if (again) archTimer.current = setTimeout(() => archiveStepRef.current(), again);
  }, []);
  const archiveStepRef = useRef(archiveStep);
  useEffect(() => {
    archiveStepRef.current = archiveStep;
  }, [archiveStep]);

  const clearArchive = useCallback(async () => {
    const r = await fetch("/api/google/archive", { method: "DELETE" }).catch(() => null);
    if (r?.ok) setArchive(await r.json());
    archiveStepRef.current();
  }, []);

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
        setTimeout(() => archiveStepRef.current(), 500);
        // yeni veri geldi: beyin son düşünmeden 30 dk geçtiyse arka planda düşünür (sunucu kısıtlar)
        fetch("/api/brain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "auto" }) }).catch(() => {});
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

  // bağlıysa arşiv ilerlemesini al ve geçmiş indirmeyi başlat
  useEffect(() => {
    if (!status?.connected) return;
    fetch("/api/google/archive", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.stats && setArchive(j))
      .catch(() => {});
    const t = setTimeout(() => archiveStepRef.current(), 3000);
    const vis = () => document.visibilityState === "visible" && archiveStepRef.current();
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", vis);
      if (archTimer.current) clearTimeout(archTimer.current);
    };
  }, [status?.connected]);

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

  return <GoogleCtx.Provider value={{ status, syncing, error, sync, disconnect, reload, archive, archiving, clearArchive }}>{children}</GoogleCtx.Provider>;
}
