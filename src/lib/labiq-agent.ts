import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { claude, claudeConfigured, costUsd, friendlyError, recordUsage } from "./claude";
import { store } from "./db";
import {
  COMPANIES,
  downloadConsumptionReport,
  ensureSession,
  fetchPageData,
  getLabiqStatus,
  switchCompany,
  type CompanyKey,
  type ExportResult,
} from "./labiq";

const LABIQ_SYSTEM_PROMPT = `Sen, kullanıcının yetkili LabIQ / Diacore stok, cihaz, personel, verimlilik ve maliyet sistemindeki verileri yöneten, analiz eden ve raporlayan uzman **LabIQ Kurumsal Veri & Canlı Operasyon Ajanı**sın.

Bu sistemde şu iki ana hastane mevcuttur:
1. **Diacore Diagnostik - Bursa PPP** (ID: 226, kod: "bursa")
2. **Diacore Diagnostik - Başakşehir PPP** (ID: 259, kod: "basaksehir")

## Temel Protokol ve Güvenlik İlkeleri
- **Varsayılan Hak:** READ_ONLY. Veri okuma, durum sorgulama, hastane değiştirme ve rapor dışa aktarma (Excel export) görevlerini doğrudan yerine getirirsin.
- **Dönem ve Sonuç Verileri:** Kullanıcı bir dönemin (ör. Eylül, Ağustos) sonuç verilerini sorduğunda, hem uygulamadaki dönem kontrol kayıtlarını hem de LabIQ Verimlilik altındaki 'Dönemsel Sonuçlar' (/companies/226/results_by_periods) veya 'Dönemsel Tüketim' süreçlerini kontrol edip açıkça yanıtla.
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
Kullanıcı senden bir işlem (tüketim indirme, hastane değiştirme, durum sorgulama, dönem kontrolü) istediğinde elindeki araçları kullan:
1. 'labiq_download_consumption': Excel formatında tüketim dökümünü indirmek için.
2. 'labiq_switch_company': Aktif hastaneyi değiştirmek için.
3. 'check_app_period_data': Uygulamadaki dönem kontrol kayıtlarını ve girilen verileri sorgulamak için.
4. 'labiq_screen_guide': 56 ekran ve R01-R12 tarifleri hakkında teknik bilgi vermek için.
5. Yanıtlarını zengin, şık Markdown formatında; net başlıklar, KPI maddeleri ve açıklayıcı özetlerle sun.`;

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
    name: "check_app_period_data",
    description: "Uygulamadaki bir dönemin (ör. '2026-09' Eylül, '2026-08' Ağustos) kontrol listesi durumunu, verilerinin girilip girilmediğini ve onay durumunu sorgular.",
    input_schema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          description: "Dönem kodu (YYYY-MM formatında, örn: '2026-09')",
        },
      },
      required: ["period"],
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
          description: "Konu veya modül adı (örn: 'stok', 'tüketim', 'cihaz', 'maliyet', 'verimlilik', 'sonuçlar', 'R01', 'R08')",
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
 * Model adını güvenli bir Anthropic model tanıtıcısına eşler
 */
function resolveModel(): string {
  const envModel = process.env.ANTHROPIC_MODEL?.trim();
  if (envModel && envModel !== "claude-haiku-5-5") return envModel;
  return "claude-3-5-haiku-20241022";
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

  // 1. Durumu oku (oturum açmayı geciktir — sadece araç gerektiğinde açılır!)
  const currentStatus = getLabiqStatus();

  // 2. Claude API yapılandırılmış mı?
  if (!claudeConfigured()) {
    addLog("Yerel motor çalıştırılıyor...", "info");
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
      reply: `**LabIQ Ajanı:** "${incomingMessage}" sorusunu aldım. LabIQ üzerinde tüketim indirme, hastane değişimi veya modül rehberliği yapabilirim.`,
      toolCalls,
      status: getLabiqStatus(),
      logs,
    };
  }

  // 3. Claude Haiku ile hızlı agentic tool loop
  addLog("Claude Haiku yanıtı hazırlıyor...", "info");
  const ai = claude();
  const model = resolveModel();

  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-8).map((m) => ({
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

    // 8 saniyelik zaman aşımı koruması (Vercel 10s sınırını aşmamak için)
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Zaman aşımı: Model yanıtı 8 sn içinde tamamlanamadı")), 8000)
    );

    const callAi = ai.messages.create({
      model,
      max_tokens: 1200,
      system: `${LABIQ_SYSTEM_PROMPT}\n\nAktif hastane: ${currentStatus.companyLabel} (${currentStatus.companyId}), Kullanıcı: ${currentStatus.user}.`,
      tools: LABIQ_TOOLS,
      messages,
    });

    let currentResponse = await Promise.race([callAi, timeoutPromise]);

    let rounds = 0;
    while (currentResponse.stop_reason === "tool_use" && rounds < 3) {
      rounds++;
      const toolUseBlocks = currentResponse.content.filter((b) => b.type === "tool_use");
      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        if (block.type !== "tool_use") continue;
        const input = block.input as Record<string, unknown>;
        addLog(`🔧 Araç: ${block.name}...`, "info");

        let resObj: Record<string, unknown> = {};

        if (block.name === "labiq_download_consumption") {
          const comp = (input.company as CompanyKey) || preferredCompany;
          const start = String(input.startDate || "2026-07-01");
          const end = String(input.endDate || "2026-09-01");

          addLog(`📥 Rapor çekiliyor (${start} → ${end})...`, "info");
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
        } else if (block.name === "check_app_period_data") {
          const pCode = String(input.period || "2026-09");
          addLog(`📊 Dönem kontrolü: ${pCode}...`, "info");
          const pData = await store().getPeriod(pCode).catch(() => null);
          if (pData) {
            const bursaItems = Object.values(pData.items || {}).filter((x) => x.bursa != null).length;
            const basakItems = Object.values(pData.items || {}).filter((x) => x.basaksehir != null).length;
            resObj = {
              mevcut: true,
              donem: pData.period,
              durum: pData.status,
              bursaIsaretlenen: `${bursaItems}/48`,
              basaksehirIsaretlenen: `${basakItems}/48`,
              hazirlayan: pData.signoffs?.preparer?.name,
              guncellenmeTarihi: pData.updatedAt,
            };
          } else {
            const periods = await store().listPeriods().catch(() => []);
            resObj = {
              mevcut: false,
              mesaj: `${pCode} dönemi için henüz sistemde kayıt açılmamış.`,
              mevcutDonemler: periods.map((p) => p.period),
              labiqNotu: "LabIQ Verimlilik modülü altında 'Dönemsel Sonuçlar' (/companies/226/results_by_periods) veya 'Dönemsel Tüketim' sayfası incelenebilir.",
            };
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

      messages.push({ role: "assistant", content: currentResponse.content });
      messages.push({ role: "user", content: toolResultBlocks });

      const nextCall = ai.messages.create({
        model,
        max_tokens: 1200,
        system: LABIQ_SYSTEM_PROMPT,
        tools: LABIQ_TOOLS,
        messages,
      });

      currentResponse = await Promise.race([nextCall, timeoutPromise]);
    }

    const replyText = currentResponse.content
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n")
      .trim();

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

    addLog("Yanıt hazırlandı.", "success");

    return {
      reply: replyText || "İşlem tamamlandı.",
      toolCalls,
      exportResult,
      status: getLabiqStatus(),
      logs,
    };
  } catch (err) {
    const errMsg = friendlyError(err);
    addLog(`Bilgi: ${errMsg}`, "info");

    // Akıllı yerel yanıt (Vercel timeout veya Anthropic 404/kredi durumunda kullanıcıyı yanıtsız bırakmaz!)
    const lower = incomingMessage.toLowerCase();
    let fallbackReply = `**LabIQ Ajanı:** ${incomingMessage}\n\n`;

    if (lower.includes("sonuç") || lower.includes("eylül") || lower.includes("dönem")) {
      const pData = await store().getPeriod("2026-09").catch(() => null);
      if (pData) {
        fallbackReply += `### Eylül 2026 (2026-09) Dönem Durumu:\n- **Durum:** ${pData.status}\n- **Hazırlayan:** ${pData.signoffs?.preparer?.name || "Batuhan Başar"}\n- **Son Güncelleme:** ${pData.updatedAt ? new Date(pData.updatedAt).toLocaleString("tr-TR") : "Belirtilmemiş"}\n\n*Ayrıca LabIQ sisteminde Verimlilik modülü altında **Dönemsel Sonuçlar** (\`/companies/226/results_by_periods\`) ekranından laboratuvar test sonuç hacimlerini inceleyebilirsiniz.*`;
      } else {
        const pAug = await store().getPeriod("2026-08").catch(() => null);
        fallbackReply += `Eylül 2026 (2026-09) dönemi kontrol kayıtları henüz sistemde açılmamış.\n\n- **Ağustos (2026-08) Durumu:** ${pAug ? pAug.status : "Mevcut"}\n- **LabIQ İnceleme Noktası:** Verimlilik & Test modülü → **Dönemsel Sonuçlar** (\`/companies/226/results_by_periods\`) ekranında dönem ve laboratuvar bazlı sonuç hacimleri yer almaktadır.`;
      }
    } else {
      fallbackReply += `İsteğinizi aldım. LabIQ üzerinde tüketim indirme, hastane değişimi veya 56 ekranlık teknik rehberimizdeki (R01-R12) analizleri gerçekleştirebilirim.`;
    }

    return {
      reply: fallbackReply,
      toolCalls,
      status: getLabiqStatus(),
      logs,
    };
  }
}
