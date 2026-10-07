import { bad, handle } from "@/lib/api";
import { getItem } from "@/lib/archive";
import { authed, decode, parseFrom } from "@/lib/google";

export const dynamic = "force-dynamic";

type MPart = { mimeType?: string; filename?: string; body?: { data?: string; size?: number; attachmentId?: string }; parts?: MPart[]; headers?: { name: string; value: string }[] };
const b64 = (d: string) => Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

const gmailLink = (email: string, threadId: string) => `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${threadId}`;

/**
 * Tek bir e-postayı uygulama içinde göstermek için tam içeriğiyle getirir (Gmail'den canlı; olmazsa arşivden).
 * HTML gövde istemcide betik çalıştırmayan, korumalı (sandbox) bir iframe içinde gösterilir.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[\w-]+$/.test(id)) return bad("Geçersiz e-posta kimliği");
  return handle(async () => {
    try {
      const { auth, get } = await authed();
      const m = await get<{ id: string; threadId: string; labelIds?: string[]; internalDate?: string; snippet?: string; payload?: MPart }>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      );
      const h = (n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
      let html = "";
      let text = "";
      const files: { name: string; size: number }[] = [];
      const walk = (p?: MPart) => {
        if (!p) return;
        if (p.filename) files.push({ name: p.filename, size: p.body?.size ?? 0 });
        else if (p.mimeType === "text/html" && p.body?.data && !html) html = b64(p.body.data);
        else if (p.mimeType === "text/plain" && p.body?.data && !text) text = b64(p.body.data);
        p.parts?.forEach(walk);
      };
      walk(m.payload);
      const from = parseFrom(h("from"));
      return {
        id: m.id,
        subject: h("subject") || "(konu yok)",
        from: from.name,
        fromEmail: from.email,
        to: h("to"),
        cc: h("cc"),
        date: new Date(Number(m.internalDate ?? 0)).toISOString(),
        html: html.slice(0, 600_000),
        text: text.slice(0, 200_000) || decode(m.snippet ?? ""),
        files,
        labels: m.labelIds ?? [],
        link: gmailLink(auth.account.email, m.threadId),
        live: true,
      };
    } catch (e) {
      // canlı alınamazsa arşivdeki metin
      const x = await getItem("gmail", id);
      if (!x) throw e;
      const [fromPart, to] = x.who.split(" → ");
      const f = parseFrom(fromPart);
      return {
        id,
        subject: x.title,
        from: f.name,
        fromEmail: f.email,
        to: to ?? "",
        cc: "",
        date: x.ts,
        html: "",
        text: x.body,
        files: [],
        labels: [],
        link: x.link,
        live: false,
      };
    }
  });
}
