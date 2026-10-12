import { NextResponse } from "next/server";
import { runLabiqAgentChat, type ChatMessage } from "@/lib/labiq-agent";
import type { CompanyKey } from "@/lib/labiq";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const message = String(body.message ?? "").trim();
    const history = (body.history ?? []) as ChatMessage[];
    const company = body.company as CompanyKey | undefined;

    if (!message) {
      return NextResponse.json({ ok: false, error: "Mesaj boş olamaz" }, { status: 400 });
    }

    const result = await runLabiqAgentChat(history, message, company);

    return NextResponse.json({
      ok: true,
      reply: result.reply,
      toolCalls: result.toolCalls,
      exportResult: result.exportResult,
      status: result.status,
      logs: result.logs,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message || "Bilinmeyen sunucu hatası" },
      { status: 500 }
    );
  }
}
