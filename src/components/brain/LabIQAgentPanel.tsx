"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { renderMd } from "@/lib/markdown";

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

interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
  toolCalls?: ToolCallRecord[];
  exportResult?: ExportResult;
}

export default function LabIQAgentPanel() {
  const [status, setStatus] = useState<{
    loggedIn: boolean;
    companyKey: "bursa" | "basaksehir";
    companyId: string;
    companyLabel: string;
    user: string;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [inputMessage, setInputMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: `Merhaba Batuhan Bey! 👋\n\nBen **LabIQ Canlı AI Ajanı**yım. Claude Haiku bağlamı ve 56 ekranlık teknik eğitim atlası (**R01–R12**) ile doğrudan LabIQ oturumunuza bağlıyım.\n\n### ⚡ Neler Yapabilirim?
- **Tüketim İndirme:** *"1 temmuz 1 eylül arasındaki tüketimleri indir"* veya *"Başakşehir için son ay tüketimlerini çek"*
- **Hastane Değişimi:** Bursa PPP (226) ve Başakşehir PPP (259) arasında anında geçiş
- **Süreç & Rapor Rehberliği:** Stok Gözlem (R02), Miadı Yaklaşanlar (R03), Test Verimliliği (R08), Cihaz Performansı (R07) ve Maliyet Anomali (R09) dökümleri
- **Doğrudan İndirme:** Rapor üretildiği an dosyayı bilgisayarınıza otomatik indiririm.\n\nNasıl yardımcı olabilirim?`,
      time: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  const [logs, setLogs] = useState<LogItem[]>([]);
  const [history, setHistory] = useState<ExportResult[]>([]);
  const [activeTab, setActiveTab] = useState<"chat" | "downloads" | "manual">("chat");

  // Manuel doğrudan indirme parametreleri
  const [startDate, setStartDate] = useState("2026-07-01");
  const [endDate, setEndDate] = useState("2026-09-01");
  const [selectedHospital, setSelectedHospital] = useState<"bursa" | "basaksehir">("bursa");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = (text: string, type: "info" | "success" | "warn" = "info") => {
    setLogs((prev) => [
      ...prev.slice(-40),
      { text, time: new Date().toLocaleTimeString("tr-TR"), type },
    ]);
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/labiq");
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch {}
      if (data?.status) {
        setStatus(data.status);
        setSelectedHospital(data.status.companyKey);
      }
    } catch (e) {
      console.error("Labiq status fetch error:", e);
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

  const handleSwitchCompany = async (target: "bursa" | "basaksehir") => {
    if (switching || status?.companyKey === target) return;
    setSwitching(true);
    addLog(`${target === "bursa" ? "Bursa PPP" : "Başakşehir PPP"} hastanesine geçiliyor...`, "info");

    try {
      const res = await fetch("/api/labiq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "switch", company: target }),
      });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch {}
      if (res.ok && data.ok) {
        setStatus(data.status);
        setSelectedHospital(target);
        addLog(`Şirket başarıyla değiştirildi: ${data.company}`, "success");
        setMessages((prev) => [
          ...prev,
          {
            id: String(Date.now()),
            role: "assistant",
            content: `🏥 Aktif hastane başarıyla **${data.company}** olarak güncellendi.`,
            time: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
      } else {
        addLog(`Şirket değiştirilemedi: ${data.error}`, "warn");
      }
    } catch (e) {
      addLog(`Bağlantı hatası: ${(e as Error).message}`, "warn");
    } finally {
      setSwitching(false);
    }
  };

  const sendMessage = async (textToSend?: string) => {
    const text = (textToSend ?? inputMessage).trim();
    if (!text || loading) return;

    const userMsgId = String(Date.now());
    const userMsg: Message = {
      id: userMsgId,
      role: "user",
      content: text,
      time: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputMessage("");
    setLoading(true);
    addLog(`Kullanıcı mesajı: "${text}"`, "info");

    try {
      const historyPayload = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("/api/labiq/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: historyPayload,
          company: status?.companyKey,
        }),
      });

      const textResponse = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(textResponse);
      } catch {
        if (res.status === 504) {
          throw new Error("Sunucu yanıt süresi aşıldı (504 Gateway Timeout). Lütfen tekrar deneyin.");
        }
        throw new Error(`Sunucu yanıtı geçersiz (${res.status}): ${textResponse.slice(0, 100)}`);
      }

      if (!res.ok && !data?.reply) {
        throw new Error(data?.error || `Sunucu hatası (${res.status})`);
      }

      if (data.logs && Array.isArray(data.logs)) {
        for (const l of data.logs) addLog(l.text, l.type);
      }

      if (data.status) {
        setStatus(data.status);
        setSelectedHospital(data.status.companyKey);
      }

      let exportItem: ExportResult | undefined;
      if (data.exportResult && data.exportResult.ok && data.exportResult.downloadUrl) {
        exportItem = {
          fileName: data.exportResult.fileName,
          downloadUrl: data.exportResult.downloadUrl,
          company: data.exportResult.company,
          range: data.exportResult.range,
          timestamp: new Date().toLocaleTimeString("tr-TR"),
        };
        setHistory((prev) => [exportItem!, ...prev]);
        addLog(`🚀 Otomatik indirme tetiklendi: ${exportItem.fileName}`, "success");
        triggerBrowserDownload(exportItem.downloadUrl, exportItem.fileName);
      }

      const botMsg: Message = {
        id: String(Date.now() + 1),
        role: "assistant",
        content: data.reply || (data.ok ? "İşlem başarıyla tamamlandı." : data.error || "Yanıt alınamadı."),
        time: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
        toolCalls: data.toolCalls,
        exportResult: exportItem,
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (e) {
      const errText = (e as Error).message;
      addLog(`Hata: ${errText}`, "warn");
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now() + 1),
          role: "assistant",
          content: `⚠️ Bağlantı hatası oluştu: ${errText}`,
          time: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleManualExport = async () => {
    if (loading) return;
    setLoading(true);
    addLog(`Manuel indirme başlatıldı: ${selectedHospital.toUpperCase()} (${startDate} → ${endDate})`, "info");

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

      const text = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        if (res.status === 504) {
          throw new Error("Sunucu yanıt süresi aşıldı (504 Gateway Timeout). Lütfen tekrar deneyin.");
        }
        throw new Error(`Sunucu yanıtı geçersiz (${res.status}): ${text.slice(0, 100)}`);
      }

      if (data && data.ok && data.downloadUrl) {
        const item: ExportResult = {
          fileName: data.fileName,
          downloadUrl: data.downloadUrl,
          company: data.company,
          range: data.range,
          timestamp: new Date().toLocaleTimeString("tr-TR"),
        };
        setHistory((prev) => [item, ...prev]);
        triggerBrowserDownload(data.downloadUrl, data.fileName);
        addLog(`Dosya hazırlandı ve indirildi: ${data.fileName}`, "success");

        setMessages((prev) => [
          ...prev,
          {
            id: String(Date.now()),
            role: "assistant",
            content: `✅ **Tüketim Raporu İndirildi**\n\n- **Dosya:** \`${data.fileName}\`\n- **Hastane:** ${data.company}\n- **Dönem:** ${data.range}`,
            time: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
            exportResult: item,
          },
        ]);
        setActiveTab("chat");
      } else {
        addLog(`İndirme başarısız: ${data.error}`, "warn");
      }
    } catch (e) {
      addLog(`Hata: ${(e as Error).message}`, "warn");
    } finally {
      setLoading(false);
    }
  };

  const quickPrompts = [
    "1 temmuz 1 eylül arasındaki tüketimleri indir",
    "Başakşehir PPP için temmuz ayı tüketimlerini indir",
    "Başakşehir hastanesine geç",
    "Bursa hastanesine geç",
    "Stok Gözlem ve Ekstre süreci nedir? (R02)",
    "Miadı yaklaşan ürünler ve riskli stok analizi (R03 & R06)",
    "Laboratuvar test verimlilik raporu tarifi (R08)",
  ];

  return (
    <div className="space-y-4">
      {/* ── ÜST BAŞLIK, CANLI DURUM & HASTANE SEÇİCİ ── */}
      <div className="clay flex flex-wrap items-center justify-between gap-4 p-5 rounded-[28px] bg-gradient-to-br from-[#0c1020]/95 via-[#0e1630]/85 to-[#080b16]/95 border border-blue/25 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="relative flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue/20 to-purple-500/20 text-2xl border border-blue/40 shadow-[0_0_25px_rgba(59,130,246,0.25)]">
            <span>⚡</span>
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-[#0c1020]"></span>
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black tracking-tight text-white">LabIQ AI Ajanı</h2>
              <span className="rounded-full bg-purple-500/20 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-purple-300 border border-purple-500/30">
                Claude Haiku Engine
              </span>
              <span className="rounded-full bg-blue/15 px-2 py-0.5 text-[10px] font-bold text-blue border border-blue/20">
                56 Ekran & R01–R12 Atlası
              </span>
            </div>
            <p className="text-xs text-ink-3 mt-0.5 flex items-center gap-1.5 font-medium">
              <span>Devise & ActionCable Canlı Bağlantısı</span>
              <span>•</span>
              <span className="text-emerald-400 font-mono">batuhanb@diacore.com.tr</span>
            </p>
          </div>
        </div>

        {/* Aktif Hastane Geçiş Hapları */}
        <div className="flex items-center gap-2 bg-[#050814]/80 p-1.5 rounded-2xl border border-white/10">
          <span className="text-[11px] font-bold text-ink-3 px-2">Aktif Hastane:</span>
          <div className="flex rounded-xl p-0.5 bg-[#0a0e20]">
            <button
              onClick={() => handleSwitchCompany("bursa")}
              disabled={switching}
              className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                status?.companyKey === "bursa"
                  ? "text-white shadow-lg shadow-blue/25"
                  : "text-ink-2 hover:text-white"
              }`}
            >
              {status?.companyKey === "bursa" && (
                <motion.span
                  layoutId="active-hospital-pill"
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
                  ? "text-white shadow-lg shadow-blue/25"
                  : "text-ink-2 hover:text-white"
              }`}
            >
              {status?.companyKey === "basaksehir" && (
                <motion.span
                  layoutId="active-hospital-pill"
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

      {/* ── İKİLİ PENCERE: SOL SOHBET & SAĞ ÇALIŞMA ALANI ── */}
      <div className="grid gap-4 lg:grid-cols-[1.65fr_1fr]">
        {/* SOL: AI SOHBET PENCERESİ */}
        <div className="clay flex flex-col rounded-[28px] bg-[#080b18]/90 border border-white/10 overflow-hidden shadow-2xl h-[680px]">
          {/* Sohbet Üst Çubuğu */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-[#050814]/80">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              <span className="text-xs font-bold text-white uppercase tracking-wider">Ajan Sohbeti</span>
              <span className="text-[10px] text-ink-3">({messages.length} mesaj)</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() =>
                  setMessages([
                    {
                      id: "welcome",
                      role: "assistant",
                      content: `Sohbet temizlendi. LabIQ üzerinde ne yapmak istersiniz?`,
                      time: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
                    },
                  ])
                }
                className="text-[11px] text-ink-3 hover:text-white px-2.5 py-1 rounded-lg hover:bg-white/5 transition-colors"
              >
                Sohbeti Temizle
              </button>
            </div>
          </div>

          {/* Mesaj Listesi */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
              >
                <div className="flex items-center gap-1.5 text-[10px] text-ink-3 mb-1 px-1">
                  <span>{m.role === "user" ? "Siz" : "⚡ LabIQ Ajanı"}</span>
                  <span>•</span>
                  <span>{m.time}</span>
                </div>

                <div
                  className={`max-w-[92%] rounded-2xl p-4 leading-relaxed ${
                    m.role === "user"
                      ? "bg-blue text-white shadow-md shadow-blue/20 rounded-br-xs font-medium"
                      : "bg-[#0f1426] text-slate-100 border border-white/10 shadow-lg rounded-bl-xs"
                  }`}
                >
                  {/* Araç Çalıştırma Rozetleri */}
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <div className="mb-3 space-y-1.5 pb-2.5 border-b border-white/10">
                      {m.toolCalls.map((tc, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 text-[11px] bg-black/30 px-2.5 py-1 rounded-lg text-emerald-400 font-mono"
                        >
                          <span>🔧</span>
                          <span>
                            {tc.name === "labiq_download_consumption"
                              ? `Tüketim Raporu İndirildi (${String(tc.input.startDate)} → ${String(tc.input.endDate)})`
                              : tc.name === "labiq_switch_company"
                              ? `Hastane Değiştirildi (${String(tc.input.company).toUpperCase()})`
                              : `Araç: ${tc.name}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Mesaj Metni (Markdown) */}
                  <div
                    className="prose prose-invert prose-sm max-w-none space-y-2 [&>p]:leading-relaxed [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>h3]:text-white [&>h3]:font-bold [&>h3]:text-sm [&>h3]:mt-2"
                    dangerouslySetInnerHTML={{ __html: renderMd(m.content) }}
                  />

                  {/* İndirilen Dosya Kartı (Eğer Mesajla Geldiyse) */}
                  {m.exportResult && (
                    <div className="mt-3.5 pt-3 border-t border-white/15 flex items-center justify-between gap-3 bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/30">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xl">📊</span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">{m.exportResult.fileName}</p>
                          <p className="text-[10px] text-emerald-300">{m.exportResult.range} • {m.exportResult.company}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => triggerBrowserDownload(m.exportResult!.downloadUrl, m.exportResult!.fileName)}
                        className="shrink-0 flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-md transition-all"
                      >
                        <span>⬇️ İndir</span>
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}

            {loading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-2 text-ink-3 text-xs pl-1">
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                  className="inline-block h-4 w-4 rounded-full border-2 border-blue border-t-transparent mt-0.5"
                />
                <span>LabIQ ve Claude Haiku sorguyu yürütüyor...</span>
              </motion.div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Hızlı Öneri Çipleri */}
          <div className="px-4 py-2 border-t border-white/5 bg-[#050814]/60 flex items-center gap-2 overflow-x-auto no-scrollbar">
            <span className="text-[10px] font-bold text-ink-3 shrink-0">Hızlı:</span>
            {quickPrompts.map((p, i) => (
              <button
                key={i}
                onClick={() => sendMessage(p)}
                disabled={loading}
                className="shrink-0 rounded-full bg-white/5 hover:bg-blue/15 hover:border-blue/30 border border-white/10 px-3 py-1 text-[11px] font-medium text-ink-2 hover:text-white transition-all disabled:opacity-50"
              >
                {p}
              </button>
            ))}
          </div>

          {/* Mesaj Giriş Barı */}
          <div className="p-3.5 border-t border-white/10 bg-[#060918]">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Örnek: 1 temmuz 1 eylül arasındaki tüketimleri indir..."
                className="flex-1 rounded-xl bg-[#090d22] px-4 py-3 text-sm text-white placeholder-ink-3 border border-white/10 outline-none focus:border-blue/50 focus:ring-2 focus:ring-blue/20 transition-all font-medium"
              />
              <button
                type="submit"
                disabled={loading || !inputMessage.trim()}
                className="flex items-center gap-1.5 rounded-xl bg-blue hover:bg-blue/90 disabled:opacity-40 px-5 py-3 text-xs font-black text-white transition-all shadow-md shadow-blue/30"
              >
                <span>Gönder</span>
                <span>→</span>
              </button>
            </form>
          </div>
        </div>

        {/* SAĞ: ÇALIŞMA ALANI (Sekmeli: Terminal, İndirilenler, Manuel) */}
        <div className="space-y-4">
          {/* Sekme Butonları */}
          <div className="clay-pressed flex rounded-2xl p-1 bg-[#050814]">
            <button
              onClick={() => setActiveTab("chat")}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === "chat" ? "bg-blue text-white shadow" : "text-ink-2 hover:text-white"
              }`}
            >
              📟 Terminal
            </button>
            <button
              onClick={() => setActiveTab("downloads")}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === "downloads" ? "bg-blue text-white shadow" : "text-ink-2 hover:text-white"
              }`}
            >
              📁 Dosyalar ({history.length})
            </button>
            <button
              onClick={() => setActiveTab("manual")}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === "manual" ? "bg-blue text-white shadow" : "text-ink-2 hover:text-white"
              }`}
            >
              ⚙️ Parametre
            </button>
          </div>

          {/* TAB 1: Canlı Ajan Terminali */}
          {activeTab === "chat" && (
            <div className="clay p-5 rounded-[28px] bg-[#050711] border border-white/10 space-y-3 font-mono h-[610px] flex flex-col">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                  <span className="text-xs font-bold text-ink-2 uppercase tracking-widest font-sans">
                    Canlı İşlem Konsolu
                  </span>
                </div>
                <button
                  onClick={() => setLogs([])}
                  className="text-[10px] text-ink-3 hover:text-white transition-colors font-sans"
                >
                  Temizle
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs">
                {logs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-ink-3 space-y-1 font-sans">
                    <span>Konsol boş.</span>
                    <span className="text-[11px] opacity-70">Sohbette komut verdiğinizde tüm adımlar burada akar.</span>
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
          )}

          {/* TAB 2: İndirilen Dosyalar */}
          {activeTab === "downloads" && (
            <div className="clay p-5 rounded-[28px] bg-[#080b18]/90 border border-white/10 h-[610px] flex flex-col">
              <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
                <span className="text-xs font-bold text-white uppercase tracking-wider">İndirilen Raporlar</span>
                <span className="text-[10px] text-ink-3">Son oturum</span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3">
                {history.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-ink-3 space-y-2">
                    <span className="text-3xl opacity-40">📁</span>
                    <p className="text-xs">Henüz indirilmiş rapor yok.</p>
                  </div>
                ) : (
                  history.map((item, idx) => (
                    <div
                      key={idx}
                      className="rounded-2xl bg-[#0c1024] p-3.5 border border-white/10 space-y-2"
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="text-xl">📊</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-white truncate">{item.fileName}</p>
                          <p className="text-[11px] text-ink-3">{item.company}</p>
                          <p className="text-[10px] text-blue font-mono mt-0.5">{item.range}</p>
                        </div>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => triggerBrowserDownload(item.downloadUrl, item.fileName)}
                          className="flex-1 bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs font-bold py-1.5 rounded-lg transition-all"
                        >
                          ⬇️ Tekrar İndir
                        </button>
                        <a
                          href={item.downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-ink-2"
                          title="S3 Doğrudan Linki"
                        >
                          🔗
                        </a>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 3: Manuel Parametre Formu */}
          {activeTab === "manual" && (
            <div className="clay p-5 rounded-[28px] bg-[#080b18]/90 border border-white/10 h-[610px] flex flex-col justify-between">
              <div className="space-y-4">
                <div className="border-b border-white/10 pb-3">
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Manuel İndirme Parametreleri
                  </span>
                  <p className="text-[11px] text-ink-3 mt-0.5">Sohbet haricinde doğrudan parametreyle indirin.</p>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="text-[11px] font-bold text-ink-3 mb-1 block">Hedef Hastane</label>
                    <select
                      value={selectedHospital}
                      onChange={(e) => setSelectedHospital(e.target.value as "bursa" | "basaksehir")}
                      className="w-full rounded-xl bg-[#050814] p-3 text-white border border-white/10 outline-none focus:border-blue/50"
                    >
                      <option value="bursa">Diacore Diagnostik - Bursa PPP (226)</option>
                      <option value="basaksehir">Diacore Diagnostik - Başakşehir PPP (259)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-ink-3 mb-1 block">Başlangıç Tarihi</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full rounded-xl bg-[#050814] p-3 text-white border border-white/10 outline-none focus:border-blue/50"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-ink-3 mb-1 block">Bitiş Tarihi</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full rounded-xl bg-[#050814] p-3 text-white border border-white/10 outline-none focus:border-blue/50"
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={handleManualExport}
                disabled={loading}
                className="w-full rounded-xl bg-gradient-to-r from-blue to-indigo-600 hover:from-blue/90 hover:to-indigo-500 p-3.5 text-xs font-black text-white transition-all shadow-lg shadow-blue/20 disabled:opacity-50"
              >
                {loading ? "İndirme Hazırlanıyor..." : "Tüketim Excel Dosyasını Doğrudan İndir ⬇️"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
