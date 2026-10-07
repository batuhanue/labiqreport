import { store } from "@/lib/db";
import { bad, handle } from "@/lib/api";
import { emptyStore, type TodoStore } from "@/lib/todo";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => (await store().getKV<TodoStore>("todos")) ?? emptyStore());
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as TodoStore | null;
  if (!body || !Array.isArray(body.todos)) return bad("Geçersiz veri");
  return handle(async () => {
    const data: TodoStore = { todos: body.todos.slice(0, 5000), dismissed: (body.dismissed ?? []).slice(-500), updatedAt: new Date().toISOString() };
    await store().setKV("todos", data);
    return { ok: true, updatedAt: data.updatedAt };
  });
}
