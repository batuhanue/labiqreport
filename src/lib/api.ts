import "server-only";
import { NextResponse } from "next/server";
import { StorageNotConfigured } from "./db";

export async function handle<T>(fn: () => Promise<T>) {
  try {
    const out = await fn();
    return out instanceof Response ? out : NextResponse.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e instanceof StorageNotConfigured ? 503 : 500;
    console.error(e);
    return NextResponse.json({ error: msg }, { status });
  }
}

export const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
