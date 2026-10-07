export const AUTH_COOKIE = "lq_auth";
/** tarayıcıların izin verdiği en uzun süre (~400 gün) */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

export async function tokenFor(password: string) {
  const data = new TextEncoder().encode(`labiqreport:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
