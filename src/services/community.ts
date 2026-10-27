/**
 * Community hub: posts (with images), likes, comments, bookmarks, reports and cursor pagination.
 *
 * Collections
 *   posts/{postId}                 title, body, subject, tag, imageUrls[], keywords[], likesCount, commentsCount, reportCount
 *   posts/{postId}/likes/{uid}     existence == "uid liked this post"
 *   posts/{postId}/comments/{id}
 *   reports/{postId}_{reporterUid} moderation queue (admin-readable)
 *   users/{uid}/bookmarks/{postId}
 *
 * Counters are kept consistent by writing the child document and the parent counter in ONE transaction/batch;
 * firestore.rules verifies each counter moves by exactly ±1 and only together with its child document.
 */
import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  increment,
  limit as qLimit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
  writeBatch,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { stripUndefined, timeAgo } from "./common";
import { addNotificationToBatch, notifyUser } from "./notifications";
import { deleteStoredFile, IMAGE_TYPES, uploadFile } from "./storage";
import type { UserDoc } from "./users";

export const POST_TYPES = ["Question", "Notes", "Resource", "Poll"] as const;
export type PostType = (typeof POST_TYPES)[number];
export const PAGE_SIZE = 10;
/** Posts with this many reports are hidden from the feed until an admin reviews them. */
export const REPORT_HIDE_THRESHOLD = 5;

export interface AuthorLite {
  uid: string;
  displayName: string;
  username?: string;
  avatarUrl?: string | null;
}

export interface PostDoc {
  authorId: string;
  author: AuthorLite;
  subject: string;
  tag: PostType | string;
  title: string;
  body: string;
  imageUrls?: string[];
  imagePaths?: string[];
  keywords: string[];
  likesCount: number;
  commentsCount: number;
  reportCount: number;
  createdAt: unknown;
}
export type Post = PostDoc & { id: string };

export interface CommentDoc {
  authorId: string;
  author: AuthorLite;
  body: string;
  createdAt: unknown;
}
export type Comment = CommentDoc & { id: string };

export interface PostFilters {
  subject?: string | null;
  tag?: string | null;
}

const authorLite = (u: Partial<UserDoc> & { uid: string }): AuthorLite =>
  stripUndefined({
    uid: u.uid,
    displayName: u.displayName || "Learner",
    username: u.username || undefined,
    avatarUrl: u.avatarUrl ?? null,
  }) as AuthorLite;

/** Words + #hashtags used for tag filtering ("#dynamic-programming" and plain words both match). */
export function extractKeywords(...texts: string[]): string[] {
  const set = new Set<string>();
  for (const t of texts) {
    for (const m of t.toLowerCase().matchAll(/#?[a-z0-9][a-z0-9-]{1,38}/g)) {
      set.add(m[0].replace(/^#/, ""));
    }
  }
  return Array.from(set).slice(0, 50);
}

export function hashtagsOf(post: Pick<PostDoc, "title" | "body">): string[] {
  const out = new Set<string>();
  for (const m of `${post.title} ${post.body}`.toLowerCase().matchAll(/#([a-z0-9][a-z0-9-]{1,38})/g)) out.add(m[1]);
  return Array.from(out);
}

export const postTime = (p: Pick<PostDoc, "createdAt">) => timeAgo(p.createdAt as never);

// ────────────────────────────────────────────────────────────────────────────
// Feed (first page realtime, further pages by cursor)
// ────────────────────────────────────────────────────────────────────────────

function feedConstraints(filters: PostFilters): QueryConstraint[] {
  const c: QueryConstraint[] = [];
  if (filters.subject) c.push(where("subject", "==", filters.subject));
  if (filters.tag) c.push(where("keywords", "array-contains", filters.tag.toLowerCase().replace(/^#/, "")));
  c.push(orderBy("createdAt", "desc"));
  return c;
}

const toPost = (d: QueryDocumentSnapshot<DocumentData>): Post => ({
  ...(d.data({ serverTimestamps: "estimate" }) as PostDoc),
  id: d.id,
});

/** Live first page. Returns the last snapshot doc so the caller can paginate with `fetchMorePosts`. */
export function subscribeFeed(
  filters: PostFilters,
  onData: (posts: Post[], cursor: QueryDocumentSnapshot<DocumentData> | null, hasMore: boolean) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  const q = query(collection(db, "posts"), ...feedConstraints(filters), qLimit(PAGE_SIZE));
  return onSnapshot(
    q,
    (snap) => {
      const posts = snap.docs.map(toPost).filter((p) => (p.reportCount ?? 0) < REPORT_HIDE_THRESHOLD);
      onData(posts, snap.docs[snap.docs.length - 1] ?? null, snap.size === PAGE_SIZE);
    },
    (err) => {
      console.error("feed listener error:", err);
      onError?.(err);
    },
  );
}

export async function fetchMorePosts(
  filters: PostFilters,
  cursor: QueryDocumentSnapshot<DocumentData>,
): Promise<{ posts: Post[]; cursor: QueryDocumentSnapshot<DocumentData> | null; hasMore: boolean }> {
  const q = query(collection(db, "posts"), ...feedConstraints(filters), startAfter(cursor), qLimit(PAGE_SIZE));
  const snap = await getDocs(q);
  return {
    posts: snap.docs.map(toPost).filter((p) => (p.reportCount ?? 0) < REPORT_HIDE_THRESHOLD),
    cursor: snap.docs[snap.docs.length - 1] ?? cursor,
    hasMore: snap.size === PAGE_SIZE,
  };
}

/** Which of these posts have I liked? One cheap get() per post on the current page. */
export async function getLikedPostIds(uid: string, postIds: string[]): Promise<Set<string>> {
  const liked = new Set<string>();
  await Promise.all(
    postIds.map(async (id) => {
      const s = await getDoc(doc(db, "posts", id, "likes", uid));
      if (s.exists()) liked.add(id);
    }),
  );
  return liked;
}

/** Real counts for the subject filter list (server-side aggregation: 1 read per 1000 index entries). */
export async function countPostsBySubject(subjects: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(
    subjects.map(async (s) => {
      try {
        const snap = await getCountFromServer(query(collection(db, "posts"), where("subject", "==", s)));
        out[s] = snap.data().count;
      } catch {
        out[s] = 0;
      }
    }),
  );
  return out;
}

/** Hashtags used in the most recent posts, most popular first. */
export async function getTrendingTags(max = 8): Promise<string[]> {
  const snap = await getDocs(query(collection(db, "posts"), orderBy("createdAt", "desc"), qLimit(100)));
  const counts = new Map<string, number>();
  snap.forEach((d) => {
    const p = d.data() as PostDoc;
    for (const t of hashtagsOf(p)) counts.set(t, (counts.get(t) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([t]) => t);
}

// ────────────────────────────────────────────────────────────────────────────
// Create / delete
// ────────────────────────────────────────────────────────────────────────────

export async function createPost(params: {
  author: Partial<UserDoc> & { uid: string };
  title: string;
  body: string;
  subject: string;
  tag: PostType;
  images?: File[];
  onProgress?: (pct: number) => void;
}): Promise<string> {
  const { author, images = [] } = params;
  const title = params.title.trim();
  const body = (params.body.trim() || title).slice(0, 5000);
  if (!title) throw new Error("Please enter a title for your post.");
  if (title.length > 200) throw new Error("Title is too long (max 200 characters).");
  if (images.length > 4) throw new Error("You can attach up to 4 images.");

  const postRef = doc(collection(db, "posts"));

  // Upload first: if an upload fails nothing has been written, so there are no half-created posts.
  const uploaded: { url: string; path: string }[] = [];
  try {
    for (let i = 0; i < images.length; i++) {
      const res = await uploadFile({
        folder: `posts/${author.uid}/${postRef.id}`,
        file: images[i],
        maxBytes: 8 * 1024 * 1024,
        allowedTypes: IMAGE_TYPES,
        onProgress: (p) => params.onProgress?.(Math.round(((i + p / 100) / images.length) * 100)),
      });
      uploaded.push({ url: res.url, path: res.path });
    }
    await setDoc(
      postRef,
      stripUndefined({
        authorId: author.uid,
        author: authorLite(author),
        subject: params.subject,
        tag: params.tag,
        title,
        body,
        imageUrls: uploaded.length ? uploaded.map((u) => u.url) : undefined,
        imagePaths: uploaded.length ? uploaded.map((u) => u.path) : undefined,
        keywords: extractKeywords(title, body, params.subject),
        likesCount: 0,
        commentsCount: 0,
        reportCount: 0,
        createdAt: serverTimestamp(),
      }),
    );
  } catch (err) {
    await Promise.all(uploaded.map((u) => deleteStoredFile(u.path))); // roll back orphaned uploads
    throw err;
  }
  return postRef.id;
}

/** Delete my post, its images, and (best effort) its likes/comments. */
export async function deletePost(post: Pick<Post, "id" | "imagePaths" | "imageUrls">): Promise<void> {
  // Remove children first (rules allow the post author to delete them); the post doc goes last so a
  // failure part-way leaves a still-visible post the user can retry deleting.
  for (const sub of ["comments", "likes"] as const) {
    for (;;) {
      const snap = await getDocs(query(collection(db, "posts", post.id, sub), qLimit(400)));
      if (snap.empty) break;
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      if (snap.size < 400) break;
    }
  }
  await deleteDoc(doc(db, "posts", post.id));
  await Promise.all((post.imagePaths ?? post.imageUrls ?? []).map((p) => deleteStoredFile(p)));
}

// ────────────────────────────────────────────────────────────────────────────
// Likes
// ────────────────────────────────────────────────────────────────────────────

/** Atomically toggle my like. Returns the new state. */
export async function toggleLike(
  post: Pick<Post, "id" | "authorId" | "title">,
  me: Partial<UserDoc> & { uid: string },
): Promise<boolean> {
  const likeRef = doc(db, "posts", post.id, "likes", me.uid);
  const postRef = doc(db, "posts", post.id);
  const nowLiked = await runTransaction(db, async (tx) => {
    const existing = await tx.get(likeRef);
    if (existing.exists()) {
      tx.delete(likeRef);
      tx.update(postRef, { likesCount: increment(-1) });
      return false;
    }
    tx.set(likeRef, { uid: me.uid, createdAt: serverTimestamp() });
    tx.update(postRef, { likesCount: increment(1) });
    return true;
  });
  if (nowLiked) {
    // Deterministic id => re-liking the same post never spams the author.
    void notifyUser(
      post.authorId,
      me.uid,
      {
        type: "like",
        title: "New like",
        text: `${me.displayName || "Someone"} liked your post "${post.title.slice(0, 60)}".`,
        actor: { uid: me.uid, username: me.username || "", displayName: me.displayName || "Learner", avatarUrl: me.avatarUrl || "" },
        actionUrl: "/community",
        entityType: "post",
        entityId: post.id,
      },
      `like_${post.id}_${me.uid}`,
    );
  }
  return nowLiked;
}

// ────────────────────────────────────────────────────────────────────────────
// Comments
// ────────────────────────────────────────────────────────────────────────────

export function subscribeComments(postId: string, onData: (c: Comment[]) => void, onError?: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, "posts", postId, "comments"), orderBy("createdAt", "asc"), qLimit(200)),
    (snap) =>
      onData(
        snap.docs.map((d) => ({ ...(d.data({ serverTimestamps: "estimate" }) as CommentDoc), id: d.id })),
      ),
    (err) => onError?.(err),
  );
}

export async function addComment(
  post: Pick<Post, "id" | "authorId" | "title">,
  me: Partial<UserDoc> & { uid: string },
  body: string,
): Promise<void> {
  const text = body.trim();
  if (!text) return;
  if (text.length > 2000) throw new Error("Comment is too long (max 2000 characters).");
  const commentRef = doc(collection(db, "posts", post.id, "comments"));
  const batch = writeBatch(db);
  batch.set(commentRef, { authorId: me.uid, author: authorLite(me), body: text, createdAt: serverTimestamp() });
  batch.update(doc(db, "posts", post.id), { commentsCount: increment(1) });
  addNotificationToBatch(batch, post.authorId, me.uid, {
    type: "comment",
    title: "New comment",
    text: `${me.displayName || "Someone"} commented on "${post.title.slice(0, 60)}": ${text.slice(0, 80)}`,
    actor: { uid: me.uid, username: me.username || "", displayName: me.displayName || "Learner", avatarUrl: me.avatarUrl || "" },
    actionUrl: "/community",
    entityType: "post",
    entityId: post.id,
  });
  await batch.commit();
}

export async function deleteComment(postId: string, commentId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, "posts", postId, "comments", commentId));
  batch.update(doc(db, "posts", postId), { commentsCount: increment(-1) });
  await batch.commit();
}

// ────────────────────────────────────────────────────────────────────────────
// Bookmarks
// ────────────────────────────────────────────────────────────────────────────

export function subscribeBookmarks(uid: string, onData: (ids: Set<string>) => void): Unsubscribe {
  return onSnapshot(
    collection(db, "users", uid, "bookmarks"),
    (snap) => onData(new Set(snap.docs.map((d) => d.id))),
    () => onData(new Set()),
  );
}

export async function toggleBookmark(uid: string, postId: string, currentlySaved: boolean): Promise<boolean> {
  const ref = doc(db, "users", uid, "bookmarks", postId);
  if (currentlySaved) {
    await deleteDoc(ref);
    return false;
  }
  await setDoc(ref, { postId, createdAt: serverTimestamp() });
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Reports
// ────────────────────────────────────────────────────────────────────────────

export const REPORT_REASONS = ["Spam", "Harassment or hate", "Inappropriate content", "Misinformation", "Other"] as const;

/** One report per user per post. Returns false if I already reported it. */
export async function reportPost(
  post: Pick<Post, "id" | "authorId" | "title">,
  reporterUid: string,
  reason: string,
): Promise<boolean> {
  const reportRef = doc(db, "reports", `${post.id}_${reporterUid}`);
  const postRef = doc(db, "posts", post.id);
  return runTransaction(db, async (tx) => {
    const existing = await tx.get(reportRef);
    if (existing.exists()) return false;
    tx.set(reportRef, {
      postId: post.id,
      postAuthorId: post.authorId,
      postTitle: post.title.slice(0, 120),
      reporterId: reporterUid,
      reason: reason.slice(0, 200),
      status: "open",
      createdAt: serverTimestamp(),
    });
    tx.update(postRef, { reportCount: increment(1) });
    return true;
  });
}

