import { bad, handle } from "@/lib/api";
import { getItem } from "@/lib/archive";
import { fileText, getFileMeta, kindOf, listFiles, readable, type DriveView } from "@/lib/drive";
import { authed, DRIVE_SCOPE, explain } from "@/lib/google";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const VIEWS: DriveView[] = ["recent", "shared", "starred", "folder", "search"];
const ID = /^[\w-]{1,200}$/;

/**
 * GET ?view=recent|shared|starred|folder|search&q=&folder=&page= : dosya listesi (canlı Drive)
 * GET ?id=… : tek dosyanın bilgisi ve metni (uygulama içinde okumak için; Drive'a ulaşılamazsa arşivden)
 */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const id = u.get("id");
  return handle(async () => {
    const { auth, get, token } = await authed();
    if (!auth.scopes?.includes(DRIVE_SCOPE)) return bad("Drive izni yok: hesabı yeniden bağla ve Drive kutusunu işaretle.", 403);

    if (id) {
      if (!ID.test(id)) return bad("Geçersiz dosya");
      try {
        const file = await getFileMeta(get, id);
        let text: string | null = null;
        let textError: string | undefined;
        if (readable(file)) {
          try {
            text = await fileText(token, file);
          } catch (e) {
            textError = explain("Drive", e);
          }
        }
        return { file, kind: kindOf(file.mime), text, textError, live: true };
      } catch (e) {
        const x = await getItem("drive", id).catch(() => null);
        if (!x) return bad(explain("Drive", e), 502);
        const m = (x.meta ?? {}) as { mime?: string; owner?: string; modifiedBy?: string; size?: number };
        return {
          file: { id, name: x.title, mime: m.mime ?? "", modified: x.ts, owner: m.owner, modifiedBy: m.modifiedBy, size: m.size, link: x.link ?? "" },
          kind: kindOf(m.mime ?? ""),
          text: x.body.replace(/^Tür: .*\n\n/, ""),
          live: false,
        };
      }
    }

    const view = (u.get("view") ?? "recent") as DriveView;
    if (!VIEWS.includes(view)) return bad("Geçersiz görünüm");
    const folder = u.get("folder") ?? undefined;
    if (folder && folder !== "root" && !ID.test(folder)) return bad("Geçersiz klasör");
    try {
      return await listFiles(get, { view, q: u.get("q") ?? undefined, folder, pageToken: u.get("page") ?? undefined });
    } catch (e) {
      return bad(explain("Drive", e), 502);
    }
  });
}
