import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Trophy, Crown, Medal, Flame, Star, Clock, Heart, Coins, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  getMyRank,
  subscribeLeaderboardBy,
  type LeaderboardMetric,
  type LeaderboardRow,
} from "@/services/gamification";
import { errorMessage } from "@/services/common";

export const Route = createFileRoute("/_app/leaderboard")({
  head: () => ({
    meta: [
      { title: "Leaderboard — Cortex" },
      { name: "description", content: "Top teachers, top learners, top helpers across Cortex." },
    ],
  }),
  component: LeaderboardPage,
});

type LeaderboardTab = "Credits" | "Teaching hours" | "Community help" | "Streak" | "Ratings";

const TAB_METRIC: Record<LeaderboardTab, LeaderboardMetric> = {
  Credits: "credits",
  "Teaching hours": "hours",
  "Community help": "help",
  Streak: "streak",
  Ratings: "rating",
};

type LeaderboardUser = Omit<LeaderboardRow, "name"> & { name: string };

export function LeaderboardPage() {
  const { user, profile } = useAuth();
  const me = user?.uid ?? "";
  const [activeTab, setActiveTab] = useState<LeaderboardTab>("Credits");
  const [sortedLeaderboard, setRows] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [myRank, setMyRank] = useState<number | null>(null);

  // Live ranking for the selected tab (server-side ordering, top 50)
  useEffect(() => {
    setLoading(true);
    setError(null);
    const unsub = subscribeLeaderboardBy(
      TAB_METRIC[activeTab],
      (rows) => {
        setRows(rows);
        setLoading(false);
      },
      (e) => {
        setLoading(false);
        setError(errorMessage(e, "Couldn't load the leaderboard."));
      },
    );
    return unsub;
  }, [activeTab]);

  useEffect(() => {
    if (!me) return;
    getMyRank({
      creditsEarned: Number(profile.creditsEarned) || 0,
      showLeaderboard: profile.showLeaderboard,
    })
      .then(setMyRank)
      .catch(() => setMyRank(null));
  }, [me, profile.creditsEarned, profile.showLeaderboard]);

  const topThree = sortedLeaderboard.slice(0, 3);

  const getMetricDisplay = (user: LeaderboardUser) => {
    switch (activeTab) {
      case "Credits":
        return { value: `${user.credits.toLocaleString()} cr`, icon: Coins };
      case "Teaching hours":
        return { value: `${user.hours} hrs`, icon: Clock };
      case "Community help":
        return { value: `${user.helpCount} solved`, icon: Heart };
      case "Streak":
        return { value: `${user.streak} days`, icon: Flame };
      case "Ratings":
        return { value: `${user.rating.toFixed(2)} ★`, icon: Star };
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="font-display text-3xl md:text-4xl tracking-tight font-medium">
          Global Leaderboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Rankings update live · only learners who opted in appear here
        </p>
      </div>

      {/* Category Tabs */}
      <div className="mb-6 flex flex-wrap gap-2">
        {(["Credits", "Teaching hours", "Community help", "Streak", "Ratings"] as const).map(
          (tab) => (
            <Button
              key={tab}
              onClick={() => setActiveTab(tab)}
              variant={activeTab === tab ? "default" : "outline"}
              className={`rounded-xl transition ${
                activeTab === tab
                  ? "bg-gradient-primary text-primary-foreground shadow-elegant"
                  : ""
              }`}
            >
              {tab === "Streak" && <Flame className="mr-1.5 h-4 w-4 text-amber-500" />}
              {tab === "Ratings" && (
                <Star className="mr-1.5 h-4 w-4 text-amber-500 fill-amber-500" />
              )}
              {tab === "Community help" && <Heart className="mr-1.5 h-4 w-4 text-rose-500" />}
              {tab === "Teaching hours" && <Clock className="mr-1.5 h-4 w-4 text-primary" />}
              {tab === "Credits" && <Coins className="mr-1.5 h-4 w-4 text-amber-500" />}
              {tab}
            </Button>
          ),
        )}
      </div>

      {loading && (
        <div className="py-12 text-center text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading rankings…
        </div>
      )}
      {error && <div className="py-12 text-center text-destructive">{error}</div>}
      {!loading && !error && sortedLeaderboard.length === 0 && (
        <Card className="rounded-2xl border-border p-10 text-center text-sm text-muted-foreground shadow-soft">
          <Trophy className="mx-auto mb-2 h-8 w-8" />
          The leaderboard is wide open — be the first on the board! Help a peer, teach a session or keep your streak going.
        </Card>
      )}
      {!loading && myRank && activeTab === "Credits" && (
        <div className="mb-4 text-sm text-muted-foreground">
          Your current rank: <span className="font-semibold text-foreground">#{myRank}</span>
        </div>
      )}

      {/* Podium Top 3 */}
      <div className="mb-8 grid gap-4 md:grid-cols-3">
        {topThree.map((u, i) => {
          const metric = getMetricDisplay(u);
          const MetricIcon = metric.icon;

          return (
            <Card
              key={u.uid}
              className={`rounded-2xl border-border p-6 text-center shadow-soft transition hover:shadow-elegant ${
                i === 0
                  ? "md:order-2 md:scale-105 bg-gradient-mesh border-primary/30"
                  : i === 1
                    ? "md:order-1"
                    : "md:order-3"
              }`}
            >
              <div className="mx-auto grid h-8 w-8 place-items-center rounded-full bg-gradient-primary text-primary-foreground shadow-elegant mb-2">
                {i === 0 ? <Crown className="h-4 w-4" /> : <Medal className="h-4 w-4" />}
              </div>

              <Avatar className="mx-auto h-20 w-20 ring-4 ring-primary/20">
                <AvatarImage src={u.avatar} />
                <AvatarFallback className="bg-primary/10 text-primary font-bold">
                  {u.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <div className="mt-3 font-semibold text-base">{u.name}</div>
              <Badge variant="secondary" className="mt-1 rounded-full text-xs">
                {u.badge}
              </Badge>

              <div className="mt-4 flex items-center justify-center gap-1.5 text-2xl font-bold text-gradient">
                <MetricIcon className="h-5 w-5 text-primary" />
                {metric.value}
              </div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">
                {activeTab}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Full Leaderboard Table List */}
      <Card className="rounded-2xl border-border p-2 shadow-soft">
        {sortedLeaderboard.map((u) => {
          const you = u.uid === me;
          const metric = getMetricDisplay(u);
          const MetricIcon = metric.icon;

          return (
            <div
              key={u.uid}
              className={`flex items-center gap-4 rounded-xl p-3 transition ${
                you ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/50"
              }`}
            >
              <div className="w-8 text-center text-sm font-bold text-muted-foreground shrink-0">
                #{u.rank}
              </div>

              <Avatar className="h-10 w-10 shrink-0">
                <AvatarImage src={u.avatar} />
                <AvatarFallback className="bg-primary/10 text-primary font-bold">
                  {u.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{u.name}</div>
                <div className="text-xs text-muted-foreground">
                  {u.hours}h taught · {u.badge}
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-sm font-bold text-foreground shrink-0">
                <MetricIcon className="h-4 w-4 text-primary" />
                {metric.value}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
