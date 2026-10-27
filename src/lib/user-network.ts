/**
 * Thin, Firestore-backed "user directory" API used by the buddy / messages / notifications / settings screens.
 *
 * This file used to keep a localStorage directory seeded with fake people and mirrored the ENTIRE users
 * collection into the browser. It now queries Firestore on demand (indexed, limited) through services/users.ts.
 * All lookups are therefore async.
 */
import {
  getUser,
  getUserByUsername as fsGetUserByUsername,
  isUsernameAvailable,
  searchUsers,
  type UserDoc,
} from "@/services/users";
import { isUserOnline } from "@/services/common";

export interface NetworkUser {
  uid: string;
  username: string; // clean handle without @, e.g. "jane_doe"
  displayName: string;
  role: "student" | "tutor" | "admin";
  avatarUrl: string;
  institution?: string;
  gradeLevel?: string;
  degreeOrStream?: string;
  about?: string;
  teach?: string[];
  learn?: string[];
  online?: boolean;
  rating?: number;
  sessions?: number;
  match?: number;
}

/** Clean raw username string into normalized lowercase alphanumeric handle */
export function cleanHandle(input: string): string {
  if (!input) return "";
  return input
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_]/g, "");
}

/** Validate username format */
export function isValidHandle(handle: string): { valid: boolean; reason?: string } {
  const clean = cleanHandle(handle);
  if (!clean) return { valid: false, reason: "Username cannot be empty." };
  if (clean.length < 3) return { valid: false, reason: "Username must be at least 3 characters." };
  if (clean.length > 20) return { valid: false, reason: "Username cannot exceed 20 characters." };
  if (!/^[a-z0-9_]{3,20}$/.test(clean)) {
    return { valid: false, reason: "Only lowercase letters, numbers, and underscores allowed." };
  }
  return { valid: true };
}

export function toNetworkUser(u: UserDoc): NetworkUser {
  return {
    uid: u.uid,
    username: u.username || `user_${u.uid.slice(0, 6)}`,
    displayName: u.displayName || "Cortex Learner",
    role: u.role ?? "student",
    avatarUrl: u.avatarUrl || "",
    institution: u.institution ?? undefined,
    gradeLevel: (u.gradeLevel as string | null | undefined) ?? undefined,
    degreeOrStream: u.degreeOrStream ?? undefined,
    about: u.about ?? undefined,
    teach: u.teach,
    learn: u.learn,
    online: isUserOnline(u),
  };
}

/** True when the handle is owned by someone other than `excludeUid`. */
export async function isUsernameTaken(handle: string, excludeUid?: string): Promise<boolean> {
  const target = cleanHandle(handle);
  if (!target) return false;
  return !(await isUsernameAvailable(target, excludeUid));
}

/** Search by handle / name / institution / topic (indexed prefix + token queries, max 20). */
export async function searchNetworkUsers(query: string, excludeUid?: string): Promise<NetworkUser[]> {
  const users = await searchUsers(query, { excludeUid, max: 20 });
  return users.map(toNetworkUser);
}

export async function getUserByUsername(handle: string): Promise<NetworkUser | undefined> {
  const u = await fsGetUserByUsername(handle);
  return u ? toNetworkUser(u) : undefined;
}

export async function getUserByUid(uid: string): Promise<NetworkUser | undefined> {
  const u = await getUser(uid);
  return u ? toNetworkUser(u) : undefined;
}
