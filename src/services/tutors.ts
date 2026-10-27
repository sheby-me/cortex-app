/**
 * Tutors: public profiles, availability, session requests (with credit escrow) and ratings.
 *
 * Collections
 *   tutor_profiles/{uid}      public listing + availability + rating aggregates (ratingSum / ratingCount)
 *   tutor_sessions/{id}       one booking; also the credit escrow record (see credits.ts)
 *
 * Session lifecycle
 *   pending ─ tutor accepts ─▶ accepted ─ tutor delivers ─▶ delivered ─ student confirms + rates ─▶ completed ─▶ tutor claims payout
 *      │                          │                                  └─ (72 h with no response) tutor may auto-complete
 *      ├─ tutor declines ─▶ declined      student cancels (pending / accepted) ─▶ cancelled        (student claims refund)
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit as qLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { buildSearchTokens, stripUndefined } from "./common";
import { addHistoryToBatch, creditFields, settlePendingCredits } from "./credits";
import { addNotificationToBatch } from "./notifications";
import { getUser, type UserDoc } from "./users";

export type SessionMode = "materials" | "asyncQa" | "zoomMeeting";
export const MODE_META: Record<SessionMode, { label: string; durationMin: number }> = {
  materials: { label: "Material review", durationMin: 15 },
  asyncQa: { label: "Async Q&A", durationMin: 30 },
  zoomMeeting: { label: "Live Zoom session", durationMin: 45 },
};
export const DEFAULT_RATES = { materials: 15, asyncQa: 25, zoomMeeting: 50 };
export const AUTO_COMPLETE_AFTER_MS = 72 * 60 * 60 * 1000;

export interface AvailabilitySlot {
  /** 0 = Sunday … 6 = Saturday */
  day: number;
  start: string; // "09:00"
  end: string; // "17:00"
}

export interface TutorProfileDoc {
  uid: string;
  displayName: string;
  username?: string;
  avatarUrl?: string | null;
  institution?: string | null;
  credentials: string;
  bio: string;
  subjects: string[];
  languages: string[];
  timezone: string;
  rates: { materials: number; asyncQa: number; zoomMeeting: number };
  availability: AvailabilitySlot[];
  acceptingSessions: boolean;
  ratingSum: number;
  ratingCount: number;
  sessionsCompleted: number;
  searchTokens: string[];
  updatedAt?: unknown;
  createdAt?: unknown;
}
export type TutorProfile = TutorProfileDoc & { id: string };

export const averageRating = (t: Pick<TutorProfileDoc, "ratingSum" | "ratingCount">) =>
  t.ratingCount > 0 ? Math.round((t.ratingSum / t.ratingCount) * 10) / 10 : 0;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const formatAvailability = (slots: AvailabilitySlot[] | undefined) =>
  !slots?.length
    ? "No fixed hours — message the tutor to agree a time"
    : slots
        .slice()
        .sort((a, b) => a.day - b.day)
        .map((s) => `${DAY_NAMES[s.day]} ${s.start}–${s.end}`)
        .join(" · ");

// ── profiles ────────────────────────────────────────────────────────────────

export function subscribeTutorProfiles(
  onData: (t: TutorProfile[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, "tutor_profiles"), where("acceptingSessions", "==", true), qLimit(100)),
    (snap) => onData(snap.docs.map((d) => ({ ...(d.data() as TutorProfileDoc), id: d.id }))),
    (err) => {
      console.error("tutor_profiles listener error:", err);
      onError?.(err);
    },
  );
}

export function subscribeTutorProfile(uid: string, onData: (t: TutorProfile | null) => void): Unsubscribe {
  return onSnapshot(
    doc(db, "tutor_profiles", uid),
    (s) => onData(s.exists() ? { ...(s.data() as TutorProfileDoc), id: s.id } : null),
    () => onData(null),
  );
}

/** Build the denormalised listing payload from a user doc (used by admin approval and lazy creation). */
export function buildTutorProfile(
  user: Partial<UserDoc> & { uid: string },
  extra: Partial<Pick<TutorProfileDoc, "credentials" | "bio" | "rates">> = {},
): Omit<TutorProfileDoc, "createdAt" | "updatedAt"> {
  const u = user as Record<string, unknown>;
  const credentials = extra.credentials ?? (u.credentials as string) ?? "Verified Expert";
  const bio = extra.bio ?? (u.bio as string) ?? user.about ?? "";
  const rates = extra.rates ?? (u.rates as TutorProfileDoc["rates"]) ?? DEFAULT_RATES;
  const subjects = user.teach ?? [];
  return {
    uid: user.uid,
    displayName: user.displayName || "Tutor",
    username: user.username || undefined,
    avatarUrl: user.avatarUrl ?? null,
    institution: user.institution ?? null,
    credentials,
    bio,
    subjects,
    languages: ["English"],
    timezone: user.timezone || "Flexible",
    rates: { ...DEFAULT_RATES, ...rates },
    availability: [],
    acceptingSessions: true,
    ratingSum: 0,
    ratingCount: 0,
    sessionsCompleted: 0,
    searchTokens: buildSearchTokens([user.displayName, user.username, credentials, subjects, user.institution]),
  } as Omit<TutorProfileDoc, "createdAt" | "updatedAt">;
}

/** Create the tutor listing for an approved tutor if it doesn't exist yet (covers tutors approved before this feature). */
export async function ensureTutorProfile(uid: string): Promise<TutorProfile | null> {
  const ref = doc(db, "tutor_profiles", uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return { ...(snap.data() as TutorProfileDoc), id: uid };
  const user = await getUser(uid);
  if (!user || user.role !== "tutor") return null;
  const payload = stripUndefined({ ...buildTutorProfile(user), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await setDoc(ref, payload);
  return { ...(payload as unknown as TutorProfileDoc), id: uid };
}

export async function updateTutorProfile(
  uid: string,
  updates: Partial<Pick<TutorProfileDoc, "bio" | "subjects" | "languages" | "timezone" | "rates" | "availability" | "acceptingSessions" | "credentials">>,
): Promise<void> {
  const payload: Record<string, unknown> = { ...updates, updatedAt: serverTimestamp() };
  if (updates.rates) {
    for (const [k, v] of Object.entries(updates.rates)) {
      if (!Number.isFinite(v) || v < 0 || v > 1000) throw new Error(`Invalid rate for ${k}.`);
    }
  }
  if (updates.availability) {
    for (const s of updates.availability) {
      if (s.day < 0 || s.day > 6 || !/^\d{2}:\d{2}$/.test(s.start) || !/^\d{2}:\d{2}$/.test(s.end) || s.start >= s.end) {
        throw new Error("Each availability slot needs a valid day and a start time before its end time.");
      }
    }
  }
  await setDoc(doc(db, "tutor_profiles", uid), payload, { merge: true });
}

// ── sessions ────────────────────────────────────────────────────────────────

export type SessionStatus = "pending" | "accepted" | "delivered" | "completed" | "declined" | "cancelled";

export interface SessionDoc {
  tutorId: string;
  studentId: string;
  tutor: { uid: string; displayName: string; avatarUrl?: string | null; username?: string };
  student: { uid: string; displayName: string; avatarUrl?: string | null; username?: string };
  subject: string;
  topic: string;
  mode: SessionMode;
  slotLabel: string;
  credits: number;
  durationMin: number;
  status: SessionStatus;
  escrowed: boolean;
  payoutClaimed: boolean;
  refundClaimed: boolean;
  rating?: number;
  review?: string;
  createdAt: unknown;
  acceptedAt?: unknown;
  deliveredAt?: unknown;
  completedAt?: unknown;
}
export type Session = SessionDoc & { id: string };

const person = (u: Partial<UserDoc> & { uid: string }) =>
  stripUndefined({ uid: u.uid, displayName: u.displayName || "Learner", avatarUrl: u.avatarUrl ?? null, username: u.username || undefined });
const actorOf = (u: Partial<UserDoc> & { uid: string }) => ({
  uid: u.uid,
  username: u.username || "",
  displayName: u.displayName || "Learner",
  avatarUrl: u.avatarUrl || "",
});

export async function requestSession(params: {
  student: Partial<UserDoc> & { uid: string };
  tutor: Pick<TutorProfile, "id" | "displayName" | "avatarUrl" | "username" | "rates" | "credentials">;
  mode: SessionMode;
  topic: string;
  slotLabel: string;
}): Promise<string> {
  const { student, tutor, mode } = params;
  const topic = params.topic.trim();
  if (!topic) throw new Error("Please enter a topic or question for the tutor session.");
  if (student.uid === tutor.id) throw new Error("You can't book a session with yourself.");

  const credits = tutor.rates[mode];
  const fresh = await getUser(student.uid);
  if (!fresh || (fresh.credits ?? 0) < credits) {
    throw new Error(`You need ${credits} credits for this session (balance: ${fresh?.credits ?? 0}).`);
  }

  const ref = doc(collection(db, "tutor_sessions"));
  const batch = writeBatch(db);
  batch.set(
    ref,
    stripUndefined({
      tutorId: tutor.id,
      studentId: student.uid,
      tutor: person({ uid: tutor.id, displayName: tutor.displayName, avatarUrl: tutor.avatarUrl, username: tutor.username }),
      student: person(student),
      subject: tutor.credentials,
      topic: topic.slice(0, 500),
      mode,
      slotLabel: params.slotLabel.trim().slice(0, 100) || "To be agreed",
      credits,
      durationMin: MODE_META[mode].durationMin,
      status: "pending" as SessionStatus,
      escrowed: true,
      payoutClaimed: false,
      refundClaimed: false,
      createdAt: serverTimestamp(),
    }),
  );
  batch.update(doc(db, "users", student.uid), creditFields("session_escrow", ref.id, -credits));
  addHistoryToBatch(batch, student.uid, { type: "spend", amount: -credits, reason: `Session with ${tutor.displayName}` }, `session_escrow_${ref.id}`);
  addNotificationToBatch(
    batch,
    tutor.id,
    student.uid,
    {
      type: "tutor_request",
      title: "New session request",
      text: `${student.displayName || "A student"} requested a ${MODE_META[mode].label.toLowerCase()} — "${topic.slice(0, 60)}" (${credits} credits).`,
      actor: actorOf(student),
      actionUrl: "/teacher",
      entityType: "session",
      entityId: ref.id,
    },
    `session_req_${ref.id}`,
  );
  await batch.commit();
  return ref.id;
}

/** Sessions where I'm the tutor and sessions where I'm the student, merged (newest first). */
export function subscribeMySessions(
  uid: string,
  onData: (s: { asTutor: Session[]; asStudent: Session[] }) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  const state = { asTutor: [] as Session[], asStudent: [] as Session[] };
  const map = (snap: { docs: { id: string; data: (o?: { serverTimestamps: "estimate" }) => unknown }[] }): Session[] =>
    snap.docs.map((d) => ({ ...(d.data({ serverTimestamps: "estimate" }) as SessionDoc), id: d.id }));
  const err = (e: Error) => {
    console.error("sessions listener error:", e);
    onError?.(e);
  };
  const col = collection(db, "tutor_sessions");
  const u1 = onSnapshot(query(col, where("tutorId", "==", uid), orderBy("createdAt", "desc"), qLimit(100)), (s) => {
    state.asTutor = map(s as never);
    onData({ ...state });
  }, err);
  const u2 = onSnapshot(query(col, where("studentId", "==", uid), orderBy("createdAt", "desc"), qLimit(100)), (s) => {
    state.asStudent = map(s as never);
    onData({ ...state });
  }, err);
  return () => {
    u1();
    u2();
  };
}

async function notifyBatchSession(
  batch: ReturnType<typeof writeBatch>,
  to: string,
  actor: Partial<UserDoc> & { uid: string },
  sessionId: string,
  title: string,
  text: string,
  url: string,
) {
  addNotificationToBatch(batch, to, actor.uid, { type: "session", title, text, actor: actorOf(actor), actionUrl: url, entityType: "session", entityId: sessionId }, `session_${sessionId}_${title.replace(/\W+/g, "_").toLowerCase()}`);
}

export async function respondToSession(session: Session, tutor: Partial<UserDoc> & { uid: string }, accept: boolean) {
  const batch = writeBatch(db);
  batch.update(doc(db, "tutor_sessions", session.id), accept ? { status: "accepted", acceptedAt: serverTimestamp() } : { status: "declined" });
  await notifyBatchSession(
    batch,
    session.studentId,
    tutor,
    session.id,
    accept ? "Session accepted" : "Session declined",
    accept
      ? `${tutor.displayName || "Your tutor"} accepted your "${session.topic.slice(0, 50)}" session (${session.slotLabel}).`
      : `${tutor.displayName || "Your tutor"} couldn't take your session request. Your ${session.credits} credits will be refunded.`,
    "/tutors",
  );
  await batch.commit();
}

export async function markDelivered(session: Session, tutor: Partial<UserDoc> & { uid: string }) {
  const batch = writeBatch(db);
  batch.update(doc(db, "tutor_sessions", session.id), { status: "delivered", deliveredAt: serverTimestamp() });
  await notifyBatchSession(batch, session.studentId, tutor, session.id, "Session delivered", `${tutor.displayName || "Your tutor"} marked your session as delivered. Please confirm and leave a rating.`, "/tutors");
  await batch.commit();
}

/** Student confirms delivery and rates 1-5. Updates the tutor's rating aggregates in the same batch. */
export async function completeAndRate(session: Session, student: Partial<UserDoc> & { uid: string }, rating: number, review: string) {
  const r = Math.round(rating);
  if (r < 1 || r > 5) throw new Error("Please choose a rating between 1 and 5.");
  const batch = writeBatch(db);
  batch.update(doc(db, "tutor_sessions", session.id), {
    status: "completed",
    completedAt: serverTimestamp(),
    rating: r,
    review: review.trim().slice(0, 500),
  });
  batch.update(doc(db, "tutor_profiles", session.tutorId), {
    ratingSum: increment(r),
    ratingCount: increment(1),
    sessionsCompleted: increment(1),
    lastRatedSession: session.id,
  });
  await notifyBatchSession(batch, session.tutorId, student, session.id, "New rating", `${student.displayName || "A student"} rated your session ${r}/5. Your ${session.credits} credits are ready to claim.`, "/teacher");
  await batch.commit();
}

/** Tutor completes a delivered session the student never confirmed (allowed by rules after 72 h). */
export async function autoCompleteSession(session: Session) {
  await writeBatch(db).update(doc(db, "tutor_sessions", session.id), { status: "completed", completedAt: serverTimestamp() }).commit();
}

export async function cancelSession(session: Session, student: Partial<UserDoc> & { uid: string }) {
  const batch = writeBatch(db);
  batch.update(doc(db, "tutor_sessions", session.id), { status: "cancelled" });
  await notifyBatchSession(batch, session.tutorId, student, session.id, "Session cancelled", `${student.displayName || "A student"} cancelled "${session.topic.slice(0, 50)}".`, "/teacher");
  await batch.commit();
  await settlePendingCredits(student.uid);
}

/** Distinct students I've taught (for the Teacher Studio stat card). */
export async function countDistinctStudents(tutorId: string): Promise<number> {
  const snap = await getDocs(query(collection(db, "tutor_sessions"), where("tutorId", "==", tutorId), where("status", "==", "completed"), qLimit(500)));
  return new Set(snap.docs.map((d) => (d.data() as SessionDoc).studentId)).size;
}
