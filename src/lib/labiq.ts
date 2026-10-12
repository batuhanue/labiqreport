import "server-only";
import { Buffer } from "node:buffer";
import { store } from "./db";

/**
 * LabIQ Canlı Entegrasyon & AI Ajan Modülü
 * 
 * - Oturum yönetimi & CSRF güvenliği
 * - Bursa PPP (226) ve Başakşehir PPP (259) hastane değişimi
 * - Ürün tüketimi ve analiz raporları dışa aktarma (ActionCable Turbo Streams WebSocket dinleme)
 * - Doğal dil komut çözümleme (Türkçe tarih & niyet tespiti)
 */

export const BASE = (process.env.LABIQ_BASE_URL?.trim() || "https://labiq.ivdiq.com").replace(/\/$/, "");
const WS_BASE = `${BASE.replace(/^http/, "ws")}/cable`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LabIQ-Agent/1.0";
// Kimlik bilgileri yalnızca ortam değişkeninden (Vercel → Settings → Environment Variables); koda yazılmaz
const EMAIL = process.env.LABIQ_EMAIL?.trim() ?? "";
const PASSWORD = process.env.LABIQ_PASSWORD ?? "";
/** isteğe bağlı: girişten sonra sayfadan kendiliğinden bulunur */
const USER_ID_ENV = process.env.LABIQ_USER_ID?.trim() ?? "";
const SESSION_KV = "labiq-session";

export const COMPANIES = [
  { id: "bursa", companyId: "226", label: "Diacore Diagnostik - Bursa PPP", short: "Bursa PPP" },
  { id: "basaksehir", companyId: "259", label: "Diacore Diagnostik - Başakşehir PPP", short: "Başakşehir PPP" },
] as const;

export type CompanyKey = "bursa" | "basaksehir";

interface LabiqSession {
  cookies: string[];
  companyKey: CompanyKey;
  companyId: string;
  companyLabel: string;
  loggedIn: boolean;
  csrfToken: string;
  exportStreamName: string;
  lastUsed: number;
  /** LabIQ kullanıcı kimliği (hastane değiştirmek için; girişten sonra sayfadan okunur) */
  userId?: string;
}

let session: LabiqSession = {
  cookies: [],
  companyKey: "bursa",
  companyId: "226",
  companyLabel: "Diacore Diagnostik - Bursa PPP",
  loggedIn: false,
  csrfToken: "",
  exportStreamName: "",
  lastUsed: 0,
};

function mergeCookies(existing: string[], setCookies: string[]): string[] {
  const map = new Map<string, string>();
  for (const c of existing) {
    const name = c.split("=")[0];
    map.set(name, c);
  }
  for (const raw of setCookies) {
    const cookie = raw.split(";")[0].trim();
    const name = cookie.split("=")[0];
    map.set(name, cookie);
  }
  return [...map.values()];
}

function cookieHeader(cookies: string[]): string {
  return cookies.join("; ");
}

function extractCSRF(html: string): string {
  const m = html.match(/name="authenticity_token" value="([^"]+)"/);
  return m?.[1] ?? "";
}

function extractMetaCSRF(html: string): string {
  const m = html.match(/name="csrf-token" content="([^"]+)"/);
  return m?.[1] ?? "";
}

/** Girişten sonra sayfadaki bağlantılardan kullanıcı kimliği (ör. /companies/226/users/17259/...) */
function extractUserId(html: string): string {
  return html.match(/\/users\/(\d+)\/update_last_sign_id/)?.[1] ?? html.match(/\/companies\/\d+\/users\/(\d+)/)?.[1] ?? html.match(/\/users\/(\d+)(?:\/edit|["'])/)?.[1] ?? USER_ID_ENV;
}

function extractExportStreamName(html: string): string {
  const streamNames = [...html.matchAll(/signed-stream-name="([^"]+)"/g)].map((m) => m[1]);
  for (const s of streamNames) {
    try {
      const decoded = Buffer.from(s.split("--")[0], "base64").toString("utf-8");
      if (decoded.includes(":exports")) return s;
    } catch {}
  }
  return streamNames[0] ?? "";
}

/**
 * LabIQ'ya giriş yapar ve oturum bilgilerini saklar
 */
export async function labiqLogin(): Promise<{ ok: boolean; company?: string; error?: string }> {
  if (!EMAIL || !PASSWORD) return { ok: false, error: "LabIQ giriş bilgileri tanımlı değil: Vercel'e LABIQ_EMAIL ve LABIQ_PASSWORD ekleyin." };
  try {
    // 1) GET login page
    const loginPage = await fetch(`${BASE}/users/sign_in`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LabIQ-Agent/1.0",
      },
    });
    const loginHtml = await loginPage.text();
    const token = extractCSRF(loginHtml);
    const spinnerMatch = loginHtml.match(/name="spinner" value="([^"]+)"/);
    const spinner = spinnerMatch?.[1] ?? "";

    if (!token) return { ok: false, error: "CSRF token alınamadı" };

    let cookies = [...(loginPage.headers.getSetCookie?.() ?? [])].map((c) => c.split(";")[0].trim());

    // 2) POST credentials
    const form = new URLSearchParams({
      authenticity_token: token,
      "user[email]": EMAIL,
      "user[password]": PASSWORD,
      "user[remember_me]": "1",
      commit: "Giriş yap",
    });
    if (spinner) form.append("spinner", spinner);

    const loginRes = await fetch(`${BASE}/users/sign_in`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader(cookies),
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LabIQ-Agent/1.0",
      },
      body: form.toString(),
      redirect: "manual",
    });

    const setCookies = [...(loginRes.headers.getSetCookie?.() ?? [])].map((c) => c.split(";")[0].trim());
    cookies = mergeCookies(cookies, setCookies);

    // 3) GET dashboard
    const dashRes = await fetch(`${BASE}/`, {
      headers: {
        Cookie: cookieHeader(cookies),
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LabIQ-Agent/1.0",
      },
    });
    const dashHtml = await dashRes.text();
    const dashCookies = [...(dashRes.headers.getSetCookie?.() ?? [])].map((c) => c.split(";")[0].trim());
    cookies = mergeCookies(cookies, dashCookies);

    const isBaşakşehir = dashHtml.includes("Başakşehir PPP");
    const activeCompanyKey: CompanyKey = isBaşakşehir ? "basaksehir" : "bursa";
    const activeCompany = COMPANIES.find((c) => c.id === activeCompanyKey)!;

    session = {
      cookies,
      companyKey: activeCompanyKey,
      companyId: activeCompany.companyId,
      companyLabel: activeCompany.label,
      loggedIn: true,
      csrfToken: extractMetaCSRF(dashHtml),
      exportStreamName: extractExportStreamName(dashHtml),
      lastUsed: Date.now(),
      userId: extractUserId(dashHtml),
    };
    if (!dashRes.url.includes("/users/sign_in") && !/name="user\[password\]"/.test(dashHtml)) {
      // giriş tamam
    } else {
      session.loggedIn = false;
      return { ok: false, error: "LabIQ girişi başarısız: e-posta ya da şifre hatalı olabilir (LABIQ_EMAIL / LABIQ_PASSWORD)." };
    }

    // Oturumu veritabanına kaydet (lambdalar arası paylaşım için)
    try {
      await store().setKV(SESSION_KV, session);
    } catch {}

    return { ok: true, company: session.companyLabel };
  } catch (e) {
    return { ok: false, error: `Labiq bağlantı hatası: ${(e as Error).message}` };
  }
}

/**
 * Oturumun güncel olduğunu garanti eder (bellek → Neon KV → yeniden giriş)
 */
export async function ensureSession(): Promise<{ ok: boolean; error?: string }> {
  // 1) Bellek kontrolü (aynı lambda içindeki çağrılar)
  if (session.loggedIn && Date.now() - session.lastUsed < 45 * 60_000) {
    session.lastUsed = Date.now();
    return { ok: true };
  }

  // 2) Veritabanı KV kontrolü (farklı lambdalar arası oturum paylaşımı)
  try {
    const saved = await store().getKV<LabiqSession>(SESSION_KV);
    if (saved && saved.loggedIn && saved.cookies?.length && Date.now() - (saved.lastUsed || 0) < 45 * 60_000) {
      session = { ...saved, lastUsed: Date.now() };
      return { ok: true };
    }
  } catch {}

  // 3) Oturum yok veya süresi dolmuşsa giriş yap
  return labiqLogin();
}

/**
 * Şirket değiştirir: Bursa PPP (226) <-> Başakşehir PPP (259)
 */
export async function switchCompany(target: CompanyKey | "226" | "259"): Promise<{ ok: boolean; company?: string; error?: string }> {
  const s = await ensureSession();
  if (!s.ok) return s;

  const targetMeta = COMPANIES.find((c) => c.id === target || c.companyId === target);
  if (!targetMeta) return { ok: false, error: `Geçersiz şirket: ${target}` };

  if (session.companyKey === targetMeta.id) {
    return { ok: true, company: targetMeta.label };
  }

  try {
    const userId = session.userId || USER_ID_ENV;
    if (!userId) return { ok: false, error: "LabIQ kullanıcı kimliği sayfadan okunamadı; hastane değiştirilemiyor." };
    const updateUrl = `${BASE}/companies/${session.companyId}/users/${userId}/update_last_sign_id`;
    const res = await fetch(updateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader(session.cookies),
        "X-CSRF-Token": session.csrfToken,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LabIQ-Agent/1.0",
      },
      body: new URLSearchParams({
        _method: "patch",
        authenticity_token: session.csrfToken,
        "user[last_signed_company_id]": targetMeta.companyId,
        commit: "Devam Et",
      }).toString(),
      redirect: "manual",
    });

    const setCookies = [...(res.headers.getSetCookie?.() ?? [])].map((c) => c.split(";")[0].trim());
    session.cookies = mergeCookies(session.cookies, setCookies);

    // Ana sayfayı kontrol et ve yeni stream adını al
    const dashRes = await fetch(`${BASE}/`, {
      headers: { Cookie: cookieHeader(session.cookies) },
    });
    const dashHtml = await dashRes.text();
    const dashCookies = [...(dashRes.headers.getSetCookie?.() ?? [])].map((c) => c.split(";")[0].trim());
    session.cookies = mergeCookies(session.cookies, dashCookies);

    session.companyKey = targetMeta.id;
    session.companyId = targetMeta.companyId;
    session.companyLabel = targetMeta.label;
    session.csrfToken = extractMetaCSRF(dashHtml);
    session.exportStreamName = extractExportStreamName(dashHtml);
    session.userId = extractUserId(dashHtml) || session.userId;
    session.lastUsed = Date.now();

    try {
      await store().setKV(SESSION_KV, session);
    } catch {}

    return { ok: true, company: session.companyLabel };
  } catch (e) {
    return { ok: false, error: `Şirket değiştirme hatası: ${(e as Error).message}` };
  }
}

/**
 * LabIQ'dan bir sayfanın HTML içeriğini ve tablosunu çeker
 */
export async function fetchPageData(path: string): Promise<{ ok: boolean; title?: string; rows?: string[][]; error?: string }> {
  const s = await ensureSession();
  if (!s.ok) return { ok: false, error: s.error };

  try {
    const url = path.startsWith("http") ? path : `${BASE}${path}`;
    const res = await fetch(url, {
      headers: {
        Cookie: cookieHeader(session.cookies),
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LabIQ-Agent/1.0",
      },
    });

    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const html = await res.text();

    const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";

    const trMatches = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    const rows = trMatches.slice(0, 20).map((tr) => {
      const cells = [...tr[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)];
      return cells.map((c) => c[1].replace(/<[^>]+>/g, "").trim());
    }).filter((r) => r.length > 0);

    return { ok: true, title, rows };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface ExportResult {
  ok: boolean;
  downloadUrl?: string;
  fileName?: string;
  company?: string;
  range?: string;
  error?: string;
}

/**
 * Ürün tüketimleri Excel raporunu LabIQ'dan indirir.
 * ActionCable WebSocket üzerinden dosya hazır olduğunda S3 bağlantısını yakalar.
 */
export async function downloadConsumptionReport(options?: {
  company?: CompanyKey;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  timeoutMs?: number;
}): Promise<ExportResult> {
  const s = await ensureSession();
  if (!s.ok) return { ok: false, error: s.error };

  // Şirket değiştirme talebi varsa önce şirketi değiştir
  if (options?.company && options.company !== session.companyKey) {
    const sw = await switchCompany(options.company);
    if (!sw.ok) return { ok: false, error: sw.error };
  }

  const timeoutMs = options?.timeoutMs ?? 25000;
  const start = options?.startDate ?? "2026-07-01";
  const end = options?.endDate ?? "2026-09-01";
  const movementDate = `${start} to ${end}`;

  if (!session.exportStreamName) {
    // Stream adı eksikse dashboard'u tekrar çek
    const dashRes = await fetch(`${BASE}/`, { headers: { Cookie: cookieHeader(session.cookies) } });
    const dashHtml = await dashRes.text();
    session.exportStreamName = extractExportStreamName(dashHtml);
  }

  return new Promise((resolve) => {
    let finished = false;
    let ws: WebSocket | null = null;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try { ws?.close(); } catch {}
        resolve({
          ok: false,
          error: "LabIQ rapor oluşturma zaman aşımına uğradı (25 sn). Lütfen tekrar deneyin.",
        });
      }
    }, timeoutMs);

    try {
      ws = new WebSocket(WS_BASE, {
        headers: {
          Cookie: cookieHeader(session.cookies),
          Origin: BASE,
        },
      } as unknown as string);

      ws.onopen = () => {
        ws?.send(
          JSON.stringify({
            command: "subscribe",
            identifier: JSON.stringify({
              channel: "Turbo::StreamsChannel",
              signed_stream_name: session.exportStreamName,
            }),
          })
        );
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "ping") return;

          if (data.type === "confirm_subscription") {
            // Abonelik onaylandı, dışa aktarmayı başlat
            const exportUrl = `${BASE}/product_consumptions/export_excel?${new URLSearchParams({
              movement_date: movementDate,
            }).toString()}`;

            const expRes = await fetch(exportUrl, {
              headers: {
                Cookie: cookieHeader(session.cookies),
                Accept: "text/vnd.turbo-stream.html",
              },
            });

            if (!expRes.ok) {
              finished = true;
              clearTimeout(timer);
              ws?.close();
              resolve({ ok: false, error: `LabIQ export tetiklenemedi: HTTP ${expRes.status}` });
              return;
            }
          }

          if (data.message && typeof data.message === "string") {
            const msg = data.message;
            if (msg.includes("href=") && (msg.includes("amazonaws.com") || msg.includes(".xlsx") || msg.includes("active_storage"))) {
              const urlMatch = msg.match(/href="([^"]+)"/);
              if (urlMatch?.[1]) {
                const rawUrl = urlMatch[1].replace(/&amp;/g, "&");
                finished = true;
                clearTimeout(timer);
                ws?.close();

                // Dosya adını URL'den çıkar
                const fnMatch = rawUrl.match(/filename%2A%3DUTF-8%27%27([^&]+)/i) || rawUrl.match(/filename%3D%22([^"]+)%22/i);
                const fileName = fnMatch ? decodeURIComponent(fnMatch[1]) : `Urun_Kullanim_${start}_${end}.xlsx`;

                resolve({
                  ok: true,
                  downloadUrl: rawUrl,
                  fileName,
                  company: session.companyLabel,
                  range: `${start} — ${end}`,
                });
              }
            }
          }
        } catch (err) {
          // JSON ayrıştırma hatası yoksayılır
        }
      };

      ws.onerror = (err) => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          const errMsg = (err as unknown as { message?: string })?.message ?? "WebSocket bağlantı hatası";
          resolve({ ok: false, error: `WebSocket bağlantı hatası: ${errMsg}` });
        }
      };
    } catch (e) {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve({ ok: false, error: `Bağlantı kurulamadı: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  });
}

/**
 * Türkçe doğal dil komutlarını çözer:
 * örn. "1 temmuz 1 eylül arasındaki tüketimleri indir"
 * örn. "Başakşehir PPP temmuz ayı tüketimlerini çek"
 * örn. "Bursa hastanesine geç"
 */
export function parseAgentCommand(cmd: string): {
  action: "export_consumption" | "switch_company" | "status" | "unknown";
  company?: CompanyKey;
  startDate?: string;
  endDate?: string;
  summary: string;
} {
  const lower = cmd.toLowerCase().trim();

  // Şirket tespiti
  let detectedCompany: CompanyKey | undefined;
  if (lower.includes("başakşehir") || lower.includes("basaksehir")) {
    detectedCompany = "basaksehir";
  } else if (lower.includes("bursa")) {
    detectedCompany = "bursa";
  }

  // Sadece şirket değiştirme komutu mu?
  if (
    (lower.includes("geç") || lower.includes("şirket") || lower.includes("hastane") || lower.includes("seç")) &&
    !lower.includes("indir") &&
    !lower.includes("tüketim") &&
    !lower.includes("rapor")
  ) {
    if (detectedCompany) {
      return {
        action: "switch_company",
        company: detectedCompany,
        summary: `${detectedCompany === "bursa" ? "Bursa PPP" : "Başakşehir PPP"} şirketine geçiş yapılıyor`,
      };
    }
  }

  // Durum kontrolü
  if (lower.includes("durum") || lower.includes("bağlantı") || lower.includes("neredesin") || lower.includes("hangi şirket")) {
    return {
      action: "status",
      summary: "LabIQ oturum ve aktif hastane durumu kontrol ediliyor",
    };
  }

  // Tüketim indirme / export komutu
  const isConsumption =
    lower.includes("tüketim") ||
    lower.includes("kullanım") ||
    lower.includes("indir") ||
    lower.includes("rapor") ||
    lower.includes("çek") ||
    lower.includes("al");

  if (isConsumption) {
    // Ay isimleri eşleşmesi
    const months: Record<string, string> = {
      ocak: "01",
      şubat: "02",
      subat: "02",
      mart: "03",
      nisan: "04",
      mayıs: "05",
      mayis: "05",
      haziran: "06",
      temmuz: "07",
      ağustos: "08",
      agustos: "08",
      eylül: "09",
      eylul: "09",
      ekim: "10",
      kasım: "11",
      kasim: "11",
      aralık: "12",
      aralik: "12",
    };

    const currentYear = new Date().getFullYear(); // 2026

    let start = `${currentYear}-07-01`;
    let end = `${currentYear}-09-01`;

    const monthNames = Object.keys(months).join("|");
    const regex = new RegExp(`(\\d{1,2})\\s+(${monthNames})(?:\\s+(\\d{4}))?(?:\\s*(?:ile|-|ve|ila)?\\s*)(\\d{1,2})\\s+(${monthNames})(?:\\s+(\\d{4}))?`, "i");
    const m = lower.match(regex);

    if (m) {
      const d1 = m[1].padStart(2, "0");
      const m1 = months[m[2].toLowerCase()];
      const y1 = m[3] || String(currentYear);

      const d2 = m[4].padStart(2, "0");
      const m2 = months[m[5].toLowerCase()];
      const y2 = m[6] || y1;

      if (m1 && m2) {
        start = `${y1}-${m1}-${d1}`;
        end = `${y2}-${m2}-${d2}`;
      }
    } else {
      // DD.MM.YYYY veya YYYY-MM-DD
      const numRange = lower.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?\s*(?:ile|-|ve|ila)?\s*(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?/);
      if (numRange) {
        const d1 = numRange[1].padStart(2, "0");
        const m1 = numRange[2].padStart(2, "0");
        const y1 = numRange[3] || String(currentYear);
        const d2 = numRange[4].padStart(2, "0");
        const m2 = numRange[5].padStart(2, "0");
        const y2 = numRange[6] || y1;
        start = `${y1}-${m1}-${d1}`;
        end = `${y2}-${m2}-${d2}`;
      } else {
        // Tek ay belirtilmiş mi? örn: "temmuz ayı"
        for (const [mName, mNum] of Object.entries(months)) {
          if (lower.includes(mName)) {
            start = `${currentYear}-${mNum}-01`;
            const lastDay = new Date(currentYear, Number(mNum), 0).getDate();
            end = `${currentYear}-${mNum}-${String(lastDay).padStart(2, "0")}`;
            break;
          }
        }
      }
    }

    return {
      action: "export_consumption",
      company: detectedCompany,
      startDate: start,
      endDate: end,
      summary: `${detectedCompany ? (detectedCompany === "bursa" ? "Bursa PPP" : "Başakşehir PPP") + " " : ""}${start} – ${end} arası ürün tüketim raporu hazırlanıyor`,
    };
  }

  return {
    action: "unknown",
    summary: "Komut anlaşılamadı. Örn: '1 temmuz 1 eylül arasındaki tüketimleri indir'",
  };
}

/**
 * Oturum durumunu döndürür
 */
export function getLabiqStatus() {
  return {
    loggedIn: session.loggedIn,
    companyKey: session.companyKey,
    companyId: session.companyId,
    companyLabel: session.companyLabel,
    user: EMAIL,
    lastUsed: session.lastUsed ? new Date(session.lastUsed).toISOString() : null,
  };
}


// ------------------------------------------------------------------ genel istek ve dışa aktarma (ajanın gezinme araçları için)
/**
 * Oturumla LabIQ isteği: çerezleri ekler, yenilerini saklar; oturum düşmüşse bir kez yeniden giriş yapıp tekrar dener.
 */
export async function labiqFetch(pathOrUrl: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const s = await ensureSession();
  if (!s.ok) throw new Error(s.error ?? "LabIQ oturumu açılamadı");
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
  const res = await fetch(url, { ...init, headers: { "User-Agent": UA, Cookie: cookieHeader(session.cookies), ...(init.headers ?? {}) } });
  const set = [...(res.headers.getSetCookie?.() ?? [])];
  if (set.length) {
    session.cookies = mergeCookies(session.cookies, set);
    store().setKV(SESSION_KV, session).catch(() => {});
  }
  if (retry && res.url.includes("/users/sign_in")) {
    session.loggedIn = false;
    const again = await labiqLogin();
    if (!again.ok) throw new Error(again.error ?? "LabIQ'ya yeniden giriş yapılamadı");
    return labiqFetch(pathOrUrl, init, false);
  }
  return res;
}

export const sessionCsrf = () => session.csrfToken;
export const sameHost = (url: string) => url.startsWith(BASE) || url.startsWith("/");

/**
 * Dışa aktarma: önce LabIQ'nun canlı kanalına (ActionCable) abone olur, sonra dışa aktarmayı tetikler.
 * Sunucu dosyayı doğrudan döndürürse onu, kanal üzerinden bağlantı gönderirse o bağlantıyı verir.
 */
export async function exportViaCable(exportUrl: string, timeoutMs = 25000): Promise<{ ok: true; file?: { buf: Buffer; name: string; type: string }; downloadUrl?: string; fileName?: string } | { ok: false; error: string }> {
  const s = await ensureSession();
  if (!s.ok) return { ok: false, error: s.error ?? "oturum yok" };
  if (!session.exportStreamName) {
    const dash = await labiqFetch("/");
    session.exportStreamName = extractExportStreamName(await dash.text());
  }
  const trigger = async () => {
    // Rails, sonu "*/*" ile biten Accept başlığını "tarayıcı" sayıp yok sayar → yalnızca turbo_stream yanıtlayan
    // dışa aktarma 406 döner. Bu yüzden önce yalnız Turbo Stream (eski çalışan yol), sonra düz GET, sonra POST denenir.
    const tries: RequestInit[] = [
      { headers: { Accept: "text/vnd.turbo-stream.html" } },
      { headers: { Accept: "text/vnd.turbo-stream.html, text/html, application/xhtml+xml" } },
      { headers: { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } },
      { method: "POST", headers: { Accept: "text/vnd.turbo-stream.html", "X-CSRF-Token": session.csrfToken, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ authenticity_token: session.csrfToken }).toString() },
    ];
    let res: Response | null = null;
    const fails: string[] = [];
    for (const t of tries) {
      const r = await labiqFetch(exportUrl, t);
      if (r.ok) {
        res = r;
        break;
      }
      const snippet = (await r.text().catch(() => "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
      fails.push(`${t.method ?? "GET"} ${String((t.headers as Record<string, string>).Accept).split(",")[0]} → HTTP ${r.status}${snippet ? ` (${snippet})` : ""}`);
      if (![404, 405, 406, 415, 422].includes(r.status)) break;
    }
    if (!res) return { error: `LabIQ dışa aktarma isteği reddedildi — ${exportUrl.split("?")[0]}: ${fails.join(" · ")}` };
    const type = res.headers.get("content-type") ?? "";
    const disp = res.headers.get("content-disposition") ?? "";
    if (/spreadsheet|excel|csv|octet-stream|pdf/i.test(type) || /attachment/i.test(disp)) {
      const name = decodeURIComponent(disp.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ?? disp.match(/filename="?([^";]+)/i)?.[1] ?? "labiq-rapor.xlsx");
      return { file: { buf: Buffer.from(await res.arrayBuffer()), name, type } };
    }
    const body = await res.text();
    const href = body.match(/href="([^"]+(?:amazonaws|active_storage|\.xlsx|\.csv)[^"]*)"/)?.[1];
    return href ? { href: href.replace(/&amp;/g, "&") } : {};
  };
  if (!session.exportStreamName) {
    // canlı kanal yok: yalnızca doğrudan dosya
    const r = await trigger();
    if ("error" in r && r.error) return { ok: false, error: r.error };
    if ("file" in r && r.file) return { ok: true, file: r.file };
    if ("href" in r && r.href) return { ok: true, downloadUrl: r.href };
    return { ok: false, error: "Dışa aktarma dosya ya da bağlantı döndürmedi" };
  }
  return new Promise((resolve) => {
    let done = false;
    let ws: WebSocket | null = null;
    const finish = (v: Parameters<typeof resolve>[0]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {}
      resolve(v);
    };
    const timer = setTimeout(() => finish({ ok: false, error: `LabIQ dosyayı ${Math.round(timeoutMs / 1000)} sn içinde hazırlamadı` }), timeoutMs);
    try {
      ws = new WebSocket(WS_BASE, { headers: { Cookie: cookieHeader(session.cookies), Origin: BASE } } as unknown as string);
      ws.onopen = () =>
        ws?.send(JSON.stringify({ command: "subscribe", identifier: JSON.stringify({ channel: "Turbo::StreamsChannel", signed_stream_name: session.exportStreamName }) }));
      ws.onmessage = async (ev) => {
        try {
          const data = JSON.parse(String(ev.data));
          if (data.type === "confirm_subscription") {
            const r = await trigger();
            if ("error" in r && r.error) finish({ ok: false, error: r.error });
            else if ("file" in r && r.file) finish({ ok: true, file: r.file });
            else if ("href" in r && r.href) finish({ ok: true, downloadUrl: r.href });
            return;
          }
          const msg = typeof data.message === "string" ? data.message : "";
          const href = msg.match(/href="([^"]+)"/)?.[1];
          if (href && /amazonaws|active_storage|\.xlsx|\.csv|\.pdf/i.test(href)) {
            const raw = href.replace(/&amp;/g, "&");
            const fn = raw.match(/filename%2A%3DUTF-8%27%27([^&]+)/i)?.[1] ?? raw.match(/filename%3D%22([^"&]+)%22/i)?.[1];
            finish({ ok: true, downloadUrl: raw, fileName: fn ? decodeURIComponent(fn) : undefined });
          }
        } catch {}
      };
      ws.onerror = () => finish({ ok: false, error: "LabIQ canlı kanalına bağlanılamadı" });
    } catch (e) {
      finish({ ok: false, error: `Bağlantı kurulamadı: ${(e as Error).message}` });
    }
  });
}

/** Dışa aktarılan dosyayı indirir (LabIQ adresine çerezle, S3 gibi dış adrese çerezsiz) */
export async function fetchFile(url: string) {
  const res = sameHost(url) ? await labiqFetch(url) : await fetch(url);
  if (!res.ok) throw new Error(`Dosya indirilemedi: HTTP ${res.status}`);
  return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "" };
}
