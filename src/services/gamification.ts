/**
 * Achievements, study streaks and the leaderboard.
 *
 * Integrity note: leaderboard ranking uses `creditsEarned` and `teachingMinutes`, which can only change through the
 * escrow-verified paths in credits.ts. Achievements and streaks are cosmetic (self-reported) and award no credits.
 */
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
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
import { buildNotificationPayload, notificationRef } from "./notifications";
import type { UserDoc } from "./users";
import type { QuizProgress } from "./progress";
import type { TutorProfileDoc } from "./tutors";

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
}

/** Static definitions (configuration, not user data). Unlock state lives in users/{uid}/achievements. */
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "a1", name: "First Steps", desc: "Complete onboarding", icon: "Sparkles" },
  { id: "a2", name: "Study Streak", desc: "7 days in a row", icon: "Flame" },
  { id: "a3", name: "Community Hero", desc: "10 community contributions", icon: "Heart" },
  { id: "a4", name: "Quiz Master", desc: "Score 100% on 5 quizzes", icon: "Trophy" },
  { id: "a5", name: "Top Tutor", desc: "50 sessions with 4.8+", icon: "GraduationCap" },
  { id: "a6", name: "Fast Responder", desc: "Answer SOS in <5min", icon: "Zap" },
  { id: "a7", name: "100 Hours Teaching", desc: "Cumulative", icon: "Clock" },
  { id: "a8", name: "Excellent Mentor", desc: "20+ five-star ratings", icon: "Star" },
];

export function subscribeAchievements(uid: string, onData: (unlocked: Record<string, unknown>) => void): Unsubscribe {
  return onSnapshot(
    collection(db, "users", uid, "achievements"),
    (s) => onData(Object.fromEntries(s.docs.map((d) => [d.id, d.data().unlockedAt ?? true]))),
    () => onData({}),
  );
}

async function countWhere(path: string, ...clauses: ReturnType<typeof where>[]): Promise<number> {
  try {
    const s = await getCountFromServer(query(collection(db, path), ...clauses));
    return s.data().count;
  } catch {
    return 0;
  }
}

/**
 * Evaluate every achievement and unlock the ones that are newly earned (one batch + one notification each).
 * Cheap enough to run at sign-in and after quizzes / sessions; returns the newly unlocked definitions.
 */
export async function evaluateAchievements(
  user: UserDoc,
  hints: { respondedFastToSos?: boolean } = {},
): Promise<AchievementDef[]> {
  const uid = user.uid;
  const existingSnap = await getDocs(collection(db, "users", uid, "achievements"));
  const have = new Set(existingSnap.docs.map((d) => d.id));
  const earn = new Set<string>();

  if (user.onboarded) earn.add("a1");
  if ((user.studyStreak ?? 0) >= 7) earn.add("a2");
  if ((user.teachingMinutes ?? 0) >= 6000) earn.add("a7");
  if (hints.respondedFastToSos) earn.add("a6");

  if (!have.has("a3")) {
    const [posts, comments] = await Promise.all([
      countWhere("posts", where("authorId", "==", uid)),
      // comments live in subcollections, so approximate with the user's own post count + received engagement
      Promise.resolve(0),
    ]);
    if (posts + comments >= 10) earn.add("a3");
  }

  if (!have.has("a4")) {
    const snap = await getDocs(collection(db, "users", uid, "quizProgress"));
    const perfect = snap.docs.reduce((n, d) => n + ((d.data() as QuizProgress).perfectCount ?? 0), 0);
    if (perfect >= 5) earn.add("a4");
  }

  if (user.role === "tutor" && (!have.has("a5") || !have.has("a8"))) {
    const t = await getDoc(doc(db, "tutor_profiles", uid));
    if (t.exists()) {
      const p = t.data() as TutorProfileDoc;
      const avg = p.ratingCount > 0 ? p.ratingSum / p.ratingCount : 0;
      if (p.sessionsCompleted >= 50 && avg >= 4.8) earn.add("a5");
      if (!have.has("a8")) {
        const fiveStars = await countWhere("tutor_sessions", where("tutorId", "==", uid), where("rating", "==", 5));
        if (fiveStars >= 20) earn.add("a8");
      }
    }
  }

  const fresh = ACHIEVEMENTS.filter((a) => earn.has(a.id) && !have.has(a.id));
  if (fresh.length === 0) return [];

  const batch = writeBatch(db);
  for (const a of fresh) {
    batch.set(doc(db, "users", uid, "achievements", a.id), { id: a.id, unlockedAt: serverTimestamp() });
    batch.set(
      notificationRef(uid, `achv_${a.id}`),
      buildNotificationPayload(uid, {
        type: "achievement",
        title: "Achievement unlocked",
        text: `Achievement unlocked: ${a.name} — ${a.desc}`,
        actionUrl: "/achievements",
      }),
    );
  }
  await batch.commit();
  return fresh;
}

// ── streaks ─────────────────────────────────────────────────────────────────

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Call once per day of activity (app open is enough). Consecutive days extend the streak, a gap resets it to 1. */
export async function touchStudyStreak(user: Pick<UserDoc, "uid" | "studyStreak" | "lastStudyDate">): Promise<number> {
  const today = dayKey(new Date());
  if (user.lastStudyDate === today) return user.studyStreak ?? 1;
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const next = user.lastStudyDate === dayKey(y) ? (user.studyStreak ?? 0) + 1 : 1;
  await updateDoc(doc(db, "users", user.uid), { studyStreak: next, lastStudyDate: today, updatedAt: serverTimestamp() });
  return next;
}

// ── leaderboard ─────────────────────────────────────────────────────────────

export type LeaderboardMetric = "credits" | "hours" | "help" | "streak" | "rating";

export interface LeaderboardRow {
  rank: number;
  uid: string;
  name: string;
  username?: string;
  credits: number;
  hours: number;
  helpCount: number;
  streak: number;
  rating: number;
  avatar: string;
  badge: string;
}

export function badgeFor(rank: number, credits: number): string {
  if (rank === 1) return "Legend";
  if (rank === 2) return "Top Mentor";
  if (rank === 3) return "Rising Star";
  if (credits >= 5000) return "Consistent";
  if (credits >= 1000) return "Community Hero";
  return "Learner";
}

const USER_SORT_FIELD: Record<"credits" | "hours" | "streak", string> = {
  credits: "creditsEarned",
  hours: "teachingMinutes",
  streak: "studyStreak",
};

function rowFromUser(d: { id: string; data: () => unknown }, rank: number): LeaderboardRow {
  const u = d.data() as UserDoc;
  const credits = u.creditsEarned ?? 0;
  return {
    rank,
    uid: d.id,
    name: u.displayName || "Learner",
    username: u.username || undefined,
    credits,
    hours: Math.round(((u.teachingMinutes ?? 0) / 60) * 10) / 10,
    helpCount: 0,
    streak: u.studyStreak ?? 0,
    rating: 0,
    avatar: u.avatarUrl || "",
    badge: badgeFor(rank, credits),
  };
}

/**
 * Live leaderboard for one metric.
 *  credits / hours / streak  → users ordered server-side (opted-in users only; needs the composite indexes)
 *  rating                    → verified tutor ratings (average of ratingSum / ratingCount, min. 1 review)
 *  help                      → resolved SOS requests grouped by helper (most recent 300 resolutions)
 */
export function subscribeLeaderboardBy(
  metric: LeaderboardMetric,
  onData: (rows: LeaderboardRow[]) => void,
  onError?: (e: Error) => void,
  max = 50,
): Unsubscribe {
  const err = (e: Error) => {
    console.error("leaderboard listener error:", e);
    onError?.(e);
  };

  if (metric === "credits" || metric === "hours" || metric === "streak") {
    return onSnapshot(
      query(collection(db, "users"), where("showLeaderboard", "==", true), orderBy(USER_SORT_FIELD[metric], "desc"), qLimit(max)),
      (snap) => onData(snap.docs.map((d, i) => rowFromUser(d, i + 1))),
      err,
    );
  }

  if (metric === "rating") {
    return onSnapshot(
      query(collection(db, "tutor_profiles"), qLimit(200)),
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as TutorProfileDoc) }))
          .filter((t) => t.ratingCount > 0)
          .map((t) => ({ t, avg: t.ratingSum / t.ratingCount }))
          .sort((a, b) => b.avg - a.avg || b.t.ratingCount - a.t.ratingCount)
          .slice(0, max)
          .map(
            ({ t, avg }, i): LeaderboardRow => ({
              rank: i + 1,
              uid: t.id,
              name: t.displayName,
              username: t.username,
              credits: 0,
              hours: 0,
              helpCount: 0,
              streak: 0,
              rating: Math.round(avg * 100) / 100,
              avatar: t.avatarUrl || "",
              badge: i === 0 ? "Top Rated" : "Verified Tutor",
            }),
          );
        onData(rows);
      },
      err,
    );
  }

  // help
  return onSnapshot(
    query(collection(db, "sos_requests"), where("status", "==", "resolved"), orderBy("closedAt", "desc"), qLimit(300)),
    (snap) => {
      const tally = new Map<string, { name: string; avatar: string; username?: string; n: number }>();
      snap.forEach((d) => {
        const s = d.data() as { helperId?: string; helper?: { displayName: string; avatarUrl?: string | null; username?: string } };
        if (!s.helperId || !s.helper) return;
        const cur = tally.get(s.helperId) ?? { name: s.helper.displayName, avatar: s.helper.avatarUrl || "", username: s.helper.username, n: 0 };
        cur.n += 1;
        tally.set(s.helperId, cur);
      });
      onData(
        Array.from(tally.entries())
          .sort((a, b) => b[1].n - a[1].n)
          .slice(0, max)
          .map(
            ([uid, v], i): LeaderboardRow => ({
              rank: i + 1,
              uid,
              name: v.name,
              username: v.username,
              credits: 0,
              hours: 0,
              helpCount: v.n,
              streak: 0,
              rating: 0,
              avatar: v.avatar,
              badge: i === 0 ? "Top Helper" : "Helper",
            }),
          ),
      );
    },
    err,
  );
}

/** My rank when I'm outside the top N: 1 + number of opted-in users who earned more than me. */
export async function getMyRank(me: Pick<UserDoc, "creditsEarned" | "showLeaderboard">): Promise<number | null> {
  if (me.showLeaderboard === false) return null;
  const ahead = await countWhere("users", where("showLeaderboard", "==", true), where("creditsEarned", ">", me.creditsEarned ?? 0));
  return ahead + 1;
}

export async function setLeaderboardVisibility(uid: string, visible: boolean) {
  await setDoc(doc(db, "users", uid), { showLeaderboard: visible, updatedAt: serverTimestamp() }, { merge: true });
}

// ── study time (feeds the dashboard's daily goal + weekly chart) ─────────────

const localDay = (d = new Date()) => dayKey(d);

/**
 * Counts minutes the user actively has Cortex open and visible. One tiny write per minute into
 * users/{uid}/studyDays/{YYYY-MM-DD}. Returns a cleanup function.
 */
export function startStudyTimer(uid: string): () => void {
  if (typeof window === "undefined") return () => {};
  const tick = () => {
    if (document.visibilityState !== "visible") return;
    const day = localDay();
    void setDoc(doc(db, "users", uid, "studyDays", day), { date: day, minutes: increment(1) }, { merge: true }).catch(() => undefined);
  };
  const timer = window.setInterval(tick, 60_000);
  return () => window.clearInterval(timer);
}

export interface StudyDay {
  date: string;
  minutes: number;
}

/** Last 7 days (oldest → newest, zero-filled) with live updates. */
export function subscribeStudyWeek(uid: string, onData: (days: StudyDay[]) => void): Unsubscribe {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(localDay(d));
  }
  return onSnapshot(
    query(collection(db, "users", uid, "studyDays"), orderBy("date", "desc"), qLimit(7)),
    (snap) => {
      const byDate = new Map<string, number>(snap.docs.map((d) => [d.id, Number((d.data() as StudyDay).minutes) || 0]));
      onData(days.map((date) => ({ date, minutes: byDate.get(date) ?? 0 })));
    },
    () => onData(days.map((date) => ({ date, minutes: 0 }))),
  );
}

export const todayKey = () => localDay();
