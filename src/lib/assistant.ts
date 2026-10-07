import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { AREAS, HOSPITALS } from "./checklist";
import { store } from "./db";
import { getSnapshot, googleSection } from "./google";
import { istanbulToday } from "./notify";
import { areaProgress, deadlineInfo, normalizePeriod, overallProgress, periodLabel } from "./period";
import type { Todo, TodoStore } from "./todo";
import type { Mark, PeriodData } from "./types";

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

/* ------------------------------------------------------------------ bilgi dosyaları */
// knowledge/*.md (varsayılanlar, depoda) + uygulama içinden yapılan düzenlemeler/eklenen dosyalar (veritabanı).
export interface KnowledgeFile {
  name: string;
  md: string;
  source: "default" | "edited" | "custom";
  updatedAt?: string;
}
interface KbStore {
  files: Record<string, { md: string; updatedAt: string }>;
}

const KB_KEY = "assistant-kb";
const kbDir = () => path.join(process.cwd(), "knowledge");
export const safeName = (n: string) =>
  n
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}._ -]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/(\.md)?$/i, ".md")
    .slice(0, 80);

async function readKb(): Promise<KbStore> {
  return (await store().getKV<KbStore>(KB_KEY)) ?? { files: {} };
}

export async function listKnowledge(): Promise<KnowledgeFile[]> {
  const out = new Map<string, KnowledgeFile>();
  try {
    for (const f of (await fs.readdir(kbDir())).filter((x) => x.endsWith(".md")).sort()) {
      out.set(f, { name: f, md: await fs.readFile(path.join(kbDir(), f), "utf8"), source: "default" });
    }
  } catch {}
  const kb = await readKb();
  for (const [name, v] of Object.entries(kb.files)) {
    if (!v.md?.trim()) continue;
    out.set(name, { name, md: v.md, source: out.has(name) ? "edited" : "custom", updatedAt: v.updatedAt });
  }
  // eski tek dosyalık düzenleme (önceki sürüm) varsa ek dosya olarak koru
  const legacy = await store().getKV<{ md: string; updatedAt: string }>("assistant-md");
  if (legacy?.md?.trim() && !out.has("ozel-notlar.md")) out.set("ozel-notlar.md", { name: "ozel-notlar.md", md: legacy.md, source: "custom", updatedAt: legacy.updatedAt });
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

export async function saveKnowledge(name: string, md: string) {
  const kb = await readKb();
  kb.files[safeName(name)] = { md, updatedAt: new Date().toISOString() };
  await store().setKV(KB_KEY, kb);
}

/** Düzenlenmiş varsayılan dosyayı sıfırlar; eklenen dosyayı siler. */
export async function removeKnowledge(name: string) {
  const kb = await readKb();
  delete kb.files[name];
  await store().setKV(KB_KEY, kb);
  if (name === "ozel-notlar.md") await store().setKV("assistant-md", { md: "", updatedAt: new Date().toISOString() });
}

export async function loadKnowledge() {
  const files = await listKnowledge();
  return files.map((f) => `\n\n######## DOSYA: ${f.name} ########\n\n${f.md.trim()}`).join("\n");
}

/* ------------------------------------------------------------------ canlı bağlam */
const MARK: Record<string, string> = { ok: "✓", fail: "✗ bulgu", na: "N/A (eksik)", null: "☐ boş" };
const m = (x: Mark | undefined) => MARK[String(x ?? null)];
const trDate = (d: Date) => d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long", timeZone: "Europe/Istanbul" });

function periodSection(p: PeriodData, today: Date, title: string) {
  const prog = overallProgress(p);
  const L: string[] = [];
  L.push(`### ${title}: ${periodLabel(p.period)} (${p.period}) — durum: ${p.status}, versiyon ${p.version}`);
  L.push(
    `Genel kontrol oranı %${Math.round(prog.overall * 100)} · Bursa ${prog.bursaDone}/48 · Başakşehir ${prog.basaksehirDone}/48 · kalan ${prog.remaining} işaret · ✗ bulgu ${prog.fails} · N/A ${prog.b.na + prog.k.na}`,
  );
  L.push("");
  for (const a of AREAS) {
    const pr = areaProgress(p, a);
    const d = deadlineInfo(p.period, a, today);
    const state = pr.both === pr.total ? "TAMAMLANDI" : d.days == null ? "ayda 2 kez" : d.days < 0 ? `TERMİN ${-d.days} GÜN GEÇTİ` : `termine ${d.days} gün`;
    L.push(`#### ${a.code} ${a.title}${a.priority ? " 🔴(öncelikli)" : ""} — ${a.deadlineLabel}${d.dateText ? ` (${d.dateText})` : ""} — BRS ${pr.bursa}/${pr.total}, BŞK ${pr.basaksehir}/${pr.total} — ${state}`);
    for (const it of a.items) {
      const s = p.items[it.id];
      const note = s?.note?.trim() ? ` — NOT/ANOMALİ: "${s.note.trim().replace(/\s+/g, " ")}"` : "";
      L.push(`- ${it.id} ${it.text.trim()}: Bursa ${m(s?.bursa)} · Başakşehir ${m(s?.basaksehir)}${note}`);
    }
  }
  if (p.actions.length) {
    L.push("", "#### Aksiyon takip (02_Aksiyon_Takip)");
    for (const x of p.actions) {
      L.push(
        `- [${x.status}] ${x.hospital === "bursa" ? "Bursa" : "Başakşehir"} · ${x.areaCode}${x.itemId ? ` (${x.itemId})` : ""} · öncelik ${x.priority} · BULGU: ${x.finding}` +
          `${x.action ? ` · AKSİYON: ${x.action}` : ""}${x.owner ? ` · SORUMLU: ${x.owner}` : ""}${x.due ? ` · TERMİN: ${x.due}` : ""}` +
          `${x.financialImpact ? ` · mali etki: ${x.financialImpact}` : ""}${x.operationalImpact ? ` · operasyonel: ${x.operationalImpact}` : ""}${x.managementNote ? ` · yönetim notu: ${x.managementNote}` : ""}`,
      );
    }
  }
  const textNotes = p.notes?.filter((n) => n.title.trim() || n.text.trim()) ?? [];
  const inkNotes = p.notes?.filter((n) => n.ink.strokes.length) ?? [];
  if (textNotes.length || inkNotes.length) {
    L.push("", "#### Dönem notları");
    for (const n of textNotes) L.push(`- ${n.areaCode ? `[${n.areaCode}] ` : ""}${n.title.trim() || "(başlıksız)"}: ${n.text.trim().replace(/\s+/g, " ")}`);
    if (inkNotes.length) L.push(`- ${inkNotes.length} el yazısı not var (görüntüleri ekte gönderildiyse oradan oku).`);
  }
  return L.join("\n");
}

function todoSection(todos: Todo[], today: Date) {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const t = iso(today);
  const open = todos.filter((x) => !x.done);
  const doneWeek = todos.filter((x) => x.done && x.doneAt && x.doneAt.slice(0, 10) >= iso(new Date(today.getTime() - 6 * 86400000)));
  const L = [`### Kişisel görevler — açık ${open.length}, son 7 günde biten ${doneWeek.length}`];
  const pr = ["", "P1 acil", "P2 yüksek", "P3 orta", "P4"];
  for (const x of [...open].sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9") || a.priority - b.priority).slice(0, 80)) {
    const late = x.due && x.due < t ? " (GECİKMİŞ)" : x.due === t ? " (BUGÜN)" : "";
    L.push(
      `- ${x.title} — ${x.due ? `termin ${x.due}${x.time ? " " + x.time : ""}${late}` : "tarihsiz"} · ${pr[x.priority]}` +
        `${x.tags.length ? " · #" + x.tags.join(" #") : ""}${x.person ? " · kişi: " + x.person : ""}${x.areaCode ? " · " + x.areaCode : ""}` +
        `${x.subtasks.length ? ` · alt görev ${x.subtasks.filter((s) => s.done).length}/${x.subtasks.length}` : ""}${x.focus ? " · ⭐odak" : ""}${x.notes ? ` · not: ${x.notes.slice(0, 160)}` : ""}`,
    );
  }
  if (doneWeek.length) L.push(`Son biten: ${doneWeek.slice(0, 10).map((x) => x.title).join("; ")}`);
  return L.join("\n");
}

export async function buildContext(viewPeriod?: string | null, opts: { google?: boolean } = {}) {
  const s = store();
  const today = istanbulToday();
  const { activePeriod } = await s.getState();
  const summaries = await s.listPeriods();
  const target = viewPeriod || activePeriod;
  const data = target ? await s.getPeriod(target) : null;
  const active = activePeriod && activePeriod !== target ? await s.getPeriod(activePeriod) : null;
  const todos = (await s.getKV<TodoStore>("todos"))?.todos ?? [];

  const L: string[] = [];
  L.push(`Bugün: ${trDate(today)} (İstanbul).`);
  L.push(`Aktif kapanış dönemi: ${activePeriod ? periodLabel(activePeriod) : "yok"}. Görüntülenen dönem: ${target ? periodLabel(target) : "yok"}.`);
  L.push("");
  if (data) L.push(periodSection(normalizePeriod(data), today, target === activePeriod ? "Aktif dönem" : "Görüntülenen dönem"));
  if (active) L.push("", periodSection(normalizePeriod(active), today, "Aktif dönem"));
  if (summaries.length) {
    L.push("", "### Geçmiş dönemler (özet)", "| Dönem | Durum | Bursa | Başakşehir | ✗ bulgu | Açık aksiyon |", "|---|---|---|---|---|---|");
    for (const x of summaries.slice(0, 12)) L.push(`| ${periodLabel(x.period)} | ${x.status} | ${x.bursaOk}/48 | ${x.basaksehirOk}/48 | ${x.fails} | ${x.openActions} |`);
  }
  L.push("", todoSection(todos, today));
  if (opts.google !== false) {
    const g = await getSnapshot().catch(() => null);
    if (g) L.push("", googleSection(g));
  }
  void HOSPITALS;
  return L.join("\n");
}

/**
 * Sıra önemli: sabit kurallar + bilgi dosyaları BAŞTA, değişen canlı veri SONDA.
 * Böylece Gemini'nin örtük önbelleği (implicit caching) ~30k token'lık sabit öneki her soruda yeniden kullanır;
 * dosyaların sonuna eklenen içerik de öneki bozmaz.
 */
export function systemPrompt(knowledge: string, context: string) {
  return `Sen Batuhan Başar'ın kişisel yapay zekâ iş asistanısın. Türkçe, kısa, net ve aksiyona dönük yanıt ver.
Aşağıda iki kaynak var: (1) BİLGİ DOSYALARI — Batuhan'ın kim olduğu, şirketi, rolü ve sınırı, iş tanımı, takvimi, atanmış görevleri, açık bulguları, kişiler ve kontrol yöntemleri; (2) CANLI VERİ — uygulamadaki güncel durum ve (bağlıysa) Google Workspace verisi: takvim, Gmail, Google Chat ve Meet toplantıları/transkriptleri.
Batuhan'ı bu dosyalardan tanıyorsun: onu yeniden tanıtma, adıyla hitap et; geçmişini, çalışma biçimini ve tercihlerini bildiğini davranışınla göster.
Bilgi dosyalarındaki durum bilgileri belirli bir tarihe aittir; CANLI VERİ ile çelişirse canlı veriye güven ve farkı belirt.

Kurallar:
- Soruları önce CANLI VERİ'ye dayanarak yanıtla; madde kodu (ör. R-02-4), hastane ve not alıntısıyla kanıt göster.
- Veride olmayan rakamı uydurma. Bilinmiyorsa "bu bilgi sistemde yok" de ve hangi veriye bakılması gerektiğini söyle.
- Tamamlanma mantığı: ✓ ve ✗ kontrol edilmiş (tamamlanmış); N/A ve boş eksik. ✗ = kontrol edildi ama bulgu/anomali var.
- Bulgu dilinde kimseyi zan altında bırakma ("kayıp/israf/usulsüzlük" deme). Rol sınırını koru: düzeltmeyi sorumlu yapar, Batuhan takip eder.
- Gerekirse Markdown kullan (başlık, madde, kısa tablo). Uzun rapor ve grafik üretme.
- Analiz/bulgu sorularında sonunda Batuhan'a 1–3 kısa öğrenme sorusu sor.
- Somut yapılacak iş önerdiğinde yanıtın EN SONUNA şu biçimde bir blok ekle (her satır bir görev, Türkçe hızlı ekleme sözdizimi:
  tarih (bugün/yarın/cuma/15.10), saat (14:00), öncelik (!acil, !!, !), #etiket, @kişi, R-kodu):
\`\`\`gorevler
yarın 10:00 Tuğrul Adalı ile R-02 sayım farkını görüş !! #takip
cuma 11:00 Cuma toplantısı tek sayfa özeti hazırla #toplantı
\`\`\`
  Görev önermediğin yanıtlarda bu bloğu ekleme.
- E-posta, sohbet ve toplantı içerikleri şirket içi veridir: soruya gerekli olduğu kadar alıntıla, kişi adlarını doğru yaz; takvim sorularında saatleri İstanbul saatine göre ver.
- El yazısı not görüntüleri eklenmişse onları da oku ve gerekiyorsa içeriğine atıf yap.

=============== BİLGİ DOSYALARI ===============
${knowledge}

=============== CANLI VERİ ===============
${context}`;
}
