import { NextResponse } from "next/server";
import { buildContext, GEMINI_MODEL, loadKnowledge, systemPrompt } from "@/lib/assistant";
import { bad } from "@/lib/api";
import { PERIOD_RE } from "@/lib/period";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Msg {
  role: "user" | "assistant";
  text: string;
}
interface Img {
  mime: string;
  data: string; // base64
  label: string;
}

/** GET: yapılandırma durumu (anahtar var mı, model) */
export async function GET() {
  return NextResponse.json({ configured: !!process.env.GEMINI_API_KEY, model: GEMINI_MODEL });
}

/** POST: soruyu bağlamla birlikte Gemini'ye gönderir, yanıtı düz metin akışı olarak döndürür. */
export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return bad("GEMINI_API_KEY tanımlı değil. Vercel → Settings → Environment Variables'a ekleyin.", 503);

  const body = (await req.json().catch(() => null)) as { messages?: Msg[]; period?: string; images?: Img[]; deep?: boolean } | null;
  const messages = (body?.messages ?? []).filter((x) => x.text?.trim()).slice(-20);
  if (!messages.length || messages[messages.length - 1].role !== "user") return bad("Soru boş");
  const period = body?.period && PERIOD_RE.test(body.period) ? body.period : null;
  const images = (body?.images ?? []).filter((x) => /^image\/(png|jpeg|webp)$/.test(x.mime) && x.data.length < 2_500_000).slice(0, 8);

  let system: string;
  try {
    const [k, ctx] = await Promise.all([loadKnowledge(), buildContext(period)]);
    system = systemPrompt(k, ctx);
  } catch (e) {
    return bad(`Bağlam hazırlanamadı: ${e instanceof Error ? e.message : e}`, 500);
  }

  const contents = messages.map((x, i) => {
    const parts: Record<string, unknown>[] = [{ text: x.text.slice(0, 20000) }];
    if (i === messages.length - 1 && images.length) {
      for (const im of images) {
        parts.push({ text: `[El yazısı not görüntüsü: ${im.label}]` });
        parts.push({ inline_data: { mime_type: im.mime, data: im.data } });
      }
    }
    return { role: x.role === "assistant" ? "model" : "user", parts };
  });

  const upstream = await fetch(`${process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com"}/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents,
      // Gemini 3: temperature/top_p kullanılmaz; düşünme seviyesi thinkingLevel ile
      generationConfig: { thinkingConfig: { thinkingLevel: body?.deep ? "high" : "low" }, maxOutputTokens: 8192 },
    }),
    signal: req.signal,
  }).catch((e) => e as Error);

  if (upstream instanceof Error) return bad(`Gemini'ye ulaşılamadı: ${upstream.message}`, 502);
  if (!upstream.ok || !upstream.body) {
    const t = await upstream.text().catch(() => "");
    let msg = t;
    try {
      msg = JSON.parse(t).error?.message ?? t;
    } catch {}
    return bad(`Gemini hatası (${upstream.status}): ${msg.slice(0, 400)}`, 502);
  }

  // SSE → düz metin akışı (düşünce parçaları atlanır)
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buf = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith("data:")) continue;
            const json = line.slice(5).trim();
            if (!json || json === "[DONE]") continue;
            try {
              const ev = JSON.parse(json);
              const parts = ev.candidates?.[0]?.content?.parts ?? [];
              for (const p of parts) if (p.text && !p.thought) controller.enqueue(enc.encode(p.text));
              const reason = ev.candidates?.[0]?.finishReason;
              if (reason && reason !== "STOP" && reason !== "MAX_TOKENS") controller.enqueue(enc.encode(`\n\n_(yanıt durduruldu: ${reason})_`));
            } catch {}
          }
        }
      } catch {
        // istemci iptal etti
      } finally {
        controller.close();
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Model": GEMINI_MODEL } });
}
