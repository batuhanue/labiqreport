import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getItem, search } from "./archive";
import { remember } from "./assistant";
import type { ArchiveSource } from "./google-types";

/** Asistanın ve beyin ajanlarının ortak araçları: Google arşivi (Drive dahil) ve bellek. */
// ------------------------------------------------------------------ araçlar (Google arşivi)
export const SOURCE_ENUM = ["gmail", "chat", "meet", "calendar", "drive"];
export const MEMORY_TOOL: Anthropic.Tool = {
  name: "remember",
  description:
    "Kalıcı belleğe (bilgi dosyalarındaki gelistirme.md) yeni öğrenilen bilgiyi yazar; sonraki tüm sohbetlerde BELLEK bölümünde görünür. " +
    "Süreç/çalışma mantığı, şirket kuralı, kişi-rol bilgisi, Batuhan'ın tercihi, alınan karar gibi kalıcı bilgiler için kullan; anlık durum verisi için kullanma.",
  input_schema: {
    type: "object",
    properties: {
      topic: { type: "string", description: "Konu başlığı (ör. 'Hakediş süreci', 'Tercihler', 'Kişiler'). BELLEK'te varsa aynısını kullan." },
      entries: { type: "array", items: { type: "string" }, description: "Kısa, kendi başına anlaşılır madde(ler)." },
      replaces: { type: "array", items: { type: "string" }, description: "Eskiyen ve kaldırılacak mevcut maddelerin metni (isteğe bağlı)." },
    },
    required: ["topic", "entries"],
  },
};

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_archive",
    description:
      "Batuhan'ın Google Workspace arşivinde (geçmiş tüm e-postalar, Google Chat mesajları, Meet toplantı transkriptleri, takvim etkinlikleri, Google Drive dosyaları ve içerikleri — Dokümanlar, E-Tablolar, Slaytlar, Word, Excel, PowerPoint) arama yapar. " +
      "Bir dosya, rapor, tablo, prosedür ya da şablon sorulduğunda source=drive ile ara. " +
      "Geçmişe dönük her soruda (kim ne dedi, ne zaman konuşuldu, hangi e-posta geldi, toplantıda ne kararlaştırıldı) kullan. " +
      "query boş bırakılıp tarih aralığı verilirse o aralıktaki kayıtları en yeniden eskiye listeler. Gerekirse farklı kelimelerle birden çok kez ara.",
    input_schema: {
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
    description: "search_archive sonucundaki bir kaydın tam metnini getirir (uzun e-posta gövdesi, toplantı transkriptinin tamamı ya da Drive dosyasının içeriği için).",
    input_schema: {
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

export function statusOf(fc: { name: string; input: unknown }) {
  const a = (fc.input ?? {}) as Record<string, unknown>;
  if (fc.name === "get_archive_item") return "📄 Kayıt okunuyor…";
  if (fc.name === "remember") return `🧠 Belleğe yazılıyor: ${String(a.topic ?? "").slice(0, 60)}`;
  const src = { gmail: "e-postalarda", chat: "Chat'te", meet: "toplantılarda", calendar: "takvimde", drive: "Drive'da" }[String(a.source)] ?? "arşivde";
  const range = a.after || a.before ? ` (${a.after ?? "…"} – ${a.before ?? "…"})` : "";
  return a.query ? `🔎 ${src[0].toUpperCase() + src.slice(1)} aranıyor: “${String(a.query).slice(0, 60)}”${range}` : `🔎 ${src[0].toUpperCase() + src.slice(1)} kayıtlar listeleniyor${range}`;
}

export async function runTool(fc: { name: string; input: unknown }) {
  const a = (fc.input ?? {}) as Record<string, unknown>;
  if (fc.name === "remember") {
    const entries = (Array.isArray(a.entries) ? a.entries : [a.entries]).map(String).filter((x) => x.trim());
    if (!entries.length) return { hata: "entries boş" };
    const replaces = Array.isArray(a.replaces) ? a.replaces.map(String) : undefined;
    return await remember({ topic: String(a.topic ?? "Genel"), entries, replaces });
  }
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
