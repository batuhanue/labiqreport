"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui";

interface LogItem {
  text: string;
  time: string;
  type: "info" | "success" | "warn";
}

interface ExportResult {
  fileName: string;
  downloadUrl: string;
  company: string;
  range: string;
  timestamp: string;
}

export default function LabIQAgentPanel() {
  const [status, setStatus] = useState<{
    loggedIn: boolean;
    companyKey: "bursa" | "basaksehir";
    companyLabel: string;
    user: string;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [command, setCommand] = useState("");
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [lastExport, setLastExport] = useState<ExportResult | null>(null);
  const [history, setHistory] = useState<ExportResult[]>([]);

  // Form tabanlı doğrudan filtreleme için
  const [startDate, setStartDate] = useState("2026-07-01");
  const [endDate, setEndDate] = useState("2026-09-01");
  const [selectedHospital, setSelectedHospital] = useState<"bursa" | "basaksehir">("bursa");

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // İlk yüklemede durum kontrolü
  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = (text: string, type: "info" | "success" | "warn" = "info") => {
    setLogs((prev) => [
      ...prev,
      { text, time: new Date().toLocaleTimeString("tr-TR"), type },
    ]);
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/labiq");
      const data = await res.json();
      if (data.status) {
        setStatus(data.status);
        setSelectedHospital(data.status.companyKey);
      }
    } catch (e) {
      console.error("Labiq status fetch error:", e);
    }
  };

  const handleSwitchCompany = async (target: "bursa" | "basaksehir") => {
    if (switching || status?.companyKey === target) return;
    setSwitching(true);
    addLog(`${target === "bursa" ? "Bursa PPP" : "Başakşehir PPP"} hastanesine geçiş yapılıyor...`, "info");

    try {
      const res = await fetch("/api/labiq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "switch", company: target }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus(data.status);
        setSelectedHospital(target);
        addLog(`Şirket başarıyla değiştirildi: ${data.company}`, "success");
      } else {
        addLog(`Şirket değiştirilemedi: ${data.error}`, "warn");
      }
    } catch (e) {
      addLog(`Bağlantı hatası: ${(e as Error).message}`, "warn");
    } finally {
      setSwitching(false);
    }
  };

  const triggerBrowserDownload = (downloadUrl: string, fileName: string) => {
    const proxyUrl = `/api/labiq/download?url=${encodeURIComponent(downloadUrl)}&name=${encodeURIComponent(fileName)}`;
    const a = document.createElement("a");
    a.href = proxyUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const runCommand = async (cmdText?: string) => {
    const cmdToRun = (cmdText ?? command).trim();
    if (!cmdToRun || loading) return;

    setLoading(true);
    setCommand("");
    addLog(`💬 Komut: "${cmdToRun}"`, "info");

    try {
      const res = await fetch("/api/labiq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "command", command: cmdToRun }),
      });

      const data = await res.json();

      if (data.logs && Array.isArray(data.logs)) {
        for (const l of data.logs) {
          addLog(l.text, l.type);
        }
      }

      if (data.status) {
        setStatus(data.status);
        setSelectedHospital(data.status.companyKey);
      }

      if (data.ok && data.action === "export_consumption" && data.downloadUrl) {
        const exportItem: ExportResult = {
          fileName: data.fileName,
          downloadUrl: data.downloadUrl,
          company: data.company,
          range: data.range,
          timestamp: new Date().toLocaleTimeString("tr-TR"),
        };
        setLastExport(exportItem);
        setHistory((prev) => [exportItem, ...prev]);

        // Otomatik indirme başlat
        addLog(`🚀 Dosya bilgisayarınıza indiriliyor...`, "success");
        triggerBrowserDownload(data.downloadUrl, data.fileName);
      } else if (!data.ok) {
        addLog(`Ajan bildirimi: ${data.error || "İşlem tamamlanamadı"}`, "warn");
      }
    } catch (e) {
      addLog(`Hata: ${(e as Error).message}`, "warn");
    } finally {
      setLoading(false);
    }
  };

  const handleDirectExport = async () => {
    if (loading) return;
    setLoading(true);
    addLog(`Doğrudan indirme başlatıldı: ${selectedHospital.toUpperCase()} (${startDate} → ${endDate})`, "info");

    try {
      const res = await fetch("/api/labiq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "export",
          company: selectedHospital,
          startDate,
          endDate,
        }),
      });

      const data = await res.json();

      if (data.ok && data.downloadUrl) {
        addLog(`Dosya hazırlandı: ${data.fileName}`, "success");
        const exportItem: ExportResult = {
          fileName: data.fileName,
          downloadUrl: data.downloadUrl,
          company: data.company,
          range: data.range,
          timestamp: new Date().toLocaleTimeString("tr-TR"),
        };
        setLastExport(exportItem);
        setHistory((prev) => [exportItem, ...prev]);
        triggerBrowserDownload(data.downloadUrl, data.fileName);
      } else {
        addLog(`İndirme başarısız: ${data.error}`, "warn");
      }
    } catch (e) {
      addLog(`Hata: ${(e as Error).message}`, "warn");
    } finally {
      setLoading(false);
    }
  };

  const chips = [
    "1 temmuz 1 eylül arasındaki tüketimleri indir",
    "Başakşehir PPP için temmuz ayı tüketimlerini indir",
    "Bursa PPP 1 temmuz 1 eylül tüketimleri",
    "Başakşehir hastanesine geç",
    "Bursa hastanesine geç",
  ];

  return (
    <div className="space-y-5">
      {/* ── ÜST BAŞLIK & DURUM PANELİ ── */}
      <div className="clay flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6 rounded-[28px] bg-gradient-to-br from-[#0c1020]/90 via-[#0e1630]/70 to-[#080b16]/90 border border-blue/20 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue/15 text-2xl border border-blue/30 shadow-[0_0_30px_rgba(59,130,246,0.3)]">
            <span className="relative">⚡</span>
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500 border-2 border-[#0c1020]"></span>
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black tracking-tight text-white">LabIQ AI Ajanı</h2>
              <span className="rounded-full bg-blue/20 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider text-blue border border-blue/30">
                v1 Deneysel
              </span>
            </div>
            <p className="text-xs text-ink-3 mt-0.5 flex items-center gap-1.5">
              <span>Devise & ActionCable Canlı Robotu</span>
              <span>•</span>
              <span className="text-emerald-400 font-medium">batuhanb@diacore.com.tr</span>
            </p>
          </div>
        </div>

        {/* Şirket Seçici Hapları (Bursa PPP vs Başakşehir PPP) */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-[#050814]/70 p-1.5 rounded-2xl border border-white/5">
          <span className="text-[11px] font-bold text-ink-3 px-3 sm:px-2">Aktif Hastane:</span>
          <div className="flex rounded-xl p-0.5 bg-[#0a0e20]">
            <button
              onClick={() => handleSwitchCompany("bursa")}
              disabled={switching}
              className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                status?.companyKey === "bursa"
                  ? "text-white shadow-lg shadow-blue/20"
                  : "text-ink-2 hover:text-white"
              }`}
            >
              {status?.companyKey === "bursa" && (
                <motion.span
                  layoutId="active-hospital"
                  className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue to-indigo-600"
                  transition={{ type: "spring", stiffness: 450, damping: 35 }}
                />
              )}
              <span className="relative">🏥 Bursa PPP</span>
              {status?.companyKey === "bursa" && <span className="relative text-[10px] opacity-75 font-mono">(226)</span>}
            </button>

            <button
              onClick={() => handleSwitchCompany("basaksehir")}
              disabled={switching}
              className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                status?.companyKey === "basaksehir"
                  ? "text-white shadow-lg shadow-blue/20"
                  : "text-ink-2 hover:text-white"
              }`}
            >
              {status?.companyKey === "basaksehir" && (
                <motion.span
                  layoutId="active-hospital"
                  className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue to-indigo-600"
                  transition={{ type: "spring", stiffness: 450, damping: 35 }}
                />
              )}
              <span className="relative">🏥 Başakşehir PPP</span>
              {status?.companyKey === "basaksehir" && <span className="relative text-[10px] opacity-75 font-mono">(259)</span>}
            </button>
          </div>
        </div>
      </div>

      {/* ── AJAN KOMUT KONSOLU & CANLI ÇALIŞMA ALANI ── */}
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        {/* SOL: Komut Kutusu & Canlı Terminal */}
        <div className="space-y-4">
          {/* Komut Girişi */}
          <div className="clay p-5 rounded-[28px] space-y-4 bg-[#090d1e]/80 border border-white/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold tracking-wider text-ink-3 uppercase flex items-center gap-2">
                <span>💬</span> Ajan Komut Girişi
              </span>
              <span className="text-[11px] text-ink-3">Doğal Türkçe anlayabilir</span>
            </div>

            <div className="relative">
              <textarea
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    runCommand();
                  }
                }}
                rows={2}
                placeholder="Örnek: 1 temmuz 1 eylül arasındaki tüketimleri indir..."
                className="w-full resize-none rounded-2xl bg-[#050814]/90 p-4 pr-24 text-sm text-white placeholder-ink-3 border border-white/10 outline-none focus:border-blue/50 focus:ring-2 focus:ring-blue/20 transition-all font-medium"
              />
              <button
                onClick={() => runCommand()}
                disabled={loading || !command.trim()}
                className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-xl bg-blue px-4 py-2 text-xs font-black text-white hover:bg-blue/90 disabled:opacity-40 transition-all shadow-md shadow-blue/30"
              >
                {loading ? (
                  <>
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                      className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent"
                    />
                    <span>İşleniyor</span>
                  </>
                ) : (
                  <>
                    <span>Çalıştır</span>
                    <span>→</span>
                  </>
                )}
              </button>
            </div>

            {/* Hızlı Komut Çipleri */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[11px] font-bold text-ink-3">Örnekler:</span>
              {chips.map((chip, i) => (
                <button
                  key={i}
                  onClick={() => runCommand(chip)}
                  disabled={loading}
                  className="rounded-full bg-white/5 hover:bg-blue/15 hover:border-blue/30 border border-white/10 px-3 py-1 text-[11px] font-medium text-ink-2 hover:text-white transition-all disabled:opacity-50"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          {/* Canlı Ajan Adım Günlüğü (Terminal Görünümü) */}
          <div className="clay p-5 rounded-[28px] bg-[#050711] border border-white/10 space-y-3 font-mono">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                <span className="text-xs font-bold text-ink-2 uppercase tracking-widest font-sans">Ajan Terminali</span>
              </div>
              <button
                onClick={() => setLogs([])}
                className="text-[10px] text-ink-3 hover:text-white transition-colors font-sans"
              >
                Temizle
              </button>
            </div>

            <div className="h-56 overflow-y-auto space-y-2 pr-1 text-xs">
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-ink-3 space-y-1 font-sans">
                  <span>Ajan hazır durumda bekliyor.</span>
                  <span className="text-[11px] opacity-70">Yukarıdaki önerilerden birine tıklayın veya komut yazın.</span>
                </div>
              ) : (
                logs.map((log, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`flex items-start gap-2.5 leading-relaxed ${
                      log.type === "success"
                        ? "text-emerald-400"
                        : log.type === "warn"
                        ? "text-rose-400"
                        : "text-slate-300"
                    }`}
                  >
                    <span className="text-[10px] text-ink-3 shrink-0 pt-0.5">[{log.time}]</span>
                    <span className="break-all">{log.text}</span>
                  </motion.div>
                ))
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>
        </div>

        {/* SAĞ: Son İndirilen Dosya Kartı & Doğrudan Filtre Kontrolü */}
        <div className="space-y-4">
          {/* Son İndirilen Dosya Kartı */}
          <div className="clay p-5 rounded-[28px] bg-gradient-to-b from-[#0e1630]/90 to-[#090d1e]/90 border border-blue/30 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                <span>📁</span> Hazır Rapor
              </span>
              {lastExport && (
                <span className="text-[10px] rounded-full bg-emerald-500/20 text-emerald-400 px-2 py-0.5 font-bold">
                  {lastExport.timestamp}
                </span>
              )}
            </div>

            {lastExport ? (
              <div className="rounded-2xl bg-[#060814]/80 p-4 border border-white/10 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-2xl border border-emerald-500/30">
                    📊
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-extrabold text-white truncate" title={lastExport.fileName}>
                      {lastExport.fileName}
                    </p>
                    <p className="text-[11px] text-ink-3 mt-0.5">{lastExport.company}</p>
                    <span className="inline-block mt-1 text-[10px] font-bold text-blue bg-blue/15 px-2 py-0.5 rounded-md">
                      {lastExport.range}
                    </span>
                  </div>
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    onClick={() => triggerBrowserDownload(lastExport.downloadUrl, lastExport.fileName)}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-xs font-bold text-white hover:from-emerald-500 hover:to-teal-500 transition-all shadow-lg shadow-emerald-900/30"
                  >
                    <span>⬇️ Tekrar İndir</span>
                  </button>
                  <a
                    href={lastExport.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-ink-2"
                    title="Doğrudan S3 Linki"
                  >
                    🔗
                  </a>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center space-y-2">
                <span className="text-3xl opacity-40">📊</span>
                <p className="text-xs text-ink-3">Henüz bu oturumda indirilmiş rapor yok.</p>
                <p className="text-[11px] text-ink-3/70">Ajan komutunu çalıştırdığınızda dosya otomatik burada belirecektir.</p>
              </div>
            )}
          </div>

          {/* Doğrudan İndirme Paneli (Manuel Yedek Kontrol) */}
          <div className="clay p-5 rounded-[28px] bg-[#090d1e]/80 border border-white/5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold tracking-wider text-ink-3 uppercase">
                ⚙️ Doğrudan Parametreli İndirme
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[11px] font-bold text-ink-3 mb-1 block">Hastane</label>
                <select
                  value={selectedHospital}
                  onChange={(e) => setSelectedHospital(e.target.value as "bursa" | "basaksehir")}
                  className="w-full rounded-xl bg-[#050814] p-2.5 text-white border border-white/10 outline-none focus:border-blue/50"
                >
                  <option value="bursa">Diacore Diagnostik - Bursa PPP (226)</option>
                  <option value="basaksehir">Diacore Diagnostik - Başakşehir PPP (259)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-ink-3 mb-1 block">Başlangıç Tarihi</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-xl bg-[#050814] p-2.5 text-white border border-white/10 outline-none focus:border-blue/50"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-ink-3 mb-1 block">Bitiş Tarihi</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full rounded-xl bg-[#050814] p-2.5 text-white border border-white/10 outline-none focus:border-blue/50"
                  />
                </div>
              </div>

              <button
                onClick={handleDirectExport}
                disabled={loading}
                className="w-full mt-2 rounded-xl bg-blue/20 hover:bg-blue/30 border border-blue/40 p-2.5 text-xs font-black text-blue hover:text-white transition-all disabled:opacity-50"
              >
                {loading ? "İndiriliyor..." : "Tüketim Excel Dosyasını Doğrudan İndir"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
