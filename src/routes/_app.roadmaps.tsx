import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Map, Sparkles, Plus, Loader2, ArrowLeft } from "lucide-react";
import { authedFetch } from "@/services/ai";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  saveGeneratedRoadmap,
  subscribeRoadmapProgress,
  subscribeRoadmaps,
  toggleMilestone,
  type CatalogRoadmap,
  type RoadmapProgress,
} from "@/services/progress";
import { errorMessage } from "@/services/common";

export const Route = createFileRoute("/_app/roadmaps")({
  head: () => ({
    meta: [
      { title: "Roadmaps — Cortex" },
      { name: "description", content: "Multi-week AI roadmaps for any skill or exam." },
    ],
  }),
  component: RoadmapPage,
});

interface RoadmapItem {
  id: string;
  title: string;
  weeks: number;
  progress: number;
  milestones: number;
  color: string;
  content?: string;
}

export function RoadmapPage() {
  const { user } = useAuth();
  const me = user?.uid ?? "";

  const [catalog, setCatalog] = useState<CatalogRoadmap[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, RoadmapProgress>>({});
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    const unsubs = [
      subscribeRoadmaps(
        me,
        (list) => {
          setCatalog(list);
          setListLoading(false);
        },
        (e) => {
          setListLoading(false);
          setListError(errorMessage(e, "Couldn't load roadmaps."));
        },
      ),
      subscribeRoadmapProgress(me, setProgressMap),
    ];
    return () => unsubs.forEach((u) => u());
  }, [me]);

  // Catalog / saved roadmaps + this user's progress on each
  const roadmapList: RoadmapItem[] = useMemo(
    () =>
      catalog.map((r) => ({
        id: r.id,
        title: r.title,
        weeks: r.weeks,
        milestones: r.milestones,
        color: r.color,
        progress: progressMap[r.id]?.progress ?? 0,
        content:
          r.content ??
          `### Curriculum Roadmap: ${r.title}\n\n**Week 1-2:** Fundamentals and Core Principles\n- Key objectives, setup, and primary abstractions\n\n**Week 3-5:** Intermediate Concepts and Practical Applications\n- Hands-on exercises and real-world project builds\n\n**Week 6-8:** Advanced Topics & Portfolio Synthesis\n- Optimization, deep dives, and final review`,
      })),
    [catalog, progressMap],
  );

  const [togglingMilestone, setTogglingMilestone] = useState<number | null>(null);
  const handleToggleMilestone = async (r: RoadmapItem, index: number) => {
    setTogglingMilestone(index);
    try {
      await toggleMilestone(me, r.id, index, r.milestones);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save your progress."));
    } finally {
      setTogglingMilestone(null);
    }
  };

  const [activeRoadmap, setActiveRoadmap] = useState<RoadmapItem | null>(null);
  const [showGenerator, setShowGenerator] = useState<boolean>(false);
  const [goal, setGoal] = useState<string>("");
  const [weeksInput, setWeeksInput] = useState<number>(8);
  const [loading, setLoading] = useState<boolean>(false);

  const colors = [
    "from-violet-500 to-fuchsia-500",
    "from-blue-500 to-cyan-500",
    "from-emerald-500 to-teal-500",
    "from-amber-500 to-orange-500",
  ];

  const handleGenerateRoadmap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim()) {
      toast.error("Please enter a learning goal or skill.");
      return;
    }

    setLoading(true);

    try {
      const res = await authedFetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Design a detailed ${weeksInput}-week learning roadmap curriculum for '${goal}'. Include week-by-week milestones, key concepts, recommended resources, and practical projects.`,
          toolId: "road",
          toolName: "Roadmap Generator",
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to generate AI roadmap.");
      }

      const randomColor = colors[Math.floor(Math.random() * colors.length)];

      const savedId = await saveGeneratedRoadmap(me, {
        title: goal.trim(),
        weeks: weeksInput,
        milestones: weeksInput * 2,
        color: randomColor,
        content: data.text,
      });
      const newRoadmap: RoadmapItem = {
        id: savedId,
        title: goal.trim(),
        weeks: weeksInput,
        progress: 0,
        milestones: weeksInput * 2,
        color: randomColor,
        content: data.text,
      };

      setActiveRoadmap(newRoadmap);
      setShowGenerator(false);
      toast.success(`Generated ${weeksInput}-week roadmap for "${goal}"!`);
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Error generating AI roadmap.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl md:text-4xl tracking-tight font-medium">Roadmaps</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Structured, multi-week plans generated by Gemini AI for any topic.
          </p>
        </div>
        <Button
          onClick={() => setShowGenerator(!showGenerator)}
          className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90"
        >
          <Sparkles className="mr-1.5 h-4 w-4" />
          {showGenerator ? "Close Generator" : "Generate Roadmap"}
        </Button>
      </div>

      {/* Generator Form */}
      {showGenerator && (
        <Card className="mb-8 overflow-hidden rounded-2xl border-primary/30 p-6 shadow-soft bg-gradient-mesh">
          <div className="flex items-center gap-2 mb-4">
            <Badge className="bg-gradient-primary text-primary-foreground border-0">
              AI Generator
            </Badge>
            <h2 className="text-lg font-semibold">Build Custom Curriculum with Gemini</h2>
          </div>

          <form onSubmit={handleGenerateRoadmap} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Learning Goal / Skill / Exam *
                </label>
                <Input aria-label="e.g. Master Machine Learning from scratch, Learn Quantum Computing, IELTS Band 8"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="e.g. Master Machine Learning from scratch, Learn Quantum Computing, IELTS Band 8"
                  required
                  className="rounded-xl bg-background"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Duration (Weeks)
                </label>
                <Input
                  type="number"
                  min={1}
                  max={52}
                  value={weeksInput}
                  onChange={(e) => setWeeksInput(Number(e.target.value))}
                  className="rounded-xl bg-background"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={loading}
                className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating Curriculum...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1.5 h-4 w-4" /> Generate Roadmap
                  </>
                )}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Active Roadmap Viewer */}
      {activeRoadmap && (
        <Card className="mb-8 rounded-2xl border-border p-6 shadow-soft bg-background">
          <div className="flex flex-wrap items-center justify-between border-b border-border pb-4 mb-4 gap-2">
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActiveRoadmap(null)}
                className="h-8 rounded-lg text-xs mb-2"
              >
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back to Roadmaps
              </Button>
              <h2 className="text-2xl font-bold tracking-tight">{activeRoadmap.title}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {activeRoadmap.weeks} Weeks · {activeRoadmap.milestones} Milestones
              </p>
            </div>
            <Badge className="bg-gradient-primary text-primary-foreground border-0">
              <Sparkles className="mr-1 h-3 w-3" /> Gemini Curriculum
            </Badge>
          </div>

          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-semibold">Your progress</span>
              <span className="text-muted-foreground">
                {progressMap[activeRoadmap.id]?.completed.length ?? 0} of {activeRoadmap.milestones} milestones ·{" "}
                {progressMap[activeRoadmap.id]?.progress ?? 0}%
              </span>
            </div>
            <Progress value={progressMap[activeRoadmap.id]?.progress ?? 0} className="h-1.5" />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Array.from({ length: activeRoadmap.milestones }, (_, i) => {
                const done = progressMap[activeRoadmap.id]?.completed.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={togglingMilestone === i}
                    onClick={() => handleToggleMilestone(activeRoadmap, i)}
                    aria-pressed={!!done}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                      done
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background hover:border-primary/50"
                    }`}
                  >
                    {done ? "✓ " : ""}Milestone {i + 1}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="prose prose-sm max-w-none dark:prose-invert text-foreground whitespace-pre-wrap leading-relaxed font-sans bg-secondary/20 p-5 rounded-2xl border border-border/60">
            {activeRoadmap.content}
          </div>
        </Card>
      )}

      {/* Roadmap Cards */}
      {listLoading && (
        <div className="py-8 text-center text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading roadmaps…
        </div>
      )}
      {listError && <div className="py-8 text-center text-destructive">{listError}</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {roadmapList.map((r) => (
          <Card
            key={r.id}
            className="overflow-hidden rounded-2xl border-border p-0 shadow-soft hover:shadow-elegant transition"
          >
            <div className={`flex h-28 items-end bg-gradient-to-br ${r.color} p-4`}>
              <Map className="h-6 w-6 text-white/90" />
            </div>
            <div className="p-5">
              <h3 className="text-lg font-semibold tracking-tight">{r.title}</h3>
              <div className="mt-1 text-xs text-muted-foreground">
                {r.weeks} weeks · {r.milestones} milestones
              </div>
              <div className="mt-3">
                <Progress value={r.progress} className="h-1.5" />
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{r.progress}% complete</span>
                  <Badge variant="secondary" className="rounded-full">
                    {r.progress > 0 ? "In progress" : "New"}
                  </Badge>
                </div>
              </div>
              <Button
                onClick={() => setActiveRoadmap(r)}
                className="mt-4 w-full rounded-xl"
                variant={activeRoadmap?.id === r.id ? "default" : "outline"}
              >
                {activeRoadmap?.id === r.id ? "Viewing Roadmap" : "View Curriculum"}
              </Button>
            </div>
          </Card>
        ))}

        <Card
          onClick={() => setShowGenerator(true)}
          className="grid place-items-center rounded-2xl border-dashed border-border p-5 text-center shadow-soft cursor-pointer hover:border-primary/50 transition"
        >
          <div>
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-accent">
              <Plus className="h-5 w-5" />
            </div>
            <div className="font-semibold">Create custom roadmap</div>
            <div className="mt-1 text-xs text-muted-foreground">
              AI-generated based on your goal.
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
