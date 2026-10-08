import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { MEMORY_TOOL, TOOLS, runTool, statusOf } from "@/lib/agent-tools";
import { buildContext, liveMessage, loadKnowledge, loadMemory, memoryPrompt, staticPrompt } from "@/lib/assistant";
import { bad } from "@/lib/api";
import { PERIOD_RE } from "@/lib/period";
import { status as googleStatus } from "@/lib/google";
import { ASSISTANT_MODEL, claude, claudeConfigured, costUsd, friendlyError, getUsage, isTransient, recordUsage } from "@/lib/claude";

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

const keyHint = () => {
  const k = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  return k ? `${k.slice(0, 7)}…${k.slice(-4)} (${k.length} karakter)` : null;
};

/**
 * GET: yapılandırma durumu. ?usage=1: token/maliyet kaydı.
 * ?test=1: bağlantı teşhisi — anahtar geçerli mi, model hesapta var mı, küçük bir deneme isteği ne döndürüyor.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const configured = claudeConfigured();
  if (q.get("usage") === "1") return NextResponse.json({ ...(await getUsage()), model: ASSISTANT_MODEL });
  const base = { configured, model: ASSISTANT_MODEL, keyHint: keyHint() };
  if (q.get("test") !== "1" || !configured) return NextResponse.json(base);

  const out: Record<string, unknown> = { ...base };
  const raw = process.env.ANTHROPIC_API_KEY ?? "";
  if (raw.trim() !== raw) out.warning = "Anahtarın başında/sonunda boşluk var — Vercel'de silip yeniden yapıştırın.";
  // 1) anahtar + model
  try {
    const m = await claude().models.retrieve(ASSISTANT_MODEL);
    out.listStatus = 200;
    out.modelFound = true;
    out.modelName = m.display_name;
  } catch (e) {
    if (e instanceof Anthropic.NotFoundError) {
      out.listStatus = 200;
      out.modelFound = false;
    } else {
      out.listStatus = e instanceof Anthropic.APIError ? (e.status ?? 0) : 0;
      out.listError = friendlyError(e);
    }
  }
  // 2) küçük deneme
  const t0 = Date.now();
  try {
    const r = await claude().messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 1024,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "Bağlantı testi: yalnızca 'Hazırım' yaz." }],
    });
    out.testStatus = 200;
    out.ms = Date.now() - t0;
    out.testText = r.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    out.ok = true;
  } catch (e) {
    out.ms = Date.now() - t0;
    out.testStatus = e instanceof Anthropic.APIError ? (e.status ?? 0) : 0;
    out.testError = friendlyError(e);
  }
  return NextResponse.json(out);
}

/** POST: soruyu bağlamla birlikte Claude'a gönderir; yanıtı düz metin akışı (veya stream:false ile tek parça) döndürür. */
export async function POST(req: Request) {
  if (!claudeConfigured()) return bad("ANTHROPIC_API_KEY tanımlı değil. Vercel → Settings → Environment Variables'a ekleyip Redeploy yapın.", 503);

  const body = (await req.json().catch(() => null)) as { messages?: Msg[]; period?: string; images?: Img[]; deep?: boolean; stream?: boolean; google?: boolean } | null;
  const history = normalizeHistory((body?.messages ?? []).filter((x) => x.text?.trim() && (x.role === "user" || x.role === "assistant")).slice(-20));
  if (!history.length || history[history.length - 1].role !== "user") return bad("Soru boş");
  const period = body?.period && PERIOD_RE.test(body.period) ? body.period : null;
  const images = (body?.images ?? []).filter((x) => /^image\/(png|jpeg|webp)$/.test(x.mime) && x.data.length < 1_500_000).slice(0, 6);
  const streaming = body?.stream !== false;
  const started = Date.now();
  const left = () => 55000 - (Date.now() - started);

  // Google bağlıysa asistan geçmiş arşivde (e-posta, Chat, Meet transkripti, takvim) arama yapabilir
  const archiveOn = body?.google !== false && !!(await googleStatus("", false).catch(() => null))?.connected;

  let system: string;
  let memory: string;
  let context: string;
  try {
    const [k, mem, ctx] = await Promise.all([loadKnowledge(), loadMemory(), buildContext(period, { google: body?.google !== false })]);
    system = staticPrompt(k);
    memory = memoryPrompt(mem);
    context = ctx;
  } catch (e) {
    return bad(`Bağlam hazırlanamadı: ${e instanceof Error ? e.message : e}`, 500);
  }

  /*
   * Önbellek düzeni (önek eşleşmesi: araçlar → sistem → mesajlar):
   *  - sistem (kurallar + bilgi dosyaları, ~30k token) açık önbellek noktası: her soruda önbellekten okunur
   *  - önceki mesajlar değişmez; canlı veri SON kullanıcı mesajının başında (her soruda değişen kısım en sonda)
   *  - üst düzey otomatik önbellek: arşiv araması turlarında bütün konuşma önbellekten okunur
   */
  const messages: Anthropic.MessageParam[] = history.map((x, i) => {
    if (i < history.length - 1) return { role: x.role, content: x.text.slice(0, 20000) };
    const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: liveMessage(context) }];
    for (const im of images) {
      content.push({ type: "text", text: `[El yazısı not görüntüsü: ${im.label}]` });
      content.push({ type: "image", source: { type: "base64", media_type: im.mime as "image/png" | "image/jpeg" | "image/webp", data: im.data } });
    }
    content.push({ type: "text", text: `SORU: ${x.text.slice(0, 20000)}` });
    return { role: "user", content };
  });
  // sistem 1 saat önbellekte kalır: seyrek sorularda da (5 dk'dan uzun aralık) önbellekten okunur
  // bellek ayrı blokta: belleğe yazınca yalnızca o küçük blok yeniden önbelleğe yazılır
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: system, cache_control: { type: "ephemeral", ttl: "1h" } },
    { type: "text", text: memory, cache_control: { type: "ephemeral", ttl: "1h" } },
  ];
  const tools = archiveOn ? [MEMORY_TOOL, ...TOOLS] : [MEMORY_TOOL];
  const effort = body?.deep ? "high" : "low";

  const usage = { input: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0 };
  let rounds = 0;
  let retries = 0;
  let finalError: string | undefined;
  let reply = "";
  const memoryNotes: { topic: string; eklenen: number; degistirilen: number }[] = [];
  /** belleğe yazıldıysa yanıtın sonuna kesin bilgi (model ayrıca yazmaz) */
  const memoryLine = () => {
    if (!memoryNotes.length) return "";
    const parts = memoryNotes.map((n) =>
      n.eklenen || n.degistirilen ? `${n.topic} (${[n.eklenen && `+${n.eklenen} madde`, n.degistirilen && `${n.degistirilen} güncellendi`].filter(Boolean).join(", ")})` : `${n.topic} (zaten kayıtlıydı)`,
    );
    return `${reply.trim() ? "\n\n" : ""}🧠 **Belleğe yazıldı:** ${parts.join(" · ")}`;
  };

  /** Tek model turu: metni akıtır, tamamlanan mesajı döndürür. */
  async function turn(emit: (s: string) => void) {
    const params = {
      model: ASSISTANT_MODEL,
      max_tokens: 16000,
      cache_control: { type: "ephemeral" as const },
      system: systemBlocks,
      tools,
      output_config: { effort: effort as "low" | "high" },
      messages,
    };
    const opts = { timeout: Math.max(5000, Math.min(50_000, left() - 2000)) };
    if (!streaming) return claude().messages.create(params, opts);
    const stream = claude().messages.stream(params, opts);
    stream.on("text", (delta) => emit(delta));
    return stream.finalMessage();
  }

  /** Araç çağrılarını (en fazla 5 tur) yürütüp son yanıta kadar ilerler; yarıda kopan turu bir kez yeniden dener. */
  async function converse(emit: (s: string) => void) {
    let roundRetries = 0;
    for (let round = 0; round < 6; round++) {
      rounds++;
      let emitted = 0;
      let fresh = true;
      /** görünen metin; turlar arasına paragraf boşluğu konur (yoksa cümleler birbirine yapışır) */
      const say = (t: string) => {
        if (!t) return;
        if (fresh && reply && !/\s$/.test(reply)) t = `\n\n${t}`;
        fresh = false;
        reply += t;
        emitted += t.length;
        emit(t);
      };
      let message: Anthropic.Message;
      try {
        message = await turn(say);
      } catch (e) {
        // akış ortasında koptuysa yarım metni istemcide sil (\u001fX<n>\u001f) ve turu yeniden iste
        if (emitted) {
          emit(`\u001fX${emitted}\u001f`);
          reply = reply.slice(0, reply.length - emitted);
        }
        if (isTransient(e) && roundRetries < 1 && left() > 12000) {
          roundRetries++;
          retries++;
          emit("\u001fS⏳ Claude yoğun, yeniden deneniyor…\u001f");
          round--;
          continue;
        }
        console.error("[assistant] Claude hatası:", e);
        finalError = friendlyError(e);
        emit(`\n\n⚠️ ${finalError}`);
        return;
      }
      usage.input += message.usage.input_tokens ?? 0;
      usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
      usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
      usage.cacheWrite1h += message.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
      usage.output += message.usage.output_tokens ?? 0;
      if (!streaming) for (const b of message.content) if (b.type === "text") say(b.text);

      if (message.stop_reason === "refusal") {
        emit("\n\n_(Claude bu isteği yanıtlamadı — soruyu farklı ifade etmeyi dene)_");
        return;
      }
      const calls = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (message.stop_reason !== "tool_use" || !calls.length) {
        if (message.stop_reason === "max_tokens") emit("\n\n_(yanıt uzunluk sınırında kesildi)_");
        return;
      }
      if (left() < 10000) {
        emit("\n\n_(süre sınırı: arama sonuçları işlenemedi, soruyu daraltıp tekrar dene)_");
        return;
      }
      // düşünce blokları dahil asistan içeriği olduğu gibi geri gönderilir
      messages.push({ role: "assistant", content: message.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const c of calls) {
        emit(`\u001fS${statusOf(c)}\u001f`);
        try {
          const out = await runTool(c);
          if (c.name === "remember" && "topic" in out) memoryNotes.push(out);
          results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(out) });
        } catch (e) {
          results.push({ type: "tool_result", tool_use_id: c.id, is_error: true, content: e instanceof Error ? e.message : String(e) });
        }
      }
      // paralel çağrıların tüm sonuçları tek kullanıcı mesajında
      messages.push({ role: "user", content: results });
    }
    emit("\n\n_(arama turu sınırına ulaşıldı)_");
  }

  const totals = () => ({ prompt: usage.input + usage.cacheRead + usage.cacheWrite, cached: usage.cacheRead, written: usage.cacheWrite, output: usage.output });
  const meta = () => `\u001eMETA${JSON.stringify({ ...totals(), model: ASSISTANT_MODEL, rounds, cost: costUsd(ASSISTANT_MODEL, usage) })}`;
  const log = () =>
    recordUsage({ at: new Date().toISOString(), model: ASSISTANT_MODEL, rounds, ...totals(), cost: costUsd(ASSISTANT_MODEL, usage), ms: Date.now() - started, error: finalError?.slice(0, 600), retries, ctxChars: context.length });

  // akışsız (yedek yol)
  if (!streaming) {
    let text = "";
    await converse((s) => (text += s));
    text += memoryLine();
    await log();
    if (!text.replace(/\u001f[^\u001f]*\u001f/g, "").trim()) text += "_(boş yanıt)_";
    return new Response(text + meta(), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }

  // düz metin akışı (\u001fS…\u001f = durum satırı, \u001fX<n>\u001f = son n karakteri sil, \u001eMETA = kullanım)
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await converse((s) => controller.enqueue(enc.encode(s)));
        const mem = memoryLine();
        if (mem) controller.enqueue(enc.encode(mem));
      } catch (e) {
        finalError = friendlyError(e);
        controller.enqueue(enc.encode(`\n\n⚠️ ${finalError}`));
      } finally {
        await log();
        controller.enqueue(enc.encode(meta()));
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no", "X-Model": ASSISTANT_MODEL } });
}

/**
 * Messages API kuralları: ilk mesaj kullanıcıdan olmalı, roller sırayla gelmeli.
 * Hatayla biten turlarda yanıtsız kalan kullanıcı mesajı (ardından yine kullanıcı gelir) atılır,
 * böylece model önceki başarısız soruya takılmaz.
 */
function normalizeHistory(list: Msg[]) {
  const out: Msg[] = [];
  for (const m of list) {
    if (!out.length && m.role !== "user") continue;
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1] = m;
    else out.push(m);
  }
  return out;
}
