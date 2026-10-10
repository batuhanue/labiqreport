import "server-only";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import type { BrainItem, MailDraft } from "./brain-types";
import { ASSISTANT_MODEL, claude, costUsd, recordUsage } from "./claude";
import { authed, COMPOSE_SCOPE, GErr, getSnapshot, parseFrom } from "./google";

/*
 * Onaylanan teslimat → Gmail taslağı. Claude teslimattan alıcı/konu/gövdeyi çıkarır; kaynak bir e-postaysa
 * taslak aynı yazışmaya yanıt olarak (In-Reply-To/References + threadId) yazılır. Gönderim yok: Batuhan
 * Gmail'de taslağı açıp "Gönder"e basar.
 */

export class DraftError extends Error {
  constructor(
    msg: string,
    public code: "scope" | "not_email" | "no_recipient" | "google",
  ) {
    super(msg);
  }
}

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

const MAIL_SCHEMA = {
  type: "object",
  properties: {
    is_email: { type: "boolean", description: "gidecek şey bir e-posta mı (sohbet mesajı, paylaşım vb. ise false)" },
    to: { type: "array", items: { type: "string" }, description: "alıcı e-posta adresleri (yalnızca adres; listede ya da kaynakta geçen gerçek adresler)" },
    cc: { type: "array", items: { type: "string" }, description: "bilgi (CC) adresleri ya da boş" },
    subject: { type: "string", description: "konu satırı; yanıtsa boş bırakılabilir (Re: eklenir)" },
    body: { type: "string", description: "gönderilmeye hazır düz metin gövde (markdown işareti, başlık, 'Kaynak:' ve 'Konu/Kime' satırları olmadan; hitap ve imza dahil)" },
    reply_signal: { type: "string", description: "bu e-posta kaynaklardan birine yanıtsa o kaynağın kimliği (gmail:…), değilse boş" },
  },
  required: ["is_email", "to", "cc", "subject", "body", "reply_signal"],
  additionalProperties: false,
} as const;

/** Bilinen kişiler: kaynaklar + son e-postalar + takvim katılımcıları (alıcı adresini bulmak için). */
async function contacts(it: BrainItem) {
  const m = new Map<string, string>();
  const add = (name: string, email: string) => {
    if (EMAIL.test(email) && !m.has(email.toLowerCase())) m.set(email.toLowerCase(), name || email);
  };
  for (const s of it.sources) if (s.who) for (const part of s.who.split(/,\s*/)) add(parseFrom(part).name, parseFrom(part).email);
  const snap = await getSnapshot().catch(() => null);
  for (const g of snap?.gmail.items ?? []) add(g.from, g.fromEmail);
  for (const e of snap?.calendar.items ?? []) for (const a of e.attendees) add(a.name, a.email);
  return [...m].slice(0, 150).map(([email, name]) => `${name} <${email}>`).join("\n");
}

const encHeader = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`);
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function createDraft(it: BrainItem): Promise<MailDraft> {
  const w = it.work;
  if (!w?.output) throw new DraftError("Teslimat yok", "not_email");
  const g = await authed().catch(() => null);
  if (!g) throw new DraftError("Google hesabı bağlı değil", "scope");
  if (!g.auth.scopes?.includes(COMPOSE_SCOPE)) throw new DraftError("Gmail'e taslak yazma izni yok: Google hesabını yeniden bağla ve Gmail taslak kutusunu işaretle.", "scope");

  const t0 = Date.now();
  const res = await claude().messages.parse(
    {
      model: ASSISTANT_MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: jsonSchemaOutputFormat(MAIL_SCHEMA) },
      messages: [
        {
          role: "user",
          content: `Batuhan aşağıdaki teslimatı onayladı. Gidecek olanı Gmail taslağına çevir.
GİDECEK: ${w.outbound ?? "(belirtilmemiş)"}
İŞ: ${it.title}

KAYNAKLAR:
${it.sources.map((s) => `- [${s.signalId}] ${s.title}${s.who ? ` — ${s.who}` : ""}`).join("\n")}

BİLİNEN KİŞİLER (ad <adres>):
${await contacts(it)}

TESLİMAT:
${w.output}

Alıcı adresini yalnızca teslimatta, kaynaklarda ya da bilinen kişilerde geçen adreslerden seç; adres uydurma.`,
        },
      ],
    },
    { timeout: 30000 },
  );
  const usage = {
    input: res.usage.input_tokens ?? 0,
    cacheRead: res.usage.cache_read_input_tokens ?? 0,
    cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
    output: res.usage.output_tokens ?? 0,
  };
  await recordUsage({
    at: new Date().toISOString(),
    model: ASSISTANT_MODEL,
    rounds: 1,
    prompt: usage.input + usage.cacheRead + usage.cacheWrite,
    cached: usage.cacheRead,
    written: usage.cacheWrite,
    output: usage.output,
    cost: costUsd(ASSISTANT_MODEL, usage),
    ms: Date.now() - t0,
    label: "✉️ Gmail taslağı",
  });
  const p = res.parsed_output;
  if (!p?.is_email) throw new DraftError("Bu teslimat bir e-posta değil (ör. sohbet mesajı): kopyalayıp gönder, sonra “Gönderdim, onayla”.", "not_email");
  const to = [...new Set(p.to.map((x) => x.trim()).filter((x) => EMAIL.test(x)))];
  const cc = [...new Set(p.cc.map((x) => x.trim()).filter((x) => EMAIL.test(x) && !to.includes(x)))];
  if (!to.length) throw new DraftError("Alıcının e-posta adresi bulunamadı: taslağı kopyalayıp Gmail'de kendin oluştur.", "no_recipient");

  // yanıtsa aynı yazışmaya bağla
  let threadId: string | undefined;
  const headers: string[] = [];
  let subject = p.subject.trim();
  const src = it.sources.find((s) => s.signalId === p.reply_signal && s.ref?.source === "gmail");
  if (src?.ref) {
    try {
      const m = await g.get<{ threadId: string; payload?: { headers?: { name: string; value: string }[] } }>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${src.ref.id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`,
      );
      const h = (n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
      threadId = m.threadId;
      const mid = h("message-id");
      if (mid) headers.push(`In-Reply-To: ${mid}`, `References: ${[h("references"), mid].filter(Boolean).join(" ")}`);
      const orig = h("subject");
      if (!subject || subject.replace(/^(re|ynt|yanıt):\s*/i, "") === orig.replace(/^(re|ynt|yanıt):\s*/i, "")) subject = /^re:/i.test(orig) ? orig : `Re: ${orig}`;
    } catch {
      // yazışma okunamazsa yeni e-posta olarak yazılır
    }
  }
  if (!subject) subject = it.title;

  const body = p.body.replace(/\r?\n/g, "\r\n");
  const mime = [
    `To: ${to.join(", ")}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    `Subject: ${encHeader(subject)}`,
    ...headers,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    (Buffer.from(body, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n"),
  ].join("\r\n");

  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${g.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw: b64url(mime), ...(threadId ? { threadId } : {}) } }),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string; message?: { id?: string; threadId?: string }; error?: { message?: string } };
  if (!r.ok || !j.id) {
    if (r.status === 403) throw new DraftError("Gmail'e taslak yazma izni yok: Google hesabını yeniden bağla.", "scope");
    throw new DraftError(`Gmail taslağı oluşturulamadı: ${new GErr(j.error?.message ?? `HTTP ${r.status}`, r.status).message}`, "google");
  }
  const messageId = j.message?.id ?? "";
  return {
    id: j.id,
    messageId,
    link: `https://mail.google.com/mail/?authuser=${encodeURIComponent(g.auth.account.email)}#drafts?compose=${messageId}`,
    to,
    cc,
    subject,
    reply: !!threadId,
    threadId: threadId ?? j.message?.threadId,
    at: new Date().toISOString(),
  };
}
