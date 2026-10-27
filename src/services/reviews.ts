/**
 * Peer reviews shown on a profile: users/{profileUid}/reviews/{reviewerUid}
 * One review per reviewer per profile (the reviewer's uid is the document id, so re-reviewing edits the old one).
 * Only study buddies of the profile owner may review (enforced in firestore.rules).
 */
import {
  collection,
  doc,
  limit as qLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { stripUndefined, timeAgoShort } from "./common";
import { notifyUser } from "./notifications";
import type { UserDoc } from "./users";

export interface ProfileReview {
  id: string;
  reviewerId: string;
  name: string;
  role: string;
  rating: number;
  text: string;
  time: string;
}

export function subscribeProfileReviews(uid: string, onData: (r: ProfileReview[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, "users", uid, "reviews"), orderBy("createdAt", "desc"), qLimit(50)),
    (snap) =>
      onData(
        snap.docs.map((d) => {
          const r = d.data({ serverTimestamps: "estimate" }) as Record<string, unknown>;
          return {
            id: d.id,
            reviewerId: d.id,
            name: (r.reviewerName as string) || "Study buddy",
            role: (r.reviewerRole as string) || "student",
            rating: Number(r.rating) || 0,
            text: (r.text as string) || "",
            time: timeAgoShort(r.createdAt as never),
          };
        }),
      ),
    () => onData([]),
  );
}

export async function leaveReview(
  reviewer: Partial<UserDoc> & { uid: string },
  targetUid: string,
  rating: number,
  text: string,
): Promise<void> {
  const r = Math.round(rating);
  if (r < 1 || r > 5) throw new Error("Please choose a rating between 1 and 5.");
  const body = text.trim();
  if (!body) throw new Error("Please write a short review.");
  await setDoc(
    doc(db, "users", targetUid, "reviews", reviewer.uid),
    stripUndefined({
      reviewerId: reviewer.uid,
      reviewerName: reviewer.displayName || "Study buddy",
      reviewerRole: reviewer.role || "student",
      rating: r,
      text: body.slice(0, 500),
      createdAt: serverTimestamp(),
    }),
  );
  void notifyUser(targetUid, reviewer.uid, {
    type: "system",
    title: "New profile review",
    text: `${reviewer.displayName || "A study buddy"} left you a ${r}★ review.`,
    actor: { uid: reviewer.uid, username: reviewer.username || "", displayName: reviewer.displayName || "Learner", avatarUrl: reviewer.avatarUrl || "" },
    actionUrl: "/profile",
  }, `review_${reviewer.uid}`);
}
