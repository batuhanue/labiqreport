import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { search } from "./archive";
import { ASSISTANT_MODEL, claude, claudeConfigured, costUsd, friendlyError, recordUsage } from "./claude";
import { store } from "./db";
import { COMPANIES, downloadConsumptionReport, getLabiqStatus, parseAgentCommand, switchCompany, type CompanyKey, type ExportResult } from "./labiq";
import { openPage, siteMap, type Params } from "./labiq-browse";
import { exportReport, listTables, tableQuery, type QueryInput } from "./labiq-data";
import { agentPrompt, screenGuide } from "./labiq-docs";

/*
 * LabIQ ajanı: eğitim paketindeki promptla çalışan, LabIQ'da bir kullanıcı gibi gezinen ajan.
 * Site haritasından sayfayı bulur, filtre formunu okuyup filtre uygular, tabloyu okur ya da raporu dışa aktarır;
 * inen Excel tabloya çevrilip şirket verisi klasörüne kaydedilir ve gerçek hesapla (süz/grupla/topla) sorgulanır.
 * Salt-okunur: yazma/düzenleme sayfaları araç düzeyinde engellidir.
 */

const ADAPTER = `## BU ORTAMDA NASIL ÇALIŞIRSIN (araç eşlemesi — yukarıdaki promptu bu araçlarla uygula)
Tarayıcın yok; LabIQ'ya sunucu üzerinden, kullanıcının oturumuyla, sayfanın HTML'ini okuyarak erişirsin.
- NAVIGATE → labiq_sitemap (menüdeki sayfalar ve adresleri) → labiq_open_page(path). Sayfa başlığını (title) hedefle karşılaştır.
- APPLY_FILTERS → labiq_open_page'in döndürdüğü forms[].fields alan ADLARIYLA params ver; seçmeli alanlarda option VALUE'sunu kullan. "Filtrele"ye basmak = aynı sayfayı params ile yeniden açmak. Sonuçta title / totalHint / notices / tablo ile filtrenin gerçekten uygulandığını doğrula. Tarih aralığı alanının biçimini placeholder ya da mevcut değerden çıkar (ör. "2026-09-01 to 2026-09-30").
- EXTRACT A (Dışa Aktar) → labiq_export(page, params): dosyayı indirir, tabloya çevirir, şirket verisi klasörüne kaydeder ve tableId döner. Büyük tablolar için tercih et.
- EXTRACT B → dışa aktarma yoksa labiq_open_page ile pagination'daki sayfaları (params.page) oku.
- HESAP → labiq_table_query(tableId, where/groupBy/sum/avg/sort). Toplam, ortalama, ilk-10, kırılım gibi her sayıyı bu araçla hesapla; asla kafadan toplama.
- Ekran bilgisi (filtreler, kolonlar, tuzaklar) → labiq_screen_guide(konu). Bilmediğin ekranda önce buna bak.
- Bilinen adres: Ürün Kullanım / tüketim dışa aktarma = labiq_export(exportUrl="/product_consumptions/export_excel", params={"movement_date":"YYYY-AA-GG to YYYY-AA-GG"}).
- Hastane → labiq_switch_company (Bursa PPP / Başakşehir PPP). Önceki indirmeler → labiq_list_tables: aynı rapor+filtre bugün indirildiyse yeniden indirme.
- Uygulamanın şirket verisi ve arşivinde arama → search_company_data. Uygulamadaki dönem kontrol listesi → check_app_period_data.
- Yazma eylemleri (Yeni, Düzenle, Sil, Onayla, İptal, Senkronize, Aktarım…) araç düzeyinde engellidir; deneme, kullanıcıya ne yapılması gerektiğini söyle.
Çalışma bütçen kısa (yaklaşık 50 sn, 12 araç adımı). Önce kısa bir plan yap, gereksiz sayfa açma, aynı sayfayı tekrar tekrar açma. Bitiremezsen: ne yaptığını, hazır tableId'leri ve kalan adımları yaz; kullanıcı "devam" derse labiq_list_tables'tan sürdür.
Yanıt biçimi: promptun 9. bölümü (çok detaylı/denetim isteklerinde tam yapı; basit sorularda kısa ve net). Kaynak zincirini (modül → sayfa → filtre → tableId/dosya) yaz.`;

const TOOLS: Anthropic.Tool[] = [
  { name: "labiq_sitemap", description: "LabIQ menüsündeki sayfalar ve adresleri (grup, ad, path). Hangi rapor hangi adreste, buradan bulunur.", input_schema: { type: "object", properties: { refresh: { type: "boolean", description: "önbelleği yenile" } } } },
  {
    name: "labiq_open_page",
    description:
      "Bir LabIQ sayfasını (isteğe bağlı filtrelerle) açar: başlık, filtre formları (alan adı, etiket, seçenekler), tablolar (ilk 40 satır), toplam kayıt ipucu, sayfalama, sekmeler, dışa aktarma bağlantıları ve 'kayıt bulunamadı' gibi uyarılar.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "sayfa adresi (site haritasından, ör. /stock_movement_reports)" },
        params: { type: "object", description: "filtreler: form alan adı → değer (dizi: çoklu seçim); sayfa için page", additionalProperties: true },
      },
      required: ["path"],
    },
  },
  {
    name: "labiq_export",
    description: "Raporu (filtrelerle) dışa aktarır, Excel/CSV'yi indirir, tabloya çevirir ve şirket verisi klasörüne (aktif hastane · dönem · LabIQ · rapor adı) kaydeder. tableId, sütunlar, satır sayısı ve önizleme döner.",
    input_schema: {
      type: "object",
      properties: {
        page: { type: "string", description: "raporun sayfa adresi (dışa aktarma bağlantısı sayfadan bulunur)" },
        exportUrl: { type: "string", description: "biliniyorsa doğrudan dışa aktarma adresi (open_page'in exports listesinden)" },
        params: { type: "object", description: "sayfadaki filtre alanları", additionalProperties: true },
        period: { type: "string", description: "klasör dönemi YYYY-AA (verilmezse filtre tarihinden)" },
        title: { type: "string", description: "rapor adı (verilmezse sayfa başlığı)" },
      },
    },
  },
  {
    name: "labiq_table_query",
    description: "İndirilen tabloda gerçek hesap: süz (where), grupla (groupBy), topla (sum), ortalama (avg), sırala, sütun seç. Sütun adları kısmi eşleşir. Sayılar Türkçe biçimden (1.234,56) çevrilir.",
    input_schema: {
      type: "object",
      properties: {
        tableId: { type: "string" },
        where: {
          type: "array",
          items: { type: "object", properties: { column: { type: "string" }, op: { type: "string", enum: ["contains", "not_contains", "=", "!=", ">", "<", ">=", "<="] }, value: { type: "string" } }, required: ["column", "value"] },
        },
        groupBy: { type: "array", items: { type: "string" } },
        sum: { type: "array", items: { type: "string" } },
        avg: { type: "array", items: { type: "string" } },
        columns: { type: "array", items: { type: "string" } },
        sort: { type: "object", properties: { column: { type: "string" }, dir: { type: "string", enum: ["asc", "desc"] } } },
        limit: { type: "integer" },
      },
      required: ["tableId"],
    },
  },
  { name: "labiq_list_tables", description: "Daha önce indirilmiş LabIQ tabloları (tableId, rapor, hastane, dönem, filtre, satır, sütunlar).", input_schema: { type: "object", properties: {} } },
  { name: "labiq_screen_guide", description: "Eğitim paketindeki teknik rapordan ekran/rapor bilgisi: menü yolu, filtreler, kolonlar, tuzaklar ve R01–R12 tarifleri.", input_schema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] } },
  { name: "labiq_switch_company", description: "Aktif hastaneyi değiştirir.", input_schema: { type: "object", properties: { company: { type: "string", enum: ["bursa", "basaksehir"] } }, required: ["company"] } },
  { name: "labiq_get_status", description: "LabIQ oturumu ve aktif hastane.", input_schema: { type: "object", properties: {} } },
  { name: "search_company_data", description: "Uygulamadaki şirket verisi ve arşivde arama (önceden indirilmiş LabIQ dosyaları dahil).", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "check_app_period_data", description: "Uygulamadaki dönem kontrol listesinin durumu (YYYY-AA).", input_schema: { type: "object", properties: { period: { type: "string" } }, required: ["period"] } },
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

const clipJson = (o: unknown, n = 14000) => {
  const s = JSON.stringify(o);
  return s.length > n ? `${s.slice(0, n)}…(kısaltıldı; daha dar filtre ya da labiq_table_query kullan)` : s;
};

const LOG: Record<string, (a: Record<string, unknown>) => string> = {
  labiq_sitemap: () => "🗺️ LabIQ menüsü okunuyor…",
  labiq_open_page: (a) => `📄 Sayfa: ${a.path}${a.params && Object.keys(a.params as object).length ? " (filtreli)" : ""}`,
  labiq_export: (a) => `📥 Dışa aktarılıyor: ${a.page ?? a.exportUrl}`,
  labiq_table_query: () => "🧮 Tablo hesaplanıyor…",
  labiq_list_tables: () => "🗂️ İndirilmiş tablolar…",
  labiq_screen_guide: (a) => `📘 Rehber: ${a.topic}`,
  labiq_switch_company: (a) => `🏥 Hastane: ${a.company}`,
  labiq_get_status: () => "🔌 Oturum durumu",
  search_company_data: (a) => `🔎 Şirket verisinde: ${a.query}`,
  check_app_period_data: (a) => `📊 Dönem: ${a.period}`,
};

async function runTool(name: string, a: Record<string, unknown>, onExport: (e: ExportResult) => void): Promise<Record<string, unknown>> {
  switch (name) {
    case "labiq_sitemap": {
      const links = await siteMap({ refresh: !!a.refresh, companyId: getLabiqStatus().companyId });
      return { sayfaSayisi: links.length, sayfalar: links.map((l) => `${l.group ? `${l.group} › ` : ""}${l.label} → ${l.path}`) };
    }
    case "labiq_open_page":
      return { ...(await openPage(String(a.path), (a.params ?? undefined) as Params)) };
    case "labiq_export": {
      const r = await exportReport({ page: a.page ? String(a.page) : undefined, exportUrl: a.exportUrl ? String(a.exportUrl) : undefined, params: (a.params ?? undefined) as Params, period: a.period ? String(a.period) : undefined, title: a.title ? String(a.title) : undefined });
      if (r.ok && r.downloadUrl) onExport({ ok: true, downloadUrl: r.downloadUrl, fileName: r.fileName, company: getLabiqStatus().companyLabel, range: String(a.period ?? "") });
      return { ...r };
    }
    case "labiq_table_query":
      return await tableQuery(String(a.tableId), a as QueryInput);
    case "labiq_list_tables":
      return { tablolar: (await listTables()).map((t) => ({ tableId: t.id, rapor: t.title, hastane: t.hospital, donem: t.period, satir: t.totalRows, sutunlar: t.headers, filtre: t.source.params, indirildi: t.at })) };
    case "labiq_screen_guide":
      return await screenGuide(String(a.topic ?? ""));
    case "labiq_switch_company":
      return { ...(await switchCompany(a.company as CompanyKey)) };
    case "labiq_get_status":
      return { durum: getLabiqStatus(), hastaneler: COMPANIES };
    case "search_company_data": {
      const hits = await search({ query: String(a.query ?? ""), limit: 10 });
      return { sonuclar: hits.map((h) => ({ kaynak: h.source, baslik: h.title, kim: h.who, ozet: h.excerpt.slice(0, 500) })) };
    }
    case "check_app_period_data": {
      const p = await store().getPeriod(String(a.period ?? "")).catch(() => null);
      if (!p) return { mevcut: false, mevcutDonemler: (await store().listPeriods().catch(() => [])).map((x) => x.period) };
      return { mevcut: true, donem: p.period, durum: p.status, bursaIsaretlenen: Object.values(p.items ?? {}).filter((x) => x.bursa != null).length, basaksehirIsaretlenen: Object.values(p.items ?? {}).filter((x) => x.basaksehir != null).length, guncellenme: p.updatedAt };
    }
  }
  return { hata: `Bilinmeyen araç: ${name}` };
}

/**
 * LabIQ ajanıyla sohbet: Claude (Haiku) eğitim paketiyle, araçlarla LabIQ'da gezinir. Süre bütçesi ~52 sn.
 */
export async function runLabiqAgentChat(history: ChatMessage[], incomingMessage: string, preferredCompany?: CompanyKey): Promise<AgentExecutionResult> {
  const logs: AgentExecutionResult["logs"] = [];
  const addLog = (text: string, type: "info" | "success" | "warn" = "info") => logs.push({ text, time: new Date().toLocaleTimeString("tr-TR"), type });
  const toolCalls: AgentExecutionResult["toolCalls"] = [];
  let exportResult: ExportResult | undefined;

  // Claude yoksa: basit yerel komutlar (tüketim indirme, hastane değiştirme)
  if (!claudeConfigured()) {
    const parsed = parseAgentCommand(incomingMessage);
    if (parsed.action === "switch_company" && parsed.company) {
      const sw = await switchCompany(parsed.company);
      return { reply: sw.ok ? `${sw.company} hastanesine geçildi.` : `Hata: ${sw.error}`, toolCalls, status: getLabiqStatus(), logs };
    }
    if (parsed.action === "export_consumption") {
      const exp = await downloadConsumptionReport({ company: parsed.company || preferredCompany, startDate: parsed.startDate, endDate: parsed.endDate });
      return { reply: exp.ok ? `Rapor hazır: ${exp.fileName} (${exp.company}, ${exp.range})` : `Hata: ${exp.error}`, toolCalls, exportResult: exp, status: getLabiqStatus(), logs };
    }
    return { reply: "Claude bağlı değil (ANTHROPIC_API_KEY). Şimdilik yalnızca tüketim indirme ve hastane değiştirme komutlarını anlayabilirim.", toolCalls, status: getLabiqStatus(), logs };
  }

  const t0 = Date.now();
  const deadline = t0 + 52_000;
  const model = process.env.ANTHROPIC_MODEL?.trim() || ASSISTANT_MODEL;
  const usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  let rounds = 0;
  try {
    if (preferredCompany && preferredCompany !== getLabiqStatus().companyKey) {
      const sw = await switchCompany(preferredCompany);
      addLog(sw.ok ? `🏥 Hastane: ${sw.company}` : `⚠️ Hastane değiştirilemedi: ${sw.error}`, sw.ok ? "info" : "warn");
    }
    const st = getLabiqStatus();
    const tables = (await listTables().catch(() => [])).slice(0, 12);
    const system: Anthropic.TextBlockParam[] = [
      { type: "text", text: `${await agentPrompt()}\n\n${ADAPTER}`, cache_control: { type: "ephemeral" } },
      {
        type: "text",
        text: `Bugün: ${new Date().toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "full" })}. Aktif hastane: ${st.companyLabel} (${st.companyKey}). Hastaneler: Bursa PPP (bursa), Başakşehir PPP (basaksehir).${tables.length ? `\nDaha önce indirilen tablolar: ${tables.map((t) => `${t.id} = ${t.title} · ${t.hospital} · ${t.period || "dönemsiz"} · ${t.totalRows} satır · ${t.at.slice(0, 10)}`).join(" | ")}` : ""}`,
      },
    ];
    const messages: Anthropic.MessageParam[] = [...history.slice(-10).map((m) => ({ role: m.role, content: m.content })), { role: "user", content: incomingMessage }];
    addLog("Claude planlıyor…");
    let res: Anthropic.Message | null = null;
    for (;;) {
      const left = deadline - Date.now();
      if (left < 4000) break;
      res = await claude().messages.create({ model, max_tokens: 4096, system, tools: TOOLS, messages }, { timeout: Math.min(30_000, left), maxRetries: 1 });
      rounds++;
      usage.input += res.usage.input_tokens ?? 0;
      usage.cacheRead += res.usage.cache_read_input_tokens ?? 0;
      usage.cacheWrite += res.usage.cache_creation_input_tokens ?? 0;
      usage.output += res.usage.output_tokens ?? 0;
      if (res.stop_reason !== "tool_use" || rounds >= 12) break;
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const b of res.content) {
        if (b.type !== "tool_use") continue;
        const input = (b.input ?? {}) as Record<string, unknown>;
        addLog(LOG[b.name]?.(input) ?? `🔧 ${b.name}`);
        let out: Record<string, unknown>;
        try {
          out = await runTool(b.name, input, (e) => (exportResult = e));
          if (b.name === "labiq_export") addLog(out.ok ? `✅ ${out.fileName} → ${out.folder ?? "kaydedildi"}` : `⚠️ ${out.error}`, out.ok ? "success" : "warn");
        } catch (e) {
          out = { hata: (e as Error).message };
          addLog(`⚠️ ${b.name}: ${(e as Error).message}`, "warn");
        }
        toolCalls.push({ name: b.name, input, result: out });
        results.push({ type: "tool_result", tool_use_id: b.id, content: clipJson(out), is_error: "hata" in out || undefined });
      }
      messages.push({ role: "assistant", content: res.content }, { role: "user", content: results });
    }
    let reply = (res?.content ?? [])
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!res || res.stop_reason === "tool_use") {
      const ready = toolCalls.filter((t) => t.name === "labiq_export" && t.result.ok).map((t) => `${t.result.tableId} (${t.result.fileName})`);
      reply = `${reply ? `${reply}\n\n` : ""}⏱️ Süre doldu; işin bir kısmı tamamlandı.${ready.length ? ` Hazır tablolar: ${ready.join(", ")}.` : ""} Kaldığım yerden sürdürmem için **devam** yaz.`;
    }
    addLog("Yanıt hazır.", "success");
    return { reply: reply || "İşlem tamamlandı.", toolCalls, exportResult, status: getLabiqStatus(), logs };
  } catch (err) {
    addLog(`⚠️ ${friendlyError(err)}`, "warn");
    return { reply: `**LabIQ ajanı yanıt veremedi:** ${friendlyError(err)}`, toolCalls, exportResult, status: getLabiqStatus(), logs };
  } finally {
    if (rounds)
      await recordUsage({
        at: new Date().toISOString(),
        model,
        rounds,
        prompt: usage.input + usage.cacheRead + usage.cacheWrite,
        cached: usage.cacheRead,
        written: usage.cacheWrite,
        output: usage.output,
        cost: costUsd(model, usage),
        ms: Date.now() - t0,
        label: "⚡ LabIQ AI Ajanı",
      });
  }
}
