"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { Logo } from "@/components/AppShell";

export default function GirisPage() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
    if (res.ok) window.location.href = "/";
    else {
      setErr("Şifre hatalı");
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <motion.form onSubmit={submit} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="clay w-full max-w-sm p-7 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="mt-4 text-2xl font-extrabold">LabIQ Kontrol</div>
        <div className="text-sm text-ink-3">Aylık kapanış kontrol listesi</div>
        <input type="password" autoFocus className="field mt-6 text-center" placeholder="Şifre" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <div className="mt-2 text-sm font-bold text-fail">{err}</div>}
        <button disabled={busy} className="clay-dark mt-5 w-full rounded-full py-3.5 font-extrabold">
          {busy ? "…" : "Giriş"}
        </button>
      </motion.form>
    </div>
  );
}
