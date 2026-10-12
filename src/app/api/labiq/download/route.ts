import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url");
    const name = searchParams.get("name") || "LabIQ_Urun_Kullanim.xlsx";

    if (!url) {
      return NextResponse.json({ error: "URL parametresi eksik" }, { status: 400 });
    }

    const res = await fetch(url);
    if (!res.ok) {
      return NextResponse.json({ error: "Dosya indirilemedi" }, { status: res.status });
    }

    const arrayBuffer = await res.arrayBuffer();
    const encodedName = encodeURIComponent(name);

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
