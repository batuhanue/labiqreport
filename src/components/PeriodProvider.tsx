"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Hospital } from "@/lib/checklist";
import { defaultPeriod, newPeriod, normalizePeriod, periodLabel } from "@/lib/period";
import type { PeriodData, PeriodSummary } from "@/lib/types";

export type SaveState = "idle" | "saving" | "saved" | "error";
export type Focus = "both" | Hospital;

interface Ctx {
  booting: boolean;
  error: string | null;
  activePeriod: string | null;
  data: PeriodData | null;
  isHistory: boolean;
  summaries: PeriodSummary[];
  saveState: SaveState;
  focus: Focus;
  setFocus: (f: Focus) => void;
  /** Var olan dönemi açar; yoksa sıfırdan başlatıp aktif yapar. */
  openPeriod: (p: string) => Promise<void>;
  backToActive: () => Promise<void>;
  setActive: (p: string | null) => Promise<void>;
  update: (fn: (d: PeriodData) => PeriodData) => void;
  replaceData: (d: PeriodData) => Promise<void>;
  deletePeriod: (p: string) => Promise<void>;
  refreshSummaries: () => Promise<void>;
  exportExcel: (d?: PeriodData) => Promise<void>;
  toast: (msg: string) => void;
  toastMsg: string | null;
}

const PeriodCtx = createContext<Ctx | null>(null);
export const usePeriod = () => {
  const c = useContext(PeriodCtx);
  if (!c) throw new Error("PeriodProvider eksik");
  return c;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (res.status === 401) {
    if (window.location.pathname !== "/giris") window.location.href = "/giris";
    throw new Error("Giriş gerekli");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `Hata ${res.status}`), { status: res.status });
  return body as T;
}

const backupKey = (p: string) => `lq:period:${p}`;
const backup = (d: PeriodData) => {
  try {
    localStorage.setItem(backupKey(d.period), JSON.stringify(d));
  } catch {}
};
const readBackup = (p: string): PeriodData | null => {
  try {
    const s = localStorage.getItem(backupKey(p));
    return s ? normalizePeriod(JSON.parse(s)) : null;
  } catch {
    return null;
  }
};

export function PeriodProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePeriod, setActivePeriod] = useState<string | null>(null);
  const [data, setData] = useState<PeriodData | null>(null);
  const [summaries, setSummaries] = useState<PeriodSummary[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [focus, setFocusState] = useState<Focus>("both");
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const dataRef = useRef<PeriodData | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 2600);
  }, []);

  const refreshSummaries = useCallback(async () => {
    try {
      setSummaries(await api<PeriodSummary[]>("/api/periods"));
    } catch {}
  }, []);

  const flush = useCallback(async () => {
    const d = dataRef.current;
    if (!d || !pending.current) return;
    pending.current = false;
    setSaveState("saving");
    try {
      await api(`/api/periods/${d.period}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      });
      setSaveState("saved");
      refreshSummaries();
    } catch (e) {
      pending.current = true;
      setSaveState("error");
      setError(e instanceof Error ? e.message : String(e));
      // tekrar dene
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 5000);
    }
  }, [refreshSummaries]);

  const schedule = useCallback(() => {
    pending.current = true;
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  }, [flush]);

  const setLoaded = (d: PeriodData | null) => {
    dataRef.current = d;
    setData(d);
  };

  const loadPeriod = useCallback(async (p: string): Promise<PeriodData | null> => {
    try {
      return normalizePeriod(await api<PeriodData>(`/api/periods/${p}`));
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      const b = readBackup(p);
      if (b) return b;
      throw e;
    }
  }, []);

  const setActive = useCallback(async (p: string | null) => {
    setActivePeriod(p);
    await api("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activePeriod: p }),
    });
  }, []);

  const openPeriod = useCallback(
    async (p: string) => {
      await flush();
      setError(null);
      const existing = await loadPeriod(p);
      if (existing) {
        setLoaded(existing);
        sessionStorage.setItem("lq:viewing", p);
        return;
      }
      // yeni dönem: sıfırdan başlar ve aktif dönem olur
      const fresh = newPeriod(p);
      setLoaded(fresh);
      backup(fresh);
      pending.current = true;
      await flush();
      await setActive(p);
      sessionStorage.setItem("lq:viewing", p);
      toast(`${periodLabel(p)} dönemi başlatıldı`);
    },
    [flush, loadPeriod, setActive, toast],
  );

  const backToActive = useCallback(async () => {
    if (activePeriod) await openPeriod(activePeriod);
  }, [activePeriod, openPeriod]);

  // açılış: aktif dönem varsa kaldığı yerden devam
  useEffect(() => {
    (async () => {
      try {
        try {
          const f = localStorage.getItem("lq:focus") as Focus | null;
          if (f === "both" || f === "bursa" || f === "basaksehir") setFocusState(f);
        } catch {}
        const [st] = await Promise.all([api<{ activePeriod: string | null }>("/api/state"), refreshSummaries()]);
        setActivePeriod(st.activePeriod);
        const viewing = sessionStorage.getItem("lq:viewing");
        const target = viewing || st.activePeriod;
        if (target) {
          const d = await loadPeriod(target);
          if (d) setLoaded(d);
          else if (st.activePeriod && target !== st.activePeriod) setLoaded(await loadPeriod(st.activePeriod));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBooting(false);
      }
    })();
  }, [loadPeriod, refreshSummaries]);

  // sayfadan çıkarken bekleyen kaydı gönder
  useEffect(() => {
    const onHide = () => {
      const d = dataRef.current;
      if (d && pending.current) {
        pending.current = false;
        fetch(`/api/periods/${d.period}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(d),
          keepalive: true,
        });
      }
    };
    const vis = () => document.visibilityState === "hidden" && onHide();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  const update = useCallback(
    (fn: (d: PeriodData) => PeriodData) => {
      const cur = dataRef.current;
      if (!cur) return;
      const next = { ...fn(cur), updatedAt: new Date().toISOString() };
      setLoaded(next);
      backup(next);
      schedule();
    },
    [schedule],
  );

  const replaceData = useCallback(
    async (d: PeriodData) => {
      setLoaded(d);
      backup(d);
      pending.current = true;
      await flush();
      sessionStorage.setItem("lq:viewing", d.period);
    },
    [flush],
  );

  const deletePeriod = useCallback(
    async (p: string) => {
      await api(`/api/periods/${p}`, { method: "DELETE" });
      try {
        localStorage.removeItem(backupKey(p));
      } catch {}
      if (activePeriod === p) setActivePeriod(null);
      if (dataRef.current?.period === p) {
        setLoaded(null);
        sessionStorage.removeItem("lq:viewing");
      }
      await refreshSummaries();
    },
    [activePeriod, refreshSummaries],
  );

  const exportExcel = useCallback(
    async (d?: PeriodData) => {
      const src = d ?? dataRef.current;
      if (!src) return;
      toast("Excel hazırlanıyor…");
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(src),
      });
      if (!res.ok) {
        toast("Excel oluşturulamadı");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `LabIQ_Diacore_Raporlama_${src.period}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast("Excel indirildi");
    },
    [toast],
  );

  const setFocus = useCallback((f: Focus) => {
    setFocusState(f);
    try {
      localStorage.setItem("lq:focus", f);
    } catch {}
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      booting,
      error,
      activePeriod,
      data,
      isHistory: !!data && data.period !== activePeriod,
      summaries,
      saveState,
      focus,
      setFocus,
      openPeriod,
      backToActive,
      setActive,
      update,
      replaceData,
      deletePeriod,
      refreshSummaries,
      exportExcel,
      toast,
      toastMsg,
    }),
    [booting, error, activePeriod, data, summaries, saveState, focus, setFocus, openPeriod, backToActive, setActive, update, replaceData, deletePeriod, refreshSummaries, exportExcel, toast, toastMsg],
  );

  return <PeriodCtx.Provider value={value}>{children}</PeriodCtx.Provider>;
}

export { defaultPeriod };
