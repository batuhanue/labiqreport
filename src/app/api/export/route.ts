import { promises as fs } from "fs";
import path from "path";
import { bad, handle } from "@/lib/api";
import { buildWorkbook } from "@/lib/excel";
import { normalizePeriod, PERIOD_RE } from "@/lib/period";
import type { PeriodData } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Gönderilen dönem verisiyle Excel şablonunu doldurup indirir. */
export async function POST(req: Request) {
  const body = (await req.json()) as PeriodData;
  if (!body?.period || !PERIOD_RE.test(body.period)) return bad("Geçersiz dönem");
  return handle(async () => {
    const tpl = await fs.readFile(path.join(process.cwd(), "templates", "kontrol-sablonu.xlsx"));
    const out = await buildWorkbook(tpl, normalizePeriod(body));
    const name = `LabIQ_Diacore_Raporlama_${body.period}.xlsx`;
    return new Response(Buffer.from(out), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
