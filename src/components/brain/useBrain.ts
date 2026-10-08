"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePeriod } from "@/components/PeriodProvider";
import { agentById, TRUST_META, type AgentId, type BrainItem, type BrainRun, type BrainState, type Lesson, type TrustLevel } from "@/lib/brain-types";
import { lessonToast } from "@/lib/learn-client";

/** Beyin durumu ve eylemleri (liste ve ofis görünümü ortak kullanır). */
export function useBrainState() {
  const { toast } = usePeriod();
  const [st, setSt] = useState<BrainState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [open, setOpen] = useState<BrainItem | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/brain", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setSt(j);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
    // açılışta (son düşünmeden 30 dk geçtiyse) arka planda düşünmeyi tetikle
    fetch("/api/brain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "auto" }) })
      .then((r) => r.json())
      .then((j) => j.started && setSt((s) => (s ? { ...s, running: true } : s)))
      .catch(() => {});
  }, [load]);
  // düşünürken durumu izle
  useEffect(() => {
    if (!st?.running || thinking) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [st?.running, thinking, load]);

  const think = async () => {
    setThinking(true);
    try {
      const r = await fetch("/api/brain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "think" }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setSt(j.state);
      const run = j.run as BrainRun;
      const created = run.agents.reduce((s, a) => s + a.created, 0);
      const auto = run.autoIds?.length ?? 0;
      toast(run.error ? `Düşünme hatası: ${run.error}` : created ? `${created} yeni iş${auto ? ` · ${auto} tanesini ajanlar kendisi onayladı` : " önerildi"}` : "Yeni bir iş çıkmadı");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setThinking(false);
    }
  };

  /** reason: Batuhan'ın sebebi (ret/onay) — verilirse beyin hemen öğrenir ve ne öğrendiğini söyler */
  const patch = async (id: string, p: Partial<BrainItem>, reason?: string) => {
    setSt((s) => (s ? { ...s, items: s.items.map((x) => (x.id === id ? { ...x, ...p } : x)) } : s));
    setOpen((o) => (o && o.id === id ? { ...o, ...p } : o));
    if (reason) toast("Not aldım, öğreniyorum…");
    const r = await fetch("/api/brain", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, patch: p, reason }) });
    if (!r.ok) {
      toast("Kaydedilemedi");
      load();
      return;
    }
    const j = await r.json().catch(() => ({}));
    const msg = lessonToast((j.learned as Lesson[]) ?? []);
    if (j.trustNote) toast(`⬇ ${j.trustNote}`);
    else if (msg) toast(msg);
    if (msg || j.trustNote) load();
  };

  /** ajan işi yapar (teslimat); feedback ile düzeltir */
  const runWork = useCallback(
    async (id: string, feedback?: string, team?: boolean, queued?: boolean) => {
      const mark = (x: BrainItem): BrainItem => ({ ...x, status: x.status === "inbox" || x.status === "todo" ? "doing" : x.status, work: { status: "running", output: x.work?.output ?? "", used: [], revisions: x.work?.revisions ?? [], at: new Date().toISOString() } });
      setSt((s) => (s ? { ...s, items: s.items.map((x) => (x.id === id ? mark(x) : x)) } : s));
      setOpen((o) => (o && o.id === id ? mark(o) : o));
      try {
        const r = await fetch("/api/brain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "work", id, feedback, team, queued }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        const item = j.item as BrainItem;
        setSt((s) => (s ? { ...s, items: s.items.map((x) => (x.id === id ? item : x)) } : s));
        setOpen((o) => (o && o.id === id ? item : o));
        const last = item.work?.revisions.at(-1);
        if (queued) return; // sıradaki işler sessizce biter; panoda görünür
        toast(item.work?.status === "error" ? `Ajan hata verdi: ${item.work.error}` : feedback && last?.rule ? `Kalıcı kural öğrenildi: ${last.rule}` : item.work?.status === "waiting_ok" ? "Taslak hazır — onayını bekliyor" : "Teslimat hazır");
      } catch (e) {
        toast((e as Error).message);
        load();
      }
    },
    [toast, load],
  );
  /** mail: gidecek e-postayı Gmail taslaklarına yazar. Hata olursa {error, code} döner (code "scope": izin gerekli). */
  const approveWork = useCallback(
    async (id: string, mail?: boolean): Promise<{ error: string; code?: string } | null> => {
      const r = await fetch("/api/brain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve", id, mail }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.item) return { error: j.error ?? "Onaylanamadı", code: j.code };
      setSt((s) => (s ? { ...s, items: s.items.map((x) => (x.id === id ? j.item : x)) } : s));
      setOpen(j.item);
      toast(j.item.work?.draft ? "✉️ Gmail'de taslak hazır — açıp gönder" : "Onaylandı");
      return null;
    },
    [toast],
  );

  /** ajanın güven seviyesi */
  const setTrust = useCallback(
    async (agent: AgentId, level: TrustLevel) => {
      const r = await fetch("/api/brain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "trust", agent, level }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return toast(j.error ?? "Kaydedilemedi");
      setSt(j.state);
      toast(`${agentById(agent)?.name}: ${TRUST_META[level].label}`);
    },
    [toast],
  );

  // güven 2: ajanın kendisi yapacağı işler sayfa açıkken sırayla yapılır (biri bitince sıradaki)
  const draining = useRef<string | null>(null);
  const queued = st?.items.filter((x) => x.work?.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.id;
  const anyRunning = !!st?.items.some((x) => x.work?.status === "running");
  useEffect(() => {
    if (!queued || anyRunning || draining.current) return;
    draining.current = queued;
    runWork(queued, undefined, undefined, true).finally(() => {
      draining.current = null;
    });
  }, [queued, anyRunning, runWork]);
  const working = !!st?.items.some((x) => x.work?.status === "running");
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [working, load]);

  return { st, setSt, err, thinking, think, patch, runWork, approveWork, setTrust, open, setOpen, load };
}
