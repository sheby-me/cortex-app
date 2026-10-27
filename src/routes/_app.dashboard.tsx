import { useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import {
  Coins,
  Flame,
  Trophy,
  Target,
  Sparkles,
  FileText,
  ListChecks,
  Users,
  LifeBuoy,
  BookOpen,
  ArrowRight,
  Star,
  Calendar,
  MessagesSquare,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { collection, limit as qLimit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { getMyRank, subscribeStudyWeek, todayKey, type StudyDay } from "@/services/gamification";
import { subscribeBuddies, type FriendUserData } from "@/services/buddies";
import { subscribeQuizProgress, type QuizProgress } from "@/services/progress";
import { averageRating, subscribeTutorProfiles, type TutorProfile } from "@/services/tutors";
import { toMillis } from "@/services/common";
import {
  getNotifications,
  NOTIFICATION_EVENT,
  type CortexNotification,
} from "@/lib/notifications-store";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Cortex" },
      { name: "description", content: "Your credits, streak, sessions and AI recommendations." },
    ],
  }),
  component: Dashboard,
});

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  tint = "primary",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tint?: string;
}) {
  return (
    <Card className="rounded-2xl border-border p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <div
          className={`grid h-10 w-10 place-items-center rounded-xl ${tint === "primary" ? "bg-gradient-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
      <div className="mt-4 text-3xl font-bold tracking-tight">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </Card>
  );
}

function Dashboard() {
  const { user, profile } = useAuth();
  const me = user?.uid ?? "";
  const [notifList, setNotifList] = useState<CortexNotification[]>([]);
  const [week, setWeek] = useState<StudyDay[]>([]);
  const [rank, setRank] = useState<number | null>(null);
  const [earnedToday, setEarnedToday] = useState(0);
  const [tutorList, setTutorList] = useState<TutorProfile[]>([]);
  const [buddyList, setBuddyList] = useState<FriendUserData[]>([]);
  const [quizProgress, setQuizProgress] = useState<Record<string, QuizProgress>>({});

  useEffect(() => {
    const update = () => {
      setNotifList(getNotifications());
    };
    update();

    if (typeof window !== "undefined") {
      window.addEventListener(NOTIFICATION_EVENT, update);
      return () => window.removeEventListener(NOTIFICATION_EVENT, update);
    }
  }, []);

  useEffect(() => {
    if (!me) return;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const unsubs = [
      subscribeStudyWeek(me, setWeek),
      subscribeBuddies(me, setBuddyList),
      subscribeQuizProgress(me, setQuizProgress),
      subscribeTutorProfiles((t) => setTutorList(t.filter((x) => x.id !== me))),
      onSnapshot(
        query(collection(db, "users", me, "creditHistory"), orderBy("createdAt", "desc"), qLimit(50)),
        (snap) =>
          setEarnedToday(
            snap.docs.reduce((sum, d) => {
              const c = d.data({ serverTimestamps: "estimate" }) as { amount?: number; type?: string; createdAt?: unknown };
              return toMillis(c.createdAt as never) >= startOfDay.getTime() ? sum + (Number(c.amount) || 0) : sum;
            }, 0),
          ),
        () => setEarnedToday(0),
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [me]);

  useEffect(() => {
    getMyRank({ creditsEarned: Number(profile.creditsEarned) || 0, showLeaderboard: profile.showLeaderboard })
      .then(setRank)
      .catch(() => setRank(null));
  }, [profile.creditsEarned, profile.showLeaderboard]);

  // Daily goal = weekly hours goal spread over 7 days; minutes come from real time spent in Cortex
  const dailyGoalMin = Math.max(10, Math.round(((Number(profile.hoursGoal) || 5) * 60) / 7));
  const todayMin = week.find((d) => d.date === todayKey())?.minutes ?? 0;
  const weeklyMin = week.reduce((n, d) => n + d.minutes, 0);
  const weeklyGoalHours = Number(profile.hoursGoal) || 5;
  const goalPct = Math.min(100, Math.round((todayMin / dailyGoalMin) * 100));
  const maxDayMin = Math.max(1, ...week.map((d) => d.minutes));
  const topTutors = [...tutorList]
    .sort((a, b) => averageRating(b) - averageRating(a) || b.sessionsCompleted - a.sessionsCompleted)
    .slice(0, 4);
  const readiness = Object.values(quizProgress)
    .sort((a, b) => toMillis(b.lastAttemptAt as never) - toMillis(a.lastAttemptAt as never))
    .slice(0, 3);
  const firstName = (profile.displayName || "").split(" ")[0];

  return (
    <div className="p-6 md:p-8">
      {/* Greeting */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm text-muted-foreground">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </div>
          <h1 className="font-display text-4xl font-medium tracking-tight md:text-5xl">
            Welcome back{firstName ? `, ${firstName}` : ""}.
          </h1>
          <p className="mt-1 text-muted-foreground">
            Your credits, sessions and progress — in one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="rounded-xl">
            <Link to="/sos">
              <LifeBuoy className="mr-1.5 h-4 w-4" />
              Create SOS
            </Link>
          </Button>
          <Button
            asChild
            className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90"
          >
            <Link to="/ai">
              <Sparkles className="mr-1.5 h-4 w-4" />
              Ask AI
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Stat
          icon={Coins}
          label="Credits"
          value={(Number(profile.credits) || 0).toLocaleString()}
          sub={earnedToday > 0 ? `+${earnedToday} today` : "balance"}
        />
        <Stat
          icon={Flame}
          label="Streak"
          value={`${Number(profile.studyStreak) || 0}d`}
          sub={Number(profile.studyStreak) >= 7 ? "On fire 🔥" : "Keep it going"}
          tint="accent"
        />
        <Stat
          icon={Trophy}
          label="Leaderboard"
          value={rank ? `#${rank}` : "—"}
          sub={profile.showLeaderboard === false ? "Hidden" : `${Number(profile.creditsEarned) || 0} earned`}
          tint="accent"
        />
        <Stat
          icon={Target}
          label="Daily Goal"
          value={`${todayMin}/${dailyGoalMin}m`}
          sub={`${goalPct}%`}
          tint="accent"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Left col */}
        <div className="space-y-6 lg:col-span-2">
          {/* Today progress */}
          <Card className="rounded-2xl border-border p-6 shadow-soft">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Weekly progress</h2>
                <p className="text-sm text-muted-foreground">
                  {Math.round((weeklyMin / 60) * 10) / 10}h of your {weeklyGoalHours}h goal
                </p>
              </div>
              <Badge variant="secondary" className="rounded-full">
                {weeklyMin / 60 >= weeklyGoalHours ? "Goal reached" : "In progress"}
              </Badge>
            </div>
            <div className="flex items-end gap-2">
              {week.map((d) => (
                <div key={d.date} className="flex-1" title={`${d.minutes} min`}>
                  <div
                    className="rounded-lg bg-gradient-primary"
                    style={{ height: `${Math.max(4, Math.round((d.minutes / maxDayMin) * 112))}px` }}
                  />
                  <div className="mt-2 text-center text-xs text-muted-foreground">
                    {["S", "M", "T", "W", "T", "F", "S"][new Date(d.date + "T00:00:00").getDay()]}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Quick actions */}
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Quick actions
            </h2>
            <div className="grid gap-3 md:grid-cols-3">
              {[
                { icon: FileText, label: "Generate notes", to: "/ai" },
                { icon: ListChecks, label: "Generate quiz", to: "/quizzes" },
                { icon: Users, label: "Find tutor", to: "/tutors" },
                { icon: LifeBuoy, label: "Create SOS", to: "/sos" },
                { icon: BookOpen, label: "Join a group", to: "/groups" },
                { icon: MessagesSquare, label: "Ask community", to: "/community" },
              ].map((a) => (
                <Link
                  key={a.label}
                  to={a.to}
                  className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-elegant"
                >
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-accent-foreground transition group-hover:bg-gradient-primary group-hover:text-primary-foreground">
                    <a.icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 text-sm font-semibold">{a.label}</div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </div>

          {/* Recommended tutors */}
          <Card className="rounded-2xl border-border p-6 shadow-soft">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Recommended tutors</h2>
                <p className="text-sm text-muted-foreground">
                  Matched by your goals · timezone · past ratings
                </p>
              </div>
              <Button asChild variant="ghost" size="sm" className="rounded-xl">
                <Link to="/tutors">
                  See all
                  <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {topTutors.length === 0 && (
                <p className="col-span-full py-4 text-center text-sm text-muted-foreground">
                  Verified tutors will appear here as soon as they join.
                </p>
              )}
              {topTutors.map((t) => (
                <div key={t.id} className="flex gap-3 rounded-xl border border-border p-3">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={t.avatarUrl || undefined} />
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-sm font-semibold">{t.displayName}</div>
                      <div className="flex items-center gap-0.5 text-xs">
                        <Star className="h-3 w-3 fill-warning text-warning" />
                        {t.ratingCount > 0 ? averageRating(t) : "New"}
                      </div>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t.credentials}
                      {t.institution ? ` · ${t.institution}` : ""}
                    </div>
                    <div className="mt-1 text-xs italic text-muted-foreground line-clamp-1">
                      ✦ {t.sessionsCompleted} session{t.sessionsCompleted === 1 ? "" : "s"} taught
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right col */}
        <div className="space-y-6">
          {/* Exams */}
          <Card className="rounded-2xl border-border p-6 shadow-soft">
            <div className="mb-4 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold tracking-tight">Quiz readiness</h2>
            </div>
            <div className="space-y-4">
              {readiness.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Take a quiz to see how ready you are.{" "}
                  <Link to="/quizzes" className="text-primary underline-offset-4 hover:underline">
                    Start one
                  </Link>
                </p>
              )}
              {readiness.map((e) => (
                <div key={e.quizId}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <div className="truncate font-semibold">{e.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {e.attempts} attempt{e.attempts === 1 ? "" : "s"}
                    </div>
                  </div>
                  <Progress value={e.bestPercent} className="h-1.5" />
                  <div className="mt-1 text-xs text-muted-foreground">Best score {e.bestPercent}%</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Buddies */}
          <Card className="rounded-2xl border-border p-6 shadow-soft">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">Study buddies</h2>
              <Button asChild variant="ghost" size="sm" className="rounded-xl">
                <Link to="/buddy">Explore</Link>
              </Button>
            </div>
            <div className="space-y-3">
              {buddyList.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No study buddies yet.{" "}
                  <Link to="/buddy" className="text-primary underline-offset-4 hover:underline">
                    Find some
                  </Link>
                </p>
              )}
              {buddyList.slice(0, 3).map((b) => (
                <div key={b.uid} className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={b.avatarUrl || undefined} />
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{b.displayName}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {b.learn?.[0] || b.institution || `@${b.username}`}
                    </div>
                  </div>
                  <Badge variant="secondary" className="rounded-full">
                    {b.online ? "Online" : "Offline"}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>

          {/* Activity */}
          <Card className="rounded-2xl border-border p-6 shadow-soft">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold tracking-tight">Recent activity</h2>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="text-xs h-7 text-primary hover:bg-primary/10"
              >
                <Link to="/notifications">View all</Link>
              </Button>
            </div>
            <div className="space-y-3">
              {notifList.length === 0 && (
                <p className="text-xs text-muted-foreground">Nothing yet — activity from buddies, SOS and sessions shows up here.</p>
              )}
              {notifList.slice(0, 4).map((n) => (
                <div key={n.id} className="flex items-start gap-3 text-sm">
                  <div
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${!n.read ? "bg-primary" : "bg-muted-foreground/40"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-xs font-medium">{n.text}</div>
                    <div className="text-xs text-muted-foreground">{n.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
