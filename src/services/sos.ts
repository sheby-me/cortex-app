/**
 * SOS urgent-help requests.
 *
 * Lifecycle (status): open → in_progress (requester accepts a helper) → resolved (requester closes it)
 *                     open | in_progress → cancelled (requester cancels, escrow is refunded)
 *
 * Credits are escrowed from the requester when the request is created (see credits.ts for the security model),
 * paid to the helper when the request is resolved, and refunded to the requester when it is cancelled.
 */
import {
  collection,
  doc,
  getDocs,
  increment,
  limit as qLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  deleteDoc,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { stripUndefined, timeAgo } from "./common";
import { addHistoryToBatch, creditFields, minutesFromLabel, settlePendingCredits } from "./credits";
import { addNotificationToBatch } from "./notifications";
import type { UserDoc } from "./users";
import { getUser } from "./users";

export type SosStatus = "open" | "in_progress" | "resolved" | "cancelled";
export const SOS_STATUS_LABEL: Record<SosStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

export interface PersonLite {
  uid: string;
  displayName: string;
  username?: string;
  avatarUrl?: string | null;
}

export interface SosDoc {
  requesterId: string;
  requester: PersonLite;
  title: string;
  description?: string;
  subject: string;
  urgency: "Critical" | "High" | "Medium" | "Low";
  duration: string;
  credits: number;
  status: SosStatus;
  offersCount: number;
  helperId: string | null;
  helper: PersonLite | null;
  escrowed: boolean;
  rewardClaimed: boolean;
  refundClaimed: boolean;
  createdAt: unknown;
  acceptedAt?: unknown;
  closedAt?: unknown;
}
export type Sos = SosDoc & { id: string };

export interface OfferDoc {
  helperId: string;
  helper: PersonLite;
  note: string;
  createdAt: unknown;
}
export type Offer = OfferDoc & { id: string };

export const MIN_SOS_CREDITS = 10;
export const MAX_SOS_CREDITS = 1000;

const lite = (u: Partial<UserDoc> & { uid: string }): PersonLite =>
  stripUndefined({
    uid: u.uid,
    displayName: u.displayName || "Learner",
    username: u.username || undefined,
    avatarUrl: u.avatarUrl ?? null,
  }) as PersonLite;

const actorOf = (u: Partial<UserDoc> & { uid: string }) => ({
  uid: u.uid,
  username: u.username || "",
  displayName: u.displayName || "Learner",
  avatarUrl: u.avatarUrl || "",
});

export const sosPosted = (s: Pick<SosDoc, "createdAt">) => timeAgo(s.createdAt as never);

// ── creating ────────────────────────────────────────────────────────────────

export async function createSosRequest(params: {
  requester: Partial<UserDoc> & { uid: string };
  title: string;
  subject: string;
  urgency: SosDoc["urgency"];
  duration: string;
  credits: number;
  description?: string;
}): Promise<string> {
  const { requester } = params;
  const title = params.title.trim();
  const credits = Math.floor(Number(params.credits));
  if (!title) throw new Error("Please enter a question or problem title.");
  if (!Number.isFinite(credits) || credits < MIN_SOS_CREDITS || credits > MAX_SOS_CREDITS) {
    throw new Error(`Credits must be between ${MIN_SOS_CREDITS} and ${MAX_SOS_CREDITS}.`);
  }

  // Fresh balance check (the profile in React state may be stale). Rules re-verify server-side.
  const fresh = await getUser(requester.uid);
  if (!fresh || (fresh.credits ?? 0) < credits) {
    throw new Error(`You need ${credits} credits to post this request (balance: ${fresh?.credits ?? 0}).`);
  }

  const sosRef = doc(collection(db, "sos_requests"));
  const batch = writeBatch(db);
  batch.set(
    sosRef,
    stripUndefined({
      requesterId: requester.uid,
      requester: lite(requester),
      title,
      description: params.description?.trim() || undefined,
      subject: params.subject,
      urgency: params.urgency,
      duration: params.duration.trim() || "15 min",
      credits,
      status: "open" as SosStatus,
      offersCount: 0,
      helperId: null,
      helper: null,
      escrowed: true,
      rewardClaimed: false,
      refundClaimed: false,
      createdAt: serverTimestamp(),
    }),
  );
  batch.update(doc(db, "users", requester.uid), creditFields("sos_escrow", sosRef.id, -credits));
  addHistoryToBatch(batch, requester.uid, { type: "spend", amount: -credits, reason: `SOS escrow — ${title}` }, `sos_escrow_${sosRef.id}`);
  await batch.commit();

  void notifyMatchingHelpers(requester, sosRef.id, title, params.subject);
  return sosRef.id;
}

/**
 * Ping up to 20 available helpers whose "teach" topics match the subject. This is deliberately capped and
 * best-effort; at larger scale move it to a Cloud Function / topic-based push (FCM).
 */
async function notifyMatchingHelpers(
  requester: Partial<UserDoc> & { uid: string },
  sosId: string,
  title: string,
  subject: string,
) {
  try {
    const words = Array.from(
      new Set([subject.toLowerCase(), ...subject.toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length >= 3)]),
    ).slice(0, 10);
    if (!words.length) return;
    const snap = await getDocs(query(collection(db, "users"), where("teachTokens", "array-contains-any", words), qLimit(25)));
    const batch = writeBatch(db);
    let n = 0;
    snap.forEach((d) => {
      const u = d.data() as UserDoc;
      if (d.id === requester.uid || u.sosAvailable === false || n >= 20) return;
      addNotificationToBatch(
        batch,
        d.id,
        requester.uid,
        {
          type: "sos",
          title: "Matching SOS Request",
          text: `${requester.displayName || "A learner"} needs help with ${subject}: "${title.slice(0, 70)}"`,
          actor: actorOf(requester),
          actionUrl: "/sos",
          entityType: "sos",
          entityId: sosId,
        },
        `sos_new_${sosId}`,
      );
      n++;
    });
    if (n > 0) await batch.commit();
  } catch (err) {
    console.warn("SOS helper fan-out failed:", err);
  }
}

// ── reading ─────────────────────────────────────────────────────────────────

const mapSos = (d: { id: string; data: (o?: { serverTimestamps: "estimate" }) => unknown }): Sos => ({
  ...(d.data({ serverTimestamps: "estimate" }) as SosDoc),
  id: d.id,
});

/** Everything the SOS board needs: all open requests + my own + the ones I'm helping with, merged and sorted. */
export function subscribeSosBoard(
  uid: string,
  onData: (items: Sos[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  const buckets: Record<"open" | "mine" | "helping", Sos[]> = { open: [], mine: [], helping: [] };
  const emit = () => {
    const map = new Map<string, Sos>();
    [...buckets.open, ...buckets.helping, ...buckets.mine].forEach((s) => map.set(s.id, s));
    const list = Array.from(map.values()).sort((a, b) => {
      const ta = (a.createdAt as { toMillis?: () => number })?.toMillis?.() ?? Date.now();
      const tb = (b.createdAt as { toMillis?: () => number })?.toMillis?.() ?? Date.now();
      return tb - ta;
    });
    onData(list);
  };
  const handler = (key: keyof typeof buckets) => (snap: { docs: { id: string; data: never }[] }) => {
    buckets[key] = snap.docs.map((d) => mapSos(d as never));
    emit();
  };
  const err = (e: Error) => {
    console.error("SOS listener error:", e);
    onError?.(e);
  };
  const col = collection(db, "sos_requests");
  const unsubs = [
    onSnapshot(query(col, where("status", "==", "open"), orderBy("createdAt", "desc"), qLimit(50)), handler("open") as never, err),
    onSnapshot(query(col, where("requesterId", "==", uid), orderBy("createdAt", "desc"), qLimit(30)), handler("mine") as never, err),
    onSnapshot(query(col, where("helperId", "==", uid), orderBy("createdAt", "desc"), qLimit(30)), handler("helping") as never, err),
  ];
  return () => unsubs.forEach((u) => u());
}

export function subscribeOffers(sosId: string, onData: (offers: Offer[]) => void, onError?: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, "sos_requests", sosId, "offers"), orderBy("createdAt", "asc"), qLimit(50)),
    (snap) => onData(snap.docs.map((d) => ({ ...(d.data({ serverTimestamps: "estimate" }) as OfferDoc), id: d.id }))),
    (e) => onError?.(e),
  );
}

/** Ids of requests I've already offered to help with (mirror docs, so no per-request reads). */
export function subscribeMyOfferIds(uid: string, onData: (ids: Set<string>) => void): Unsubscribe {
  return onSnapshot(
    collection(db, "users", uid, "sosOffers"),
    (snap) => onData(new Set(snap.docs.map((d) => d.id))),
    () => onData(new Set()),
  );
}

export function subscribeSosBookmarks(uid: string, onData: (ids: Set<string>) => void): Unsubscribe {
  return onSnapshot(
    collection(db, "users", uid, "sosBookmarks"),
    (snap) => onData(new Set(snap.docs.map((d) => d.id))),
    () => onData(new Set()),
  );
}

export async function toggleSosBookmark(uid: string, sosId: string, saved: boolean): Promise<boolean> {
  const ref = doc(db, "users", uid, "sosBookmarks", sosId);
  if (saved) {
    await deleteDoc(ref);
    return false;
  }
  await setDoc(ref, { sosId, createdAt: serverTimestamp() });
  return true;
}

// ── actions ─────────────────────────────────────────────────────────────────

export async function offerHelp(
  request: Pick<Sos, "id" | "requesterId" | "title">,
  helper: Partial<UserDoc> & { uid: string },
  note: string,
): Promise<void> {
  const text = note.trim();
  if (!text) throw new Error("Please include a short note on how you can help.");
  if (helper.uid === request.requesterId) throw new Error("You can't offer help on your own request.");

  const batch = writeBatch(db);
  batch.set(doc(db, "sos_requests", request.id, "offers", helper.uid), {
    helperId: helper.uid,
    helper: lite(helper),
    note: text.slice(0, 500),
    createdAt: serverTimestamp(),
  });
  batch.update(doc(db, "sos_requests", request.id), { offersCount: increment(1) });
  batch.set(doc(db, "users", helper.uid, "sosOffers", request.id), { sosId: request.id, createdAt: serverTimestamp() });
  addNotificationToBatch(
    batch,
    request.requesterId,
    helper.uid,
    {
      type: "sos",
      title: "New offer to help",
      text: `${helper.displayName || "Someone"} offered to help with "${request.title.slice(0, 60)}".`,
      actor: actorOf(helper),
      actionUrl: "/sos",
      entityType: "sos",
      entityId: request.id,
    },
    `sos_offer_${request.id}_${helper.uid}`,
  );
  await batch.commit();
}

export async function acceptHelper(
  request: Pick<Sos, "id" | "title" | "requester">,
  offer: Offer,
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, "sos_requests", request.id), {
    status: "in_progress",
    helperId: offer.helperId,
    helper: offer.helper,
    acceptedAt: serverTimestamp(),
  });
  addNotificationToBatch(
    batch,
    offer.helperId,
    request.requester.uid,
    {
      type: "sos",
      title: "Your offer was accepted 🎉",
      text: `${request.requester.displayName} accepted your help with "${request.title.slice(0, 60)}". Message them to get started.`,
      actor: actorOf(request.requester),
      actionUrl: "/sos",
      entityType: "sos",
      entityId: request.id,
    },
    `sos_accepted_${request.id}`,
  );
  await batch.commit();
}

/** Requester marks the request as solved. The helper's client then claims the reward (settlePendingCredits). */
export async function closeRequest(request: Pick<Sos, "id" | "title" | "helperId" | "requester" | "credits">): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, "sos_requests", request.id), { status: "resolved", closedAt: serverTimestamp() });
  if (request.helperId) {
    addNotificationToBatch(
      batch,
      request.helperId,
      request.requester.uid,
      {
        type: "credit",
        title: "Request resolved",
        text: `"${request.title.slice(0, 60)}" was marked resolved — ${request.credits} credits are on their way to you.`,
        actor: actorOf(request.requester),
        actionUrl: "/profile",
        entityType: "sos",
        entityId: request.id,
      },
      `sos_resolved_${request.id}`,
    );
  }
  await batch.commit();
}

/** Cancel the request; the requester's client immediately reclaims the escrow. */
export async function cancelRequest(request: Pick<Sos, "id" | "requesterId" | "title" | "helperId" | "requester">): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, "sos_requests", request.id), { status: "cancelled", closedAt: serverTimestamp() });
  if (request.helperId) {
    addNotificationToBatch(
      batch,
      request.helperId,
      request.requester.uid,
      {
        type: "sos",
        title: "Request cancelled",
        text: `"${request.title.slice(0, 60)}" was cancelled by the requester.`,
        actor: actorOf(request.requester),
        actionUrl: "/sos",
        entityType: "sos",
        entityId: request.id,
      },
      `sos_cancelled_${request.id}`,
    );
  }
  await batch.commit();
  await settlePendingCredits(request.requesterId); // refund right away
}

export { minutesFromLabel };
