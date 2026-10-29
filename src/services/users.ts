/**
 * User profile service: CRUD, unique usernames, avatar/cover upload, search and presence.
 *
 * Collections
 *   users/{uid}            public profile (readable by any signed-in user)
 *   users_private/{uid}    email + account-level data (owner + admin only)
 *   usernames/{lower}      { uid } — one doc per taken handle; created in the same transaction as the profile
 */
import { UserError } from "@/lib/friendly-errors";
import { validatePersonName } from "@/lib/name-policy";
import { checkUsernameFormat, cleanUsername } from "@/lib/username-policy";
import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit as qLimit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/integrations/firebase/client";
import { buildSearchTokens, chunk, stripUndefined } from "./common";
import { deleteStoredFile, IMAGE_TYPES, uploadFile } from "./storage";
import type { EducationEntry, GradeLevel } from "@/hooks/use-auth";

export type AppRole = "student" | "tutor" | "admin";

/** Fields a user may edit on their own profile. Everything else (role, credits, …) is server-guarded. */
export const EDITABLE_PROFILE_FIELDS = [
  "displayName",
  "avatarUrl",
  "coverImageUrl",
  "gradeLevel",
  "institution",
  "semesterOrYear",
  "degreeOrStream",
  "about",
  "country",
  "timezone",
  "hoursGoal",
  "teach",
  "learn",
  "educationHistory",
  "institutionId",
  "darkMode",
  "emailNotifications",
  "showLeaderboard",
  "sosAvailable",
  "onboarded",
  "studyStreak",
  "lastStudyDate",
] as const;

export interface UserDoc {
  uid: string;
  username?: string | null;
  usernameLower?: string | null;
  displayName: string | null;
  displayNameLower?: string | null;
  avatarUrl?: string | null;
  coverImageUrl?: string | null;
  role: AppRole;
  tutorStatus?: "pending" | "approved" | "rejected" | null;
  gradeLevel?: GradeLevel | null;
  institution?: string | null;
  institutionId?: string | null;
  universityVerified?: boolean;
  verifiedUniversityId?: string | null;
  verifiedUniversityName?: string | null;
  verifiedAt?: unknown;
  semesterOrYear?: string | null;
  degreeOrStream?: string | null;
  about?: string | null;
  country?: string | null;
  timezone?: string | null;
  hoursGoal?: number;
  teach?: string[];
  learn?: string[];
  educationHistory?: EducationEntry[];
  credits?: number;
  creditsEarned?: number;
  teachingMinutes?: number;
  studyStreak?: number;
  lastStudyDate?: string | null;
  online?: boolean;
  lastSeen?: unknown;
  searchTokens?: string[];
  teachTokens?: string[];
  onboarded?: boolean;
  darkMode?: boolean;
  emailNotifications?: boolean;
  showLeaderboard?: boolean;
  sosAvailable?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/** Starting balance for a new account. Mirrors what the README promises ("every student begins with credits"). */
export const STARTING_CREDITS = 100;

export { cleanUsername } from "@/lib/username-policy";

export function validateUsername(raw: string): { valid: boolean; reason?: string } {
  const r = checkUsernameFormat(raw);
  return { valid: r.ok, reason: r.error };
}

// ────────────────────────────────────────────────────────────────────────────
// Reads
// ────────────────────────────────────────────────────────────────────────────

export async function getUser(uid: string): Promise<UserDoc | null> {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? ({ ...(snap.data() as UserDoc), uid: snap.id }) : null;
}

export function subscribeUser(
  uid: string,
  onData: (user: UserDoc | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, "users", uid),
    (snap) => onData(snap.exists() ? { ...(snap.data() as UserDoc), uid: snap.id } : null),
    (err) => onError?.(err),
  );
}

/** Batch-load profiles (Firestore `in` supports max 30 values; we use 10 to stay well inside limits). */
export async function getUsersByIds(uids: string[]): Promise<Record<string, UserDoc>> {
  const unique = Array.from(new Set(uids.filter(Boolean)));
  const out: Record<string, UserDoc> = {};
  await Promise.all(
    chunk(unique, 10).map(async (ids) => {
      const snap = await getDocs(query(collection(db, "users"), where(documentId(), "in", ids)));
      snap.forEach((d) => {
        out[d.id] = { ...(d.data() as UserDoc), uid: d.id };
      });
    }),
  );
  return out;
}

export async function getUserByUsername(username: string): Promise<UserDoc | null> {
  const clean = cleanUsername(username);
  if (!clean) return null;
  const snap = await getDoc(doc(db, "usernames", clean));
  if (!snap.exists()) return null;
  return getUser((snap.data() as { uid: string }).uid);
}

/**
 * Search users by username/display-name prefix and by topic/institution tokens.
 * Firestore has no full-text search, so we run up to three cheap indexed queries and merge:
 *   1. usernameLower prefix        2. displayNameLower prefix        3. searchTokens array-contains
 * For fuzzy / typo-tolerant search integrate Algolia or Typesense later.
 */
export async function searchUsers(
  term: string,
  opts: { excludeUid?: string; max?: number; role?: AppRole } = {},
): Promise<UserDoc[]> {
  const { excludeUid, max = 20, role } = opts;
  const q = term.trim().toLowerCase().replace(/^@+/, "");
  const results = new Map<string, UserDoc>();

  const add = (snap: { forEach: (cb: (d: { id: string; data: () => unknown }) => void) => void }) =>
    snap.forEach((d) => {
      const u = { ...(d.data() as UserDoc), uid: d.id };
      if (u.uid === excludeUid) return;
      if (role && u.role !== role) return;
      results.set(u.uid, u);
    });

  const users = collection(db, "users");
  try {
    if (!q) {
      // No term: return a recent/active slice so the discover tab is never empty.
      const snap = await getDocs(query(users, orderBy("createdAt", "desc"), qLimit(max + 1)));
      add(snap);
    } else {
      const prefix = (field: string) =>
        getDocs(query(users, where(field, ">=", q), where(field, "<=", q + "\uf8ff"), qLimit(max)));
      const [byUsername, byName, byToken] = await Promise.all([
        prefix("usernameLower"),
        prefix("displayNameLower"),
        getDocs(query(users, where("searchTokens", "array-contains", q), qLimit(max))),
      ]);
      add(byUsername);
      add(byName);
      add(byToken);
    }
  } catch (err) {
    console.error("searchUsers failed:", err);
    throw err;
  }
  return Array.from(results.values()).slice(0, max);
}

// ────────────────────────────────────────────────────────────────────────────
// Usernames
// ────────────────────────────────────────────────────────────────────────────

/** True when nobody else owns the handle. */
export async function isUsernameAvailable(username: string, excludeUid?: string): Promise<boolean> {
  const clean = cleanUsername(username);
  if (!validateUsername(clean).valid) return false;
  const snap = await getDoc(doc(db, "usernames", clean));
  if (!snap.exists()) return true;
  return !!excludeUid && (snap.data() as { uid: string }).uid === excludeUid;
}

/**
 * Atomically claim `username` for `uid` and release the previous one.
 * Runs in a transaction so two people can never grab the same handle.
 * Throws `Error("USERNAME_TAKEN")` if somebody else owns it.
 */
export async function claimUsername(uid: string, username: string): Promise<string> {
  const clean = cleanUsername(username);
  const check = validateUsername(clean);
  if (!check.valid) throw new UserError(check.reason ?? "That username isn't allowed.");

  await runTransaction(db, async (tx) => {
    const newRef = doc(db, "usernames", clean);
    const userRef = doc(db, "users", uid);
    const [newSnap, userSnap] = await Promise.all([tx.get(newRef), tx.get(userRef)]);

    if (newSnap.exists() && (newSnap.data() as { uid: string }).uid !== uid) {
      throw new UserError("USERNAME_TAKEN");
    }

    const prev = userSnap.exists() ? (userSnap.data() as UserDoc).usernameLower : null;
    if (prev && prev !== clean) tx.delete(doc(db, "usernames", prev));

    tx.set(newRef, { uid, username: clean, createdAt: serverTimestamp() });
    if (userSnap.exists()) {
      tx.update(userRef, { username: clean, usernameLower: clean, updatedAt: serverTimestamp() });
    }
  });
  return clean;
}

// ────────────────────────────────────────────────────────────────────────────
// Create / update
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create `users/{uid}` (and `users_private/{uid}`) the first time we see an account.
 * Safe to call on every sign-in: existing documents are left untouched.
 * Role is always "student" here — tutors/admins are promoted only by an admin (see firestore.rules).
 */
export async function ensureUserDocument(
  user: User,
  extra: Partial<UserDoc> & { tutorPending?: boolean } = {},
): Promise<UserDoc> {
  const ref = doc(db, "users", user.uid);
  const existing = await getDoc(ref);
  if (existing.exists()) return { ...(existing.data() as UserDoc), uid: user.uid };

  const displayName =
    extra.displayName || user.displayName || (user.email ? user.email.split("@")[0] : "Learner");

  // Privileged fields are stripped from `extra` so a caller can never escalate itself;
  // firestore.rules enforces the same thing on the server.
  const {
    tutorPending,
    role: _role,
    credits: _credits,
    creditsEarned: _earned,
    teachingMinutes: _minutes,
    tutorStatus: _tutorStatus,
    ...rest
  } = extra;

  const base = stripUndefined({
    uid: user.uid,
    displayName,
    displayNameLower: displayName.toLowerCase(),
    avatarUrl: user.photoURL ?? null,
    role: "student" as AppRole,
    tutorStatus: tutorPending ? ("pending" as const) : null,
    credits: STARTING_CREDITS,
    creditsEarned: 0,
    teachingMinutes: 0,
    studyStreak: 0,
    teach: [] as string[],
    learn: [] as string[],
    online: true,
    onboarded: false,
    showLeaderboard: true,
    sosAvailable: true,
    searchTokens: buildSearchTokens([displayName]),
    teachTokens: [] as string[],
    ...rest,
  });
  // `rest` could (type-wise) carry these again — force the safe values last.
  base.role = "student";
  base.credits = STARTING_CREDITS;

  await setDoc(ref, {
    ...base,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastSeen: serverTimestamp(),
  });
  if (user.email) {
    await setDoc(
      doc(db, "users_private", user.uid),
      { uid: user.uid, email: user.email.toLowerCase(), createdAt: serverTimestamp() },
      { merge: true },
    );
  }
  const created = await getDoc(ref);
  return { ...(created.data() as UserDoc), uid: user.uid };
}

/**
 * Update the signed-in user's own profile. Only whitelisted fields are sent, and search
 * tokens / lower-case mirrors are regenerated so search stays consistent.
 * If `username` is supplied it is claimed transactionally first.
 */
export async function updateUserProfile(
  uid: string,
  updates: Partial<UserDoc> & { username?: string | null },
  current?: Partial<UserDoc>,
): Promise<void> {
  const payload: Record<string, unknown> = {};
  for (const key of EDITABLE_PROFILE_FIELDS) {
    if (key in updates) payload[key] = (updates as Record<string, unknown>)[key];
  }

  if (updates.username !== undefined && updates.username !== null && updates.username !== "") {
    await claimUsername(uid, updates.username);
  }

  if ("displayName" in payload) {
    const nameCheck = validatePersonName(String(payload.displayName ?? ""), "name");
    if (!nameCheck.ok) throw new UserError(nameCheck.error ?? "Please enter a valid name.");
    payload.displayName = nameCheck.value;
    payload.displayNameLower = String(payload.displayName ?? "").toLowerCase();
  }

  const merged = { ...(current ?? {}), ...payload, username: updates.username ?? current?.username };
  if (["displayName", "institution", "teach", "learn", "degreeOrStream", "username"].some((k) => k in payload || k === "username")) {
    payload.searchTokens = buildSearchTokens([
      merged.displayName as string | undefined,
      merged.username as string | undefined,
      merged.institution as string | undefined,
      merged.degreeOrStream as string | undefined,
      merged.teach as string[] | undefined,
      merged.learn as string[] | undefined,
    ]);
  }

  // Separate tokens for "topics I can teach" so SOS requests can be matched to helpers cheaply.
  if ("teach" in payload) {
    payload.teachTokens = buildSearchTokens([(payload.teach as string[] | undefined) ?? []]);
  }

  if (Object.keys(payload).length === 0) return;
  await setDoc(doc(db, "users", uid), { ...stripUndefined(payload), updatedAt: serverTimestamp() }, { merge: true });
}

export async function uploadAvatar(
  uid: string,
  file: File,
  previousUrl?: string | null,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const { url } = await uploadFile({
    folder: `avatars/${uid}`,
    file,
    maxBytes: 5 * 1024 * 1024,
    allowedTypes: IMAGE_TYPES,
    onProgress,
  });
  await updateDoc(doc(db, "users", uid), { avatarUrl: url, updatedAt: serverTimestamp() });
  void deleteStoredFile(previousUrl);
  return url;
}

export async function uploadCover(
  uid: string,
  file: File,
  previousUrl?: string | null,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const { url } = await uploadFile({
    folder: `covers/${uid}`,
    file,
    maxBytes: 8 * 1024 * 1024,
    allowedTypes: IMAGE_TYPES,
    onProgress,
  });
  await updateDoc(doc(db, "users", uid), { coverImageUrl: url, updatedAt: serverTimestamp() });
  void deleteStoredFile(previousUrl);
  return url;
}

/**
 * Permanently remove the profile document and its username reservation.
 * (Deleting the Auth user itself is done by the caller with `deleteUser`.)
 */
export async function deleteUserData(uid: string, username?: string | null): Promise<void> {
  if (username) await deleteDoc(doc(db, "usernames", cleanUsername(username))).catch(() => undefined);
  await deleteDoc(doc(db, "users_private", uid)).catch(() => undefined);
  await deleteDoc(doc(db, "users", uid));
}

// ────────────────────────────────────────────────────────────────────────────
// Presence
// ────────────────────────────────────────────────────────────────────────────

const HEARTBEAT_MS = 60_000;

/**
 * Marks the user online, refreshes `lastSeen` every minute, and flips to offline on tab close /
 * hidden. Returns a cleanup function. Consumers should treat a user as online only if
 * `isUserOnline()` is true (flag AND fresh heartbeat), because an abruptly closed tab can't clear the flag.
 */
export function startPresence(uid: string): () => void {
  if (typeof window === "undefined") return () => {};
  const ref = doc(db, "users", uid);
  const write = (online: boolean) =>
    updateDoc(ref, { online, lastSeen: serverTimestamp() }).catch(() => undefined);

  void write(true);
  const timer = window.setInterval(() => {
    if (document.visibilityState === "visible") void write(true);
  }, HEARTBEAT_MS);

  const onVisibility = () => void write(document.visibilityState === "visible");
  const onUnload = () => void write(false);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onUnload);

  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onUnload);
    void write(false);
  };
}

/** People at the same institution (for the "Batch Mates" tab). Single equality filter => no composite index needed. */
export async function getClassmates(institution: string, excludeUid: string, max = 12): Promise<UserDoc[]> {
  if (!institution.trim()) return [];
  const snap = await getDocs(query(collection(db, "users"), where("institution", "==", institution.trim()), qLimit(max + 1)));
  return snap.docs
    .map((d) => ({ ...(d.data() as UserDoc), uid: d.id }))
    .filter((u) => u.uid !== excludeUid)
    .slice(0, max);
}

// ────────────────────────────────────────────────────────────────────────────
// Account deletion
// ────────────────────────────────────────────────────────────────────────────

const OWN_SUBCOLLECTIONS = [
  "notifications",
  "creditHistory",
  "achievements",
  "bookmarks",
  "sosBookmarks",
  "sosOffers",
  "groups",
  "quizzes",
  "roadmaps",
  "quizProgress",
  "roadmapProgress",
  "studyDays",
  "reviews",
];

async function deleteCollectionInBatches(path: string[]) {
  const col = collection(db, path[0], ...path.slice(1));
  for (;;) {
    const snap = await getDocs(query(col, qLimit(400)));
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < 400) return;
  }
}

/**
 * Permanently delete the signed-in user's account data and sign-in. The caller must have re-authenticated just before
 * (Firebase refuses to delete accounts with stale sign-ins).
 *
 * Removed: profile, username reservation, private email record, notifications/bookmarks/progress/etc., friendships
 * (both sides), tutor listing is switched off. NOT removed (needs a Cloud Function): the user's posts, comments,
 * messages and files in shared spaces — those stay under the author name stored on them until an admin deletes them.
 */
export async function deleteMyAccountData(uid: string, username?: string | null): Promise<void> {
  // 1) friendships — remove the counterpart copy on every friend's side first
  const friends = await getDocs(collection(db, "users", uid, "friends"));
  for (const part of chunk(friends.docs, 200)) {
    const batch = writeBatch(db);
    part.forEach((f) => {
      batch.delete(doc(db, "users", f.id, "friends", uid));
      batch.delete(f.ref);
    });
    await batch.commit();
  }

  // 2) tutor listing off (the admin-owned document itself is kept for session history)
  await updateDoc(doc(db, "tutor_profiles", uid), { acceptingSessions: false }).catch(() => undefined);

  // 3) personal subcollections
  for (const sub of OWN_SUBCOLLECTIONS) await deleteCollectionInBatches(["users", uid, sub]);

  // 4) identity documents last
  await deleteUserData(uid, username);
}

/** Remove the cover banner (profile + Storage file). */
export async function removeCover(uid: string, currentUrl?: string | null): Promise<void> {
  await updateDoc(doc(db, "users", uid), { coverImageUrl: null, updatedAt: serverTimestamp() });
  void deleteStoredFile(currentUrl);
}

/** Remove the profile picture (falls back to initials). */
export async function removeAvatar(uid: string, currentUrl?: string | null): Promise<void> {
  await updateDoc(doc(db, "users", uid), { avatarUrl: null, updatedAt: serverTimestamp() });
  void deleteStoredFile(currentUrl);
}
