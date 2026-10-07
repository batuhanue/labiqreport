"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { emptyStore, nextDue, type Todo, type TodoStore } from "@/lib/todo";

interface Ctx {
  store: TodoStore;
  loaded: boolean;
  mutate: (fn: (s: TodoStore) => TodoStore) => void;
  add: (t: Todo) => void;
  patch: (id: string, p: Partial<Todo>) => void;
  toggle: (id: string) => void;
  remove: (id: string) => Todo | undefined;
  restore: (t: Todo) => void;
}
const TodoCtx = createContext<Ctx | null>(null);
export const useTodos = () => useContext(TodoCtx)!;

const LS = "lq:todos";

export function TodoProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<TodoStore>(emptyStore);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(store);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      let local: TodoStore | null = null;
      try {
        local = JSON.parse(localStorage.getItem(LS) || "null");
      } catch {}
      try {
        const r = await fetch("/api/todos", { cache: "no-store" });
        if (r.ok) {
          const remote = (await r.json()) as TodoStore;
          // çevrimdışıyken yapılan değişiklik daha yeniyse onu kullan ve gönder
          const pick = local && local.updatedAt > remote.updatedAt ? local : remote;
          ref.current = pick;
          setStore(pick);
          if (pick === local) schedule();
        } else if (local) {
          ref.current = local;
          setStore(local);
        }
      } catch {
        if (local) {
          ref.current = local;
          setStore(local);
        }
      }
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flush = useCallback(async () => {
    try {
      await fetch("/api/todos", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ref.current), keepalive: true });
    } catch {
      timer.current = setTimeout(flush, 5000);
    }
  }, []);
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
  }, [flush]);

  const mutate = useCallback(
    (fn: (s: TodoStore) => TodoStore) => {
      const next = { ...fn(ref.current), updatedAt: new Date().toISOString() };
      ref.current = next;
      setStore(next);
      try {
        localStorage.setItem(LS, JSON.stringify(next));
      } catch {}
      schedule();
    },
    [schedule],
  );

  const add = useCallback((t: Todo) => mutate((s) => ({ ...s, todos: [t, ...s.todos] })), [mutate]);
  const patch = useCallback(
    (id: string, p: Partial<Todo>) => mutate((s) => ({ ...s, todos: s.todos.map((t) => (t.id === id ? { ...t, ...p, updatedAt: new Date().toISOString() } : t)) })),
    [mutate],
  );
  const toggle = useCallback(
    (id: string) =>
      mutate((s) => {
        const t = s.todos.find((x) => x.id === id);
        if (!t) return s;
        const now = new Date().toISOString();
        if (!t.done && t.recur) {
          // tekrarlayan: bu örnek tamamlanır, bir sonraki oluşturulur
          const next: Todo = { ...t, id: Math.random().toString(36).slice(2, 9) + Date.now().toString(36), due: nextDue(t), done: false, doneAt: undefined, subtasks: t.subtasks.map((x) => ({ ...x, done: false })), createdAt: now, updatedAt: now };
          return { ...s, todos: [next, ...s.todos.map((x) => (x.id === id ? { ...x, done: true, doneAt: now, recur: undefined, updatedAt: now } : x))] };
        }
        return { ...s, todos: s.todos.map((x) => (x.id === id ? { ...x, done: !x.done, doneAt: !x.done ? now : undefined, updatedAt: now } : x)) };
      }),
    [mutate],
  );
  const remove = useCallback(
    (id: string) => {
      const t = ref.current.todos.find((x) => x.id === id);
      mutate((s) => ({ ...s, todos: s.todos.filter((x) => x.id !== id) }));
      return t;
    },
    [mutate],
  );
  const restore = useCallback((t: Todo) => mutate((s) => ({ ...s, todos: [t, ...s.todos.filter((x) => x.id !== t.id)] })), [mutate]);

  const value = useMemo(() => ({ store, loaded, mutate, add, patch, toggle, remove, restore }), [store, loaded, mutate, add, patch, toggle, remove, restore]);
  return <TodoCtx.Provider value={value}>{children}</TodoCtx.Provider>;
}
