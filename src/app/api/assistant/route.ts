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

const BASE = () => process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
const modelUrl = (method: string) => `${BASE()}/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:${method}`;

async function errorText(r: Response) {
  const t = await r.text().catch(() => "");
  try {
    const j = JSON.parse(t);
    return j.error?.message ?? t;
  } catch {
    return t;
  }
}

/**
 * GET: yapılandırma durumu.
 * GET ?test=1: bağlantı teşhisi — anahtar geçerli mi, model hesapta var mı, küçük bir deneme isteği ne döndürüyor.
 */
export async function GET(req: Request) {
  const key = process.env.GEMINI_API_KEY;
  const configured = !!key;
  if (new URL(req.url).searchParams.get("test") !== "1" || !key) {
    return NextResponse.json({ configured, model: GEMINI_MODEL, keyHint: key ? `${key.slice(0, 4)}…${key.slice(-4)} (${key.length} karakter)` : null });
  }
  const out: Record<string, unknown> = { configured, model: GEMINI_MODEL, keyHint: `${key.slice(0, 4)}…${key.slice(-4)} (${key.length} karakter)` };
  if (key.trim() !== key) out.warning = "Anahtarın başında/sonunda boşluk var — Vercel'de silip yeniden yapıştırın.";

  // 1) modeller
  try {
    const r = await fetch(`${BASE()}/v1beta/models?pageSize=1000`, { headers: { "x-goog-api-key": key.trim() }, cache: "no-store" });
    out.listStatus = r.status;
    if (r.ok) {
      const j = (await r.json()) as { models?: { name: string }[] };
      const names = (j.models ?? []).map((m) => m.name.replace(/^models\//, ""));
      out.modelFound = names.includes(GEMINI_MODEL);
      out.flashModels = names.filter((n) => /flash/i.test(n)).slice(-12);
    } else out.listError = (await errorText(r)).slice(0, 400);
  } catch (e) {
    out.listError = String(e);
  }

  // 2) küçük deneme (akışsız)
  const t0 = Date.now();
  try {
    const r = await fetch(modelUrl("generateContent"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key.trim() },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Bağlantı testi: yalnızca 'Hazırım' yaz." }] }],
        generationConfig: { thinkingConfig: { thinkingLevel: "low" }, maxOutputTokens: 64 },
      }),
      cache: "no-store",
    });
    out.testStatus = r.status;
    out.ms = Date.now() - t0;
    if (r.ok) {
      const j = await r.json();
      out.testText = (j.candidates?.[0]?.content?.parts ?? []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? "").join("");
      out.ok = true;
    } else out.testError = (await errorText(r)).slice(0, 600);
  } catch (e) {
    out.testError = String(e);
  }
  return NextResponse.json(out);
}

/** POST: soruyu bağlamla birlikte Gemini'ye gönderir; yanıtı düz metin akışı (veya stream:false ile tek parça) döndürür. */
export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return bad("GEMINI_API_KEY tanımlı değil. Vercel → Settings → Environment Variables'a ekleyip Redeploy yapın.", 503);

  const body = (await req.json().catch(() => null)) as { messages?: Msg[]; period?: string; images?: Img[]; deep?: boolean; stream?: boolean } | null;
  const messages = (body?.messages ?? []).filter((x) => x.text?.trim()).slice(-20);
  if (!messages.length || messages[messages.length - 1].role !== "user") return bad("Soru boş");
  const period = body?.period && PERIOD_RE.test(body.period) ? body.period : null;
  const images = (body?.images ?? []).filter((x) => /^image\/(png|jpeg|webp)$/.test(x.mime) && x.data.length < 1_500_000).slice(0, 6);
  const streaming = body?.stream !== false;

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

  const payload = JSON.stringify({
    system_instruction: { parts: [{ text: system }] },
    contents,
    // Gemini 3: temperature/top_p kullanılmaz; düşünme seviyesi thinkingLevel ile
    generationConfig: { thinkingConfig: { thinkingLevel: body?.deep ? "high" : "low" }, maxOutputTokens: 8192 },
  });

  // Not: istemcinin iptal sinyali Gemini isteğine bağlanmaz (Vercel'de erken kesmeye yol açabiliyordu).
  const upstream = await fetch(streaming ? modelUrl("streamGenerateContent?alt=sse") : modelUrl("generateContent"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: payload,
    cache: "no-store",
  }).catch((e) => e as Error);

  if (upstream instanceof Error) return bad(`Gemini'ye ulaşılamadı: ${upstream.message}`, 502);
  if (!upstream.ok || !upstream.body) return bad(`Gemini hatası (${upstream.status}): ${(await errorText(upstream)).slice(0, 500)}`, 502);

  const enc = new TextEncoder();
  const metaOf = (u: Record<string, number> | null) =>
    u ? `\u001eMETA${JSON.stringify({ prompt: u.promptTokenCount ?? 0, cached: u.cachedContentTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) })}` : "";
  const textOf = (ev: { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } }) => {
    let t = "";
    for (const p of ev.candidates?.[0]?.content?.parts ?? []) if (p.text && !p.thought) t += p.text;
    const reason = ev.candidates?.[0]?.finishReason;
    if (reason && !["STOP", "MAX_TOKENS", "FINISH_REASON_UNSPECIFIED"].includes(reason)) t += `\n\n_(yanıt durduruldu: ${reason})_`;
    if (ev.promptFeedback?.blockReason) t += `\n\n_(istek engellendi: ${ev.promptFeedback.blockReason})_`;
    return t;
  };

  // akışsız (yedek yol)
  if (!streaming) {
    const j = await upstream.json().catch(() => ({}));
    const text = textOf(j) || "_(boş yanıt)_";
    return new Response(text + metaOf(j.usageMetadata ?? null), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }

  // SSE → düz metin akışı (düşünce parçaları atlanır)
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buf = "";
      let usage: Record<string, number> | null = null;
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
              if (ev.usageMetadata) usage = ev.usageMetadata;
              if (ev.error) controller.enqueue(enc.encode(`\n\n⚠️ Gemini: ${ev.error.message ?? "hata"}`));
              const t = textOf(ev);
              if (t) controller.enqueue(enc.encode(t));
            } catch {}
          }
        }
      } catch (e) {
        controller.enqueue(enc.encode(`\n\n_(bağlantı kesildi: ${e instanceof Error ? e.message : e})_`));
      } finally {
        controller.enqueue(enc.encode(metaOf(usage)));
        controller.close();
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no", "X-Model": GEMINI_MODEL } });
}
