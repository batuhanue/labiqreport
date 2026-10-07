import { NextResponse } from "next/server";
import { buildContext, GEMINI_MODEL, loadKnowledge, systemPrompt } from "@/lib/assistant";
import { bad } from "@/lib/api";
import { PERIOD_RE } from "@/lib/period";
import { getItem, search } from "@/lib/archive";
import { status as googleStatus } from "@/lib/google";
import type { ArchiveSource } from "@/lib/google-types";

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

/** fetch + zaman aşımı: Vercel fonksiyonu öldürmeden önce anlaşılır bir hata döndürebilmek için. */
async function timed(url: string, init: RequestInit, ms: number) {
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(ms) });
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new Error(`Gemini ${Math.round(ms / 1000)} sn içinde yanıt vermedi (zaman aşımı)`);
    throw e;
  }
}

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
    const r = await timed(`${BASE()}/v1beta/models?pageSize=1000`, { headers: { "x-goog-api-key": key.trim() } }, 15000);
    out.listStatus = r.status;
    if (r.ok) {
      const j = (await r.json()) as { models?: { name: string }[] };
      const names = (j.models ?? []).map((m) => m.name.replace(/^models\//, ""));
      out.modelFound = names.includes(GEMINI_MODEL);
      out.flashModels = names.filter((n) => /flash/i.test(n)).slice(-12);
    } else out.listError = (await errorText(r)).slice(0, 400);
  } catch (e) {
    out.listError = e instanceof Error ? e.message : String(e);
  }

  // 2) küçük deneme (akışsız)
  const t0 = Date.now();
  try {
    const r = await timed(
      modelUrl("generateContent"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key.trim() },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Bağlantı testi: yalnızca 'Hazırım' yaz." }] }],
          generationConfig: { thinkingConfig: { thinkingLevel: "low" }, maxOutputTokens: 256 },
        }),
      },
      30000,
    );
    out.testStatus = r.status;
    out.ms = Date.now() - t0;
    if (r.ok) {
      const j = await r.json();
      out.testText = (j.candidates?.[0]?.content?.parts ?? []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? "").join("");
      out.ok = true;
    } else out.testError = (await errorText(r)).slice(0, 600);
  } catch (e) {
    out.ms = Date.now() - t0;
    out.testError = e instanceof Error ? e.message : String(e);
  }
  out.region = process.env.VERCEL_REGION ?? null;
  return NextResponse.json(out);
}

/** POST: soruyu bağlamla birlikte Gemini'ye gönderir; yanıtı düz metin akışı (veya stream:false ile tek parça) döndürür. */
export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return bad("GEMINI_API_KEY tanımlı değil. Vercel → Settings → Environment Variables'a ekleyip Redeploy yapın.", 503);

  const body = (await req.json().catch(() => null)) as { messages?: Msg[]; period?: string; images?: Img[]; deep?: boolean; stream?: boolean; google?: boolean } | null;
  const messages = (body?.messages ?? []).filter((x) => x.text?.trim()).slice(-20);
  if (!messages.length || messages[messages.length - 1].role !== "user") return bad("Soru boş");
  const period = body?.period && PERIOD_RE.test(body.period) ? body.period : null;
  const images = (body?.images ?? []).filter((x) => /^image\/(png|jpeg|webp)$/.test(x.mime) && x.data.length < 1_500_000).slice(0, 6);
  const streaming = body?.stream !== false;

  let system: string;
  try {
    const [k, ctx] = await Promise.all([loadKnowledge(), buildContext(period, { google: body?.google !== false })]);
    system = systemPrompt(k, ctx);
  } catch (e) {
    return bad(`Bağlam hazırlanamadı: ${e instanceof Error ? e.message : e}`, 500);
  }

  const contents: { role: string; parts: Record<string, unknown>[] }[] = messages.map((x, i) => {
    const parts: Record<string, unknown>[] = [{ text: x.text.slice(0, 20000) }];
    if (i === messages.length - 1 && images.length) {
      for (const im of images) {
        parts.push({ text: `[El yazısı not görüntüsü: ${im.label}]` });
        parts.push({ inline_data: { mime_type: im.mime, data: im.data } });
      }
    }
    return { role: x.role === "assistant" ? "model" : "user", parts };
  });

  // Google bağlıysa asistan geçmiş arşivde (e-posta, Chat, Meet transkripti, takvim) arama yapabilir
  const archiveOn = body?.google !== false && !!(await googleStatus("", false).catch(() => null))?.connected;
  const genConfig = { thinkingConfig: { thinkingLevel: body?.deep ? "high" : "low" }, maxOutputTokens: 8192 };
  // Gemini 3: temperature/top_p kullanılmaz; düşünme seviyesi thinkingLevel ile.
  // Sıra (araçlar → sistem → konuşma) örtük önbellek için sabit kalır.
  const payload = () =>
    JSON.stringify({
      ...(archiveOn ? { tools: [{ functionDeclarations: TOOLS }] } : {}),
      system_instruction: { parts: [{ text: system }] },
      contents,
      generationConfig: genConfig,
    });
  const url = streaming ? modelUrl("streamGenerateContent?alt=sse") : modelUrl("generateContent");
  const call = (ms: number) => timed(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: payload() }, ms);

  // Not: istemcinin iptal sinyali Gemini isteğine bağlanmaz (Vercel'de erken kesmeye yol açabiliyordu).
  // Zaman aşımları Vercel'in 60 sn sınırının altında tutulur; böylece bağlantı sessizce kopmak yerine hata mesajı döner.
  const started = Date.now();
  const left = () => 54000 - (Date.now() - started);
  const first = await call(streaming ? 40000 : 50000).catch((e) => e as Error);
  if (first instanceof Error) return bad(`Gemini'ye ulaşılamadı: ${first.message}`, 502);
  if (!first.ok || !first.body) return bad(`Gemini hatası (${first.status}): ${(await errorText(first)).slice(0, 500)}`, 502);

  const usage = { prompt: 0, cached: 0, output: 0 };
  const addUsage = (u?: Record<string, number>) => {
    if (!u) return;
    usage.prompt += u.promptTokenCount ?? 0;
    usage.cached += u.cachedContentTokenCount ?? 0;
    usage.output += (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  };
  const noteOf = (ev: Ev) => {
    const reason = ev.candidates?.[0]?.finishReason;
    let t = "";
    if (reason && !["STOP", "MAX_TOKENS", "FINISH_REASON_UNSPECIFIED"].includes(reason)) t += `\n\n_(yanıt durduruldu: ${reason})_`;
    if (ev.promptFeedback?.blockReason) t += `\n\n_(istek engellendi: ${ev.promptFeedback.blockReason})_`;
    return t;
  };

  /** Bir model turunu okur: metni emit eder, tüm parçaları (araç çağrıları + imzalar dahil) döndürür. */
  async function readRound(res: Response, emit: (s: string) => void) {
    const parts: GPart[] = [];
    let u: Record<string, number> | undefined;
    const onEv = (ev: Ev) => {
      if (ev.usageMetadata) u = ev.usageMetadata;
      if (ev.error) emit(`\n\n⚠️ Gemini: ${ev.error.message ?? "hata"}`);
      for (const p of ev.candidates?.[0]?.content?.parts ?? []) {
        parts.push(p);
        if (p.text && !p.thought) emit(p.text);
      }
      const n = noteOf(ev);
      if (n) emit(n);
    };
    if (!streaming) {
      onEv(await res.json().catch(() => ({})));
      addUsage(u);
      return { parts, timedOut: false };
    }
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let timedOut = false;
    try {
      for (;;) {
        const next = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), Math.max(0, left())))]);
        if (!next) {
          emit("\n\n_(yanıt süre sınırında kesildi — soruyu daraltıp tekrar dene)_");
          reader.cancel().catch(() => {});
          timedOut = true;
          break;
        }
        if (next.done) break;
        buf += dec.decode(next.value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json || json === "[DONE]") continue;
          try {
            onEv(JSON.parse(json));
          } catch {}
        }
      }
    } catch (e) {
      emit(`\n\n_(bağlantı kesildi: ${e instanceof Error ? e.message : e})_`);
      timedOut = true;
    }
    addUsage(u);
    return { parts, timedOut };
  }

  /** Araç çağrılarını (en fazla 4 tur) yürütüp son yanıta kadar ilerler. */
  async function converse(emit: (s: string) => void) {
    let res = first as Response;
    for (let round = 0; ; round++) {
      const { parts, timedOut } = await readRound(res, emit);
      const calls = parts.filter((p) => p.functionCall);
      if (!calls.length || timedOut) break;
      if (round >= 4 || left() < 9000) {
        emit("\n\n_(arama turu sınırına ulaşıldı)_");
        break;
      }
      contents.push({ role: "model", parts });
      const responses: Record<string, unknown>[] = [];
      for (const c of calls) {
        const fc = c.functionCall!;
        emit(`\u001fS${statusOf(fc)}\u001f`);
        const response = await runTool(fc).catch((e) => ({ hata: e instanceof Error ? e.message : String(e) }));
        responses.push({ functionResponse: { ...(fc.id ? { id: fc.id } : {}), name: fc.name, response } });
      }
      contents.push({ role: "user", parts: responses });
      const next = await call(Math.min(40000, left())).catch((e) => e as Error);
      if (next instanceof Error || !next.ok || !next.body) {
        emit(`\n\n⚠️ Gemini: ${next instanceof Error ? next.message : `HTTP ${next.status} ${(await errorText(next)).slice(0, 300)}`}`);
        break;
      }
      res = next;
    }
  }
  const meta = () => `\u001eMETA${JSON.stringify(usage)}`;

  // akışsız (yedek yol)
  if (!streaming) {
    let text = "";
    await converse((s) => (text += s));
    if (!text.replace(/\u001f[^\u001f]*\u001f/g, "").trim()) text += "_(boş yanıt)_";
    return new Response(text + meta(), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }

  // SSE → düz metin akışı (düşünce parçaları atlanır; \u001fS…\u001f = durum satırı)
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await converse((s) => controller.enqueue(enc.encode(s)));
      } catch (e) {
        controller.enqueue(enc.encode(`\n\n_(bağlantı kesildi: ${e instanceof Error ? e.message : e})_`));
      } finally {
        controller.enqueue(enc.encode(meta()));
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no", "X-Model": GEMINI_MODEL } });
}

// ------------------------------------------------------------------ araçlar
type GPart = { text?: string; thought?: boolean; thoughtSignature?: string; functionCall?: { id?: string; name: string; args?: Record<string, unknown> } };
type Ev = {
  candidates?: { content?: { parts?: GPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: Record<string, number>;
  error?: { message?: string };
};

const SOURCE_ENUM = ["gmail", "chat", "meet", "calendar"];
const TOOLS = [
  {
    name: "search_archive",
    description:
      "Batuhan'ın Google Workspace arşivinde (geçmiş tüm e-postalar, Google Chat mesajları, Meet toplantı transkriptleri, takvim etkinlikleri) arama yapar. " +
      "Geçmişe dönük her soruda (kim ne dedi, ne zaman konuşuldu, hangi e-posta geldi, toplantıda ne kararlaştırıldı) kullan. " +
      "query boş bırakılıp tarih aralığı verilirse o aralıktaki kayıtları en yeniden eskiye listeler. Gerekirse farklı kelimelerle birden çok kez ara.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Anahtar kelimeler (kişi adı, konu, kod, ürün vb.). Türkçe ekler sorun değil." },
        source: { type: "string", enum: SOURCE_ENUM, description: "Yalnızca bu kaynakta ara (isteğe bağlı)." },
        after: { type: "string", description: "Bu tarihten sonra (YYYY-MM-DD)." },
        before: { type: "string", description: "Bu tarihten önce/dahil (YYYY-MM-DD)." },
        limit: { type: "integer", description: "En fazla kaç sonuç (varsayılan 15, en çok 40)." },
      },
    },
  },
  {
    name: "get_archive_item",
    description: "search_archive sonucundaki bir kaydın tam metnini getirir (uzun e-posta gövdesi veya toplantı transkriptinin tamamı için).",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", enum: SOURCE_ENUM },
        id: { type: "string" },
      },
      required: ["source", "id"],
    },
  },
];

const trDate = (s: string) => new Date(s).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" });

function statusOf(fc: { name: string; args?: Record<string, unknown> }) {
  const a = fc.args ?? {};
  if (fc.name === "get_archive_item") return "📄 Kayıt okunuyor…";
  const src = { gmail: "e-postalarda", chat: "Chat'te", meet: "toplantılarda", calendar: "takvimde" }[String(a.source)] ?? "arşivde";
  const range = a.after || a.before ? ` (${a.after ?? "…"} – ${a.before ?? "…"})` : "";
  return a.query ? `🔎 ${src[0].toUpperCase() + src.slice(1)} aranıyor: “${String(a.query).slice(0, 60)}”${range}` : `🔎 ${src[0].toUpperCase() + src.slice(1)} kayıtlar listeleniyor${range}`;
}

async function runTool(fc: { name: string; args?: Record<string, unknown> }) {
  const a = fc.args ?? {};
  const source = SOURCE_ENUM.includes(String(a.source)) ? (a.source as ArchiveSource) : undefined;
  if (fc.name === "search_archive") {
    const hits = await search({ query: a.query ? String(a.query) : undefined, source, after: a.after ? String(a.after) : undefined, before: a.before ? String(a.before) : undefined, limit: Number(a.limit) || 15 });
    return {
      sonuc_sayisi: hits.length,
      sonuclar: hits.map((h) => ({ source: h.source, id: h.id, tarih: trDate(h.ts), baslik: h.title, kim: h.who.slice(0, 200), ozet: h.excerpt, link: h.link })),
      not: hits.length ? undefined : "Sonuç yok. Farklı/daha az kelimeyle ya da tarih aralığıyla tekrar dene.",
    };
  }
  if (fc.name === "get_archive_item" && source && a.id) {
    const x = await getItem(source, String(a.id));
    if (!x) return { hata: "Kayıt bulunamadı" };
    return { source: x.source, tarih: trDate(x.ts), baslik: x.title, kim: x.who, metin: x.body.slice(0, 30000), link: x.link };
  }
  return { hata: `Bilinmeyen araç: ${fc.name}` };
}
