/**
 * Study groups: create, join, leave, invite, members and group chat.
 *
 * Collections
 *   groups/{gid}                    name, subject, description, schedule, privacy, ownerId, memberCount, lastActivityAt
 *   groups/{gid}/members/{uid}      membership record (role: owner | member)
 *   group_invites/{gid}_{uid}       pending invitation (private groups require one to join)
 *   users/{uid}/groups/{gid}        mirror of my memberships so "my groups" is one cheap listener
 *   conversations/group_{gid}       the group chat (see messaging.ts)
 *
 * memberCount is changed only in the same batch that adds / removes a member document.
 */
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  documentId,
  getDoc,
  getDocs,
  increment,
  limit as qLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { buildSearchTokens, chunk, stripUndefined } from "./common";
import { addNotificationToBatch } from "./notifications";
import { groupConversationId, groupConversationPayload } from "./messaging";
import { cleanUsername, type UserDoc } from "./users";

export const GROUP_COLORS = [
  "from-violet-500 to-fuchsia-500",
  "from-blue-500 to-cyan-500",
  "from-emerald-500 to-teal-500",
  "from-orange-500 to-rose-500",
  "from-blue-600 to-indigo-700",
];

export interface GroupDoc {
  name: string;
  subject: string;
  description: string;
  schedule: string;
  color: string;
  privacy: "public" | "private";
  ownerId: string;
  memberCount: number;
  searchTokens: string[];
  createdAt: unknown;
  lastActivityAt?: unknown;
}
export type Group = GroupDoc & { id: string };

export interface GroupMember {
  uid: string;
  displayName: string;
  username?: string;
  avatarUrl?: string | null;
  role: "owner" | "member";
  joinedAt: unknown;
}

const memberLite = (u: Partial<UserDoc> & { uid: string }, role: GroupMember["role"]) =>
  stripUndefined({
    uid: u.uid,
    displayName: u.displayName || "Learner",
    username: u.username || undefined,
    avatarUrl: u.avatarUrl ?? null,
    role,
    joinedAt: serverTimestamp(),
  });
const actorOf = (u: Partial<UserDoc> & { uid: string }) => ({
  uid: u.uid,
  username: u.username || "",
  displayName: u.displayName || "Learner",
  avatarUrl: u.avatarUrl || "",
});

export const inviteId = (gid: string, uid: string) => `${gid}_${uid}`;

// ── reading ─────────────────────────────────────────────────────────────────

/**
 * Public groups (most popular first) + groups I belong to (including private ones), merged.
 * `memberOf` tells the UI which cards show "Joined".
 */
export function subscribeGroups(
  uid: string,
  onData: (groups: Group[], memberOf: Set<string>) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  let publicGroups: Group[] = [];
  let mine: Group[] = [];
  let memberOf = new Set<string>();
  const emit = () => {
    const map = new Map<string, Group>();
    [...publicGroups, ...mine].forEach((g) => map.set(g.id, g));
    onData(Array.from(map.values()).sort((a, b) => b.memberCount - a.memberCount), memberOf);
  };
  const err = (e: Error) => {
    console.error("groups listener error:", e);
    onError?.(e);
  };

  const u1 = onSnapshot(
    query(collection(db, "groups"), where("privacy", "==", "public"), orderBy("memberCount", "desc"), qLimit(60)),
    (snap) => {
      publicGroups = snap.docs.map((d) => ({ ...(d.data({ serverTimestamps: "estimate" }) as GroupDoc), id: d.id }));
      emit();
    },
    err,
  );

  let privateUnsubs: Unsubscribe[] = [];
  const u2 = onSnapshot(
    collection(db, "users", uid, "groups"),
    (snap) => {
      memberOf = new Set(snap.docs.map((d) => d.id));
      privateUnsubs.forEach((u) => u());
      privateUnsubs = [];
      const ids = Array.from(memberOf);
      mine = [];
      if (ids.length === 0) return emit();
      // Live-listen to my groups in chunks of 10 (Firestore `in` limit-safe).
      chunk(ids, 10).forEach((part, idx) => {
        const partResults: Record<number, Group[]> = {};
        privateUnsubs.push(
          onSnapshot(
            query(collection(db, "groups"), where(documentId(), "in", part)),
            (s) => {
              partResults[idx] = s.docs.map((d) => ({ ...(d.data({ serverTimestamps: "estimate" }) as GroupDoc), id: d.id }));
              mine = Object.values(partResults).flat();
              emit();
            },
            err,
          ),
        );
      });
    },
    err,
  );

  return () => {
    u1();
    u2();
    privateUnsubs.forEach((u) => u());
  };
}

export function subscribeGroupMembers(gid: string, onData: (m: GroupMember[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, "groups", gid, "members"), orderBy("joinedAt", "asc"), qLimit(100)),
    (snap) => onData(snap.docs.map((d) => ({ ...(d.data({ serverTimestamps: "estimate" }) as GroupMember), uid: d.id }))),
    () => onData([]),
  );
}

/** Pending invitations addressed to me. */
export function subscribeMyInvites(
  uid: string,
  onData: (invites: Array<{ id: string; groupId: string; groupName: string; from: { uid: string; displayName: string } }>) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, "group_invites"), where("toUid", "==", uid), where("status", "==", "pending")),
    (snap) => onData(
        snap.docs.map(
          (d) =>
            ({ ...(d.data() as Record<string, unknown>), id: d.id }) as {
              id: string;
              groupId: string;
              groupName: string;
              from: { uid: string; displayName: string };
            },
        ),
      ),
    () => onData([]),
  );
}

// ── create ──────────────────────────────────────────────────────────────────

/**
 * Create a group, its owner membership, its group-chat conversation and (optionally) invitations — atomically.
 * `invitedHandles` are @usernames; unknown handles are reported back instead of failing the whole create.
 */
export async function createGroup(params: {
  owner: Partial<UserDoc> & { uid: string };
  name: string;
  subject: string;
  description?: string;
  schedule?: string;
  privacy?: "public" | "private";
  invitedHandles?: string[];
}): Promise<{ id: string; invited: string[]; notFound: string[] }> {
  const { owner } = params;
  const name = params.name.trim();
  if (!name) throw new Error("Please enter a group name.");
  if (name.length > 80) throw new Error("Group name is too long (max 80 characters).");

  // Resolve @handles → uids (usernames/{handle} is a public lookup doc).
  const handles = Array.from(new Set((params.invitedHandles ?? []).map(cleanUsername).filter(Boolean)));
  const resolved: Array<{ handle: string; uid: string }> = [];
  const notFound: string[] = [];
  await Promise.all(
    handles.map(async (h) => {
      const s = await getDoc(doc(db, "usernames", h));
      if (s.exists() && (s.data() as { uid: string }).uid !== owner.uid) resolved.push({ handle: h, uid: (s.data() as { uid: string }).uid });
      else if (!s.exists()) notFound.push(h);
    }),
  );

  const groupRef = doc(collection(db, "groups"));
  const gid = groupRef.id;
  const privacy = params.privacy ?? "public";
  const batch = writeBatch(db);

  batch.set(groupRef, {
    name,
    subject: params.subject,
    description: params.description?.trim() || `Study room for ${name}.`,
    schedule: params.schedule?.trim() || "To be agreed",
    color: GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)],
    privacy,
    ownerId: owner.uid,
    memberCount: 1,
    searchTokens: buildSearchTokens([name, params.subject]),
    createdAt: serverTimestamp(),
    lastActivityAt: serverTimestamp(),
  });
  batch.set(doc(db, "groups", gid, "members", owner.uid), memberLite(owner, "owner"));
  batch.set(doc(db, "users", owner.uid, "groups", gid), { groupId: gid, joinedAt: serverTimestamp() });
  batch.set(doc(db, "conversations", groupConversationId(gid)), groupConversationPayload(gid, name, [owner]));

  for (const r of resolved) {
    batch.set(doc(db, "group_invites", inviteId(gid, r.uid)), {
      groupId: gid,
      groupName: name,
      fromUid: owner.uid,
      from: { uid: owner.uid, displayName: owner.displayName || "Learner" },
      toUid: r.uid,
      status: "pending",
      createdAt: serverTimestamp(),
    });
    addNotificationToBatch(
      batch,
      r.uid,
      owner.uid,
      {
        type: "group_invite",
        title: "Study group invitation",
        text: `${owner.displayName || "Someone"} invited you to join "${name}".`,
        actor: actorOf(owner),
        actionUrl: "/groups",
        entityType: "group",
        entityId: gid,
      },
      `group_invite_${gid}`,
    );
  }
  await batch.commit();
  return { id: gid, invited: resolved.map((r) => r.handle), notFound };
}

// ── join / leave ────────────────────────────────────────────────────────────

/** Join a public group, or any group I hold an invitation to. */
export async function joinGroup(group: Pick<Group, "id" | "privacy" | "name">, me: Partial<UserDoc> & { uid: string }): Promise<void> {
  const invite = await getDoc(doc(db, "group_invites", inviteId(group.id, me.uid)));
  if (group.privacy === "private" && !invite.exists()) throw new Error("This is a private group — you need an invitation to join.");

  const batch = writeBatch(db);
  batch.set(doc(db, "groups", group.id, "members", me.uid), memberLite(me, "member"));
  batch.update(doc(db, "groups", group.id), { memberCount: increment(1) });
  batch.set(doc(db, "users", me.uid, "groups", group.id), { groupId: group.id, joinedAt: serverTimestamp() });
  batch.update(doc(db, "conversations", groupConversationId(group.id)), {
    participants: arrayUnion(me.uid),
    [`participantInfo.${me.uid}`]: stripUndefined({ displayName: me.displayName || "Learner", username: me.username, avatarUrl: me.avatarUrl ?? null }),
    [`unread.${me.uid}`]: 0,
  });
  if (invite.exists()) batch.delete(invite.ref);
  await batch.commit();
}

export async function leaveGroup(group: Pick<Group, "id" | "ownerId">, uid: string): Promise<void> {
  if (group.ownerId === uid) throw new Error("Group owners can't leave. Delete the group instead.");
  const batch = writeBatch(db);
  batch.delete(doc(db, "groups", group.id, "members", uid));
  batch.update(doc(db, "groups", group.id), { memberCount: increment(-1) });
  batch.delete(doc(db, "users", uid, "groups", group.id));
  batch.update(doc(db, "conversations", groupConversationId(group.id)), {
    participants: arrayRemove(uid),
    [`participantInfo.${uid}`]: deleteField(),
    [`unread.${uid}`]: deleteField(),
    [`lastRead.${uid}`]: deleteField(),
    [`typing.${uid}`]: deleteField(),
  });
  await batch.commit();
}

export async function declineInvite(gid: string, uid: string): Promise<void> {
  await deleteDoc(doc(db, "group_invites", inviteId(gid, uid)));
}

/** Owner invites more people after creation. */
export async function inviteToGroup(
  group: Pick<Group, "id" | "name">,
  owner: Partial<UserDoc> & { uid: string },
  handles: string[],
): Promise<{ invited: string[]; notFound: string[] }> {
  const clean = Array.from(new Set(handles.map(cleanUsername).filter(Boolean)));
  const invited: string[] = [];
  const notFound: string[] = [];
  const batch = writeBatch(db);
  for (const h of clean) {
    const s = await getDoc(doc(db, "usernames", h));
    if (!s.exists()) {
      notFound.push(h);
      continue;
    }
    const toUid = (s.data() as { uid: string }).uid;
    if (toUid === owner.uid) continue;
    invited.push(h);
    batch.set(doc(db, "group_invites", inviteId(group.id, toUid)), {
      groupId: group.id,
      groupName: group.name,
      fromUid: owner.uid,
      from: { uid: owner.uid, displayName: owner.displayName || "Learner" },
      toUid,
      status: "pending",
      createdAt: serverTimestamp(),
    });
    addNotificationToBatch(batch, toUid, owner.uid, {
      type: "group_invite",
      title: "Study group invitation",
      text: `${owner.displayName || "Someone"} invited you to join "${group.name}".`,
      actor: actorOf(owner),
      actionUrl: "/groups",
      entityType: "group",
      entityId: group.id,
    }, `group_invite_${group.id}`);
  }
  if (invited.length) await batch.commit();
  return { invited, notFound };
}

/** Owner removes the group, memberships and chat conversation. (Chat messages are left for a scheduled cleanup.) */
export async function deleteGroup(group: Pick<Group, "id">): Promise<void> {
  const members = await getDocs(collection(db, "groups", group.id, "members"));
  for (const part of chunk(members.docs, 200)) {
    const batch = writeBatch(db);
    part.forEach((m) => {
      batch.delete(m.ref);
      batch.delete(doc(db, "users", m.id, "groups", group.id));
    });
    await batch.commit();
  }
  const last = writeBatch(db);
  last.delete(doc(db, "conversations", groupConversationId(group.id)));
  last.delete(doc(db, "groups", group.id));
  await last.commit();
}
