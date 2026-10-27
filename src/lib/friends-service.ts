/**
 * Compatibility facade for the buddy screens. The implementation lives in services/buddies.ts and
 * services/users.ts (Firestore-first, real-time, no localStorage). Export names are unchanged so the UI keeps working.
 */
import type { Unsubscribe } from "firebase/firestore";
import {
  acceptBuddyRequest,
  areBuddies,
  cancelBuddyRequest,
  declineBuddyRequest,
  getPendingRequestBetween,
  removeBuddy,
  sendBuddyRequest,
  subscribeBuddies,
  subscribeIncoming,
  subscribeOutgoing,
  type FriendRequestData,
  type FriendUserData,
} from "@/services/buddies";
import {
  claimUsername,
  cleanUsername,
  getUser,
  isUsernameAvailable,
  searchUsers,
  type UserDoc,
} from "@/services/users";
import type { UserProfile } from "@/hooks/use-auth";

export type { FriendRequestData, FriendUserData };
export { cleanUsername };

/** Fired by older screens after local changes; Firestore listeners make it unnecessary but it's kept for compatibility. */
export const FRIENDS_EVENT = "cortex_friends_changed";

export async function checkUsernameAvailable(username: string, excludeUid?: string): Promise<boolean> {
  return isUsernameAvailable(username, excludeUid);
}

/** Claim a handle for `uid` (transactional). Returns false when it is taken. */
export async function registerUsername(uid: string, username: string): Promise<boolean> {
  try {
    await claimUsername(uid, username);
    return true;
  } catch (err) {
    if ((err as Error).message === "USERNAME_TAKEN") return false;
    throw err;
  }
}

export async function searchUsersByUsername(searchQuery: string, currentUid: string): Promise<UserProfile[]> {
  const users = await searchUsers(searchQuery, { excludeUid: currentUid, max: 20 });
  return users as unknown as UserProfile[];
}

export const checkIfFriends = areBuddies;
export const getExistingRequestBetweenUsers = getPendingRequestBetween;

export async function sendFriendRequest(
  fromUser: Partial<UserProfile>,
  toUser: Partial<UserProfile>,
): Promise<{ success: boolean; message: string }> {
  if (!fromUser?.uid || !toUser?.uid) return { success: false, message: "Invalid target user." };
  // Make sure we have the recipient's real profile (the caller may only know uid + a couple of fields).
  const target = (await getUser(toUser.uid)) ?? (toUser as UserDoc);
  try {
    return await sendBuddyRequest(fromUser as UserDoc & { uid: string }, { ...target, uid: toUser.uid });
  } catch (err) {
    console.error("sendFriendRequest failed:", err);
    return { success: false, message: "Couldn't send the request. Please try again." };
  }
}

export function subscribeIncomingRequests(
  currentUid: string,
  onUpdate: (requests: FriendRequestData[]) => void,
  _currentUsername?: string,
): Unsubscribe {
  return subscribeIncoming(currentUid, onUpdate);
}

export function subscribeOutgoingRequests(
  currentUid: string,
  onUpdate: (requests: FriendRequestData[]) => void,
  _currentUsername?: string,
): Unsubscribe {
  return subscribeOutgoing(currentUid, onUpdate);
}

export const subscribeFriendsList = subscribeBuddies;

export async function acceptFriendRequest(request: FriendRequestData): Promise<void> {
  await acceptBuddyRequest(request, request.toUid);
}

/** `requestId` form kept for compatibility; the recipient uid is parsed from the deterministic id. */
export async function declineFriendRequest(requestId: string): Promise<void> {
  const toUid = requestId.split("_").slice(2).join("_");
  await declineBuddyRequest({ id: requestId, toUid });
}

export async function cancelFriendRequest(requestId: string): Promise<void> {
  const toUid = requestId.split("_").slice(2).join("_");
  await cancelBuddyRequest({ id: requestId, toUid });
}

export const removeFriend = removeBuddy;
