import { bad, handle } from "@/lib/api";
import { listBriefs, prepare, removeBrief, upcomingMeetings } from "@/lib/prepare";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Hazırla: GET → geçmiş notlar + yaklaşan toplantılar · POST { request, meetingId? } → not · DELETE ?id= */
export async function GET() {
  return handle(async () => ({ briefs: await listBriefs(), meetings: await upcomingMeetings() }));
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { request?: string; meetingId?: string } | null;
  if (!b?.request?.trim() && !b?.meetingId) return bad("Ne hazırlayayım?");
  if ((b.request ?? "").length > 2000) return bad("İstek çok uzun");
  return handle(async () => ({ brief: await prepare({ request: b.request ?? "", meetingId: b.meetingId }) }));
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id gerekli");
  return handle(async () => (await removeBrief(id), { ok: true }));
}
