/**
 * Notification store used by the bell badge, dashboard and notifications page.
 *
 * Source of truth: Firestore `users/{uid}/notifications` via a single real-time listener that AuthProvider starts on
 * sign-in (`startNotificationListener`) and stops on sign-out. The listener fills a small in-memory cache and fires
 * NOTIFICATION_EVENT, so existing components that call getNotifications() / listen for the event keep working
 * unchanged — but there is no localStorage and no seed data any more.
 */
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import {
  clearInbox,
  markAllRead,
  markRead,
  removeNotification,
  subscribeNotifications,
  type NotificationItem,
} from "@/services/notifications";
import {
  acceptBuddyRequest,
  declineBuddyRequest,
  sendBuddyRequest as sendRequest,
  type FriendRequestData,
} from "@/services/buddies";
import { getUser, getUserByUsername as fsGetUserByUsername, type UserDoc } from "@/services/users";
import { cleanHandle, toNetworkUser, type NetworkUser } from "./user-network";

export type CortexNotification = NotificationItem & {
  // kept for backwards compatibility with the pre-Firestore shape used by the UI
  fromUser?: NotificationItem["fromUser"];
  toUser?: NotificationItem["toUser"];
};

export const NOTIFICATION_EVENT = "cortex_notifications_updated";

let cache: CortexNotification[] = [];
let activeUid: string | null = null;
let unsubscribe: (() => void) | null = null;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOTIFICATION_EVENT));
}

/** Start (or restart) the inbox listener for `uid`. Safe to call repeatedly. */
export function startNotificationListener(uid: string) {
  if (activeUid === uid && unsubscribe) return;
  stopNotificationListener();
  activeUid = uid;
  unsubscribe = subscribeNotifications(
    uid,
    (items) => {
      cache = items;
      emit();
    },
    (err) => console.warn("Notification listener error:", err),
  );
}

export function stopNotificationListener() {
  unsubscribe?.();
  unsubscribe = null;
  activeUid = null;
  cache = [];
  emit();
}

/** Current inbox, newest first (synchronous read of the live cache). */
export function getNotifications(): CortexNotification[] {
  return cache;
}

export function getUnreadNotificationCount(): number {
  return cache.filter((n) => !n.read).length;
}

function patchCache(fn: (list: CortexNotification[]) => CortexNotification[]) {
  cache = fn(cache);
  emit();
}

/** Optimistic: the UI updates immediately, the write follows (the listener reconciles on failure). */
export function markNotificationRead(id: string): void {
  if (!activeUid) return;
  patchCache((l) => l.map((n) => (n.id === id ? { ...n, read: true } : n)));
  void markRead(activeUid, id).catch((e) => console.warn("markRead failed:", e));
}

export function markAllNotificationsRead(): void {
  if (!activeUid) return;
  const ids = cache.filter((n) => !n.read).map((n) => n.id);
  if (ids.length === 0) return;
  patchCache((l) => l.map((n) => ({ ...n, read: true })));
  void markAllRead(activeUid, ids).catch((e) => console.warn("markAllRead failed:", e));
}

export function deleteNotification(id: string): void {
  if (!activeUid) return;
  patchCache((l) => l.filter((n) => n.id !== id));
  void removeNotification(activeUid, id).catch((e) => console.warn("delete notification failed:", e));
}

export function clearAllNotifications(): void {
  if (!activeUid) return;
  patchCache(() => []);
  void clearInbox(activeUid).catch((e) => console.warn("clear inbox failed:", e));
}

// ── buddy requests initiated from the notifications screen ──────────────────

interface SenderProfile {
  uid: string;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  institution?: string | null;
  role?: string | null;
  degreeOrStream?: string | null;
}

/** Send a buddy request to a user identified by UID or @username. */
export async function sendBuddyRequest(params: {
  targetUidOrHandle: string;
  customNote?: string;
  senderProfile?: SenderProfile;
}): Promise<{ success: boolean; message: string; targetUser?: NetworkUser }> {
  const { targetUidOrHandle, customNote, senderProfile } = params;
  const raw = targetUidOrHandle.trim();
  if (!raw) return { success: false, message: "Please enter a valid User ID or @username handle." };
  if (!senderProfile?.uid) return { success: false, message: "You need to be signed in to send requests." };

  try {
    const handle = cleanHandle(raw);
    const target: UserDoc | null = (await fsGetUserByUsername(handle)) ?? (await getUser(raw));
    if (!target) {
      return {
        success: false,
        message: `No user found matching "${raw}". Please check the ID or username.`,
      };
    }
    const sender = ((await getUser(senderProfile.uid)) ?? senderProfile) as UserDoc;
    const res = await sendRequest({ ...sender, uid: senderProfile.uid }, target, customNote);
    return { ...res, targetUser: toNetworkUser(target) };
  } catch (err) {
    console.error("sendBuddyRequest failed:", err);
    return { success: false, message: "Couldn't send the request. Please try again." };
  }
}

/** Accept or decline an incoming buddy-request notification. */
export async function respondToBuddyRequest(
  notificationId: string,
  accept: boolean,
): Promise<{ success: boolean; message: string }> {
  const requestId = notificationId.replace(/^notif_/, "");
  try {
    const snap = await getDoc(doc(db, "friend_requests", requestId));
    if (!snap.exists()) {
      return { success: false, message: "This request is no longer available (it may have been cancelled)." };
    }
    const req = { ...(snap.data() as FriendRequestData), id: snap.id };
    if (accept) {
      await acceptBuddyRequest(req, req.toUid);
      return { success: true, message: `You and ${req.fromUser.displayName} are now study buddies!` };
    }
    await declineBuddyRequest({ id: req.id, toUid: req.toUid });
    return { success: true, message: "Request declined." };
  } catch (err) {
    console.error("respondToBuddyRequest failed:", err);
    return { success: false, message: "Couldn't update the request. Please try again." };
  }
}
