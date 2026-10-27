/**
 * User-controlled URLs (message attachments, post images) are only ever opened or embedded when they point at our own
 * Firebase Storage bucket. This blocks `javascript:` / `data:` URLs and links to attacker-hosted trackers or phishing
 * pages smuggled in through a crafted Firestore document.
 */
const ALLOWED_HOSTS = new Set(["firebasestorage.googleapis.com", "storage.googleapis.com"]);

export function isSafeStorageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/** Returns the URL if it is safe, otherwise undefined (so `<img src={safeUrl(x)}>` renders nothing harmful). */
export const safeUrl = (value: unknown): string | undefined => (isSafeStorageUrl(value) ? value : undefined);
