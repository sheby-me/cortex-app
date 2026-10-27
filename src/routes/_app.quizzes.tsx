import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Sparkles,
  Play,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  Loader2,
  RotateCcw,
  Trophy,
  HelpCircle,
  Check,
  X,
} from "lucide-react";
import { authedFetch } from "@/services/ai";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  recordQuizAttempt,
  saveGeneratedQuiz,
  subscribeQuizProgress,
  subscribeQuizzes,
  type CatalogQuiz,
  type QuizProgress,
} from "@/services/progress";
import { evaluateAchievements } from "@/services/gamification";
import { errorMessage } from "@/services/common";
import type { UserDoc } from "@/services/users";

export const Route = createFileRoute("/_app/quizzes")({
  head: () => ({
    meta: [
      { title: "Quizzes — Cortex" },
      {
        name: "description",
        content: "Adaptive AI-generated interactive quizzes for every subject.",
      },
    ],
  }),
  component: QuizPage,
});

export interface QuizQuestion {
  id: number;
  question: string;
  options: { key: "A" | "B" | "C" | "D"; text: string }[];
  correctAnswer: "A" | "B" | "C" | "D";
  explanation: string;
}

interface QuizItem {
  id: string;
  title: string;
  subject: string;
  questionsCount: number;
  difficulty: string;
  ai: boolean;
  rawContent?: string;
  parsedQuestions: QuizQuestion[];
}

function generateDefaultQuestionsForTopic(title: string, subject: string): QuizQuestion[] {
  if (title.includes("Deadlock") || subject.includes("Operating")) {
    return [
      {
        id: 1,
        question:
          "Which of the following is NOT one of Coffman's four necessary conditions for a deadlock?",
        options: [
          { key: "A", text: "Mutual Exclusion" },
          { key: "B", text: "Hold and Wait" },
          { key: "C", text: "Preemption Allowed" },
          { key: "D", text: "Circular Wait" },
        ],
        correctAnswer: "C",
        explanation:
          "No Preemption (not preemption allowed) is a Coffman condition. If preemption is allowed, deadlocks can be broken.",
      },
      {
        id: 2,
        question: "The Banker's Algorithm is primarily used for which strategy?",
        options: [
          { key: "A", text: "Deadlock Detection" },
          { key: "B", text: "Deadlock Avoidance" },
          { key: "C", text: "Deadlock Recovery" },
          { key: "D", text: "Mutual Exclusion" },
        ],
        correctAnswer: "B",
        explanation:
          "Banker's Algorithm simulates resource allocation to ensure the system stays in a safe state, avoiding deadlocks.",
      },
      {
        id: 3,
        question:
          "In semaphores, what does the wait() or P() operation do when semaphore value S <= 0?",
        options: [
          { key: "A", text: "Increments S by 1" },
          { key: "B", text: "Blocks the calling process" },
          { key: "C", text: "Terminates the calling process" },
          { key: "D", text: "Signals all waiting threads" },
        ],
        correctAnswer: "B",
        explanation:
          "When S <= 0, the P() operation decrements S and blocks the thread until another thread calls signal() / V().",
      },
      {
        id: 4,
        question: "What is a major drawback of strict priority scheduling regarding semaphores?",
        options: [
          { key: "A", text: "Cache invalidation" },
          { key: "B", text: "Priority Inversion" },
          { key: "C", text: "Double free error" },
          { key: "D", text: "High stack usage" },
        ],
        correctAnswer: "B",
        explanation:
          "Priority inversion occurs when a low-priority process holding a lock blocks a high-priority process.",
      },
      {
        id: 5,
        question: "In a Resource Allocation Graph (RAG), a cycle guarantees a deadlock if:",
        options: [
          { key: "A", text: "Each resource type has only one single instance" },
          { key: "B", text: "Each resource has multiple instances" },
          { key: "C", text: "All processes are running concurrently" },
          { key: "D", text: "Semaphores are initialized to 1" },
        ],
        correctAnswer: "A",
        explanation:
          "If every resource type has exactly 1 instance, a cycle in the RAG is necessary and sufficient for a deadlock.",
      },
    ];
  }

  if (title.includes("Big-O") || subject.includes("Algorithms")) {
    return [
      {
        id: 1,
        question: "What is the average-case time complexity of Quick Sort?",
        options: [
          { key: "A", text: "O(n)" },
          { key: "B", text: "O(n log n)" },
          { key: "C", text: "O(n²)" },
          { key: "D", text: "O(log n)" },
        ],
        correctAnswer: "B",
        explanation:
          "QuickSort averages O(n log n) comparisons, although worst-case is O(n²) if pivots are poorly chosen.",
      },
      {
        id: 2,
        question: "Which data structure provides O(1) average time complexity for key lookup?",
        options: [
          { key: "A", text: "Binary Search Tree" },
          { key: "B", text: "Hash Table" },
          { key: "C", text: "Sorted Array" },
          { key: "D", text: "Linked List" },
        ],
        correctAnswer: "B",
        explanation:
          "Hash tables use hash functions to map keys directly to buckets, yielding O(1) average lookup.",
      },
      {
        id: 3,
        question:
          "What is the tight worst-case time complexity of Binary Search on a sorted array of size n?",
        options: [
          { key: "A", text: "O(1)" },
          { key: "B", text: "O(log n)" },
          { key: "C", text: "O(n)" },
          { key: "D", text: "O(n log n)" },
        ],
        correctAnswer: "B",
        explanation:
          "Binary Search halves the search space each step, completing in O(log n) time.",
      },
      {
        id: 4,
        question:
          "Space complexity of a recursive depth-first search (DFS) on a tree of height h is:",
        options: [
          { key: "A", text: "O(1)" },
          { key: "B", text: "O(h)" },
          { key: "C", text: "O(n²)" },
          { key: "D", text: "O(2ⁿ)" },
        ],
        correctAnswer: "B",
        explanation: "The call stack grows proportionally to the max height h of the tree.",
      },
      {
        id: 5,
        question: "Which growth rate dominates all others as n becomes very large?",
        options: [
          { key: "A", text: "O(n¹⁰)" },
          { key: "B", text: "O(2ⁿ)" },
          { key: "C", text: "O(n log n)" },
          { key: "D", text: "O(n!)" },
        ],
        correctAnswer: "D",
        explanation:
          "Factorial growth O(n!) grows faster than polynomial or exponential O(2ⁿ) functions for large n.",
      },
    ];
  }

  // Default general fallback set
  return [
    {
      id: 1,
      question: `What is a fundamental concept in ${title}?`,
      options: [
        { key: "A", text: "Primary abstraction and core principles" },
        { key: "B", text: "Arbitrary manual override" },
        { key: "C", text: "Deprecation of all dynamic states" },
        { key: "D", text: "Unbounded linear recursion" },
      ],
      correctAnswer: "A",
      explanation:
        "Primary abstraction provides structural consistency and efficiency in this field.",
    },
    {
      id: 2,
      question: "Which approach optimizes performance when evaluating complex problem states?",
      options: [
        { key: "A", text: "Brute force iterations without memoization" },
        { key: "B", text: "Divide and conquer or dynamic programming" },
        { key: "C", text: "Ignoring edge cases" },
        { key: "D", text: "Randomized memory dumps" },
      ],
      correctAnswer: "B",
      explanation:
        "Dividing problems into smaller subproblems or caching subsolutions drastically lowers time complexity.",
    },
    {
      id: 3,
      question: "In rigorous academic testing, why is active recall emphasized?",
      options: [
        { key: "A", text: "It strengthens neural retrieval pathways" },
        { key: "B", text: "It replaces all conceptual understanding" },
        { key: "C", text: "It requires zero study time" },
        { key: "D", text: "It only works for multiple choice" },
      ],
      correctAnswer: "A",
      explanation:
        "Active recall forces the brain to retrieve information, building stronger long-term retention.",
    },
    {
      id: 4,
      question: "What is the primary benefit of modular problem decomposition?",
      options: [
        { key: "A", text: "Tighter coupling" },
        { key: "B", text: "Isolation of responsibilities and easier testing" },
        { key: "C", text: "Increased code complexity" },
        { key: "D", text: "Disabling error propagation" },
      ],
      correctAnswer: "B",
      explanation:
        "Decomposition breaks monolithic challenges into manageable, testable components.",
    },
    {
      id: 5,
      question: "When reviewing incorrect quiz options, what strategy is recommended?",
      options: [
        { key: "A", text: "Skip explanations and move on" },
        {
          key: "B",
          text: "Analyze why the chosen answer was wrong and review the correct rationale",
        },
        { key: "C", text: "Memorize question positions" },
        { key: "D", text: "Disable score tracking" },
      ],
      correctAnswer: "B",
      explanation:
        "Targeted error analysis targets blind spots and converts mistakes into lasting knowledge.",
    },
  ];
}

function parseAIQuizText(text: string): QuizQuestion[] {
  // 1. Try parsing JSON code block or direct JSON string
  try {
    let jsonStr = text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (jsonMatch && jsonMatch[1]) {
      jsonStr = jsonMatch[1];
    }
    const rawArr = JSON.parse(jsonStr.trim());
    if (Array.isArray(rawArr) && rawArr.length > 0) {
      return rawArr.map((item, idx) => {
        let opts: { key: "A" | "B" | "C" | "D"; text: string }[] = [];
        if (Array.isArray(item.options)) {
          const keys: ("A" | "B" | "C" | "D")[] = ["A", "B", "C", "D"];
          opts = item.options.slice(0, 4).map((optStr: string, oIdx: number) => {
            const cleanOpt = optStr.replace(/^[A-D]\)\s*/i, "").trim();
            return { key: keys[oIdx] || "A", text: cleanOpt };
          });
        }
        return {
          id: idx + 1,
          question: item.question || `Question ${idx + 1}`,
          options:
            opts.length === 4
              ? opts
              : [
                  { key: "A", text: "Option A" },
                  { key: "B", text: "Option B" },
                  { key: "C", text: "Option C" },
                  { key: "D", text: "Option D" },
                ],
          correctAnswer: (item.correctAnswer || item.answer || "A")
            .toString()
            .trim()
            .toUpperCase()
            .charAt(0) as "A" | "B" | "C" | "D",
          explanation: item.explanation || "No explanation provided.",
        };
      });
    }
  } catch {
    // Continue to regex fallback parser
  }

  // 2. Fallback Regex Parsing
  const questions: QuizQuestion[] = [];
  const blocks = text.split(/(?:Question|\d+\.)/i).filter((b) => b.trim().length > 10);

  blocks.forEach((block, idx) => {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 3) return;

    const qText = lines[0].replace(/^[:\d.\s]+/, "");
    const optA = lines.find((l) => /^A[).]/i.test(l))?.replace(/^A[).]\s*/i, "") || "Option A";
    const optB = lines.find((l) => /^B[).]/i.test(l))?.replace(/^B[).]\s*/i, "") || "Option B";
    const optC = lines.find((l) => /^C[).]/i.test(l))?.replace(/^C[).]\s*/i, "") || "Option C";
    const optD = lines.find((l) => /^D[).]/i.test(l))?.replace(/^D[).]\s*/i, "") || "Option D";

    const ansLine = lines.find((l) => /Correct Answer|Answer:/i.test(l)) || "";
    let ansKey: "A" | "B" | "C" | "D" = "A";
    if (/B/i.test(ansLine)) ansKey = "B";
    else if (/C/i.test(ansLine)) ansKey = "C";
    else if (/D/i.test(ansLine)) ansKey = "D";

    const expLine =
      lines.find((l) => /Explanation:/i.test(l))?.replace(/Explanation:\s*/i, "") ||
      "Review this topic for deeper understanding.";

    questions.push({
      id: idx + 1,
      question: qText || `Question ${idx + 1}`,
      options: [
        { key: "A", text: optA },
        { key: "B", text: optB },
        { key: "C", text: optC },
        { key: "D", text: optD },
      ],
      correctAnswer: ansKey,
      explanation: expLine,
    });
  });

  return questions.length > 0 ? questions : generateDefaultQuestionsForTopic("AI Topic", "Science");
}

export function QuizPage() {
  const { user, profile } = useAuth();
  const me = user?.uid ?? "";

  // Catalog quizzes (Firestore `quizzes`) + this user's saved AI quizzes (`users/{uid}/quizzes`)
  const [catalog, setCatalog] = useState<CatalogQuiz[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, QuizProgress>>({});

  useEffect(() => {
    if (!me) return;
    const unsubs = [
      subscribeQuizzes(
        me,
        (list) => {
          setCatalog(list);
          setCatalogLoading(false);
        },
        (e) => {
          setCatalogLoading(false);
          setCatalogError(errorMessage(e, "Couldn't load quizzes."));
        },
      ),
      subscribeQuizProgress(me, setProgress),
    ];
    return () => unsubs.forEach((u) => u());
  }, [me]);

  const quizList: QuizItem[] = useMemo(
    () =>
      catalog.map((q) => ({
        id: q.id,
        title: q.title,
        subject: q.subject,
        questionsCount: q.parsedQuestions?.length || q.questions || 5,
        difficulty: q.difficulty,
        ai: q.ai,
        rawContent: q.rawContent,
        // built-in quizzes generate their question bank locally from the title/subject; saved AI quizzes carry their own
        parsedQuestions: (q.parsedQuestions as QuizQuestion[] | undefined)?.length
          ? (q.parsedQuestions as QuizQuestion[])
          : generateDefaultQuestionsForTopic(q.title, q.subject),
      })),
    [catalog],
  );

  const [activeQuiz, setActiveQuiz] = useState<QuizItem | null>(null);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState<number>(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, "A" | "B" | "C" | "D">>({});
  const [quizCompleted, setQuizCompleted] = useState<boolean>(false);

  const [showGenerator, setShowGenerator] = useState<boolean>(false);
  const [topic, setTopic] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [difficulty, setDifficulty] = useState<string>("Medium");
  const [loading, setLoading] = useState<boolean>(false);

  const handleStartQuiz = (q: QuizItem) => {
    setActiveQuiz(q);
    setCurrentQuestionIdx(0);
    setUserAnswers({});
    setQuizCompleted(false);
  };

  const handleSelectOption = (questionId: number, selectedKey: "A" | "B" | "C" | "D") => {
    // Only allow selecting once per question so answer feedback stays clear
    if (userAnswers[questionId]) return;

    setUserAnswers((prev) => ({
      ...prev,
      [questionId]: selectedKey,
    }));
  };

  const handleGenerateQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) {
      toast.error("Please enter a topic for the quiz.");
      return;
    }

    setLoading(true);

    try {
      const res = await authedFetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Create a 5-question multiple choice quiz on '${topic}' in subject '${
            subject || "General Study"
          }' with difficulty '${difficulty}'.`,
          toolId: "quiz",
          toolName: "Quiz Generator",
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to generate AI quiz.");
      }

      const questions = parseAIQuizText(data.text);

      // Persist so the quiz (and the user's progress on it) survives reloads and devices
      const savedId = await saveGeneratedQuiz(me, {
        title: topic.trim(),
        subject: subject.trim() || "AI Generated",
        difficulty,
        parsedQuestions: questions,
        rawContent: data.text,
      });
      const newQuiz: QuizItem = {
        id: savedId,
        title: topic.trim(),
        subject: subject.trim() || "AI Generated",
        questionsCount: questions.length,
        difficulty,
        ai: true,
        rawContent: data.text,
        parsedQuestions: questions,
      };

      handleStartQuiz(newQuiz);
      setShowGenerator(false);
      toast.success(`Generated 5-question quiz for "${topic}"!`);
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Error creating AI quiz.");
    } finally {
      setLoading(false);
    }
  };

  const currentQuestion = activeQuiz?.parsedQuestions[currentQuestionIdx];
  const totalQuestions = activeQuiz?.parsedQuestions.length || 0;
  const selectedAnswer = currentQuestion ? userAnswers[currentQuestion.id] : undefined;

  const calculateScore = () => {
    if (!activeQuiz) return 0;
    let correctCount = 0;
    activeQuiz.parsedQuestions.forEach((q) => {
      if (userAnswers[q.id] === q.correctAnswer) {
        correctCount += 1;
      }
    });
    return correctCount;
  };

  /** Finish: show the summary immediately and record the attempt (attempts, best score, perfect-score count). */
  const handleFinishQuiz = async () => {
    setQuizCompleted(true);
    if (!activeQuiz || !me) return;
    const score = calculateScore();
    try {
      const result = await recordQuizAttempt(me, activeQuiz, score, activeQuiz.parsedQuestions.length);
      if (result.perfect) {
        const unlocked = await evaluateAchievements({ ...(profile as unknown as UserDoc), uid: me });
        unlocked.forEach((a) => toast.success(`Achievement unlocked: ${a.name}`));
      }
    } catch (err) {
      toast.error(errorMessage(err, "Your score couldn't be saved."));
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl md:text-4xl tracking-tight font-medium">
            Interactive Quizzes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Test yourself with instant option checking, right/wrong feedback, and AI quiz
            generation.
          </p>
        </div>
        <Button
          onClick={() => setShowGenerator(!showGenerator)}
          className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90"
        >
          <Sparkles className="mr-1.5 h-4 w-4" />
          {showGenerator ? "Close Generator" : "Generate AI Quiz"}
        </Button>
      </div>

      {/* AI Quiz Generator Panel */}
      {showGenerator && (
        <Card className="mb-8 overflow-hidden rounded-2xl border-primary/30 p-6 shadow-soft bg-gradient-mesh">
          <div className="flex items-center gap-2 mb-4">
            <Badge className="bg-gradient-primary text-primary-foreground border-0">
              AI Generator
            </Badge>
            <h2 className="text-lg font-semibold">Generate Interactive Quiz with Gemini</h2>
          </div>

          <form onSubmit={handleGenerateQuiz} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Topic / Subtopic *
                </label>
                <Input aria-label="e.g. Binary Search Trees, Cell Biology, World War II"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. Binary Search Trees, Cell Biology, World War II"
                  required
                  className="rounded-xl bg-background"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Subject Name
                </label>
                <Input aria-label="e.g. Computer Science"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Computer Science"
                  className="rounded-xl bg-background"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Difficulty:</span>
                {["Easy", "Medium", "Hard"].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDifficulty(d)}
                    className={`rounded-full px-3 py-1 text-xs font-medium border transition ${
                      difficulty === d
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1.5 h-4 w-4" /> Build Interactive Quiz
                  </>
                )}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Active Interactive Quiz Mode */}
      {activeQuiz && (
        <Card className="mb-8 rounded-2xl border-border p-6 shadow-soft bg-background">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 mb-6">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActiveQuiz(null)}
                className="h-8 rounded-lg text-xs"
              >
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back to List
              </Button>
              <Badge variant="secondary">{activeQuiz.subject}</Badge>
              {activeQuiz.ai && (
                <Badge className="bg-gradient-primary text-primary-foreground border-0">
                  <Sparkles className="mr-1 h-3 w-3" /> AI Generated
                </Badge>
              )}
            </div>
            <div className="text-sm font-semibold text-muted-foreground">
              {activeQuiz.title} ({activeQuiz.difficulty})
            </div>
          </div>

          {!quizCompleted && currentQuestion ? (
            <div>
              {/* Progress indicator */}
              <div className="mb-6">
                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground mb-2">
                  <span>
                    Question {currentQuestionIdx + 1} of {totalQuestions}
                  </span>
                  <span>
                    {Math.round(((currentQuestionIdx + 1) / totalQuestions) * 100)}% Completed
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-gradient-primary transition-all duration-300"
                    style={{ width: `${((currentQuestionIdx + 1) / totalQuestions) * 100}%` }}
                  />
                </div>
              </div>

              {/* Question Text */}
              <div className="mb-6 bg-secondary/30 p-5 rounded-2xl border border-border">
                <h2 className="text-lg md:text-xl font-semibold tracking-tight leading-snug">
                  {currentQuestion.id}. {currentQuestion.question}
                </h2>
              </div>

              {/* Options Grid */}
              <div className="grid gap-3 mb-6">
                {currentQuestion.options.map((opt) => {
                  const isSelected = selectedAnswer === opt.key;
                  const isCorrectKey = opt.key === currentQuestion.correctAnswer;
                  const isAnswered = selectedAnswer !== undefined;

                  let buttonStyle =
                    "bg-background border-border hover:bg-secondary/50 text-foreground";
                  let icon = null;

                  if (isAnswered) {
                    if (isCorrectKey) {
                      buttonStyle =
                        "bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-emerald-300 font-medium";
                      icon = (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      );
                    } else if (isSelected && !isCorrectKey) {
                      buttonStyle =
                        "bg-destructive/10 border-destructive text-destructive font-medium";
                      icon = <XCircle className="h-5 w-5 text-destructive shrink-0" />;
                    } else {
                      buttonStyle =
                        "bg-background/50 border-border/50 text-muted-foreground opacity-60";
                    }
                  }

                  return (
                    <button
                      key={opt.key}
                      onClick={() => handleSelectOption(currentQuestion.id, opt.key)}
                      disabled={isAnswered}
                      className={`w-full flex items-center justify-between p-4 rounded-xl border text-left transition-all duration-200 ${buttonStyle}`}
                    >
                      <div className="flex items-center gap-3 pr-2">
                        <span
                          className={`grid h-7 w-7 place-items-center rounded-lg text-xs font-bold shrink-0 ${
                            isAnswered && isCorrectKey
                              ? "bg-emerald-600 text-white"
                              : isAnswered && isSelected && !isCorrectKey
                                ? "bg-destructive text-white"
                                : "bg-secondary text-foreground"
                          }`}
                        >
                          {opt.key}
                        </span>
                        <span className="text-sm font-medium leading-relaxed">{opt.text}</span>
                      </div>
                      {icon}
                    </button>
                  );
                })}
              </div>

              {/* Immediate Right/Wrong Answer Feedback */}
              {selectedAnswer && (
                <div
                  className={`p-4 rounded-xl border mb-6 animate-in fade-in-50 duration-300 ${
                    selectedAnswer === currentQuestion.correctAnswer
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-100"
                      : "bg-destructive/10 border-destructive/30 text-destructive-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-sm mb-1">
                    {selectedAnswer === currentQuestion.correctAnswer ? (
                      <>
                        <Check className="h-4 w-4 text-emerald-600" />
                        <span className="text-emerald-600 dark:text-emerald-400">
                          Correct Answer!
                        </span>
                      </>
                    ) : (
                      <>
                        <X className="h-4 w-4 text-destructive" />
                        <span className="text-destructive">
                          Incorrect. Correct Option is ({currentQuestion.correctAnswer})
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {currentQuestion.explanation}
                  </p>
                </div>
              )}

              {/* Navigation buttons */}
              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="ghost"
                  disabled={currentQuestionIdx === 0}
                  onClick={() => setCurrentQuestionIdx((prev) => Math.max(0, prev - 1))}
                  className="rounded-xl"
                >
                  Previous
                </Button>

                {currentQuestionIdx < totalQuestions - 1 ? (
                  <Button
                    onClick={() => setCurrentQuestionIdx((prev) => prev + 1)}
                    disabled={!selectedAnswer}
                    className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90"
                  >
                    Next Question
                  </Button>
                ) : (
                  <Button
                    onClick={handleFinishQuiz}
                    disabled={!selectedAnswer}
                    className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90"
                  >
                    Finish Quiz
                  </Button>
                )}
              </div>
            </div>
          ) : (
            /* Quiz Completed Summary View */
            <div className="py-6 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary mb-4">
                <Trophy className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Quiz Completed!</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                You scored <span className="font-bold text-foreground">{calculateScore()}</span> out
                of <span className="font-bold text-foreground">{totalQuestions}</span> (
                {Math.round((calculateScore() / totalQuestions) * 100)}%)
              </p>

              <div className="my-6 max-w-md mx-auto space-y-2 text-left">
                {activeQuiz.parsedQuestions.map((q) => {
                  const userAns = userAnswers[q.id];
                  const isRight = userAns === q.correctAnswer;
                  return (
                    <div
                      key={q.id}
                      className="flex items-center justify-between p-3 rounded-xl border border-border bg-secondary/20 text-xs"
                    >
                      <span className="truncate pr-2 font-medium">
                        Q{q.id}: {q.question}
                      </span>
                      {isRight ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 shrink-0">
                          Correct ({userAns})
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="shrink-0">
                          Wrong ({userAns || "None"} → {q.correctAnswer})
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-center gap-3">
                <Button
                  onClick={() => {
                    setUserAnswers({});
                    setCurrentQuestionIdx(0);
                    setQuizCompleted(false);
                  }}
                  variant="outline"
                  className="rounded-xl"
                >
                  <RotateCcw className="mr-1.5 h-4 w-4" /> Retake Quiz
                </Button>
                <Button
                  onClick={() => setActiveQuiz(null)}
                  className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant"
                >
                  Explore Other Quizzes
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Quiz Grid */}
      {catalogLoading && (
        <div className="py-12 text-center text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading quizzes…
        </div>
      )}
      {catalogError && <div className="py-12 text-center text-destructive">{catalogError}</div>}
      {!catalogLoading && !catalogError && quizList.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          No quizzes yet — be the first to create one! Use “Generate with AI” to make a quiz on any topic.
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {quizList.map((q) => (
          <Card
            key={q.id}
            className="rounded-2xl border-border p-5 shadow-soft hover:shadow-elegant transition flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between">
                <Badge variant="secondary" className="rounded-full">
                  {q.subject}
                </Badge>
                {q.ai && (
                  <Badge className="rounded-full border-0 bg-gradient-primary text-primary-foreground">
                    <Sparkles className="mr-1 h-3 w-3" />
                    AI
                  </Badge>
                )}
              </div>
              <h3 className="mt-3 text-lg font-semibold tracking-tight">{q.title}</h3>
              <div className="mt-1 text-sm text-muted-foreground flex items-center gap-2">
                <HelpCircle className="h-3.5 w-3.5 text-primary" />
                {q.questionsCount} questions · {q.difficulty}
              </div>
              {progress[q.id] && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Best {progress[q.id].bestPercent}% · {progress[q.id].attempts} attempt
                  {progress[q.id].attempts === 1 ? "" : "s"}
                </div>
              )}
            </div>

            <Button
              onClick={() => handleStartQuiz(q)}
              className="mt-6 w-full rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90"
            >
              <Play className="mr-1.5 h-4 w-4" />
              {activeQuiz?.id === q.id ? "Resume Quiz" : "Start Interactive Quiz"}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
