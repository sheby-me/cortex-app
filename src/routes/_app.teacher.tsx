import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GraduationCap, Calendar, Coins, Users, Plus, Star, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { settlePendingCredits } from "@/services/credits";
import { errorMessage } from "@/services/common";
import {
  AUTO_COMPLETE_AFTER_MS,
  MODE_META,
  autoCompleteSession,
  averageRating,
  countDistinctStudents,
  ensureTutorProfile,
  markDelivered,
  respondToSession,
  subscribeMySessions,
  subscribeTutorProfile,
  updateTutorProfile,
  type AvailabilitySlot,
  type Session,
  type TutorProfile,
} from "@/services/tutors";
import { toMillis } from "@/services/common";
import type { UserDoc } from "@/services/users";

export const Route = createFileRoute("/_app/teacher")({
  head: () => ({
    meta: [
      { title: "Teacher Studio — Cortex" },
      { name: "description", content: "Manage courses, availability, bookings and earnings." },
    ],
  }),
  component: TeacherPage,
});

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function TeacherPage() {
  const { user, profile } = useAuth();
  const me = user?.uid ?? "";
  const meDoc = { ...(profile as unknown as UserDoc), uid: me };

  const [tutor, setTutor] = useState<TutorProfile | null>(null);
  const [tutorLoading, setTutorLoading] = useState(true);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [students, setStudents] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  // Editable profile state (mirrors the stored profile until the tutor changes something)
  const [bio, setBio] = useState("");
  const [subjects, setSubjects] = useState("");
  const [languages, setLanguages] = useState("");
  const [timezone, setTimezone] = useState("");
  const [rates, setRates] = useState({ materials: 15, asyncQa: 25, zoomMeeting: 50 });
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [accepting, setAccepting] = useState(true);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    if (!me) return;
    ensureTutorProfile(me).catch((e) => console.warn("ensureTutorProfile failed:", e));
    const unsubs = [
      subscribeTutorProfile(me, (t) => {
        setTutor(t);
        setTutorLoading(false);
        if (t && !hydrated.current) {
          hydrated.current = true;
          setBio(t.bio ?? "");
          setSubjects((t.subjects ?? []).join(", "));
          setLanguages((t.languages ?? []).join(", "));
          setTimezone(t.timezone ?? "");
          setRates(t.rates);
          setSlots(t.availability ?? []);
          setAccepting(t.acceptingSessions);
        }
      }),
      subscribeMySessions(me, ({ asTutor }) => setSessions(asTutor)),
    ];
    countDistinctStudents(me).then(setStudents).catch(() => undefined);
    return () => unsubs.forEach((u) => u());
  }, [me]);

  // Collect payment for any session the student already confirmed
  const unclaimed = sessions.filter((s) => s.status === "completed" && !s.payoutClaimed).length;
  useEffect(() => {
    if (!me || unclaimed === 0) return;
    settlePendingCredits(me)
      .then((m) => m.forEach((x) => toast.success(x)))
      .catch(() => undefined);
  }, [me, unclaimed]);

  const pending = sessions.filter((s) => s.status === "pending");
  const upcoming = sessions.filter((s) => s.status === "accepted" || s.status === "delivered");
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const sessionsThisWeek = sessions.filter(
    (s) => s.status !== "declined" && s.status !== "cancelled" && toMillis(s.createdAt as never) > weekAgo,
  ).length;

  const stats = useMemo(
    () => [
      { icon: Coins, l: "Credits earned", v: `${Number(profile.creditsEarned) || 0}`, s: `${Number(profile.credits) || 0} balance` },
      { icon: Users, l: "Students taught", v: `${students}`, s: "all time" },
      { icon: Calendar, l: "Sessions", v: `${sessionsThisWeek}`, s: "this week" },
      {
        icon: Star,
        l: "Rating",
        v: tutor && tutor.ratingCount > 0 ? `${averageRating(tutor)}` : "—",
        s: `${tutor?.ratingCount ?? 0} review${tutor?.ratingCount === 1 ? "" : "s"}`,
      },
    ],
    [profile.creditsEarned, profile.credits, students, sessionsThisWeek, tutor],
  );

  const act = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateTutorProfile(me, {
        bio: bio.trim(),
        subjects: subjects.split(",").map((x) => x.trim()).filter(Boolean),
        languages: languages.split(",").map((x) => x.trim()).filter(Boolean),
        timezone: timezone.trim() || "Flexible",
        rates: {
          materials: Number(rates.materials),
          asyncQa: Number(rates.asyncQa),
          zoomMeeting: Number(rates.zoomMeeting),
        },
        availability: slots,
        acceptingSessions: accepting,
      });
      toast.success("Your tutor profile was updated.");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save your tutor profile."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge variant="secondary" className="rounded-full mb-2">
            Verified educator
          </Badge>
          <h1 className="font-display text-4xl tracking-tight flex items-center gap-3">
            <GraduationCap className="h-8 w-8 text-primary" />
            Teacher studio
          </h1>
          <p className="mt-1 text-muted-foreground">
            Your bookings, students, availability and earnings — one place.
          </p>
        </div>
        <Button
          onClick={() => editorRef.current?.scrollIntoView({ behavior: "smooth" })}
          className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Edit availability
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.l} className="rounded-2xl border-border p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-primary text-primary-foreground">
                <s.icon className="h-4 w-4" />
              </div>
              <Badge variant="secondary" className="rounded-full">
                {s.s}
              </Badge>
            </div>
            <div className="mt-3 text-2xl font-bold">{s.v}</div>
            <div className="text-xs text-muted-foreground">{s.l}</div>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="rounded-2xl border-border p-6 shadow-soft">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">Session requests &amp; upcoming</h2>
          {pending.length === 0 && upcoming.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No session requests yet. Students can book you once your profile is complete.
            </p>
          )}

          {pending.map((r) => (
            <div key={r.id} className="mb-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold truncate">
                    {r.student.displayName} · {MODE_META[r.mode].label}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    “{r.topic}” · {r.slotLabel} · {r.credits} cr
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === `decline_${r.id}`}
                    onClick={() => act(`decline_${r.id}`, () => respondToSession(r, meDoc, false), "Request declined.")}
                    className="rounded-xl"
                  >
                    Decline
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy === `accept_${r.id}`}
                    onClick={() => act(`accept_${r.id}`, () => respondToSession(r, meDoc, true), "Session accepted.")}
                    className="rounded-xl bg-gradient-primary text-primary-foreground"
                  >
                    Accept
                  </Button>
                </div>
              </div>
            </div>
          ))}

          {upcoming.map((r) => {
            const canAutoComplete =
              r.status === "delivered" && Date.now() - toMillis(r.deliveredAt as never) > AUTO_COMPLETE_AFTER_MS;
            return (
              <div key={r.id} className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-border p-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{r.slotLabel}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {MODE_META[r.mode].label} · {r.topic} · {r.student.displayName}
                  </div>
                </div>
                {r.status === "accepted" ? (
                  <Button
                    size="sm"
                    disabled={busy === `deliver_${r.id}`}
                    onClick={() => act(`deliver_${r.id}`, () => markDelivered(r, meDoc), "Marked as delivered — waiting for the student's confirmation.")}
                    className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90"
                  >
                    Mark delivered
                  </Button>
                ) : canAutoComplete ? (
                  <Button
                    size="sm"
                    disabled={busy === `auto_${r.id}`}
                    onClick={() => act(`auto_${r.id}`, async () => { await autoCompleteSession(r); await settlePendingCredits(me); }, "Session completed and credits claimed.")}
                    className="rounded-xl"
                  >
                    Claim credits
                  </Button>
                ) : (
                  <Badge variant="outline" className="rounded-full shrink-0">
                    Awaiting confirmation
                  </Badge>
                )}
              </div>
            );
          })}
        </Card>

        <div ref={editorRef}>
          <Card className="rounded-2xl border-border p-6 shadow-soft">
            <h2 className="mb-4 text-lg font-semibold tracking-tight">Availability &amp; rates</h2>
            {tutorLoading ? (
              <div className="py-8 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              </div>
            ) : !tutor ? (
              <p className="text-sm text-muted-foreground">
                Your tutor listing isn't ready yet. If you were just approved, refresh in a moment.
              </p>
            ) : (
              <div className="space-y-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={accepting} onChange={(e) => setAccepting(e.target.checked)} />
                  Accepting new session requests (listed in Find Tutors)
                </label>

                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">About you</div>
                  <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className="rounded-xl" />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted-foreground">Subjects (comma separated)</div>
                    <Input value={subjects} onChange={(e) => setSubjects(e.target.value)} className="rounded-xl" />
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted-foreground">Languages</div>
                    <Input value={languages} onChange={(e) => setLanguages(e.target.value)} className="rounded-xl" />
                  </div>
                  <div className="sm:col-span-2">
                    <div className="mb-1 text-xs font-medium text-muted-foreground">Timezone</div>
                    <Input aria-label="e.g. UTC+5 (PKT)" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="e.g. UTC+5 (PKT)" className="rounded-xl" />
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Credit rates</div>
                  <div className="grid grid-cols-3 gap-2">
                    {(["materials", "asyncQa", "zoomMeeting"] as const).map((k) => (
                      <label key={k} className="text-xs text-muted-foreground">
                        {MODE_META[k].label}
                        <Input
                          type="number"
                          min={0}
                          max={1000}
                          value={rates[k]}
                          onChange={(e) => setRates((r) => ({ ...r, [k]: Number(e.target.value) }))}
                          className="mt-1 rounded-xl"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Weekly availability</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setSlots((s) => [...s, { day: 1, start: "09:00", end: "17:00" }])}
                      className="h-7 rounded-xl text-xs"
                    >
                      <Plus className="mr-1 h-3 w-3" /> Add slot
                    </Button>
                  </div>
                  {slots.length === 0 && (
                    <p className="text-xs text-muted-foreground">No fixed hours — students will agree a time with you.</p>
                  )}
                  {slots.map((sl, i) => (
                    <div key={i} className="mb-1.5 flex items-center gap-2">
                      <select
                        value={sl.day}
                        onChange={(e) => setSlots((all) => all.map((x, idx) => (idx === i ? { ...x, day: Number(e.target.value) } : x)))}
                        className="h-9 rounded-xl border border-border bg-background px-2 text-xs"
                      >
                        {DAYS.map((d, idx) => (
                          <option key={d} value={idx}>
                            {d}
                          </option>
                        ))}
                      </select>
                      <Input type="time" value={sl.start} onChange={(e) => setSlots((all) => all.map((x, idx) => (idx === i ? { ...x, start: e.target.value } : x)))} className="h-9 w-28 rounded-xl" />
                      <span className="text-xs text-muted-foreground">to</span>
                      <Input type="time" value={sl.end} onChange={(e) => setSlots((all) => all.map((x, idx) => (idx === i ? { ...x, end: e.target.value } : x)))} className="h-9 w-28 rounded-xl" />
                      <Button type="button" size="icon" variant="ghost" onClick={() => setSlots((all) => all.filter((_, idx) => idx !== i))} aria-label="Remove slot">
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>

                <Button onClick={save} disabled={saving} className="w-full rounded-xl bg-gradient-primary text-primary-foreground">
                  {saving ? "Saving…" : "Save tutor profile"}
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
