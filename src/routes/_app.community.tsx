import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Heart,
  MessageCircle,
  Bookmark,
  Share2,
  TrendingUp,
  Plus,
  Send,
  Filter,
  CheckCircle,
  MoreHorizontal,
  Trash2,
  Flag,
  Image as ImageIcon,
  X,
  Loader2,
} from "lucide-react";
import { collection, getCountFromServer, type DocumentData, type QueryDocumentSnapshot } from "firebase/firestore";
import { toast } from "sonner";
import { db } from "@/integrations/firebase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  REPORT_REASONS,
  addComment,
  countPostsBySubject,
  createPost,
  deleteComment,
  deletePost,
  fetchMorePosts,
  getLikedPostIds,
  getTrendingTags,
  postTime,
  reportPost,
  subscribeBookmarks,
  subscribeComments,
  subscribeFeed,
  toggleBookmark,
  toggleLike,
  type Comment,
  type Post,
  type PostType,
} from "@/services/community";
import { isSafeStorageUrl } from "@/lib/safe-url";
import { VerifiedBadge } from "@/components/verified-badge";
import { errorMessage, timeAgo } from "@/services/common";
import type { UserDoc } from "@/services/users";

export const Route = createFileRoute("/_app/community")({
  head: () => ({
    meta: [
      { title: "Community — Cortex" },
      { name: "description", content: "Ask, answer, share notes. Accepted answers earn credits." },
    ],
  }),
  component: CommunityPage,
});

const SUBJECTS = ["Algorithms", "Machine Learning", "Databases", "OS", "Frontend", "Math"];
/** Suggested topics shown until real hashtags exist (these are UI suggestions, not data). */
const DEFAULT_TOPICS = ["dynamic-programming", "transformers", "os-deadlocks", "react-19", "sql-indexing", "ielts-writing", "linear-algebra"];

export function CommunityPage() {
  const { user, profile } = useAuth();
  const me = user?.uid ?? "";
  const meDoc = { ...(profile as unknown as UserDoc), uid: me };

  // New Post Form State
  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [selectedType, setSelectedType] = useState<PostType>("Question");
  const [selectedSubject, setSelectedSubject] = useState("Algorithms");
  const [postImages, setPostImages] = useState<File[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imagePreviews = useMemo(() => postImages.map((f) => URL.createObjectURL(f)), [postImages]);
  useEffect(() => () => imagePreviews.forEach((u) => URL.revokeObjectURL(u)), [imagePreviews]);

  // Filters State
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [activeSubjectFilter, setActiveSubjectFilter] = useState<string | null>(null);

  // Feed state: live first page + manually paginated older pages
  const [firstPage, setFirstPage] = useState<Post[]>([]);
  const [olderPages, setOlderPages] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [feedLoading, setFeedLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  const olderCount = useRef(0);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const checkedLikes = useRef<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [busyPostIds, setBusyPostIds] = useState<Set<string>>(new Set());

  // Sidebar data
  const [subjectCounts, setSubjectCounts] = useState<Record<string, number>>({});
  const [trending, setTrending] = useState<string[]>(DEFAULT_TOPICS);
  const [learnerCount, setLearnerCount] = useState<number | null>(null);

  // Expanded Comments State
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newCommentText, setNewCommentText] = useState("");

  // ── subscriptions ──────────────────────────────────────────────────────────
  useEffect(() => {
    setFeedLoading(true);
    setFeedError(null);
    setOlderPages([]);
    olderCount.current = 0;
    const unsub = subscribeFeed(
      { subject: activeSubjectFilter, tag: activeTagFilter },
      (posts, last, more) => {
        setFirstPage(posts);
        // Once older pages are loaded the pagination cursor belongs to them, not to the live first page.
        if (olderCount.current === 0) {
          setCursor(last);
          setHasMore(more);
        }
        setFeedLoading(false);
      },
      (err) => {
        setFeedLoading(false);
        setFeedError(errorMessage(err, "Couldn't load the community feed."));
      },
    );
    return unsub;
  }, [activeSubjectFilter, activeTagFilter]);

  useEffect(() => {
    if (!me) return;
    return subscribeBookmarks(me, setSavedIds);
  }, [me]);

  useEffect(() => {
    countPostsBySubject(SUBJECTS).then(setSubjectCounts).catch(() => undefined);
    getTrendingTags()
      .then((t) => t.length && setTrending(t))
      .catch(() => undefined);
    getCountFromServer(collection(db, "users"))
      .then((s) => setLearnerCount(s.data().count))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!expandedPostId) {
      setComments([]);
      return;
    }
    return subscribeComments(expandedPostId, setComments, (e) => toast.error(errorMessage(e)));
  }, [expandedPostId]);

  const postList = useMemo(() => {
    const map = new Map<string, Post>();
    [...firstPage, ...olderPages].forEach((p) => map.set(p.id, p));
    return Array.from(map.values());
  }, [firstPage, olderPages]);

  // Which visible posts did I like? (one lookup per newly-seen post)
  useEffect(() => {
    if (!me) return;
    const unseen = postList.map((p) => p.id).filter((id) => !checkedLikes.current.has(id));
    if (unseen.length === 0) return;
    unseen.forEach((id) => checkedLikes.current.add(id));
    getLikedPostIds(me, unseen)
      .then((liked) => setLikedIds((prev) => new Set([...prev, ...liked])))
      .catch(() => undefined);
  }, [postList, me]);

  // ── actions ────────────────────────────────────────────────────────────────
  const withBusy = async (id: string, fn: () => Promise<void>) => {
    if (busyPostIds.has(id)) return;
    setBusyPostIds((s) => new Set(s).add(id));
    try {
      await fn();
    } finally {
      setBusyPostIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  const handlePickImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = Array.from((e.target.files ?? []) as FileList);
    e.target.value = "";
    const ok = files.filter((f) => {
      if (!f.type.startsWith("image/")) return toast.error(`"${f.name}" isn't an image.`), false;
      if (f.size > 8 * 1024 * 1024) return toast.error(`"${f.name}" is larger than 8 MB.`), false;
      return true;
    });
    setPostImages((prev) => [...prev, ...ok].slice(0, 4));
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!postTitle.trim()) {
      toast.error("Please enter a title for your post.");
      return;
    }
    setPublishing(true);
    try {
      await createPost({
        author: meDoc,
        title: postTitle,
        body: postBody,
        subject: selectedSubject,
        tag: selectedType,
        images: postImages,
        onProgress: setUploadPct,
      });
      setPostTitle("");
      setPostBody("");
      setPostImages([]);
      toast.success(`Published ${selectedType.toLowerCase()} to the Cortex community!`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't publish your post."));
    } finally {
      setPublishing(false);
      setUploadPct(null);
    }
  };

  /** Optimistic like: flip the UI instantly, roll back if the transaction fails. */
  const handleToggleLike = (post: Post) =>
    withBusy(post.id, async () => {
      const wasLiked = likedIds.has(post.id);
      const flip = (liked: boolean) =>
        setLikedIds((prev) => {
          const n = new Set(prev);
          liked ? n.add(post.id) : n.delete(post.id);
          return n;
        });
      flip(!wasLiked);
      try {
        await toggleLike(post, meDoc);
      } catch (err) {
        flip(wasLiked);
        toast.error(errorMessage(err, "Couldn't update your like."));
      }
    });

  const handleToggleSave = async (post: Post) => {
    const wasSaved = savedIds.has(post.id);
    try {
      await toggleBookmark(me, post.id, wasSaved);
      toast.info(!wasSaved ? "Post saved to your bookmarks." : "Post removed from bookmarks.");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update bookmarks."));
    }
  };

  const handleAddComment = async (post: Post, e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim()) return;
    try {
      await addComment(post, meDoc, newCommentText);
      setNewCommentText("");
      toast.success("Comment added!");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't add your comment."));
    }
  };

  const handleDeletePost = async (post: Post) => {
    if (!window.confirm("Delete this post? This also removes its comments and images.")) return;
    try {
      await deletePost(post);
      setOlderPages((prev) => prev.filter((p) => p.id !== post.id));
      toast.success("Post deleted.");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't delete the post."));
    }
  };

  const handleReport = async (post: Post, reason: string) => {
    try {
      const created = await reportPost(post, me, reason);
      created ? toast.success("Thanks — our moderators will review this post.") : toast.info("You've already reported this post.");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't submit your report."));
    }
  };

  const handleLoadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      // older pages continue from the last doc we know about (first page or the previous older page)
      const res = await fetchMorePosts({ subject: activeSubjectFilter, tag: activeTagFilter }, cursor);
      olderCount.current += res.posts.length || 1;
      setOlderPages((prev) => [...prev, ...res.posts]);
      setCursor(res.cursor);
      setHasMore(res.hasMore);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load more posts."));
    } finally {
      setLoadingMore(false);
    }
  };

  const filteredPosts = postList;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl md:text-4xl tracking-tight font-medium">
            Community Hub
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Questions, study notes, and peer discussions from {learnerCount ? learnerCount.toLocaleString() : "our"} learners.
          </p>
        </div>

        {(activeTagFilter || activeSubjectFilter) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setActiveTagFilter(null);
              setActiveSubjectFilter(null);
            }}
            className="rounded-xl text-xs"
          >
            Clear Filters
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {/* Post Creation Box */}
          <Card className="rounded-2xl border-border p-5 shadow-soft bg-card">
            <form onSubmit={handleCreatePost} className="space-y-3">
              <Input aria-label="Share a note, ask a question, or post a resource…"
                value={postTitle}
                onChange={(e) => setPostTitle(e.target.value)}
                placeholder="Share a note, ask a question, or post a resource…"
                required
                className="h-11 rounded-xl bg-muted/50 font-medium"
              />

              {postTitle.length > 0 && (
                <Textarea
                  value={postBody}
                  onChange={(e) => setPostBody(e.target.value)}
                  placeholder="Add additional details, code snippets, or background context..."
                  rows={3}
                  className="rounded-xl bg-muted/30"
                />
              )}

              {imagePreviews.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {imagePreviews.map((src, i) => (
                    <div key={src} className="relative h-20 w-20 overflow-hidden rounded-xl border border-border">
                      <img src={src} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setPostImages((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"
                        aria-label="Remove image"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(["Question", "Notes", "Resource", "Poll"] as const).map((t) => (
                    <Button
                      key={t}
                      type="button"
                      size="sm"
                      variant={selectedType === t ? "default" : "ghost"}
                      onClick={() => setSelectedType(t)}
                      className={`rounded-full text-xs ${
                        selectedType === t
                          ? "bg-gradient-primary text-primary-foreground shadow-soft"
                          : ""
                      }`}
                    >
                      {t}
                    </Button>
                  ))}
                  <select
                    value={selectedSubject}
                    onChange={(e) => setSelectedSubject(e.target.value)}
                    aria-label="Subject"
                    className="h-8 rounded-full border border-border bg-background px-2 text-xs"
                  >
                    {SUBJECTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handlePickImages}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => imageInputRef.current?.click()}
                    className="rounded-full text-xs"
                  >
                    <ImageIcon className="mr-1 h-3.5 w-3.5" /> Image
                  </Button>
                </div>

                <Button
                  type="submit"
                  size="sm"
                  disabled={publishing}
                  className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90"
                >
                  {publishing ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {publishing ? (uploadPct !== null ? `Uploading ${uploadPct}%` : "Posting…") : "Post to Community"}
                </Button>
              </div>
            </form>
          </Card>

          {/* Posts List */}
          {feedLoading ? (
            <div className="py-12 text-center text-muted-foreground">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading posts…
            </div>
          ) : feedError ? (
            <div className="py-12 text-center text-destructive">{feedError}</div>
          ) : filteredPosts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              {activeTagFilter || activeSubjectFilter
                ? "No community posts found matching your filter criteria."
                : "No posts yet — be the first to ask a question or share some notes!"}
            </div>
          ) : (
            filteredPosts.map((p) => (
              <Card key={p.id} className="rounded-2xl border-border p-5 shadow-soft">
                <div className="flex items-start gap-3">
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarImage src={p.author.avatarUrl ?? undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary font-bold">
                      {p.author.displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold">{p.author.displayName}</span>
                      {p.author.verified && <VerifiedBadge />}
                      {p.author.username && (
                        <span className="font-mono text-xs text-primary bg-primary/10 px-1.5 py-0.2 rounded font-medium">
                          @{p.author.username}
                        </span>
                      )}
                      <span className="text-muted-foreground">· {postTime(p)}</span>
                      <Badge variant="secondary" className="rounded-full text-xs">
                        {p.subject}
                      </Badge>
                      <Badge variant="outline" className="rounded-full text-xs">
                        {p.tag}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="ml-auto h-7 w-7 rounded-full" aria-label="Post options">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52 rounded-xl">
                          {p.authorId === me ? (
                            <DropdownMenuItem onClick={() => handleDeletePost(p)} className="gap-2 text-xs text-destructive">
                              <Trash2 className="h-3.5 w-3.5" /> Delete my post
                            </DropdownMenuItem>
                          ) : (
                            <>
                              <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                                <Flag className="h-3 w-3" /> Report this post
                              </DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {REPORT_REASONS.map((r) => (
                                <DropdownMenuItem key={r} onClick={() => handleReport(p, r)} className="text-xs">
                                  {r}
                                </DropdownMenuItem>
                              ))}
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <h3 className="mt-2 text-base md:text-lg font-semibold tracking-tight">
                      {p.title}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                      {p.body}
                    </p>
                    {p.imageUrls && p.imageUrls.length > 0 && (
                      <div className={`mt-3 grid gap-2 ${p.imageUrls.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                        {p.imageUrls.filter(isSafeStorageUrl).map((src) => (
                          <a key={src} href={src} target="_blank" rel="noopener noreferrer">
                            <img
                              src={src}
                              alt=""
                              loading="lazy"
                              className="max-h-72 w-full rounded-xl border border-border object-cover"
                            />
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="mt-4 flex flex-wrap items-center gap-1 text-sm text-muted-foreground pt-2 border-t border-border">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleLike(p)}
                        className={`rounded-full ${likedIds.has(p.id) ? "text-rose-500 font-semibold" : ""}`}
                      >
                        <Heart
                          className={`mr-1.5 h-4 w-4 ${likedIds.has(p.id) ? "fill-rose-500 text-rose-500" : ""}`}
                        />
                        {Math.max(0, p.likesCount)}
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedPostId(expandedPostId === p.id ? null : p.id)}
                        className="rounded-full"
                      >
                        <MessageCircle className="mr-1.5 h-4 w-4" />
                        {Math.max(0, p.commentsCount)}
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleSave(p)}
                        className={`rounded-full ${savedIds.has(p.id) ? "text-primary font-semibold" : ""}`}
                      >
                        <Bookmark
                          className={`mr-1.5 h-4 w-4 ${savedIds.has(p.id) ? "fill-primary text-primary" : ""}`}
                        />
                        {savedIds.has(p.id) ? "Saved" : "Save"}
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard?.writeText(window.location.href);
                          toast.success("Post link copied!");
                        }}
                        className="rounded-full"
                      >
                        <Share2 className="mr-1.5 h-4 w-4" />
                        Share
                      </Button>
                    </div>

                    {/* Expanded Comments Section */}
                    {expandedPostId === p.id && (
                      <div className="mt-4 space-y-3 pt-3 border-t border-border bg-secondary/20 p-4 rounded-xl">
                        <div className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                          Comments ({comments.length})
                        </div>

                        {comments.length === 0 && (
                          <p className="text-xs text-muted-foreground">No comments yet — start the discussion.</p>
                        )}
                        {comments.map((c) => (
                          <div
                            key={c.id}
                            className="p-3 rounded-lg bg-background border border-border text-xs"
                          >
                            <div className="flex items-center justify-between font-semibold mb-1">
                              <span>{c.author.displayName}</span>
                              <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                                {timeAgo(c.createdAt as never)}
                                {c.authorId === me && (
                                  <button
                                    type="button"
                                    aria-label="Delete comment"
                                    onClick={() =>
                                      deleteComment(p.id, c.id).catch((err) => toast.error(errorMessage(err)))
                                    }
                                    className="hover:text-destructive"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                )}
                              </span>
                            </div>
                            <p className="text-muted-foreground leading-relaxed">{c.body}</p>
                          </div>
                        ))}

                        <form
                          onSubmit={(e) => handleAddComment(p, e)}
                          className="flex items-center gap-2 pt-1"
                        >
                          <Input aria-label="Write a comment or answer..."
                            value={newCommentText}
                            onChange={(e) => setNewCommentText(e.target.value)}
                            placeholder="Write a comment or answer..."
                            className="h-9 rounded-xl text-xs bg-background"
                          />
                          <Button
                            type="submit"
                            size="sm"
                            className="h-9 rounded-xl bg-gradient-primary text-primary-foreground"
                          >
                            Reply
                          </Button>
                        </form>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}

          {!feedLoading && hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={handleLoadMore} disabled={loadingMore} className="rounded-xl">
                {loadingMore ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                {loadingMore ? "Loading…" : "Load more posts"}
              </Button>
            </div>
          )}
        </div>

        {/* Sidebar Widgets */}
        <div className="space-y-4">
          <Card className="rounded-2xl border-border p-5 shadow-soft">
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">Trending topics</h3>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {trending.map((t) => (
                <Badge
                  key={t}
                  variant={activeTagFilter === t ? "default" : "secondary"}
                  onClick={() => setActiveTagFilter(activeTagFilter === t ? null : t)}
                  className={`rounded-full cursor-pointer transition ${
                    activeTagFilter === t
                      ? "bg-gradient-primary text-primary-foreground"
                      : "hover:bg-primary/20"
                  }`}
                >
                  #{t}
                </Badge>
              ))}
            </div>
          </Card>

          <Card className="rounded-2xl border-border p-5 shadow-soft">
            <h3 className="mb-3 font-semibold text-sm">Filter by subject</h3>
            <div className="space-y-1.5 text-xs">
              {SUBJECTS.map(
                (s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setActiveSubjectFilter(activeSubjectFilter === s ? null : s)}
                    className={`w-full flex items-center justify-between rounded-xl px-3 py-2 transition ${
                      activeSubjectFilter === s
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "hover:bg-muted/60 text-foreground"
                    }`}
                  >
                    <span>{s}</span>
                    <span
                      className={`text-xs ${activeSubjectFilter === s ? "text-primary-foreground" : "text-muted-foreground"}`}
                    >
                      {subjectCounts[s] ?? 0}
                    </span>
                  </button>
                ),
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
