"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildMessages, DEFAULT_PREFS, type NotifyMessage, type NotifyPrefs } from "@/lib/notify";
import { usePeriod } from "./PeriodProvider";
import { Icon, Sheet } from "./ui";

interface PushInfo {
  configured: boolean;
  publicKey: string;
  prefs: NotifyPrefs;
  devices: { device: string; createdAt: string; endpointTail: string }[];
}

type Support = "checking" | "ok" | "unsupported" | "ios-install";

const b64ToBytes = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Cihaz";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [os, br].filter(Boolean).join(" · ");
}

const LEVEL: Record<NotifyMessage["level"], string> = { info: "var(--color-tint-info)", warn: "var(--color-tint-warn)", alert: "var(--color-tint-fail)" };

function Toggle({ on, onChange, label, sub }: { on: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <button onClick={() => onChange(!on)} className="clay-sm flex w-full items-center gap-3 px-4 py-3 text-left">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold">{label}</div>
        {sub && <div className="text-xs text-ink-3">{sub}</div>}
      </div>
      <span className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${on ? "bg-ok" : "clay-pressed"}`}>
        <motion.span
          className="absolute top-1 h-6 w-6 rounded-full bg-white shadow-md"
          animate={{ left: on ? 28 : 4 }}
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
        />
      </span>
    </button>
  );
}

export function NotificationBell() {
  const { data, toast } = usePeriod();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<PushInfo | null>(null);
  const [support, setSupport] = useState<Support>("checking");
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);

  const prefs = info?.prefs ?? DEFAULT_PREFS;
  const messages = useMemo(() => buildMessages(data, prefs), [data, prefs]);
  const alertCount = messages.filter((m) => m.kind !== "friday").length;

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/push", { cache: "no-store" });
      if (r.ok) setInfo(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    load();
    (async () => {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setSupport(ios && !standalone ? "ios-install" : "unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        setSub(await reg.pushManager.getSubscription());
        setSupport("ok");
      } catch {
        setSupport("unsupported");
      }
    })();
  }, [load]);

  const enable = async () => {
    if (!info?.configured) return toast("Sunucuda push anahtarları tanımlı değil");
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast("Bildirim izni verilmedi");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(info.publicKey) });
      const r = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: s.toJSON(), device: deviceName() }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setSub(s);
      await fetch("/api/push/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: s.endpoint }) });
      toast("Bildirimler açıldı");
      load();
    } catch (e) {
      toast(`Açılamadı: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!sub) return;
    setBusy(true);
    try {
      await fetch("/api/push/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
      setSub(null);
      toast("Bu cihazda bildirimler kapatıldı");
      load();
    } finally {
      setBusy(false);
    }
  };

  const sendNow = async (mode?: "today") => {
    if (!sub) return;
    setBusy(true);
    try {
      const r = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint, mode }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      if (mode === "today" && !body.messages?.length) toast("Bugün için hatırlatma yok");
      else toast("Gönderildi");
    } catch (e) {
      toast(`Gönderilemedi: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  const savePrefs = async (p: NotifyPrefs) => {
    setInfo((i) => (i ? { ...i, prefs: p } : i));
    await fetch("/api/push/prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
  };

  return (
    <>
      <motion.button whileTap={{ scale: 0.9 }} onClick={() => setOpen(true)} className="clay-sm relative grid h-11 w-11 shrink-0 place-items-center rounded-full" aria-label="Bildirimler">
        <Icon name="bell" size={21} />
        <AnimatePresence>
          {alertCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-fail px-1 text-[10px] font-extrabold text-white shadow"
            >
              {alertCount}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Bildirimler">
        {/* Bugünün hatırlatmaları */}
        <div className="text-xs font-bold uppercase tracking-wide text-ink-3">Bugün</div>
        <div className="mt-2 space-y-2.5">
          {messages.length === 0 ? (
            <div className="clay-sm px-4 py-5 text-center text-sm text-ink-3">Bugün için hatırlatma yok 🎉</div>
          ) : (
            messages.map((m) => (
              <Link key={m.tag} href={m.url} onClick={() => setOpen(false)} className="clay-sm block px-4 py-3" style={{ background: LEVEL[m.level] }}>
                <div className="text-sm font-extrabold">{m.title}</div>
                <div className="mt-0.5 text-sm text-ink-2">{m.body}</div>
              </Link>
            ))
          )}
        </div>

        {/* Push */}
        <div className="mt-6 text-xs font-bold uppercase tracking-wide text-ink-3">Bu cihaza push bildirimi</div>
        <div className="clay mt-2 p-4">
          {support === "checking" ? (
            <div className="text-sm text-ink-3">Kontrol ediliyor…</div>
          ) : support === "ios-install" ? (
            <div className="text-sm">
              <div className="font-extrabold">📲 Önce ana ekrana ekle</div>
              <p className="mt-1 text-ink-2">
                iPhone/iPad&apos;de bildirimler için uygulamayı Safari&apos;de <b>Paylaş → Ana Ekrana Ekle</b> ile yükleyip oradan açman gerekiyor (iOS 16.4+).
              </p>
            </div>
          ) : support === "unsupported" ? (
            <div className="text-sm text-ink-2">Bu tarayıcı push bildirimlerini desteklemiyor.</div>
          ) : !info?.configured ? (
            <div className="text-sm text-ink-2">
              <b>Sunucu ayarı eksik:</b> Vercel ortam değişkenlerine <code>VAPID_PUBLIC_KEY</code>, <code>VAPID_PRIVATE_KEY</code> ve <code>CRON_SECRET</code> eklenmeli (README&apos;de anlatıldı).
            </div>
          ) : sub ? (
            <>
              <div className="flex items-center gap-3">
                <span className="clay-color grid h-11 w-11 place-items-center bg-ok text-white" style={{ borderRadius: 16, ["--glow" as string]: "#34C26B88" }}>
                  <Icon name="bell" size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-extrabold">Açık</div>
                  <div className="text-xs text-ink-3">Her sabah 09:00&apos;da hatırlatmalar gelir · {info.devices.length} cihaz kayıtlı</div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button disabled={busy} onClick={() => sendNow()} className="clay-sm rounded-full py-2.5 text-sm font-bold">Test gönder</button>
                <button disabled={busy} onClick={() => sendNow("today")} className="clay-sm rounded-full py-2.5 text-sm font-bold">Bugününkünü gönder</button>
              </div>
              <button disabled={busy} onClick={disable} className="mt-2 w-full rounded-full py-2.5 text-sm font-bold text-fail">Bu cihazda kapat</button>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-2">Termin, geciken aksiyon ve Cuma toplantısı hatırlatmaları telefonuna/bilgisayarına bildirim olarak gelsin.</p>
              <button disabled={busy} onClick={enable} className="clay-dark mt-3 flex w-full items-center justify-center gap-2 rounded-full py-3.5 font-extrabold">
                <Icon name="bell" size={19} /> {busy ? "Açılıyor…" : "Bildirimleri aç"}
              </button>
            </>
          )}
        </div>

        {/* Tercihler */}
        <div className="mt-6 text-xs font-bold uppercase tracking-wide text-ink-3">Neler bildirilsin?</div>
        <div className="mt-2 space-y-2.5">
          <Toggle on={prefs.deadlines} onChange={(v) => savePrefs({ ...prefs, deadlines: v })} label="Rapor alanı terminleri" sub="Yaklaşan ve geçen terminler (Ay bitiş + N gün)" />
          {prefs.deadlines && (
            <div className="clay-sm flex items-center gap-3 px-4 py-3">
              <div className="flex-1 text-sm font-bold">Kaç gün önce hatırlat?</div>
              {[1, 2, 3].map((n) => (
                <button key={n} onClick={() => savePrefs({ ...prefs, daysBefore: n })} className={`h-9 w-9 rounded-full text-sm font-extrabold ${prefs.daysBefore === n ? "bg-blue text-white" : "clay-pressed"}`}>
                  {n}
                </button>
              ))}
            </div>
          )}
          <Toggle on={prefs.actions} onChange={(v) => savePrefs({ ...prefs, actions: v })} label="Aksiyon terminleri" sub="Termini bugün olan ve geciken açık aksiyonlar" />
          <Toggle on={prefs.friday} onChange={(v) => savePrefs({ ...prefs, friday: v })} label="Cuma toplantı özeti" sub="Cuma sabahı: kapanan / açık aksiyonlar, sorunlu maddeler" />
          <Toggle on={prefs.monthStart} onChange={(v) => savePrefs({ ...prefs, monthStart: v })} label="Ay başı hatırlatması" sub="Yeni ayın ilk günlerinde kapanışı başlat" />
        </div>
      </Sheet>
    </>
  );
}
