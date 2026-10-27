/**
 * Study-buddy system (friend requests + friend lists), fully Firestore-backed.
 *
 * Collections
 *   friend_requests/{fromUid}_{toUid}   pending requests only (deleted on accept / decline / cancel)
 *   users/{uid}/friends/{friendUid}     mutual friendship, written for BOTH users in one batch
 *
 * Request ids are deterministic (`req_${from}_${to}`) so a duplicate send is an overwrite, not a second request,
 * and notifications can be addressed predictably (`notif_${requestId}`).
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { addNotificationToBatch, removeNotification, setNotificationStatus } from "./notifications";
import { stripUndefined, toMillis } from "./common";
import { getUsersByIds, type UserDoc } from "./users";

export interface BuddyUserLite {
  uid: string;
  displayName: string;
  username: string;
  avatarUrl?: string | null;
  institution?: string | null;
  gradeLevel?: string | null;
}

export interface FriendRequestData {
  id: string;
  fromUid: string;
  toUid: string;
  fromUser: BuddyUserLite;
  toUser: BuddyUserLite;
  note?: string;
  status: "pending" | "accepted" | "declined";
  createdAt: unknown;
}

export interface FriendUserData extends BuddyUserLite {
  teach?: string[];
  learn?: string[];
  online?: boolean;
  lastSeen?: unknown;
  since?: unknown;
}

export const requestIdFor = (fromUid: string, toUid: string) => `req_${fromUid}_${toUid}`;
export const notificationIdForRequest = (requestId: string) => `notif_${requestId}`;

export function toLite(u: Partial<UserDoc> & { uid: string }): BuddyUserLite {
  return stripUndefined({
    uid: u.uid,
    displayName: u.displayName || "Learner",
    username: u.username || `user_${u.uid.slice(0, 6)}`,
    avatarUrl: u.avatarUrl ?? null,
    institution: u.institution ?? null,
    gradeLevel: (u.gradeLevel as string | null | undefined) ?? null,
  });
}

export async function areBuddies(uid: string, otherUid: string): Promise<boolean> {
  if (!uid || !otherUid) return false;
  const snap = await getDoc(doc(db, "users", uid, "friends", otherUid));
  return snap.exists();
}

/** Returns the pending request between two users in either direction, if any. */
export async function getPendingRequestBetween(a: string, b: string): Promise<FriendRequestData | null> {
  const [ab, ba] = await Promise.all([
    getDoc(doc(db, "friend_requests", requestIdFor(a, b))),
    getDoc(doc(db, "friend_requests", requestIdFor(b, a))),
  ]);
  const hit = ab.exists() ? ab : ba.exists() ? ba : null;
  return hit ? ({ ...(hit.data() as FriendRequestData), id: hit.id }) : null;
}

export async function sendBuddyRequest(
  from: Partial<UserDoc> & { uid: string },
  to: Partial<UserDoc> & { uid: string },
  note?: string,
): Promise<{ success: boolean; message: string }> {
  if (!from.uid || !to.uid) return { success: false, message: "Invalid user." };
  if (from.uid === to.uid) return { success: false, message: "You cannot send a buddy request to yourself." };

  const toName = to.displayName || to.username || "this user";
  if (await areBuddies(from.uid, to.uid)) {
    return { success: false, message: `You are already study buddies with ${toName}.` };
  }

  const existing = await getPendingRequestBetween(from.uid, to.uid);
  if (existing) {
    return existing.fromUid === from.uid
      ? { success: false, message: "Buddy request already sent and pending." }
      : { success: false, message: `${toName} has already sent you a request. Check your Requests tab!` };
  }

  const id = requestIdFor(from.uid, to.uid);
  const fromLite = toLite(from);
  const toLiteUser = toLite(to);
  const batch = writeBatch(db);

  batch.set(
    doc(db, "friend_requests", id),
    stripUndefined({
      fromUid: from.uid,
      toUid: to.uid,
      fromUser: fromLite,
      toUser: toLiteUser,
      note: note?.trim() || null,
      status: "pending" as const,
      createdAt: serverTimestamp(),
    }),
  );

  addNotificationToBatch(
    batch,
    to.uid,
    from.uid,
    {
      type: "buddy_request",
      title: "Study Buddy Request",
      text: `@${fromLite.username} (${fromLite.displayName}) sent you a study buddy request.`,
      fromUser: { ...fromLite, avatarUrl: fromLite.avatarUrl || "", role: from.role, degreeOrStream: from.degreeOrStream ?? undefined } as never,
      toUser: { ...toLiteUser, avatarUrl: toLiteUser.avatarUrl || "", role: to.role, degreeOrStream: to.degreeOrStream ?? undefined } as never,
      requestStatus: "pending",
      customNote: note?.trim() || `Hi ${toLiteUser.displayName}! Let's connect as study buddies on Cortex.`,
      actionUrl: "/buddy",
    },
    notificationIdForRequest(id),
  );

  await batch.commit();
  return { success: true, message: `Buddy request sent to ${toName}!` };
}

/** Accept: create both friend docs, delete the request, tell the sender — one atomic batch. */
export async function acceptBuddyRequest(request: FriendRequestData, actingUid: string): Promise<void> {
  if (request.toUid !== actingUid) throw new Error("Only the recipient can accept this request.");
  const { fromUser, toUser, fromUid, toUid, id } = request;

  const batch = writeBatch(db);
  batch.set(doc(db, "users", toUid, "friends", fromUid), { ...stripUndefined(fromUser), since: serverTimestamp() });
  batch.set(doc(db, "users", fromUid, "friends", toUid), { ...stripUndefined(toUser), since: serverTimestamp() });
  batch.delete(doc(db, "friend_requests", id));
  addNotificationToBatch(
    batch,
    fromUid,
    toUid,
    {
      type: "buddy_accepted",
      title: "New Study Buddy Connected 🎉",
      text: `You and ${toUser.displayName} (@${toUser.username}) are now Study Buddies! You can now send direct messages.`,
      actor: { ...toUser, avatarUrl: toUser.avatarUrl || "" } as never,
      requestStatus: "accepted",
      actionUrl: "/messages",
    },
    `notif_accepted_${id}`,
  );
  await batch.commit();

  // Non-critical: reflect the decision on the original inbox card.
  void setNotificationStatus(toUid, notificationIdForRequest(id), {
    requestStatus: "accepted",
    read: true,
    text: `Accepted study buddy request from ${fromUser.displayName} (@${fromUser.username}).`,
  }).catch(() => undefined);
}

export async function declineBuddyRequest(request: Pick<FriendRequestData, "id" | "toUid">): Promise<void> {
  await deleteDoc(doc(db, "friend_requests", request.id));
  void setNotificationStatus(request.toUid, notificationIdForRequest(request.id), {
    requestStatus: "declined",
    read: true,
  }).catch(() => undefined);
}

/** Sender withdraws a pending request; also removes the (now stale) card from the recipient's inbox. */
export async function cancelBuddyRequest(request: Pick<FriendRequestData, "id" | "toUid">): Promise<void> {
  await deleteDoc(doc(db, "friend_requests", request.id));
  void removeNotification(request.toUid, notificationIdForRequest(request.id)).catch(() => undefined);
}

export async function removeBuddy(uid1: string, uid2: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, "users", uid1, "friends", uid2));
  batch.delete(doc(db, "users", uid2, "friends", uid1));
  await batch.commit();
}

// ── realtime ────────────────────────────────────────────────────────────────

function requestsQuery(field: "toUid" | "fromUid", uid: string) {
  // Two equality filters need no composite index; ordering is done client-side.
  return query(collection(db, "friend_requests"), where(field, "==", uid), where("status", "==", "pending"));
}

function subscribeRequests(
  field: "toUid" | "fromUid",
  uid: string,
  onUpdate: (r: FriendRequestData[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  if (!uid) return () => {};
  return onSnapshot(
    requestsQuery(field, uid),
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as FriendRequestData), id: d.id }));
      list.sort((a, b) => toMillis(b.createdAt as never) - toMillis(a.createdAt as never));
      onUpdate(list);
    },
    (err) => {
      console.error(`friend_requests (${field}) listener error:`, err);
      onError?.(err);
    },
  );
}

export const subscribeIncoming = (uid: string, cb: (r: FriendRequestData[]) => void, onError?: (e: Error) => void) =>
  subscribeRequests("toUid", uid, cb, onError);

export const subscribeOutgoing = (uid: string, cb: (r: FriendRequestData[]) => void, onError?: (e: Error) => void) =>
  subscribeRequests("fromUid", uid, cb, onError);

/**
 * Live friends list. Each friend doc is a snapshot taken when the friendship was created, so we
 * hydrate with the friends' *current* profiles (avatar, topics, online status) on every change.
 */
export function subscribeBuddies(
  uid: string,
  onUpdate: (friends: FriendUserData[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  if (!uid) return () => {};
  return onSnapshot(
    collection(db, "users", uid, "friends"),
    async (snap) => {
      const base = snap.docs.map((d) => ({ ...(d.data() as FriendUserData), uid: d.id }));
      onUpdate(base); // render immediately with the stored snapshot…
      try {
        const live = await getUsersByIds(base.map((f) => f.uid));
        onUpdate(
          base.map((f) => {
            const u = live[f.uid];
            return u
              ? {
                  ...f,
                  displayName: u.displayName || f.displayName,
                  username: u.username || f.username,
                  avatarUrl: u.avatarUrl ?? f.avatarUrl,
                  institution: u.institution ?? f.institution,
                  gradeLevel: (u.gradeLevel as string | null | undefined) ?? f.gradeLevel,
                  teach: u.teach,
                  learn: u.learn,
                  online: u.online,
                  lastSeen: u.lastSeen,
                }
              : f;
          }),
        ); // …then upgrade with fresh data.
      } catch (err) {
        console.warn("Could not hydrate friends:", err);
      }
    },
    (err) => {
      console.error("friends listener error:", err);
      onError?.(err);
    },
  );
}
