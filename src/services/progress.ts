/**
 * Learning content & progress: quizzes and roadmaps.
 *
 *   quizzes/{id}, roadmaps/{id}                         built-in catalog (public read, admin write; see scripts/seed-firestore.mjs)
 *   users/{uid}/quizzes/{id}, users/{uid}/roadmaps/{id} AI-generated content that belongs to one user
 *   users/{uid}/quizProgress/{quizId}                   attempts, best/last score
 *   users/{uid}/roadmapProgress/{roadmapId}             completed milestone indexes
 */
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  limit as qLimit,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { stripUndefined } from "./common";

// ── catalog + user content ──────────────────────────────────────────────────

export interface CatalogQuiz {
  id: string;
  title: string;
  subject: string;
  questions: number;
  difficulty: string;
  ai: boolean;
  /** Present on user-generated quizzes. */
  parsedQuestions?: unknown[];
  rawContent?: string;
  owned?: boolean;
}

export interface CatalogRoadmap {
  id: string;
  title: string;
  weeks: number;
  milestones: number;
  color: string;
  content?: string;
  owned?: boolean;
}

function subscribeMerged<T extends { id: string }>(
  catalogPath: string,
  userPath: (uid: string) => string,
  uid: string,
  onData: (items: T[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  let catalog: T[] = [];
  let mine: T[] = [];
  const emit = () => onData([...mine, ...catalog]);
  const err = (e: Error) => {
    console.error(`${catalogPath} listener error:`, e);
    onError?.(e);
  };
  const u1 = onSnapshot(
    query(collection(db, catalogPath), qLimit(100)),
    (s) => {
      catalog = s.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as unknown as T);
      emit();
    },
    err,
  );
  const u2 = onSnapshot(
    query(collection(db, userPath(uid)), orderBy("createdAt", "desc"), qLimit(100)),
    (s) => {
      mine = s.docs.map((d) => ({ ...(d.data() as object), id: d.id, owned: true }) as unknown as T);
      emit();
    },
    err,
  );
  return () => {
    u1();
    u2();
  };
}

export const subscribeQuizzes = (uid: string, cb: (q: CatalogQuiz[]) => void, onError?: (e: Error) => void) =>
  subscribeMerged<CatalogQuiz>("quizzes", (u) => `users/${u}/quizzes`, uid, cb, onError);

export const subscribeRoadmaps = (uid: string, cb: (r: CatalogRoadmap[]) => void, onError?: (e: Error) => void) =>
  subscribeMerged<CatalogRoadmap>("roadmaps", (u) => `users/${u}/roadmaps`, uid, cb, onError);

/** Persist an AI-generated quiz for this user. Returns the stored id. */
export async function saveGeneratedQuiz(
  uid: string,
  quiz: { title: string; subject: string; difficulty: string; parsedQuestions: unknown[]; rawContent?: string },
): Promise<string> {
  const ref = doc(collection(db, "users", uid, "quizzes"));
  await setDoc(
    ref,
    stripUndefined({
      title: quiz.title,
      subject: quiz.subject,
      difficulty: quiz.difficulty,
      questions: quiz.parsedQuestions.length,
      parsedQuestions: quiz.parsedQuestions,
      rawContent: quiz.rawContent?.slice(0, 20000),
      ai: true,
      createdAt: serverTimestamp(),
    }),
  );
  return ref.id;
}

export async function saveGeneratedRoadmap(
  uid: string,
  roadmap: { title: string; weeks: number; milestones: number; color: string; content: string },
): Promise<string> {
  const ref = doc(collection(db, "users", uid, "roadmaps"));
  await setDoc(ref, { ...roadmap, content: roadmap.content.slice(0, 50000), createdAt: serverTimestamp() });
  return ref.id;
}

// ── quiz progress ───────────────────────────────────────────────────────────

export interface QuizProgress {
  quizId: string;
  title: string;
  attempts: number;
  bestScore: number;
  bestPercent: number;
  lastScore: number;
  total: number;
  perfect: boolean;
  /** How many attempts were 100% — feeds the "Quiz Master" achievement. */
  perfectCount: number;
  lastAttemptAt?: unknown;
}

export function subscribeQuizProgress(uid: string, onData: (p: Record<string, QuizProgress>) => void): Unsubscribe {
  return onSnapshot(
    collection(db, "users", uid, "quizProgress"),
    (s) => onData(Object.fromEntries(s.docs.map((d) => [d.id, d.data() as QuizProgress]))),
    () => onData({}),
  );
}

/** Record a finished attempt. Transactional so attempts/best/perfect counters never lose an update. */
export async function recordQuizAttempt(
  uid: string,
  quiz: { id: string; title: string },
  score: number,
  total: number,
): Promise<QuizProgress> {
  const ref = doc(db, "users", uid, "quizProgress", quiz.id);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists() ? (snap.data() as QuizProgress) : null;
    const percent = total > 0 ? Math.round((score / total) * 100) : 0;
    const perfect = total > 0 && score === total;
    const next: QuizProgress = {
      quizId: quiz.id,
      title: quiz.title,
      attempts: (prev?.attempts ?? 0) + 1,
      bestScore: Math.max(prev?.bestScore ?? 0, score),
      bestPercent: Math.max(prev?.bestPercent ?? 0, percent),
      lastScore: score,
      total,
      perfect,
      perfectCount: (prev?.perfectCount ?? 0) + (perfect ? 1 : 0),
    };
    tx.set(ref, { ...next, lastAttemptAt: serverTimestamp() });
    return next;
  });
}

// ── roadmap progress ────────────────────────────────────────────────────────

export interface RoadmapProgress {
  roadmapId: string;
  completed: number[]; // indexes (0-based) of completed milestones
  progress: number; // 0-100
  updatedAt?: unknown;
}

export function subscribeRoadmapProgress(uid: string, onData: (p: Record<string, RoadmapProgress>) => void): Unsubscribe {
  return onSnapshot(
    collection(db, "users", uid, "roadmapProgress"),
    (s) => onData(Object.fromEntries(s.docs.map((d) => [d.id, d.data() as RoadmapProgress]))),
    () => onData({}),
  );
}

/** Toggle one milestone and recompute the percentage atomically. */
export async function toggleMilestone(uid: string, roadmapId: string, index: number, totalMilestones: number): Promise<RoadmapProgress> {
  if (index < 0 || index >= totalMilestones) throw new Error("Invalid milestone.");
  const ref = doc(db, "users", uid, "roadmapProgress", roadmapId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const set = new Set<number>(snap.exists() ? (snap.data() as RoadmapProgress).completed ?? [] : []);
    if (set.has(index)) set.delete(index);
    else set.add(index);
    const completed = Array.from(set).sort((a, b) => a - b);
    const progress = totalMilestones > 0 ? Math.round((completed.length / totalMilestones) * 100) : 0;
    const next: RoadmapProgress = { roadmapId, completed, progress };
    tx.set(ref, { ...next, updatedAt: serverTimestamp() });
    return next;
  });
}

export async function getRoadmapProgress(uid: string, roadmapId: string): Promise<RoadmapProgress | null> {
  const s = await getDoc(doc(db, "users", uid, "roadmapProgress", roadmapId));
  return s.exists() ? (s.data() as RoadmapProgress) : null;
}
