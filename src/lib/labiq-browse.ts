import "server-only";
import { store } from "./db";
import { BASE, labiqFetch } from "./labiq";

/*
 * LabIQ'da bir kullanıcı gibi gezinme: menüden site haritası, sayfanın filtre formu, tabloları, dışa aktarma
 * düğmeleri ve sayfalaması. LabIQ sunucu taraflı (Rails + Turbo) sayfalar üretir; filtreler form alanlarıdır ve
 * "Filtrele" formu GET ile gönderir — ajan aynı alan adlarıyla sorgu parametresi vererek filtre uygular.
 * Dış kütüphane yok: hoşgörülü küçük bir HTML okuyucu.
 */

export interface PageLink {
  label: string;
  path: string;
  /** menüdeki üst başlık (Stok, Cihaz, Maliyet…) */
  group?: string;
}
export interface FormField {
  name: string;
  label?: string;
  type: string;
  value?: string;
  placeholder?: string;
  options?: { value: string; label: string; selected?: boolean }[];
  optionCount?: number;
}
export interface PageForm {
  action: string;
  method: string;
  fields: FormField[];
  submit?: string;
}
export interface PageTable {
  headers: string[];
  rows: string[][];
  totalRows: number;
}
export interface PageView {
  url: string;
  title: string;
  forms: PageForm[];
  tables: PageTable[];
  exports: { label: string; href: string; method: string }[];
  tabs: PageLink[];
  pagination?: { pages: number[]; next?: string; current?: number };
  notices: string[];
  totalHint?: string;
  frames: string[];
}

// ------------------------------------------------------------------ küçük HTML yardımcıları
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
export const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e.toLowerCase()] ?? m)));
export const text = (html: string) =>
  decode(
    html
      .replace(/<(script|style|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decode(m[1] ?? m[2] ?? m[3] ?? "") : undefined;
};
const internal = (href: string) => {
  if (!href || href.startsWith("#") || /^(javascript|mailto|tel):/i.test(href)) return null;
  if (href.startsWith(BASE)) return href.slice(BASE.length) || "/";
  if (/^https?:\/\//i.test(href)) return null;
  return href.startsWith("/") ? href : `/${href}`;
};
const blocks = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map((m) => ({ open: `<${tag}${m[1]}>`, inner: m[2] }));
const SKIP = /sign_out|logout|cikis|\/users\/edit|\.(css|js|png|jpe?g|svg|ico)(\?|$)|\/rails\/active_storage|\/assets\//i;
const WRITE = /\b(new|edit|destroy|delete|create|update|approve|cancel|sync|import|senkron)\b|\/new\b|\/edit\b/i;

// ------------------------------------------------------------------ site haritası
/** Menüden (ana sayfadaki tüm iç bağlantılar) sayfa listesi; şirket başına 12 saat önbellekte */
export async function siteMap(opts: { refresh?: boolean; companyId?: string } = {}): Promise<PageLink[]> {
  const key = `labiq-sitemap-${opts.companyId ?? "x"}`;
  if (!opts.refresh) {
    const c = await store().getKV<{ at: number; links: PageLink[] }>(key).catch(() => null);
    if (c && Date.now() - c.at < 12 * 3600_000 && c.links.length) return c.links;
  }
  const html = await (await labiqFetch("/")).text();
  const links = parseNav(html);
  await store().setKV(key, { at: Date.now(), links }).catch(() => {});
  return links;
}

export function parseNav(html: string): PageLink[] {
  const out = new Map<string, PageLink>();
  // menü başlıklarını takip et: <li> içinde başlık + alt <ul> yapısı ya da data-title/aria-label
  const nav = html.match(/<(nav|aside)\b[\s\S]*?<\/\1>/gi)?.join("\n") ?? html;
  let group = "";
  for (const m of nav.matchAll(/<(a|span|div|p|h[1-6]|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const [, tag, rawAttrs, inner] = m;
    const open = `<${tag}${rawAttrs}>`;
    const label = text(inner) || attr(open, "title") || attr(open, "aria-label") || attr(open, "data-title") || "";
    if (tag.toLowerCase() !== "a") {
      // alt menüyü açan başlık (chevron/collapse düğmesi ya da başlık metni)
      if (label && label.length < 40 && /collapse|toggle|menu-title|nav-header|heading|section|group|sidebar/i.test(rawAttrs)) group = label;
      continue;
    }
    const path = internal(attr(open, "href") ?? "");
    if (!path || path === "/" || SKIP.test(path) || WRITE.test(path.split("?")[0]) || !label || label.length > 80) continue;
    if (!out.has(path)) out.set(path, { label, path, group: group || undefined });
  }
  return [...out.values()];
}

// ------------------------------------------------------------------ sayfa okuma
export function parseForms(html: string): PageForm[] {
  return blocks(html, "form")
    .map(({ open, inner }) => {
      const labels = new Map<string, string>();
      for (const l of blocks(inner, "label")) {
        const f = attr(l.open, "for");
        if (f) labels.set(f, text(l.inner));
      }
      const fields: FormField[] = [];
      for (const m of inner.matchAll(/<input\b[^>]*>/gi)) {
        const tag = m[0];
        const name = attr(tag, "name");
        const type = (attr(tag, "type") ?? "text").toLowerCase();
        if (!name || ["submit", "button", "image", "reset"].includes(type) || name === "authenticity_token" || name === "utf8") continue;
        if (type === "hidden" && !/date|period|company|lab|depo|warehouse|product|test|status|tab|type|q\[/i.test(name)) continue;
        const id = attr(tag, "id");
        fields.push({ name, type, value: type === "checkbox" ? (/\schecked\b/i.test(tag) ? attr(tag, "value") ?? "on" : "") : attr(tag, "value"), placeholder: attr(tag, "placeholder"), label: (id && labels.get(id)) || attr(tag, "aria-label") || attr(tag, "placeholder") });
      }
      for (const s of blocks(inner, "select")) {
        const name = attr(s.open, "name");
        if (!name) continue;
        const id = attr(s.open, "id");
        const options = [...s.inner.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((o) => ({ value: attr(`<o${o[1]}>`, "value") ?? text(o[2]), label: text(o[2]), selected: /\sselected\b/i.test(o[1]) || undefined }));
        fields.push({ name, type: /\smultiple\b/i.test(s.open) ? "select-multiple" : "select", label: (id && labels.get(id)) || attr(s.open, "aria-label") || attr(s.open, "data-placeholder"), options: options.slice(0, 60), optionCount: options.length, value: options.find((o) => o.selected)?.value });
      }
      for (const t of blocks(inner, "textarea")) {
        const name = attr(t.open, "name");
        if (name) fields.push({ name, type: "textarea", value: text(t.inner) });
      }
      const submit = inner.match(/<(?:button|input)\b[^>]*type="submit"[^>]*>(?:([\s\S]*?)<\/button>)?/i);
      return { action: internal(attr(open, "action") ?? "") ?? "", method: (attr(open, "method") ?? "get").toLowerCase(), fields, submit: submit ? text(submit[1] ?? "") || attr(submit[0], "value") : undefined };
    })
    .filter((f) => f.fields.length && !/sign_in|password/.test(f.action + f.fields.map((x) => x.name).join()));
}

export function parseTables(html: string, maxRows = 40): PageTable[] {
  return blocks(html, "table")
    .map(({ inner }) => {
      const trs = blocks(inner, "tr");
      let headers: string[] = [];
      const rows: string[][] = [];
      for (const tr of trs) {
        const ths = blocks(tr.inner, "th").map((c) => text(c.inner));
        const tds = blocks(tr.inner, "td").map((c) => text(c.inner));
        if (ths.length && !tds.length && !headers.length) headers = ths;
        else if (tds.length) rows.push(ths.length ? [...ths, ...tds] : tds);
      }
      const empty = rows.length === 1 && rows[0].length === 1;
      return { headers, rows: empty ? [] : rows.slice(0, maxRows), totalRows: empty ? 0 : rows.length, emptyText: empty ? rows[0][0] : undefined };
    })
    .filter((t) => t.headers.length || t.rows.length)
    .map(({ headers, rows, totalRows }) => ({ headers, rows, totalRows }));
}

export function parsePage(html: string, url: string): PageView {
  const title = text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "") || text(html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "") || text(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const exports: PageView["exports"] = [];
  const tabs: PageLink[] = [];
  const pages = new Set<number>();
  let next: string | undefined;
  for (const m of html.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const open = `<${m[1]}${m[2]}>`;
    const label = text(m[3]) || attr(open, "title") || attr(open, "aria-label") || "";
    const href = internal(attr(open, "href") ?? attr(open, "formaction") ?? attr(open, "data-url") ?? attr(open, "data-href") ?? "");
    if (!href) continue;
    if (/export|excel|xlsx|csv|pdf|download|indir/i.test(href) || /dışa aktar|excel|indir|export/i.test(label)) exports.push({ label: label || "Dışa aktar", href, method: (attr(open, "data-turbo-method") ?? attr(open, "data-method") ?? "get").toLowerCase() });
    const pg = href.match(/[?&]page=(\d+)/)?.[1];
    if (pg) {
      pages.add(Number(pg));
      if (/sonraki|next|›|»/i.test(label) || attr(open, "rel") === "next") next = href;
    }
    if (/tab|sekme/i.test(m[2]) && label && !WRITE.test(href)) tabs.push({ label, path: href });
  }
  for (const f of blocks(html, "form")) {
    const action = internal(attr(f.open, "action") ?? "");
    if (action && /export|excel|xlsx|csv/i.test(action)) exports.push({ label: text(f.inner).slice(0, 40) || "Dışa aktar", href: action, method: (attr(f.open, "method") ?? "get").toLowerCase() });
  }
  const body = text(html);
  const notices = [/gösterilecek kayıt bulunamadı/i, /kayıt bulunamadı/i, /sonuçları görmek için[^.]*/i, /ürün seçilmedi/i, /grafik görmek için[^.]*/i, /yetkiniz yok[^.]*/i]
    .map((r) => body.match(r)?.[0])
    .filter((x): x is string => !!x);
  const totalHint = body.match(/(?:toplam\s*:?\s*[\d.]+\s*kayıt|[\d.]+\s*kayıttan\s*[\d.]+\s*-\s*[\d.]+|showing\s+\d+\s+to\s+\d+\s+of\s+[\d,]+|[\d.]+\s+kayıt)/i)?.[0];
  const frames = [...html.matchAll(/<turbo-frame\b[^>]*\ssrc="([^"]+)"/gi)].map((m) => internal(decode(m[1]))).filter((x): x is string => !!x);
  const uniq = <T,>(xs: T[], k: (x: T) => string) => [...new Map(xs.map((x) => [k(x), x])).values()];
  return {
    url,
    title,
    forms: parseForms(html),
    tables: parseTables(html),
    exports: uniq(exports, (x) => x.href),
    tabs: uniq(tabs, (x) => x.path).slice(0, 15),
    pagination: pages.size ? { pages: [...pages].sort((a, b) => a - b), next, current: Number(new URL(url, BASE).searchParams.get("page") ?? 1) } : undefined,
    notices,
    totalHint,
    frames,
  };
}

/** Sorgu parametreleri: { "q[date]": "...", "lab_ids[]": ["1","2"] } */
export type Params = Record<string, string | number | boolean | (string | number)[] | null | undefined>;
export function withParams(path: string, params?: Params) {
  const u = new URL(path, BASE);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v == null || v === "") continue;
    if (Array.isArray(v)) {
      u.searchParams.delete(k);
      for (const x of v) u.searchParams.append(k, String(x));
    } else u.searchParams.set(k, String(v));
  }
  return u.pathname + u.search;
}

/** Sayfayı (filtrelerle) açar; tembel yüklenen Turbo çerçevelerinin tablolarını da getirir */
export async function openPage(path: string, params?: Params): Promise<PageView> {
  if (WRITE.test(path.split("?")[0])) throw new Error("Bu adres bir yazma/düzenleme sayfası gibi görünüyor; ajan salt-okunur çalışır.");
  const url = withParams(path, params);
  const res = await labiqFetch(url, { headers: { Accept: "text/html, application/xhtml+xml" } });
  if (!res.ok) throw new Error(`LabIQ sayfası açılamadı: HTTP ${res.status}`);
  const html = await res.text();
  const view = parsePage(html, url);
  for (const f of view.frames.slice(0, 3)) {
    try {
      const fr = await labiqFetch(withParams(f, params), { headers: { Accept: "text/html", "Turbo-Frame": "1" } });
      if (!fr.ok) continue;
      const sub = parsePage(await fr.text(), f);
      view.tables.push(...sub.tables);
      view.exports.push(...sub.exports.filter((e) => !view.exports.some((x) => x.href === e.href)));
      if (!view.pagination && sub.pagination) view.pagination = sub.pagination;
      view.notices.push(...sub.notices);
      view.totalHint ??= sub.totalHint;
    } catch {}
  }
  return view;
}
