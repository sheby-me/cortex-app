import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LifeBuoy, Plus, Clock, Coins, MessageCircle, Bookmark, Send, Check, Loader2, XCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  SOS_STATUS_LABEL,
  acceptHelper,
  cancelRequest,
  closeRequest,
  createSosRequest,
  offerHelp,
  sosPosted,
  subscribeMyOfferIds,
  subscribeOffers,
  subscribeSosBoard,
  subscribeSosBookmarks,
  toggleSosBookmark,
  type Offer,
  type Sos,
} from "@/services/sos";
import { settlePendingCredits } from "@/services/credits";
import { evaluateAchievements } from "@/services/gamification";
import { errorMessage } from "@/services/common";
import type { UserDoc } from "@/services/users";

export const Route = createFileRoute("/_app/sos")({
  head: () => ({
    meta: [
      { title: "SOS Help — Cortex" },
      {
        name: "description",
        content: "Urgent academic help from verified peers, matched in minutes.",
      },
    ],
  }),
  component: SosPage,
});

const urgencyColor = (u: string) =>
  u === "Critical"
    ? "bg-destructive/10 text-destructive border-destructive/20"
    : u === "High"
      ? "bg-warning/10 text-warning border-warning/30"
      : u === "Medium"
        ? "bg-primary/10 text-primary border-primary/20"
        : "bg-muted text-muted-foreground border-border";

export function SosPage() {
  const { user, profile } = useAuth();
  const me = user?.uid ?? "";
  const meDoc = { ...(profile as unknown as UserDoc), uid: me };

  // ── live data ──────────────────────────────────────────────────────────────
  const [board, setBoard] = useState<Sos[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [offeredIds, setOfferedIds] = useState<Set<string>>(new Set());
  const [bookmarkIds, setBookmarkIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!me) return;
    const unsubs = [
      subscribeSosBoard(
        me,
        (items) => {
          setBoard(items);
          setLoading(false);
          setLoadError(null);
        },
        (err) => {
          setLoading(false);
          setLoadError(errorMessage(err, "Couldn't load SOS requests."));
        },
      ),
      subscribeMyOfferIds(me, setOfferedIds),
      subscribeSosBookmarks(me, setBookmarkIds),
    ];
    return () => unsubs.forEach((u) => u());
  }, [me]);

  // Settle rewards / refunds the moment the board tells us something is waiting for me
  const claimable = useMemo(
    () =>
      board.filter(
        (s) =>
          (s.helperId === me && s.status === "resolved" && !s.rewardClaimed) ||
          (s.requesterId === me && s.status === "cancelled" && !s.refundClaimed),
      ).length,
    [board, me],
  );
  useEffect(() => {
    if (!me || claimable === 0) return;
    settlePendingCredits(me)
      .then((msgs) => msgs.forEach((m) => toast.success(m)))
      .catch(() => undefined);
  }, [me, claimable]);

  // Only requests that still need attention are shown as "active"; closed ones I was part of stay visible with their status.
  const requests = board;

  // New Request Modal State
  const [isNewSosModalOpen, setIsNewSosModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSubject, setNewSubject] = useState("Computer Science");
  const [newUrgency, setNewUrgency] = useState<"Critical" | "High" | "Medium">("High");
  const [newDuration, setNewDuration] = useState("15 min");
  const [newCredits, setNewCredits] = useState(100);
  const [submitting, setSubmitting] = useState(false);

  // Offer Help Modal State
  const [selectedSosForOffer, setSelectedSosForOffer] = useState<Sos | null>(null);
  const [offerNote, setOfferNote] = useState("");

  // Offers (requester's view) Modal State
  const [offersFor, setOffersFor] = useState<Sos | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!offersFor) {
      setOffers([]);
      return;
    }
    return subscribeOffers(offersFor.id, setOffers, (e) => toast.error(errorMessage(e)));
  }, [offersFor]);

  const handleCreateSos = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      toast.error("Please enter a question or problem title.");
      return;
    }
    setSubmitting(true);
    try {
      await createSosRequest({
        requester: meDoc,
        title: newTitle,
        subject: newSubject,
        urgency: newUrgency,
        duration: newDuration,
        credits: newCredits,
      });
      setIsNewSosModalOpen(false);
      toast.success("Urgent SOS request posted! Helpers are notified.");
      setNewTitle("");
      setNewCredits(100);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't post your request."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleOfferHelp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSosForOffer) return;
    setSubmitting(true);
    try {
      await offerHelp(selectedSosForOffer, meDoc, offerNote);
      toast.success(`Help offer sent for "${selectedSosForOffer.title}"!`);
      // "Fast Responder" achievement: first answer within 5 minutes of posting
      const postedAt = (selectedSosForOffer.createdAt as { toMillis?: () => number })?.toMillis?.();
      if (postedAt && Date.now() - postedAt < 5 * 60_000) {
        void evaluateAchievements(meDoc, { respondedFastToSos: true })
          .then((a) => a.forEach((x) => toast.success(`Achievement unlocked: ${x.name}`)))
          .catch(() => undefined);
      }
      setSelectedSosForOffer(null);
      setOfferNote("");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't send your offer."));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleBookmark = async (id: string) => {
    const was = bookmarkIds.has(id);
    try {
      await toggleSosBookmark(me, id, was);
      toast.info(!was ? "Saved to bookmarked requests." : "Removed from bookmarks.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const runAction = async (key: string, fn: () => Promise<void>, okMsg: string) => {
    setActionBusy(key);
    try {
      await fn();
      toast.success(okMsg);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setActionBusy(null);
    }
  };

  // Real board statistics (replaces the placeholder numbers)
  const stats = useMemo(() => {
    const active = requests.filter((r) => r.status === "open" || r.status === "in_progress");
    return [
      { label: "Active Requests", value: active.length.toString() },
      { label: "Open Offers", value: active.reduce((n, r) => n + (r.offersCount || 0), 0).toString() },
      { label: "In Progress", value: requests.filter((r) => r.status === "in_progress").length.toString() },
      { label: "Credits in Play", value: `${active.reduce((n, r) => n + r.credits, 0)} cr` },
    ];
  }, [requests]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl md:text-4xl tracking-tight flex items-center gap-3 font-medium">
            <LifeBuoy className="h-8 w-8 text-primary" />
            SOS Urgent Help
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Post urgent academic requests. Get matched with expert helpers in minutes.
          </p>
        </div>
        <Button
          onClick={() => setIsNewSosModalOpen(true)}
          className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Create SOS Request
        </Button>
      </div>

      <div className="mb-6 grid gap-3 grid-cols-2 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="rounded-2xl border-border p-4 shadow-soft">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="mt-1 text-xl md:text-2xl font-bold">{s.value}</div>
          </Card>
        ))}
      </div>

      {/* SOS List */}
      <div className="space-y-3">
        {loading && (
          <div className="py-12 text-center text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading requests…
          </div>
        )}
        {loadError && <div className="py-12 text-center text-destructive">{loadError}</div>}
        {!loading && !loadError && requests.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            No SOS requests yet — be the first to ask, or check back soon to help someone else. New requests appear here instantly.
          </div>
        )}
        {requests.map((s) => (
          <Card
            key={s.id}
            className="rounded-2xl border-border p-5 shadow-soft transition hover:shadow-elegant"
          >
            <div className="flex flex-wrap items-start gap-4">
              <Avatar className="h-11 w-11">
                <AvatarImage src={s.requester.avatarUrl ?? undefined} />
                <AvatarFallback className="bg-primary/10 text-primary font-bold">
                  {s.requester.displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={`rounded-full ${urgencyColor(s.urgency)}`}>
                    {s.urgency}
                  </Badge>
                  <Badge variant="secondary" className="rounded-full">
                    {s.subject}
                  </Badge>
                  <Badge variant="outline" className="rounded-full">
                    {SOS_STATUS_LABEL[s.status]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">· {sosPosted(s)}</span>
                </div>

                <h3 className="mt-2 text-base md:text-lg font-semibold tracking-tight">
                  {s.title}
                </h3>
                <div className="mt-1 text-xs text-muted-foreground">by {s.requesterId === me ? "You" : s.requester.displayName}{s.helper && ` · helper: ${s.requesterId === me ? s.helper.displayName : s.helperId === me ? "You" : s.helper.displayName}`}</div>

                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {s.duration}
                  </span>
                  <span className="flex items-center gap-1 font-semibold text-primary">
                    <Coins className="h-3.5 w-3.5 text-amber-500" />
                    {s.credits} cr offered
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageCircle className="h-3.5 w-3.5" />
                    {s.offersCount} offers
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button aria-label="Bookmark this request"
                  variant={bookmarkIds.has(s.id) ? "secondary" : "ghost"}
                  size="icon"
                  onClick={() => toggleBookmark(s.id)}
                  className="rounded-xl"
                >
                  <Bookmark
                    className={`h-4 w-4 ${bookmarkIds.has(s.id) ? "fill-primary text-primary" : ""}`}
                  />
                </Button>

                {s.requesterId === me ? (
                  <>
                    {(s.status === "open" || s.status === "in_progress") && (
                      <>
                        {s.status === "open" && (
                          <Button variant="outline" onClick={() => setOffersFor(s)} className="rounded-xl">
                            View offers ({s.offersCount})
                          </Button>
                        )}
                        {s.status === "in_progress" && (
                          <Button
                            disabled={actionBusy === `close_${s.id}`}
                            onClick={() => runAction(`close_${s.id}`, () => closeRequest(s), "Marked resolved — your helper will receive the credits.")}
                            className="rounded-xl bg-gradient-primary text-primary-foreground"
                          >
                            <CheckCircle2 className="mr-1.5 h-4 w-4" /> Mark resolved
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          disabled={actionBusy === `cancel_${s.id}`}
                          onClick={() => {
                            if (window.confirm("Cancel this request? Your escrowed credits will be refunded."))
                              runAction(`cancel_${s.id}`, () => cancelRequest(s), "Request cancelled — credits refunded.");
                          }}
                          className="rounded-xl text-destructive"
                        >
                          <XCircle className="mr-1.5 h-4 w-4" /> Cancel
                        </Button>
                      </>
                    )}
                  </>
                ) : s.helperId === me ? (
                  <Button asChild variant="outline" className="rounded-xl">
                    <Link to="/messages" search={{ user: s.requesterId } as never}>
                      <MessageCircle className="mr-1.5 h-4 w-4" /> Message requester
                    </Link>
                  </Button>
                ) : (
                  s.status === "open" && (
                    <Button
                      onClick={() => setSelectedSosForOffer(s)}
                      disabled={offeredIds.has(s.id)}
                      className={`rounded-xl transition ${
                        offeredIds.has(s.id)
                          ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30"
                          : "bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90"
                      }`}
                    >
                      {offeredIds.has(s.id) ? (
                        <>
                          <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> Help Offered
                        </>
                      ) : (
                        "Offer Help"
                      )}
                    </Button>
                  )
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* New SOS Modal */}
      <Dialog open={isNewSosModalOpen} onOpenChange={setIsNewSosModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Post Urgent SOS Request</DialogTitle>
            <DialogDescription>
              Describe your immediate problem. Available tutors or peers will offer help within
              minutes.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSos} className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Question / Problem Summary *
              </label>
              <Input aria-label="e.g. Need help debugging recursion stack overflow before 11 PM"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Need help debugging recursion stack overflow before 11 PM"
                required
                className="rounded-xl"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Subject
                </label>
                <Select value={newSubject} onValueChange={setNewSubject}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Computer Science">Computer Science</SelectItem>
                    <SelectItem value="Mathematics">Mathematics</SelectItem>
                    <SelectItem value="Chemistry">Chemistry</SelectItem>
                    <SelectItem value="Physics">Physics</SelectItem>
                    <SelectItem value="Biology">Biology</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Urgency Level
                </label>
                <Select
                  value={newUrgency}
                  onValueChange={(val) => setNewUrgency(val as "Critical" | "High" | "Medium")}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Critical">Critical (&lt; 1 hr)</SelectItem>
                    <SelectItem value="High">High (&lt; 3 hrs)</SelectItem>
                    <SelectItem value="Medium">Medium (Today)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Estimated Duration
                </label>
                <Input aria-label="e.g. 15 min"
                  value={newDuration}
                  onChange={(e) => setNewDuration(e.target.value)}
                  placeholder="e.g. 15 min"
                  className="rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Credits Offered
                </label>
                <Input aria-label="100"
                  type="number"
                  value={newCredits}
                  onChange={(e) => setNewCredits(Number(e.target.value))}
                  placeholder="100"
                  className="rounded-xl"
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsNewSosModalOpen(false)}
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant"
              >
                Post Request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Offer Help Modal */}
      <Dialog
        open={!!selectedSosForOffer}
        onOpenChange={(open) => !open && setSelectedSosForOffer(null)}
      >
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Offer Help for SOS Request</DialogTitle>
            <DialogDescription>
              "{selectedSosForOffer?.title}" — Reward: {selectedSosForOffer?.credits} credits
            </DialogDescription>
          </DialogHeader>

          {selectedSosForOffer && (
            <form onSubmit={handleOfferHelp} className="space-y-4 py-2">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  How can you assist? *
                </label>
                <Textarea
                  value={offerNote}
                  onChange={(e) => setOfferNote(e.target.value)}
                  placeholder="e.g. I am online now and specialize in this exact topic. Let's do a quick 10-minute code walkthrough!"
                  rows={4}
                  required
                  className="rounded-xl"
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedSosForOffer(null)}
                  className="rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant"
                >
                  <Send className="mr-1.5 h-4 w-4" /> Send Offer
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      {/* Offers (requester) Modal */}
      <Dialog open={!!offersFor} onOpenChange={(o) => !o && setOffersFor(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Offers to help</DialogTitle>
            <DialogDescription>
              Choose who should help with “{offersFor?.title}”. Your {offersFor?.credits} credits are held in
              escrow and released to the helper when you mark the request resolved.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto py-1">
            {offers.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No offers yet — helpers are being notified.
              </p>
            )}
            {offers.map((o) => (
              <div key={o.id} className="flex items-start gap-3 rounded-xl border border-border p-3">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={o.helper.avatarUrl ?? undefined} />
                  <AvatarFallback>{o.helper.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">
                    {o.helper.displayName}
                    {o.helper.username && (
                      <span className="ml-1.5 font-mono text-xs text-muted-foreground">@{o.helper.username}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{o.note}</p>
                </div>
                <Button
                  size="sm"
                  disabled={actionBusy === `accept_${o.id}`}
                  onClick={() =>
                    offersFor &&
                    runAction(
                      `accept_${o.id}`,
                      async () => {
                        await acceptHelper(offersFor, o);
                        setOffersFor(null);
                      },
                      `${o.helper.displayName} is now helping you.`,
                    )
                  }
                  className="rounded-xl"
                >
                  Accept
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
