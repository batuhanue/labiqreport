import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { norm } from "./archive";

/*
 * LabIQ ajan eğitim paketi (knowledge/labiq/): ajan promptu (sistem promptu olur) ve 56 ekranlık teknik rapor
 * (labiq_screen_guide ile bölüm bölüm aranır). Brain'in genel bilgi dosyalarına girmez (yalnızca LabIQ ajanı okur).
 */

const dir = () => path.join(process.cwd(), "knowledge", "labiq");
let cache: { prompt: string; report: string; sections: { head: string; body: string }[] } | null = null;

async function load() {
  if (cache) return cache;
  const read = (f: string) => fs.readFile(path.join(dir(), f), "utf8").catch(() => "");
  const [prompt, report] = await Promise.all([read("ajan-promptu.md"), read("teknik-rapor.md")]);
  const sections: { head: string; body: string }[] = [];
  let cur: { head: string; body: string } | null = null;
  for (const line of report.split("\n")) {
    if (/^#{2,3} /.test(line)) {
      if (cur) sections.push(cur);
      cur = { head: line.replace(/^#+\s*/, ""), body: "" };
    } else if (cur) cur.body += `${line}\n`;
  }
  if (cur) sections.push(cur);
  cache = { prompt, report, sections };
  return cache;
}

export async function agentPrompt() {
  return (await load()).prompt;
}

/** Teknik rapordan konuya en uygun bölümler (başlık eşleşmesi ağırlıklı) */
export async function screenGuide(topic: string, max = 7000) {
  const { sections } = await load();
  if (!sections.length) return { bulunamadi: "Teknik rapor (knowledge/labiq/teknik-rapor.md) yüklenemedi." };
  const terms = norm(topic)
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length >= 2);
  const scored = sections
    .map((s, i) => {
      const h = norm(s.head);
      const b = norm(s.body);
      const score = terms.reduce((n, t) => n + (h.includes(t) ? 5 : 0) + Math.min(3, b.split(t).length - 1), 0);
      return { s, i, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const out: string[] = [];
  let len = 0;
  for (const x of scored) {
    const block = `## ${x.s.head}\n${x.s.body.trim()}`;
    if (len + block.length > max) break;
    out.push(block);
    len += block.length;
  }
  return out.length ? { bolumler: out.join("\n\n") } : { bulunamadi: `“${topic}” için bölüm yok. Başlıklar: ${sections.map((s) => s.head).slice(0, 60).join(" · ")}` };
}
