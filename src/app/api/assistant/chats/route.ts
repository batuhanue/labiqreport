import { bad, handle } from "@/lib/api";
import { deleteChat, getChat, listChats, renameChat, saveChat, validId, type ChatMsg } from "@/lib/chats";

export const dynamic = "force-dynamic";

/** GET: sohbet listesi · ?id=… : tek sohbet (mesajlarıyla) */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  return handle(async () => {
    if (!id) return { chats: await listChats() };
    if (!validId(id)) return bad("Geçersiz sohbet");
    return { chat: await getChat(id) };
  });
}

/** PUT: { id, messages?, title? } — sohbeti kaydeder ya da yeniden adlandırır */
export async function PUT(req: Request) {
  const b = (await req.json().catch(() => null)) as { id?: string; messages?: ChatMsg[]; title?: string } | null;
  if (!validId(b?.id)) return bad("Geçersiz sohbet");
  const id = b.id;
  if (!Array.isArray(b.messages) && !b.title?.trim()) return bad("İçerik yok");
  return handle(async () => {
    if (Array.isArray(b.messages)) return { chat: await saveChat(id, b.messages, b.title) };
    await renameChat(id, b.title!);
    return { ok: true };
  });
}

/** DELETE ?id=… */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!validId(id)) return bad("Geçersiz sohbet");
  return handle(async () => {
    await deleteChat(id);
    return { ok: true };
  });
}
