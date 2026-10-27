/**
 * Notification service. Inbox lives at users/{uid}/notifications/{id}.
 *
 * Any signed-in user may *create* a notification in someone else's inbox (that is how buddy requests,
 * likes, comments, messages, SOS offers and tutor requests reach the recipient) but only the owner can
 * read / mark-read / delete them. firestore.rules pins `actorId == request.auth.uid` so they can't be forged
 * as coming from another person.
 */
import {
  collection,
  deleteDoc,
  doc,
  limit as qLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  getDocs,
  type DocumentReference,
  type Unsubscribe,
  type WriteBatch,
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { chunk, stripUndefined, toMillis, timeAgo } from "./common";

export type NotificationType =
  | "buddy_request"
  | "buddy_accepted"
  | "credit"
  | "sos"
  | "buddy"
  | "achievement"
  | "session"
  | "group_invite"
  | "message"
  | "like"
  | "comment"
  | "tutor_request"
  | "system";

export interface NotificationActor {
  uid: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  institution?: string;
  role?: string;
  degreeOrStream?: string;
}

export interface NotificationDoc {
  type: NotificationType;
  title?: string;
  text: string;
  read: boolean;
  actorId: string;
  actor?: NotificationActor;
  /** Present on buddy requests so the UI can render Accept / Decline. */
  fromUser?: NotificationActor;
  toUser?: NotificationActor;
  requestStatus?: "pending" | "accepted" | "declined";
  customNote?: string;
  actionUrl?: string;
  entityType?: string;
  entityId?: string;
  createdAt: unknown;
}

export interface NotificationItem extends Omit<NotificationDoc, "createdAt"> {
  id: string;
  time: string;
  timestamp: number;
}

export type NewNotification = Omit<NotificationDoc, "createdAt" | "read" | "actorId"> & { actorId?: string };

const inbox = (uid: string) => collection(db, "users", uid, "notifications");

/** Build a notification ref + payload so callers can add it to their own WriteBatch (atomic with the main action). */
export function notificationRef(toUid: string, id?: string): DocumentReference {
  return id ? doc(inbox(toUid), id) : doc(inbox(toUid));
}

export function buildNotificationPayload(actorId: string, n: NewNotification) {
  return stripUndefined({
    ...n,
    actorId,
    read: false,
    createdAt: serverTimestamp(),
  });
}

/** Add a notification to an existing batch. No-op when you'd be notifying yourself. */
export function addNotificationToBatch(
  batch: WriteBatch,
  toUid: string,
  actorId: string,
  n: NewNotification,
  id?: string,
): void {
  if (!toUid || toUid === actorId) return;
  batch.set(notificationRef(toUid, id), buildNotificationPayload(actorId, n));
}

/**
 * Fire-and-forget notification. Failures are logged but never thrown: a missed notification must
 * never make the primary action (liking, sending, commenting…) look like it failed.
 * Pass a deterministic `id` to de-duplicate (e.g. `like_${postId}_${actorId}`).
 */
export async function notifyUser(
  toUid: string,
  actorId: string,
  n: NewNotification,
  id?: string,
): Promise<void> {
  if (!toUid || toUid === actorId) return;
  try {
    await setDoc(notificationRef(toUid, id), buildNotificationPayload(actorId, n));
  } catch (err) {
    console.warn("notifyUser failed:", err);
  }
}

function toItem(id: string, data: NotificationDoc): NotificationItem {
  const { createdAt, ...rest } = data;
  return { ...rest, id, timestamp: toMillis(createdAt as never), time: timeAgo(createdAt as never) };
}

/** Real-time inbox (newest first, capped at 100 — older items are reachable via "load more" if needed). */
export function subscribeNotifications(
  uid: string,
  onData: (items: NotificationItem[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(inbox(uid), orderBy("createdAt", "desc"), qLimit(100)),
    { includeMetadataChanges: false },
    (snap) => onData(snap.docs.map((d) => toItem(d.id, d.data() as NotificationDoc))),
    (err) => onError?.(err),
  );
}

export async function markRead(uid: string, id: string): Promise<void> {
  await updateDoc(doc(inbox(uid), id), { read: true });
}

export async function markAllRead(uid: string, ids: string[]): Promise<void> {
  for (const group of chunk(ids, 400)) {
    const batch = writeBatch(db);
    group.forEach((id) => batch.update(doc(inbox(uid), id), { read: true }));
    await batch.commit();
  }
}

export async function removeNotification(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(inbox(uid), id));
}

/** Delete the whole inbox in batches of 400 (Firestore limit is 500 writes per batch). */
export async function clearInbox(uid: string): Promise<void> {
  for (;;) {
    const snap = await getDocs(query(inbox(uid), qLimit(400)));
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < 400) return;
  }
}

export async function setNotificationStatus(
  uid: string,
  id: string,
  patch: Partial<Pick<NotificationDoc, "requestStatus" | "text" | "read">>,
): Promise<void> {
  await updateDoc(doc(inbox(uid), id), stripUndefined(patch));
}
