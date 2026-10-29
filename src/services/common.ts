/**
 * Shared helpers for the Firestore service layer.
 * Nothing in here touches the network; it is safe to import anywhere.
 */
import { friendlyMessage } from "@/lib/friendly-errors";
import { Timestamp, type DocumentData, type QueryDocumentSnapshot } from "firebase/firestore";

/** Any value Firestore may hand back for a timestamp field (pending serverTimestamp() is null). */
export type FsTime = Timestamp | Date | number | string | null | undefined;

/** Convert any Firestore-ish timestamp into epoch millis. `null` (pending server write) => now. */
export function toMillis(value: FsTime): number {
  if (value === null || value === undefined) return Date.now();
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

/** "just now", "5m ago", "3h ago", "2d ago", "Mar 4" — mirrors the strings the UI used with mock data. */
export function timeAgo(value: FsTime): string {
  const diff = Date.now() - toMillis(value);
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 45) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(toMillis(value)).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Short form used by the old mock data ("12m", "2h", "1d"). */
export function timeAgoShort(value: FsTime): string {
  return timeAgo(value).replace(" ago", "").replace("Just now", "now");
}

/** Split an array into chunks (Firestore `in` / batch limits). */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Map a snapshot to `{ id, ...data }`. */
export function withId<T extends object>(snap: QueryDocumentSnapshot<DocumentData>): T & { id: string } {
  return { ...(snap.data() as T), id: snap.id };
}

/** Firestore rejects `undefined` field values — drop them before writing. */
export function stripUndefined<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/** Turn any thrown value into a message that is safe to show in a toast (details go to the console only). */
export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  return friendlyMessage(err, fallback);
}

export { UserError } from "@/lib/friendly-errors";

/** A user counts as online if the flag is set AND the heartbeat is recent (tab crashes never clear the flag). */
export const ONLINE_STALE_MS = 150_000;
export function isUserOnline(user: { online?: boolean; lastSeen?: FsTime } | null | undefined): boolean {
  if (!user?.online) return false;
  if (!user.lastSeen) return true;
  return Date.now() - toMillis(user.lastSeen) < ONLINE_STALE_MS;
}

/** Lower-cased search tokens for a user/tutor/group so we can do `array-contains` lookups. */
export function buildSearchTokens(parts: Array<string | string[] | null | undefined>): string[] {
  const set = new Set<string>();
  for (const part of parts) {
    const values = Array.isArray(part) ? part : [part];
    for (const v of values) {
      if (!v) continue;
      const lower = String(v).toLowerCase().trim();
      if (!lower) continue;
      set.add(lower.slice(0, 40));
      for (const word of lower.split(/[^a-z0-9+#.]+/)) {
        if (word.length >= 2) set.add(word.slice(0, 40));
      }
    }
  }
  // Firestore allows large arrays, but keep documents lean.
  return Array.from(set).slice(0, 60);
}

/** Deterministic id for a pair of users, independent of order. */
export function pairId(a: string, b: string): string {
  return [a, b].sort().join("_");
}
