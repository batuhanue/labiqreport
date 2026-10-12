import { NextResponse } from "next/server";
import {
  COMPANIES,
  downloadConsumptionReport,
  ensureSession,
  getLabiqStatus,
  labiqLogin,
  parseAgentCommand,
  switchCompany,
  type CompanyKey,
} from "@/lib/labiq";

export const maxDuration = 60; // 60 seconds timeout for serverless/long requests

export async function GET() {
  await ensureSession();
  const status = getLabiqStatus();
  return NextResponse.json({
    status,
    companies: COMPANIES.map((c) => ({ id: c.id, label: c.label, short: c.short })),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body.action;

    // 1. Giriş kontrolü / Login
    if (action === "login") {
      const res = await labiqLogin();
      return NextResponse.json(res);
    }

    // 2. Şirket Değiştirme
    if (action === "switch") {
      const companyKey = body.company as CompanyKey;
      if (!companyKey) {
        return NextResponse.json({ ok: false, error: "Şirket belirtilmedi" }, { status: 400 });
      }
      const res = await switchCompany(companyKey);
      return NextResponse.json({
        ...res,
        status: getLabiqStatus(),
      });
    }

    // 3. Tüketim Raporu İndirme
    if (action === "export") {
      const { company, startDate, endDate } = body;
      const res = await downloadConsumptionReport({
        company: company as CompanyKey | undefined,
        startDate,
        endDate,
      });
      return NextResponse.json(res);
    }

    // 4. Doğal Dil Komutu (AI Ajan Konsolu)
    if (action === "command" || body.command) {
      const cmd = String(body.command ?? "").trim();
      if (!cmd) {
        return NextResponse.json({ ok: false, error: "Komut girilmedi" }, { status: 400 });
      }

      const parsed = parseAgentCommand(cmd);

      // Log adımları (kullanıcıya canlı geri bildirim için)
      const logs: { text: string; time: string; type: "info" | "success" | "warn" }[] = [];
      const addLog = (text: string, type: "info" | "success" | "warn" = "info") => {
        logs.push({ text, time: new Date().toLocaleTimeString("tr-TR"), type });
      };

      addLog(`Komut alındı: "${cmd}"`);
      addLog(`Hedef: ${parsed.summary}`);

      // Durum kontrolü
      if (parsed.action === "status") {
        await ensureSession();
        const curStatus = getLabiqStatus();
        addLog(`Mevcut Şirket: ${curStatus.companyLabel}`, "success");
        return NextResponse.json({
          ok: true,
          action: "status",
          summary: parsed.summary,
          logs,
          status: curStatus,
        });
      }

      // Şirket değiştirme
      if (parsed.action === "switch_company") {
        addLog(`${parsed.company === "bursa" ? "Bursa PPP" : "Başakşehir PPP"} seçiliyor...`);
        const sw = await switchCompany(parsed.company!);
        if (!sw.ok) {
          addLog(`Hata: ${sw.error}`, "warn");
          return NextResponse.json({ ok: false, error: sw.error, logs });
        }
        addLog(`Şirket başarıyla değiştirildi: ${sw.company}`, "success");
        return NextResponse.json({
          ok: true,
          action: "switch_company",
          company: sw.company,
          logs,
          status: getLabiqStatus(),
        });
      }

      // Tüketim indirme
      if (parsed.action === "export_consumption") {
        // İstenen şirket varsa ve aktif olandan farklıysa değiştir
        if (parsed.company) {
          addLog(`${parsed.company === "bursa" ? "Bursa PPP" : "Başakşehir PPP"} şirketine geçiliyor...`);
        }
        addLog(`LabIQ ürün tüketim verileri taranıyor (${parsed.startDate} → ${parsed.endDate})...`);
        addLog(`Asenkron raporlama motoru başlatıldı (Turbo Streams)...`);

        const exp = await downloadConsumptionReport({
          company: parsed.company,
          startDate: parsed.startDate,
          endDate: parsed.endDate,
        });

        if (!exp.ok) {
          addLog(`Hata oluştu: ${exp.error}`, "warn");
          return NextResponse.json({ ok: false, error: exp.error, logs });
        }

        addLog(`Dosya hazırlandı: ${exp.fileName}`, "success");
        addLog(`İndirme bağlantısı sağlandı.`, "success");

        return NextResponse.json({
          ok: true,
          action: "export_consumption",
          summary: parsed.summary,
          downloadUrl: exp.downloadUrl,
          fileName: exp.fileName,
          company: exp.company,
          range: exp.range,
          logs,
          status: getLabiqStatus(),
        });
      }

      return NextResponse.json({
        ok: false,
        error: "Komut anlaşılamadı. Lütfen örneğin '1 temmuz 1 eylül arasındaki tüketimleri indir' şeklinde deneyin.",
        logs,
      });
    }

    return NextResponse.json({ ok: false, error: "Bilinmeyen işlem" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
