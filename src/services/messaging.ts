/**
 * Real-time messaging: direct chats, message requests, group chats, unread counts,
 * read receipts and typing indicators.
 *
 * Data model
 *   conversations/{id}
 *     type            "direct" | "group"        direct ids are the sorted uid pair ("a_b"), group ids are "group_{groupId}"
 *     participants    uid[]                     used for security rules and the inbox query
 *     participantInfo { [uid]: {displayName, username, avatarUrl} }   denormalised so the inbox needs no joins
 *     status          "accepted" | "pending" | "declined"             pending = message request awaiting the recipient
 *     requestedBy     uid                        who opened a pending request
 *     lastMessage     { text, senderId, hasAttachment }
 *     lastMessageAt   timestamp                  inbox ordering
 *     unread          { [uid]: number }          per-user unread counter (incremented by sender, reset by reader)
 *     lastRead        { [uid]: timestamp }       read receipts: a message is "seen" if createdAt <= lastRead[other]
 *     typing          { [uid]: timestamp }       typing indicator; clients treat < 6s old as "typing"
 *   conversations/{id}/messages/{messageId}
 *     senderId, text, attachments[], createdAt
 */
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  increment,
  limit as qLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { areBuddies } from "./buddies";
import { pairId, stripUndefined, toMillis, timeAgo } from "./common";
import { addNotificationToBatch } from "./notifications";
import { DOC_TYPES, uploadFile } from "./storage";
import type { UserDoc } from "./users";

export interface ParticipantInfo {
  displayName: string;
  username?: string;
  avatarUrl?: string | null;
}

export interface MessageAttachment {
  id: string;
  name: string;
  url: string;
  type: "image" | "file";
  size: string;
  bytes?: number;
}

export interface ConversationDoc {
  id: string;
  type: "direct" | "group";
  participants: string[];
  participantInfo: Record<string, ParticipantInfo>;
  status: "accepted" | "pending" | "declined";
  requestedBy?: string;
  groupId?: string;
  name?: string;
  avatarUrl?: string | null;
  lastMessage?: { text: string; senderId: string; hasAttachment?: boolean } | null;
  lastMessageAt?: unknown;
  unread?: Record<string, number>;
  lastRead?: Record<string, unknown>;
  typing?: Record<string, unknown>;
}

export interface MessageDoc {
  id: string;
  senderId: string;
  text: string;
  attachments?: MessageAttachment[];
  createdAt: unknown;
  /** True while the write has not yet reached the server (optimistic UI). */
  pending?: boolean;
}

const TYPING_FRESH_MS = 6_000;

const info = (u: Partial<UserDoc> & { uid: string }): ParticipantInfo =>
  stripUndefined({
    displayName: u.displayName || "Learner",
    username: u.username || undefined,
    avatarUrl: u.avatarUrl ?? null,
  }) as ParticipantInfo;

export const directConversationId = pairId;
export const groupConversationId = (groupId: string) => `group_${groupId}`;

/** The other participant in a direct chat. */
export function otherParticipant(conv: Pick<ConversationDoc, "participants">, me: string): string | undefined {
  return conv.participants.find((p) => p !== me);
}

/** Is `uid` currently typing in this conversation? (Re-evaluate on an interval — the data itself doesn't change when typing stops.) */
export function isTyping(conv: Pick<ConversationDoc, "typing">, uid: string): boolean {
  const t = conv.typing?.[uid];
  return !!t && Date.now() - toMillis(t as never) < TYPING_FRESH_MS;
}

/** Has the other person read up to (and including) this message? */
export function isSeenByOthers(conv: Pick<ConversationDoc, "lastRead" | "participants">, me: string, msg: MessageDoc): boolean {
  const createdAt = toMillis(msg.createdAt as never);
  return conv.participants
    .filter((p) => p !== me)
    .some((p) => {
      const lr = conv.lastRead?.[p];
      return !!lr && toMillis(lr as never) >= createdAt;
    });
}

// ────────────────────────────────────────────────────────────────────────────
// Conversations
// ────────────────────────────────────────────────────────────────────────────

/**
 * Open (or create) the 1:1 conversation between `me` and `other`.
 * Study buddies chat freely; everyone else starts a *message request* the recipient must accept.
 */
export async function getOrCreateDirectConversation(
  me: Partial<UserDoc> & { uid: string },
  other: Partial<UserDoc> & { uid: string },
): Promise<string> {
  if (me.uid === other.uid) throw new Error("You can't message yourself.");
  const id = directConversationId(me.uid, other.uid);
  const ref = doc(db, "conversations", id);
  const existing = await getDoc(ref);
  if (existing.exists()) return id;

  const buddies = await areBuddies(me.uid, other.uid);
  await setDoc(
    ref,
    stripUndefined({
      type: "direct",
      participants: [me.uid, other.uid].sort(),
      participantInfo: { [me.uid]: info(me), [other.uid]: info(other) },
      status: buddies ? "accepted" : "pending",
      requestedBy: buddies ? undefined : me.uid,
      lastMessage: null,
      lastMessageAt: serverTimestamp(),
      unread: { [me.uid]: 0, [other.uid]: 0 },
      createdAt: serverTimestamp(),
    }),
  );
  return id;
}

export async function respondToMessageRequest(convId: string, accept: boolean): Promise<void> {
  await updateDoc(doc(db, "conversations", convId), { status: accept ? "accepted" : "declined" });
}

/** Create the group-chat conversation. Called by the groups service in the same batch as the group itself. */
export function groupConversationPayload(
  groupId: string,
  name: string,
  members: Array<Partial<UserDoc> & { uid: string }>,
) {
  return stripUndefined({
    type: "group" as const,
    groupId,
    name,
    participants: members.map((m) => m.uid),
    participantInfo: Object.fromEntries(members.map((m) => [m.uid, info(m)])),
    status: "accepted" as const,
    lastMessage: null,
    lastMessageAt: serverTimestamp(),
    unread: Object.fromEntries(members.map((m) => [m.uid, 0])),
    createdAt: serverTimestamp(),
  });
}

export async function addToGroupConversation(groupId: string, member: Partial<UserDoc> & { uid: string }) {
  await updateDoc(doc(db, "conversations", groupConversationId(groupId)), {
    participants: arrayUnion(member.uid),
    [`participantInfo.${member.uid}`]: info(member),
    [`unread.${member.uid}`]: 0,
  });
}

export async function removeFromGroupConversation(groupId: string, uid: string) {
  await updateDoc(doc(db, "conversations", groupConversationId(groupId)), {
    participants: arrayRemove(uid),
    [`participantInfo.${uid}`]: deleteField(),
    [`unread.${uid}`]: deleteField(),
    [`lastRead.${uid}`]: deleteField(),
    [`typing.${uid}`]: deleteField(),
  });
}

/** Live inbox, newest activity first. Needs the (participants ARRAY, lastMessageAt DESC) index. */
export function subscribeConversations(
  uid: string,
  onData: (list: ConversationDoc[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, "conversations"),
    where("participants", "array-contains", uid),
    orderBy("lastMessageAt", "desc"),
    qLimit(60),
  );
  return onSnapshot(
    q,
    (snap) =>
      onData(
        snap.docs.map((d) => ({ ...(d.data({ serverTimestamps: "estimate" }) as ConversationDoc), id: d.id })),
      ),
    (err) => {
      console.error("conversations listener error:", err);
      onError?.(err);
    },
  );
}

export function subscribeConversation(
  convId: string,
  onData: (c: ConversationDoc | null) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, "conversations", convId),
    (s) => onData(s.exists() ? ({ ...(s.data({ serverTimestamps: "estimate" }) as ConversationDoc), id: s.id }) : null),
    () => onData(null),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Messages
// ────────────────────────────────────────────────────────────────────────────

/** Latest `max` messages in chronological order. Local (not-yet-synced) writes appear instantly with `pending: true`. */
export function subscribeMessages(
  convId: string,
  onData: (msgs: MessageDoc[]) => void,
  onError?: (e: Error) => void,
  max = 200,
): Unsubscribe {
  const q = query(collection(db, "conversations", convId, "messages"), orderBy("createdAt", "desc"), qLimit(max));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      const list = snap.docs
        .map((d) => ({
          ...(d.data({ serverTimestamps: "estimate" }) as Omit<MessageDoc, "id">),
          id: d.id,
          pending: d.metadata.hasPendingWrites,
        }))
        .reverse();
      onData(list);
    },
    (err) => {
      console.error("messages listener error:", err);
      onError?.(err);
    },
  );
}

export function formatBytes(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Upload chat attachments to Storage and return message-ready descriptors. */
export async function uploadChatAttachments(
  convId: string,
  files: File[],
  onProgress?: (pct: number) => void,
): Promise<MessageAttachment[]> {
  const out: MessageAttachment[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const res = await uploadFile({
      folder: `chat/${convId}`,
      file: f,
      maxBytes: 10 * 1024 * 1024,
      allowedTypes: DOC_TYPES,
      onProgress: (p) => onProgress?.(Math.round(((i + p / 100) / files.length) * 100)),
    });
    out.push({
      id: res.path,
      name: f.name,
      url: res.url,
      type: f.type.startsWith("image/") ? "image" : "file",
      size: formatBytes(f.size),
      bytes: f.size,
    });
  }
  return out;
}

/**
 * Send a message. One batch: message doc + conversation summary (+ unread counters) + inbox notification.
 * Because Firestore applies local writes immediately, the sender sees the message with no spinner (optimistic UI).
 */
export async function sendMessage(params: {
  conversation: Pick<ConversationDoc, "id" | "participants" | "type" | "name" | "participantInfo" | "groupId">;
  sender: Partial<UserDoc> & { uid: string };
  text: string;
  attachments?: MessageAttachment[];
}): Promise<void> {
  const { conversation, sender } = params;
  const text = params.text.trim();
  const attachments = params.attachments ?? [];
  if (!text && attachments.length === 0) return;
  if (text.length > 4000) throw new Error("Message is too long (max 4000 characters).");

  const convRef = doc(db, "conversations", conversation.id);
  const msgRef = doc(collection(db, "conversations", conversation.id, "messages"));
  const preview = text || (attachments[0]?.type === "image" ? "📷 Photo" : `📎 ${attachments[0]?.name ?? "Attachment"}`);

  const batch = writeBatch(db);
  batch.set(
    msgRef,
    stripUndefined({
      senderId: sender.uid,
      text,
      attachments: attachments.length ? attachments : undefined,
      createdAt: serverTimestamp(),
    }),
  );

  const convUpdate: Record<string, unknown> = {
    lastMessage: { text: preview.slice(0, 140), senderId: sender.uid, hasAttachment: attachments.length > 0 },
    lastMessageAt: serverTimestamp(),
    [`typing.${sender.uid}`]: deleteField(),
    [`lastRead.${sender.uid}`]: serverTimestamp(),
    [`unread.${sender.uid}`]: 0,
  };
  for (const p of conversation.participants) {
    if (p !== sender.uid) convUpdate[`unread.${p}`] = increment(1);
  }
  batch.update(convRef, convUpdate);

  // Keep the group card's "active" label fresh.
  if (conversation.type === "group" && conversation.groupId) {
    batch.update(doc(db, "groups", conversation.groupId), { lastActivityAt: serverTimestamp() });
  }

  // Direct chats also drop a (de-duplicated) notification so the bell lights up even if the inbox isn't open.
  if (conversation.type === "direct") {
    const other = conversation.participants.find((p) => p !== sender.uid);
    if (other) {
      addNotificationToBatch(
        batch,
        other,
        sender.uid,
        {
          type: "message",
          title: "New message",
          text: `${sender.displayName || "Someone"}: ${preview.slice(0, 80)}`,
          actor: {
            uid: sender.uid,
            username: sender.username || "",
            displayName: sender.displayName || "Learner",
            avatarUrl: sender.avatarUrl || "",
          },
          actionUrl: `/messages?conversation=${conversation.id}`,
          entityType: "conversation",
          entityId: conversation.id,
        },
        `msg_${conversation.id}_${sender.uid}`, // one rolling notification per sender per chat
      );
    }
  }

  await batch.commit();
}

/** Reset my unread counter + stamp my read receipt. Call only when unread > 0 to avoid pointless writes. */
export async function markConversationRead(convId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, "conversations", convId), {
    [`unread.${uid}`]: 0,
    [`lastRead.${uid}`]: serverTimestamp(),
  });
}

/** Typing indicator. Callers should throttle `true` to ~once per 2.5 s and send `false` on blur / send. */
export async function setTypingState(convId: string, uid: string, typing: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, "conversations", convId), {
      [`typing.${uid}`]: typing ? serverTimestamp() : deleteField(),
    });
  } catch {
    /* typing is best-effort */
  }
}

export function conversationTitle(conv: ConversationDoc, me: string): string {
  if (conv.type === "group") return conv.name || "Group chat";
  const other = otherParticipant(conv, me);
  return (other && conv.participantInfo?.[other]?.displayName) || "Learner";
}

export function conversationAvatar(conv: ConversationDoc, me: string): string {
  if (conv.type === "group") return conv.avatarUrl || "";
  const other = otherParticipant(conv, me);
  return (other && conv.participantInfo?.[other]?.avatarUrl) || "";
}

export { timeAgo as conversationTime };
