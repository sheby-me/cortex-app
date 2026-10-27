/**
 * Credit economy helpers.
 *
 * SECURITY MODEL (no Cloud Functions required):
 * A user may only change their OWN `credits` / `creditsEarned` / `teachingMinutes` fields, and firestore.rules only
 * accepts the change when it is accompanied — in the SAME batch — by a state change on a shared escrow document
 * (an SOS request or a tutor session) that justifies it. The user document carries two marker fields,
 * `lastCreditKind` and `lastCreditId`, which tell the rules which escrow document to verify:
 *
 *   sos_escrow      requester locks `credits` when creating an SOS request           (balance  -N)
 *   sos_reward      helper claims the reward after the requester marked it resolved  (balance  +N, earned +N)
 *   sos_refund      requester reclaims escrow after cancelling the request           (balance  +N)
 *   session_escrow  student locks the session price when requesting a tutor session  (balance  -N)
 *   session_payout  tutor claims payment after the student marked the session done   (balance  +N, earned +N)
 *   session_refund  student reclaims escrow after decline / cancel                   (balance  +N)
 *
 * Because every movement requires a matching, one-time flag flip on the escrow document (`rewardClaimed`,
 * `refundClaimed`, `payoutClaimed`), credits can't be minted or double-claimed from the browser console.
 */
import {
  collection,
  doc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type WriteBatch,
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";

export type CreditKind =
  | "sos_escrow"
  | "sos_reward"
  | "sos_refund"
  | "session_escrow"
  | "session_payout"
  | "session_refund";

export interface CreditHistoryEntry {
  id: string;
  type: "earn" | "spend";
  amount: number;
  reason: string;
  createdAt: unknown;
}

/** Fields to merge into the user doc update for a credit movement. `delta` is signed. */
export function creditFields(kind: CreditKind, escrowId: string, delta: number, opts: { minutes?: number } = {}) {
  const earned = kind === "sos_reward" || kind === "session_payout";
  return {
    credits: increment(delta),
    ...(earned ? { creditsEarned: increment(delta), teachingMinutes: increment(opts.minutes ?? 0) } : {}),
    lastCreditKind: kind,
    lastCreditId: escrowId,
    updatedAt: serverTimestamp(),
  };
}

/** Append a line to the user's visible credit ledger (shown on the profile page). */
export function addHistoryToBatch(
  batch: WriteBatch,
  uid: string,
  entry: { type: "earn" | "spend"; amount: number; reason: string },
  id?: string,
) {
  const ref = id ? doc(db, "users", uid, "creditHistory", id) : doc(collection(db, "users", uid, "creditHistory"));
  batch.set(ref, { ...entry, createdAt: serverTimestamp() });
}

export function minutesFromLabel(label: string | undefined | null): number {
  const m = String(label ?? "").match(/(\d+)\s*(h|hr|hour|m|min)?/i);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return m[2] && /^h/i.test(m[2]) ? n * 60 : n;
}

/**
 * Claim every payout / refund that is waiting for me. Idempotent and safe to call on each app load:
 *  - SOS I helped with that the requester marked resolved
 *  - SOS I cancelled that still hold my escrow
 *  - Tutor sessions completed where I'm the tutor
 *  - Tutor sessions declined / cancelled where I'm the student
 * Returns a human-readable summary for each claim so the UI can toast it.
 */
export async function settlePendingCredits(uid: string): Promise<string[]> {
  const messages: string[] = [];

  const [rewards, sosRefunds, payouts, sessionRefunds] = await Promise.all([
    getDocs(query(collection(db, "sos_requests"), where("helperId", "==", uid), where("status", "==", "resolved"), where("rewardClaimed", "==", false))),
    getDocs(query(collection(db, "sos_requests"), where("requesterId", "==", uid), where("status", "==", "cancelled"), where("refundClaimed", "==", false))),
    getDocs(query(collection(db, "tutor_sessions"), where("tutorId", "==", uid), where("status", "==", "completed"), where("payoutClaimed", "==", false))),
    getDocs(query(collection(db, "tutor_sessions"), where("studentId", "==", uid), where("status", "in", ["declined", "cancelled"]), where("refundClaimed", "==", false))),
  ]);

  // One batch per claim so a rules rejection on one item can't block the others.
  for (const d of rewards.docs) {
    const s = d.data() as { credits: number; title: string; duration?: string };
    try {
      const batch = writeBatch(db);
      batch.update(d.ref, { rewardClaimed: true });
      batch.update(doc(db, "users", uid), creditFields("sos_reward", d.id, s.credits, { minutes: minutesFromLabel(s.duration) }));
      addHistoryToBatch(batch, uid, { type: "earn", amount: s.credits, reason: `SOS help — ${s.title}` }, `sos_reward_${d.id}`);
      await batch.commit();
      messages.push(`You earned +${s.credits} credits for helping with "${s.title}".`);
    } catch (err) {
      console.warn("SOS reward claim failed:", err);
    }
  }

  for (const d of sosRefunds.docs) {
    const s = d.data() as { credits: number; title: string };
    try {
      const batch = writeBatch(db);
      batch.update(d.ref, { refundClaimed: true });
      batch.update(doc(db, "users", uid), creditFields("sos_refund", d.id, s.credits));
      addHistoryToBatch(batch, uid, { type: "earn", amount: s.credits, reason: `Refund — cancelled SOS "${s.title}"` }, `sos_refund_${d.id}`);
      await batch.commit();
      messages.push(`${s.credits} credits were refunded for your cancelled SOS request.`);
    } catch (err) {
      console.warn("SOS refund claim failed:", err);
    }
  }

  for (const d of payouts.docs) {
    const s = d.data() as { credits: number; subject: string; durationMin?: number; studentName?: string };
    try {
      const batch = writeBatch(db);
      batch.update(d.ref, { payoutClaimed: true });
      batch.update(doc(db, "users", uid), creditFields("session_payout", d.id, s.credits, { minutes: s.durationMin ?? 0 }));
      addHistoryToBatch(batch, uid, { type: "earn", amount: s.credits, reason: `Tutoring session — ${s.subject}` }, `session_payout_${d.id}`);
      await batch.commit();
      messages.push(`You earned +${s.credits} credits for your ${s.subject} session.`);
    } catch (err) {
      console.warn("Session payout claim failed:", err);
    }
  }

  for (const d of sessionRefunds.docs) {
    const s = d.data() as { credits: number; subject: string };
    try {
      const batch = writeBatch(db);
      batch.update(d.ref, { refundClaimed: true });
      batch.update(doc(db, "users", uid), creditFields("session_refund", d.id, s.credits));
      addHistoryToBatch(batch, uid, { type: "earn", amount: s.credits, reason: `Refund — ${s.subject} session not held` }, `session_refund_${d.id}`);
      await batch.commit();
      messages.push(`${s.credits} credits were refunded for your ${s.subject} session.`);
    } catch (err) {
      console.warn("Session refund claim failed:", err);
    }
  }

  return messages;
}
