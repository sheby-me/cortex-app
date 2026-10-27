import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
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
import {
  Search,
  Star,
  Sparkles,
  Clock,
  Coins,
  Globe,
  FileText,
  Video,
  MessageSquare,
  FileCheck,
  Calendar as CalendarIcon,
  CheckCircle2,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  MODE_META,
  averageRating,
  cancelSession,
  completeAndRate,
  formatAvailability,
  requestSession,
  subscribeMySessions,
  subscribeTutorProfiles,
  type Session,
  type SessionMode,
  type TutorProfile,
} from "@/services/tutors";
import { errorMessage } from "@/services/common";
import type { UserDoc } from "@/services/users";

export const Route = createFileRoute("/_app/tutors")({
  head: () => ({
    meta: [
      { title: "Find Tutors — Cortex" },
      {
        name: "description",
        content: "AI-matched tutors by subject, timezone, language and rating.",
      },
    ],
  }),
  component: TutorsPage,
});

interface BookingTutorInfo {
  id: string;
  name: string;
  avatar?: string;
  subject: string;
  profile: TutorProfile;
  availability: string;
  rates: {
    materials: number;
    asyncQa: number;
    zoomMeeting: number;
  };
}

export function TutorsPage() {
  const { user, profile } = useAuth();
  const me = user?.uid ?? "";
  const meDoc = { ...(profile as unknown as UserDoc), uid: me };

  const [tutors, setTutors] = useState<TutorProfile[]>([]);
  const [tutorsLoading, setTutorsLoading] = useState(true);
  const [tutorsError, setTutorsError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("all");

  // My bookings (as a student)
  const [mySessions, setMySessions] = useState<Session[]>([]);
  const [ratingFor, setRatingFor] = useState<Session | null>(null);
  const [ratingValue, setRatingValue] = useState(5);
  const [ratingText, setRatingText] = useState("");
  const [sessionBusy, setSessionBusy] = useState<string | null>(null);

  // Booking Modal State
  const [selectedTutorForBooking, setSelectedTutorForBooking] = useState<BookingTutorInfo | null>(
    null,
  );
  const [selectedMode, setSelectedMode] = useState<SessionMode>("zoomMeeting");
  const [bookingDate, setBookingDate] = useState("Tomorrow at 3:00 PM");
  const [sessionTopic, setSessionTopic] = useState("");
  const [isSubmittingBooking, setIsSubmittingBooking] = useState(false);

  useEffect(() => {
    const unsub = subscribeTutorProfiles(
      (list) => {
        setTutors(list);
        setTutorsLoading(false);
        setTutorsError(null);
      },
      (err) => {
        setTutorsLoading(false);
        setTutorsError(errorMessage(err, "Couldn't load tutors."));
      },
    );
    return unsub;
  }, []);

  useEffect(() => {
    if (!me) return;
    return subscribeMySessions(me, ({ asStudent }) => setMySessions(asStudent));
  }, [me]);

  const handleOpenBooking = (tutor: BookingTutorInfo) => {
    setSelectedTutorForBooking(tutor);
    setSelectedMode("zoomMeeting");
    setSessionTopic("");
  };

  const handleConfirmBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTutorForBooking) return;

    if (!sessionTopic.trim()) {
      toast.error("Please enter a topic or question for the tutor session.");
      return;
    }

    setIsSubmittingBooking(true);
    try {
      await requestSession({
        student: meDoc,
        tutor: selectedTutorForBooking.profile,
        mode: selectedMode,
        topic: sessionTopic,
        slotLabel: bookingDate,
      });
      toast.success(
        `Session requested from ${selectedTutorForBooking.name}! (${selectedTutorForBooking.rates[selectedMode]} credits held until it's completed)`,
      );
      setSelectedTutorForBooking(null);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't book the session."));
    } finally {
      setIsSubmittingBooking(false);
    }
  };

  const runSessionAction = async (key: string, fn: () => Promise<void>, ok: string) => {
    setSessionBusy(key);
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSessionBusy(null);
    }
  };

  const handleSubmitRating = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ratingFor) return;
    await runSessionAction(
      `rate_${ratingFor.id}`,
      async () => {
        await completeAndRate(ratingFor, meDoc, ratingValue, ratingText);
        setRatingFor(null);
        setRatingText("");
        setRatingValue(5);
      },
      "Thanks! Your rating was saved and the tutor has been paid.",
    );
  };

  // Filter tutors by name / handle / credentials / bio / subjects
  const filteredTutors = tutors.filter((t) => {
    if (t.id === me) return false;
    const q = searchQuery.toLowerCase().trim().replace(/^@/, "");
    const haystack = [t.displayName, t.username, t.credentials, t.bio, t.institution, ...(t.subjects ?? [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matchesSearch = !q || haystack.includes(q);
    const matchesSubject = subjectFilter === "all" || haystack.includes(subjectFilter.toLowerCase());
    return matchesSearch && matchesSubject;
  });

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="font-display text-3xl md:text-4xl font-medium tracking-tight">
          Find Tutors
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Verified tutors across every subject — book live sessions, async Q&A, or material reviews.
        </p>
      </div>

      {/* Filters */}
      <Card className="mb-6 rounded-2xl border-border p-4 shadow-soft">
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search by subject, topic, or tutor name…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by subject, topic, or tutor name…"
              className="h-10 rounded-xl pl-9"
            />
          </div>

          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="h-10 rounded-xl">
              <SelectValue placeholder="All Subjects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Subjects</SelectItem>
              <SelectItem value="computer science">Computer Science</SelectItem>
              <SelectItem value="algorithms">Algorithms</SelectItem>
              <SelectItem value="chemistry">Chemistry</SelectItem>
              <SelectItem value="math">Mathematics</SelectItem>
              <SelectItem value="biology">Biology</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            onClick={() => {
              setSearchQuery("");
              setSubjectFilter("all");
            }}
            className="h-10 rounded-xl"
          >
            Reset Filters
          </Button>
        </div>
      </Card>

      {/* AI Smart matches banner */}
      <div className="mb-4 flex items-center gap-2 text-sm">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="font-semibold">Verified Tutors</span>
        <span className="text-muted-foreground">— available for instant credit booking</span>
      </div>

      {mySessions.length > 0 && (
        <Card className="mb-6 rounded-2xl border-border p-5 shadow-soft">
          <div className="mb-3 text-sm font-semibold">My tutor sessions</div>
          <div className="space-y-2">
            {mySessions.slice(0, 8).map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3 text-xs">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">
                    {m.tutor.displayName} · {MODE_META[m.mode].label}
                  </div>
                  <div className="text-muted-foreground truncate">
                    “{m.topic}” · {m.slotLabel} · {m.credits} cr
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="rounded-full capitalize">
                    {m.status === "delivered" ? "awaiting your confirmation" : m.status}
                  </Badge>
                  {(m.status === "pending" || m.status === "accepted") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={sessionBusy === `cancel_${m.id}`}
                      onClick={() =>
                        runSessionAction(`cancel_${m.id}`, () => cancelSession(m, meDoc), "Session cancelled — credits refunded.")
                      }
                      className="rounded-xl text-destructive"
                    >
                      Cancel
                    </Button>
                  )}
                  {m.status === "delivered" && (
                    <Button size="sm" onClick={() => setRatingFor(m)} className="rounded-xl bg-gradient-primary text-primary-foreground">
                      Confirm &amp; rate
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tutorsLoading && (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading tutors…
          </div>
        )}
        {tutorsError && <div className="col-span-full py-12 text-center text-destructive">{tutorsError}</div>}
        {!tutorsLoading && !tutorsError && filteredTutors.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            {tutors.length === 0
              ? "We're just getting started and there are no verified tutors yet — be the first! Know someone great at a subject? Invite them to apply as a founding tutor."
              : "No tutors match your search. Try different keywords or reset the filters."}
          </div>
        )}
        {filteredTutors.map((t) => {
          const name = t.displayName || "Verified Tutor";
          const matRate = t.rates.materials;
          const asyncRate = t.rates.asyncQa;
          const zoomRate = t.rates.zoomMeeting;
          const avg = averageRating(t);

          const tutorBookingInfo: BookingTutorInfo = {
            id: t.id,
            name,
            avatar: t.avatarUrl || undefined,
            subject: t.credentials || "Verified Expert",
            profile: t,
            availability: formatAvailability(t.availability),
            rates: { materials: matRate, asyncQa: asyncRate, zoomMeeting: zoomRate },
          };

          return (
            <Card
              key={t.id}
              className="group flex flex-col justify-between rounded-2xl border-primary/30 bg-card p-5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-elegant relative overflow-hidden"
            >
              <div>
                <div className="absolute top-2 right-2">
                  <Badge
                    variant="outline"
                    className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20 font-medium"
                  >
                    Verified Tutor
                  </Badge>
                </div>

                <div className="flex items-start gap-3">
                  <div className="relative">
                    <Avatar className="h-14 w-14 border border-border">
                      <AvatarImage src={t.avatarUrl || undefined} />
                      <AvatarFallback className="bg-primary/10 text-primary font-bold">
                        {name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border-2 border-card bg-emerald-600 text-xs font-bold text-white">
                      ✓
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 pr-16">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground truncate">
                      {name}
                      {t.username && (
                        <span className="font-mono text-xs text-primary bg-primary/10 px-1.5 py-0.2 rounded font-medium shrink-0">
                          @{t.username}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-primary font-medium mt-0.5">
                      {t.credentials || "Verified Expert"}
                      {t.institution ? ` · ${t.institution}` : ""}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-0.5 font-semibold text-amber-600">
                        <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                        {t.ratingCount > 0 ? `${avg} (${t.ratingCount})` : "New"}
                      </span>
                      <Clock className="h-3 w-3" />
                      {t.timezone}
                      <Globe className="ml-1 h-3 w-3" />
                      {(t.languages ?? ["English"]).join(", ")}
                    </div>
                  </div>
                </div>

                {t.bio && (
                  <p className="mt-3 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {t.bio}
                  </p>
                )}

                {t.subjects?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {t.subjects.slice(0, 5).map((tag) => (
                      <Badge key={tag} variant="secondary" className="rounded-full text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="mt-3 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-2.5 text-xs">
                  <div className="flex items-center gap-1 font-semibold text-primary text-xs">
                    <FileCheck className="h-3.5 w-3.5" />
                    Availability · {t.sessionsCompleted} session{t.sessionsCompleted === 1 ? "" : "s"} taught
                  </div>
                  <div className="text-muted-foreground text-xs mt-0.5">
                    {formatAvailability(t.availability)}
                  </div>
                </div>

                {/* Teaching modes & Custom Service Rates */}
                <div className="mt-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Service Credit Rates
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <ModeChip icon={FileText} label="Materials" hint={`${matRate} cr`} />
                    <ModeChip icon={MessageSquare} label="Async (30m)" hint={`${asyncRate} cr`} />
                    <ModeChip icon={Video} label="Zoom (45m)" hint={`${zoomRate} cr`} />
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between pt-3 border-t border-border">
                <div className="flex items-center gap-1 text-sm font-semibold">
                  <Coins className="h-4 w-4 text-amber-500" />
                  from {matRate} cr
                </div>
                <Button
                  size="sm"
                  onClick={() => handleOpenBooking(tutorBookingInfo)}
                  className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90"
                >
                  Book Session
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Tutor Session Booking Dialog */}
      <Dialog
        open={!!selectedTutorForBooking}
        onOpenChange={(open) => !open && setSelectedTutorForBooking(null)}
      >
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Book Tutor Session</DialogTitle>
            <DialogDescription>
              Select your preferred service mode and time to schedule with{" "}
              {selectedTutorForBooking?.name}.
            </DialogDescription>
          </DialogHeader>

          {selectedTutorForBooking && (
            <form onSubmit={handleConfirmBooking} className="space-y-4 py-2">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30 border border-border">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={selectedTutorForBooking.avatar} />
                  <AvatarFallback className="bg-primary/10 text-primary font-bold">
                    {selectedTutorForBooking.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-semibold text-sm">{selectedTutorForBooking.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {selectedTutorForBooking.subject}
                  </div>
                </div>
              </div>

              {/* Service Mode Selector */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2">
                  Select Session Type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedMode("materials")}
                    className={`p-3 rounded-xl border text-center text-xs transition ${
                      selectedMode === "materials"
                        ? "border-primary bg-primary/10 font-bold text-primary"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <FileText className="mx-auto h-4 w-4 mb-1" />
                    <div>Materials</div>
                    <div className="text-xs text-amber-600 mt-1">
                      {selectedTutorForBooking.rates.materials} cr
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedMode("asyncQa")}
                    className={`p-3 rounded-xl border text-center text-xs transition ${
                      selectedMode === "asyncQa"
                        ? "border-primary bg-primary/10 font-bold text-primary"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <MessageSquare className="mx-auto h-4 w-4 mb-1" />
                    <div>Async Q&A</div>
                    <div className="text-xs text-amber-600 mt-1">
                      {selectedTutorForBooking.rates.asyncQa} cr
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedMode("zoomMeeting")}
                    className={`p-3 rounded-xl border text-center text-xs transition ${
                      selectedMode === "zoomMeeting"
                        ? "border-primary bg-primary/10 font-bold text-primary"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <Video className="mx-auto h-4 w-4 mb-1" />
                    <div>Zoom (45m)</div>
                    <div className="text-xs text-amber-600 mt-1">
                      {selectedTutorForBooking.rates.zoomMeeting} cr
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Preferred Date & Time
                </label>
                <div className="relative">
                  <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input aria-label="e.g. Tomorrow at 3:00 PM"
                    value={bookingDate}
                    onChange={(e) => setBookingDate(e.target.value)}
                    placeholder="e.g. Tomorrow at 3:00 PM"
                    required
                    className="rounded-xl pl-9"
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tutor availability: {selectedTutorForBooking.availability}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Topic / Problem Notes *
                </label>
                <Textarea
                  value={sessionTopic}
                  onChange={(e) => setSessionTopic(e.target.value)}
                  placeholder="Describe what topic, homework, or exam you want to review in this session..."
                  rows={3}
                  required
                  className="rounded-xl"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs">
                <span className="flex items-center gap-1 font-medium">
                  <Coins className="h-4 w-4 text-amber-500" />
                  Total Credits Required:
                </span>
                <span className="font-bold text-sm">
                  {selectedMode === "materials"
                    ? selectedTutorForBooking.rates.materials
                    : selectedMode === "asyncQa"
                      ? selectedTutorForBooking.rates.asyncQa
                      : selectedTutorForBooking.rates.zoomMeeting}{" "}
                  cr
                </span>
              </div>

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedTutorForBooking(null)}
                  className="rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmittingBooking}
                  className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant"
                >
                  {isSubmittingBooking ? "Booking..." : "Confirm & Pay Credits"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm & Rate Dialog */}
      <Dialog open={!!ratingFor} onOpenChange={(o) => !o && setRatingFor(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Confirm session &amp; rate your tutor</DialogTitle>
            <DialogDescription>
              Confirming releases {ratingFor?.credits} credits to {ratingFor?.tutor.displayName}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmitRating} className="space-y-3 py-1">
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRatingValue(n)} className="p-1" aria-label={`${n} stars`}>
                  <Star
                    className={`h-6 w-6 ${n <= ratingValue ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
                  />
                </button>
              ))}
            </div>
            <Textarea
              value={ratingText}
              onChange={(e) => setRatingText(e.target.value)}
              placeholder="How was the session? (optional)"
              rows={3}
              className="rounded-xl"
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRatingFor(null)} className="rounded-xl">
                Not yet
              </Button>
              <Button
                type="submit"
                disabled={sessionBusy === `rate_${ratingFor?.id}`}
                className="rounded-xl bg-gradient-primary text-primary-foreground"
              >
                Submit &amp; pay tutor
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModeChip({
  icon: Icon,
  label,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-xl border border-border p-2 text-center text-xs">
      <Icon className="h-3.5 w-3.5 text-primary" />
      <div className="font-semibold leading-none">{label}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}
