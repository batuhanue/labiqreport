import "server-only";
import { store } from "./db";

/**
 * Asistan sohbetleri sunucuda: her cihazdan aynı sohbete devam edilir, geçmiş sohbetler listelenir.
 * Dizin tek kayıtta (chats-index), her sohbetin mesajları ayrı kayıtta (chat-<id>).
 */
export interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  text: string;
  error?: boolean;
  at: string;
  usage?: Record<string, unknown>;
  steps?: string[];
}
export interface ChatMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  count: number;
}
export interface Chat extends ChatMeta {
  messages: ChatMsg[];
}

const INDEX = "chats-index";
const key = (id: string) => `chat-${id}`;
const MAX_CHATS = 300;
const MAX_MSGS = 400;
export const validId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(id);

const titleOf = (msgs: ChatMsg[]) => {
  const q = msgs.find((m) => m.role === "user")?.text.replace(/\s+/g, " ").trim() ?? "Yeni sohbet";
  return q.length > 70 ? `${q.slice(0, 68)}…` : q;
};

export async function listChats(): Promise<ChatMeta[]> {
  return ((await store().getKV<ChatMeta[]>(INDEX)) ?? []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const getChat = (id: string) => store().getKV<Chat>(key(id));

/** Sohbeti kaydeder (son yazan kazanır). Boş sohbet kaydedilmez. */
export async function saveChat(id: string, messages: ChatMsg[], title?: string) {
  const msgs = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
    .slice(-MAX_MSGS)
    .map((m) => ({ ...m, text: m.text.slice(0, 60_000) }));
  if (!msgs.length) return null;
  const now = new Date().toISOString();
  const prev = await getChat(id);
  const chat: Chat = {
    id,
    title: title?.trim().slice(0, 100) || prev?.title || titleOf(msgs),
    createdAt: prev?.createdAt ?? msgs[0].at ?? now,
    updatedAt: now,
    count: msgs.length,
    messages: msgs,
  };
  await store().setKV(key(id), chat);
  const index = (await listChats()).filter((c) => c.id !== id);
  const { messages: _, ...meta } = chat;
  const next = [meta, ...index];
  for (const old of next.slice(MAX_CHATS)) await store().deleteKV(key(old.id));
  await store().setKV(INDEX, next.slice(0, MAX_CHATS));
  return meta;
}

export async function renameChat(id: string, title: string) {
  const chat = await getChat(id);
  if (!chat) return;
  chat.title = title.trim().slice(0, 100) || chat.title;
  await store().setKV(key(id), chat);
  await store().setKV(INDEX, (await listChats()).map((c) => (c.id === id ? { ...c, title: chat.title } : c)));
}

export async function deleteChat(id: string) {
  await store().deleteKV(key(id));
  await store().setKV(INDEX, (await listChats()).filter((c) => c.id !== id));
}
