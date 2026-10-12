import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { claude, claudeConfigured, costUsd, friendlyError, recordUsage } from "./claude";
import {
  COMPANIES,
  downloadConsumptionReport,
  ensureSession,
  getLabiqStatus,
  switchCompany,
  type CompanyKey,
  type ExportResult,
} from "./labiq";

const LABIQ_SYSTEM_PROMPT = `Sen, kullanıcının yetkili LabIQ / Diacore stok, cihaz, personel, verimlilik ve maliyet arayüzündeki verileri yöneten, analiz eden ve raporlayan uzman **LabIQ Kurumsal Veri & Canlı Operasyon Ajanı**sın.

Bu sistemde şu iki ana hastane mevcuttur:
1. **Diacore Diagnostik - Bursa PPP** (ID: 226, kod: "bursa")
2. **Diacore Diagnostik - Başakşehir PPP** (ID: 259, kod: "basaksehir")

## Temel Protokol ve Güvenlik İlkeleri
- **Varsayılan Hak:** READ_ONLY. Veri okuma, durum sorgulama, hastane değiştirme ve rapor dışa aktarma (Excel export) görevlerini doğrudan yerine getirirsin.
- **Metrik Güvenliği:**
  - Giriş ≠ Kullanım ≠ Transfer ≠ İade ≠ İmha
  - Sipariş ≠ Mal kabul ≠ Fiili tüketim
  - Stok miktarı (kutu/paket) ≠ Toplam miktar (test/adet)
  - Kritik stok ≠ Fazla stok ≠ Riskli stok
  - Boş ekran veya filtre uygulanmamış sonuç sıfır (0) kabul edilmez.
- **Pratik Rapor Tarifleri (R01–R12):**
  - R01: Stok Hareket Raporu (dönemsel giriş-çıkış-iade-imha dökümü)
  - R02: Stok Gözlem & Stok Ekstresi (anlık stok ve ürün geçmişi)
  - R03: Miadı Yaklaşan Ürünler & Depo Gözlem
  - R04: Tüketim Analiz Raporu & Tüketim Takibi (dönemsel tüketim kıyası)
  - R05: Stok Yeterlilik Analizi (hedef gün karşılama süresi)
  - R06: Fazla Stok Analizi & Riskli Stok Raporu (transfer önerileri)
  - R07: Cihaz Bakım/Kalibrasyon & Servis Performans Raporu
  - R08: Test Verimlilik Raporu (tüketim vs üretilen sonuç, verimlilik %)
  - R09: Maliyet Gösterge Paneli & CPR Anomali Raporu (sonuç başı maliyet)
  - R10: Stok Maliyet Raporu (giriş faturası, sözleşme birim fiyatı)
  - R11: İmha Raporu
  - R12: Tedarikçi Sözleşmeleri & Sipariş Formları karşılaştırması

## Görev Yürütme ve Araç Kullanımı
Kullanıcı senden bir işlem (tüketim indirme, hastane değiştirme, durum sorgulama) istediğinde elindeki araçları tereddüt etmeden kullan:
1. Kullanıcı belirli bir hastane için tüketim istediğinde (veya genel tüketim istediğinde) 'labiq_download_consumption' aracını çalıştır.
2. Kullanıcı hastane değiştirmek istediğinde 'labiq_switch_company' aracını çalıştır.
3. Kullanıcı durum veya bilgi sorduğunda 'labiq_get_status' veya 'labiq_screen_guide' kullan.
4. Yanıtlarını zengin, şık Markdown formatında; net başlıklar, KPI maddeleri ve açıklayıcı özetlerle sun.`;

const LABIQ_TOOLS: Anthropic.Tool[] = [
  {
    name: "labiq_download_consumption",
    description:
      "LabIQ sistemine bağlanarak seçilen hastane ve tarih aralığı için Ürün Tüketim Excel (.xlsx) raporunu oluşturur ve indirir. ActionCable WebSocket üzerinden anında hazır dosyayı yakalar.",
    input_schema: {
      type: "object",
      properties: {
        company: {
          type: "string",
          enum: ["bursa", "basaksehir"],
          description: "Hedef hastane: 'bursa' (Bursa PPP 226) veya 'basaksehir' (Başakşehir PPP 259). Belirtilmezse mevcut aktif hastane kullanılır.",
        },
        startDate: {
          type: "string",
          description: "Başlangıç tarihi (YYYY-MM-DD formatında, örn: '2026-07-01')",
        },
        endDate: {
          type: "string",
          description: "Bitiş tarihi (YYYY-MM-DD formatında, örn: '2026-09-01')",
        },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "labiq_switch_company",
    description: "LabIQ oturumundaki aktif hastaneyi değiştirir: Bursa PPP (226) veya Başakşehir PPP (259).",
    input_schema: {
      type: "object",
      properties: {
        company: {
          type: "string",
          enum: ["bursa", "basaksehir"],
          description: "Geçilmek istenen hastane",
        },
      },
      required: ["company"],
    },
  },
  {
    name: "labiq_get_status",
    description: "LabIQ canlı oturum durumunu, aktif seçili hastaneyi ve kullanıcı bilgilerini döndürür.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "labiq_screen_guide",
    description:
      "LabIQ'daki 56 ekran, navigasyon yolları, filtreler ve R01-R12 rapor tarifleri hakkında tam teknik rehber bilgisini getirir.",
    input_schema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Konu veya modül adı (örn: 'stok', 'tüketim', 'cihaz', 'maliyet', 'verimlilik', 'R01', 'R05', 'R08')",
        },
      },
      required: ["topic"],
    },
  },
];

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentExecutionResult {
  reply: string;
  toolCalls: { name: string; input: Record<string, unknown>; result: Record<string, unknown> }[];
  exportResult?: ExportResult;
  status: ReturnType<typeof getLabiqStatus>;
  logs: { text: string; time: string; type: "info" | "success" | "warn" }[];
}

/**
 * LabIQ AI Ajanı — Claude Haiku modeliyle tam bağlamlı ve araç destekli sohbet yürütür.
 */
export async function runLabiqAgentChat(
  history: ChatMessage[],
  incomingMessage: string,
  preferredCompany?: CompanyKey
): Promise<AgentExecutionResult> {
  const logs: { text: string; time: string; type: "info" | "success" | "warn" }[] = [];
  const addLog = (text: string, type: "info" | "success" | "warn" = "info") => {
    logs.push({ text, time: new Date().toLocaleTimeString("tr-TR"), type });
  };

  const toolCalls: AgentExecutionResult["toolCalls"] = [];
  let exportResult: ExportResult | undefined;

  // 1. Oturumu garanti et
  await ensureSession();
  const currentStatus = getLabiqStatus();

  // 2. Claude API yapılandırılmış mı?
  if (!claudeConfigured()) {
    // API Key yoksa akıllı deterministik fallback
    addLog("Claude API anahtarı tanımlı değil, yerel ayrıştırıcı motoru çalıştırılıyor...", "warn");
    const { parseAgentCommand } = await import("./labiq");
    const parsed = parseAgentCommand(incomingMessage);

    if (parsed.action === "switch_company" && parsed.company) {
      addLog(`${parsed.company.toUpperCase()} hastanesine geçiliyor...`, "info");
      const sw = await switchCompany(parsed.company);
      return {
        reply: `**LabIQ Ajanı:** ${sw.company} hastanesine başarıyla geçiş yapıldı.`,
        toolCalls,
        status: getLabiqStatus(),
        logs,
      };
    }

    if (parsed.action === "export_consumption") {
      addLog(`Rapor indiriliyor: ${parsed.startDate} → ${parsed.endDate}...`, "info");
      const exp = await downloadConsumptionReport({
        company: parsed.company || preferredCompany,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
      });
      exportResult = exp;
      return {
        reply: exp.ok
          ? `**Rapor Hazır!** 🎉\n\n- **Dosya:** \`${exp.fileName}\`\n- **Hastane:** ${exp.company}\n- **Dönem:** ${exp.range}\n\nDosya indirme işlemi başlatıldı.`
          : `**Hata:** ${exp.error}`,
        toolCalls,
        exportResult,
        status: getLabiqStatus(),
        logs,
      };
    }

    return {
      reply: `**LabIQ Ajanı:** İsteğinizi aldım. Örn: *"1 temmuz 1 eylül arasındaki tüketimleri indir"* veya *"Başakşehir hastanesine geç"* diyebilirsiniz.`,
      toolCalls,
      status: getLabiqStatus(),
      logs,
    };
  }

  // 3. Claude Haiku ile agentic tool loop
  addLog("Claude Haiku ajanı sorguyu inceliyor...", "info");
  const ai = claude();
  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-5-5";

  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    })),
    {
      role: "user",
      content: incomingMessage,
    },
  ];

  try {
    const t0 = Date.now();
    let currentResponse = await ai.messages.create({
      model,
      max_tokens: 1500,
      system: `${LABIQ_SYSTEM_PROMPT}\n\nŞU ANKİ DURUM: Aktif hastane: ${currentStatus.companyLabel} (${currentStatus.companyId}), Kullanıcı: ${currentStatus.user}.`,
      tools: LABIQ_TOOLS,
      messages,
    });

    let rounds = 0;
    while (currentResponse.stop_reason === "tool_use" && rounds < 4) {
      rounds++;
      const toolUseBlocks = currentResponse.content.filter((b) => b.type === "tool_use");
      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        if (block.type !== "tool_use") continue;
        const input = block.input as Record<string, unknown>;
        addLog(`🔧 Ajan aracı çalıştırılıyor: ${block.name}...`, "info");

        let resObj: Record<string, unknown> = {};

        if (block.name === "labiq_download_consumption") {
          const comp = (input.company as CompanyKey) || preferredCompany;
          const start = String(input.startDate || "2026-07-01");
          const end = String(input.endDate || "2026-09-01");

          addLog(`📥 Tüketim raporu hazırlanıyor (${start} → ${end})...`, "info");
          const exp = await downloadConsumptionReport({
            company: comp,
            startDate: start,
            endDate: end,
          });

          exportResult = exp;
          if (exp.ok) {
            addLog(`✅ Dosya hazır: ${exp.fileName}`, "success");
            resObj = {
              basarili: true,
              dosyaAdi: exp.fileName,
              hastane: exp.company,
              tarihAraligi: exp.range,
              indirmeBaglantisi: exp.downloadUrl,
            };
          } else {
            addLog(`⚠️ Dışa aktarma hatası: ${exp.error}`, "warn");
            resObj = { basarili: false, hata: exp.error };
          }
        } else if (block.name === "labiq_switch_company") {
          const comp = input.company as CompanyKey;
          addLog(`🏥 Hastane değiştiriliyor: ${comp.toUpperCase()}...`, "info");
          const sw = await switchCompany(comp);
          if (sw.ok) {
            addLog(`✅ Hastane seçildi: ${sw.company}`, "success");
            resObj = { basarili: true, yeniHastane: sw.company };
          } else {
            addLog(`⚠️ Geçiş hatası: ${sw.error}`, "warn");
            resObj = { basarili: false, hata: sw.error };
          }
        } else if (block.name === "labiq_get_status") {
          resObj = { durum: getLabiqStatus(), hastaneler: COMPANIES };
        } else if (block.name === "labiq_screen_guide") {
          resObj = {
            rehber: `LabIQ modülleri: Stok, Cihaz, Personel, Verimlilik, Maliyet. İlgili ekranlar için R01-R12 reçeteleri geçerlidir. Aktif hastane: ${currentStatus.companyLabel}`,
          };
        }

        toolCalls.push({ name: block.name, input, result: resObj });
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(resObj),
        });
      }

      // Tool sonuçlarıyla Claude'a dön
      messages.push({ role: "assistant", content: currentResponse.content });
      messages.push({ role: "user", content: toolResultBlocks });

      currentResponse = await ai.messages.create({
        model,
        max_tokens: 1500,
        system: LABIQ_SYSTEM_PROMPT,
        tools: LABIQ_TOOLS,
        messages,
      });
    }

    // Nihai metin cevabını birleştir
    const replyText = currentResponse.content
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n")
      .trim();

    // Kullanım kaydı
    recordUsage({
      at: new Date().toISOString(),
      model,
      rounds,
      prompt: currentResponse.usage.input_tokens,
      cached: 0,
      written: 0,
      output: currentResponse.usage.output_tokens,
      cost: costUsd(model, {
        input: currentResponse.usage.input_tokens,
        cacheRead: 0,
        cacheWrite: 0,
        output: currentResponse.usage.output_tokens,
      }),
      ms: Date.now() - t0,
      label: "⚡ LabIQ AI Ajanı",
    });

    addLog("Ajan cevabı hazırlandı.", "success");

    return {
      reply: replyText || "İşlem tamamlandı.",
      toolCalls,
      exportResult,
      status: getLabiqStatus(),
      logs,
    };
  } catch (err) {
    addLog(`Hata: ${(err as Error).message}`, "warn");
    return {
      reply: `**LabIQ Ajanı:** İşlem sırasında bir hata oluştu: ${friendlyError(err)}`,
      toolCalls,
      status: getLabiqStatus(),
      logs,
    };
  }
}
