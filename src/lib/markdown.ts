import { Marked } from "marked";

/** Güvenli markdown: ham HTML çalıştırılmaz, yalnızca http(s)/mailto bağlantıları. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html(t) {
      return esc(t.text ?? t.raw ?? "");
    },
    link(t) {
      const href = /^(https?:|mailto:)/i.test(t.href) ? t.href : "#";
      return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(t.text)}</a>`;
    },
    image(t) {
      return esc(t.text ?? "");
    },
  },
});
export const renderMd = (text: string) => md.parse(text) as string;
