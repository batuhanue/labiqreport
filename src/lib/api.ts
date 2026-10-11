import "server-only";
import { NextResponse } from "next/server";
import { StorageNotConfigured } from "./db";

/** Kullanıcının düzeltebileceği hata (geçersiz giriş): 400 döner */
export class UserError extends Error {}

export async function handle<T>(fn: () => Promise<T>) {
  try {
    const out = await fn();
    return out instanceof Response ? out : NextResponse.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e instanceof StorageNotConfigured ? 503 : e instanceof UserError ? 400 : 500;
    if (status !== 400) console.error(e);
    return NextResponse.json({ error: msg }, { status });
  }
}

export const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
