import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import * as Icons from "lucide-react";
import { aiTools } from "@/lib/ai-tools";
import { useAuth, type GradeLevel } from "@/hooks/use-auth";
import { authedFetch } from "@/services/ai";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/ai")({
  head: () => ({
    meta: [
      { title: "AI Study Assistant — Cortex" },
      {
        name: "description",
        content: "14 AI tools built for real studying with reference material support.",
      },
    ],
  }),
  component: AiPage,
});

interface GenerationItem {
  id: string;
  toolId: string;
  toolName: string;
  prompt: string;
  response: string;
  timestamp: string;
  filesCount?: number;
}

interface AttachedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  data: string;
}

const TOOL_PLACEHOLDERS: Record<string, string> = {
  study: "e.g. Explain semaphores with a real-world analogy, then quiz me on 5 questions.",
  lecture: "e.g. Turn 'Distributed Systems Deadlocks' into a 30-minute structured lecture outline.",
  pdf: "e.g. Summarize the key concepts from my attached Operating Systems notes or PDF.",
  flash: "e.g. Generate 5 spaced-repetition flashcards based on my attached reference materials.",
  mind: "e.g. Outline a concept mind map connecting topics from my attached lecture slides.",
  quiz: "e.g. Create a 5-question multiple choice quiz directly from my attached course materials.",
  weak: "e.g. Analyze my attached study notes and highlight areas I might be struggling with.",
  plan: "e.g. Build a balanced 7-day study schedule for my upcoming exams based on this syllabus.",
  road: "e.g. Design an 8-week learning roadmap to master Full-Stack Web Development.",
  rec: "e.g. I need help with Data Structures in C++. What mentor skills and topics should I look for?",
  hw: "e.g. Give me hints to solve the attached practice problems without giving away the direct answers.",
  code: "e.g. Debug the issue in my attached code snippet and explain why it occurs.",
  mock: "e.g. Conduct a mock interview round based on my attached resume or study sheet.",
  exam: "e.g. Predict high-yield topics and practice questions from my attached course slides.",
};

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function getFileIcon(mimeType: string, fileName: string) {
  if (mimeType.includes("pdf") || fileName.endsWith(".pdf")) {
    return <Icons.FileText className="h-4 w-4 text-red-500" />;
  }
  if (mimeType.startsWith("image/")) {
    return <Icons.Image className="h-4 w-4 text-blue-500" />;
  }
  if (mimeType.startsWith("audio/")) {
    return <Icons.Music className="h-4 w-4 text-purple-500" />;
  }
  if (
    fileName.endsWith(".js") ||
    fileName.endsWith(".ts") ||
    fileName.endsWith(".py") ||
    fileName.endsWith(".java") ||
    fileName.endsWith(".cpp") ||
    fileName.endsWith(".c") ||
    fileName.endsWith(".json")
  ) {
    return <Icons.Code2 className="h-4 w-4 text-emerald-500" />;
  }
  return <Icons.FileCode className="h-4 w-4 text-primary" />;
}

export function AiPage() {
  const { profile, updateProfile } = useAuth();
  const [selectedToolId, setSelectedToolId] = useState<string>("study");
  const [selectedGrade, setSelectedGrade] = useState<GradeLevel>(
    (profile?.gradeLevel as GradeLevel) || "Undergraduate",
  );

  useEffect(() => {
    if (profile?.gradeLevel) {
      setSelectedGrade(profile.gradeLevel as GradeLevel);
    }
  }, [profile?.gradeLevel]);

  const handleGradeChange = (newGrade: GradeLevel) => {
    setSelectedGrade(newGrade);
    updateProfile({ gradeLevel: newGrade });
    toast.success(`AI Response Level set to: ${newGrade}`);
  };

  const [prompt, setPrompt] = useState<string>("");
  const [context, setContext] = useState<string>("");
  const [showContext, setShowContext] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [generations, setGenerations] = useState<GenerationItem[]>([]);
  const [activeTab, setActiveTab] = useState<"current" | "history">("current");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentTool = aiTools.find((t) => t.id === selectedToolId) || aiTools[0];

  const handleFileUpload = (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    fileArray.forEach((file) => {
      const fileNameLower = file.name.toLowerCase();
      const isTextFile =
        file.type.startsWith("text/") ||
        fileNameLower.endsWith(".txt") ||
        fileNameLower.endsWith(".md") ||
        fileNameLower.endsWith(".js") ||
        fileNameLower.endsWith(".ts") ||
        fileNameLower.endsWith(".py") ||
        fileNameLower.endsWith(".java") ||
        fileNameLower.endsWith(".cpp") ||
        fileNameLower.endsWith(".c") ||
        fileNameLower.endsWith(".json") ||
        fileNameLower.endsWith(".csv") ||
        fileNameLower.endsWith(".html") ||
        fileNameLower.endsWith(".css");

      // For binary files (PDFs/Images), enforce 3.5MB limit for Vercel serverless payload capacity
      if (!isTextFile && file.size > 3.5 * 1024 * 1024) {
        toast.error(
          `File "${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)}MB. Max limit for PDFs/Images is 3.5MB on Vercel.`,
        );
        return;
      }

      if (isTextFile && file.size > 10 * 1024 * 1024) {
        toast.error(`Text document "${file.name}" exceeds 10MB limit.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const newFile: AttachedFile = {
          id: Math.random().toString(36).substring(2, 9),
          name: file.name,
          type: isTextFile ? "text/plain" : file.type || "application/octet-stream",
          size: file.size,
          data: result,
        };
        setAttachedFiles((prev) => [...prev, newFile]);
        toast.success(`Attached "${file.name}" as reference material`);
      };

      if (isTextFile) {
        reader.readAsText(file);
      } else {
        reader.readAsDataURL(file);
      }
    });
  };

  const handleRemoveFile = (id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleQuickChip = (chipText: string) => {
    if (chipText === "Summarize attached notes") {
      setSelectedToolId("pdf");
      if (attachedFiles.length > 0) {
        setPrompt(
          "Summarize my attached course notes/PDF and highlight key definitions, takeaways, and core formulas.",
        );
      } else {
        setPrompt("Summarize my study notes and highlight key definitions and takeaways.");
        if (fileInputRef.current) fileInputRef.current.click();
      }
    } else if (chipText === "Make flashcards") {
      setSelectedToolId("flash");
      setPrompt("Generate 5 front-and-back flashcards for my study material.");
    } else if (chipText === "Quiz me") {
      setSelectedToolId("quiz");
      setPrompt(
        "Create a 5-question multiple choice quiz with answer explanations based on my reference material.",
      );
    } else if (chipText === "Plan my week") {
      setSelectedToolId("plan");
      setPrompt("Build a structured weekly study plan for my upcoming exams.");
    } else {
      setPrompt(chipText);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      if (attachedFiles.length > 0) {
        setPrompt(
          "Analyze my attached reference materials and give a comprehensive study summary with key concepts.",
        );
      } else {
        toast.error("Please enter a question or attach reference material for Gemini.");
        return;
      }
    }

    setLoading(true);
    setActiveTab("current");

    try {
      const res = await authedFetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt:
            prompt.trim() ||
            "Analyze attached reference materials and give a detailed study summary.",
          toolId: currentTool.id,
          toolName: currentTool.name,
          gradeLevel: selectedGrade,
          context: context.trim() || undefined,
          files: attachedFiles.map((f) => ({
            name: f.name,
            type: f.type,
            size: f.size,
            data: f.data,
          })),
        }),
      });

      const resText = await res.text();
      let data: { success?: boolean; error?: string; text?: string } = {};
      try {
        data = JSON.parse(resText);
      } catch {
        throw new Error(
          `Server returned non-JSON error (${res.status}). If you attached large files, try attaching a smaller file or text notes.`,
        );
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to generate AI response.");
      }

      const newItem: GenerationItem = {
        id: Date.now().toString(),
        toolId: currentTool.id,
        toolName: currentTool.name,
        prompt: prompt.trim() || "Analyze attached reference materials",
        response: data.text,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        filesCount: attachedFiles.length,
      };

      setGenerations((prev) => [newItem, ...prev]);
      toast.success(`${currentTool.name} response generated!`);
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Error connecting to AI service.");
    } finally {
      setLoading(false);
    }
  };

  const latestGeneration = generations[0];

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-elegant">
            <Icons.Sparkles className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-3xl md:text-4xl tracking-tight font-medium">
              AI Study Assistant
            </h1>
            <p className="text-sm text-muted-foreground">
              Powered by Google Gemini 3.6 Flash · 14 specialized academic tools.
            </p>
          </div>
        </div>

        {generations.length > 0 && (
          <div className="flex rounded-lg border border-border bg-secondary/50 p-1">
            <button
              onClick={() => setActiveTab("current")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                activeTab === "current"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Latest Result
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                activeTab === "history"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Session History ({generations.length})
            </button>
          </div>
        )}
      </div>

      {/* Main Input Card */}
      <Card className="mb-8 overflow-hidden rounded-3xl border-border shadow-soft">
        <div className="bg-gradient-mesh p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="secondary"
                className="rounded-full bg-background/80 backdrop-blur font-medium"
              >
                Tool: <span className="text-foreground font-semibold ml-1">{currentTool.name}</span>
              </Badge>

              {/* Grade Level Selector Dropdown */}
              <div className="flex items-center gap-1.5 bg-background/90 rounded-full px-3 py-1 border border-border shadow-xs">
                <Icons.GraduationCap className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs text-muted-foreground font-medium hidden sm:inline">
                  Academic Level:
                </span>
                <Select
                  value={selectedGrade}
                  onValueChange={(val) => handleGradeChange(val as GradeLevel)}
                >
                  <SelectTrigger className="h-6 border-0 bg-transparent px-1 py-0 text-xs font-semibold focus:ring-0 text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Matric">Matric (High School 8th-10th)</SelectItem>
                    <SelectItem value="Intermediate">Intermediate (FSc / A-Levels)</SelectItem>
                    <SelectItem value="Undergraduate">Undergraduate (Bachelor's)</SelectItem>
                    <SelectItem value="Graduate">Graduate (Master's)</SelectItem>
                    <SelectItem value="Mphil">Mphil (Post-Graduate)</SelectItem>
                    <SelectItem value="Phd">Phd (Doctoral / Research)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowContext(!showContext)}
              className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
            >
              <Icons.Paperclip className="h-3.5 w-3.5" />
              {showContext ? "Hide study material input" : "+ Add study material / notes context"}
            </button>
          </div>

          {showContext && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Paste study notes, lecture transcript, or context text here (optional):
              </label>
              <Textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Paste your course notes or material here to ground the AI's response..."
                className="min-h-20 rounded-xl border-border bg-background/90 text-sm shadow-xs"
              />
            </div>
          )}

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleFileUpload(e.dataTransfer.files);
              }
            }}
            className={`relative rounded-2xl transition-all ${
              isDragging ? "ring-2 ring-primary ring-offset-2 bg-primary/5" : ""
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              multiple
              accept=".pdf,image/*,audio/*,.txt,.md,.docx,.doc,.csv,.json,.js,.ts,.py,.java,.cpp,.c"
              onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
              className="hidden"
            />

            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                TOOL_PLACEHOLDERS[currentTool.id] || "Ask anything or specify your learning goal..."
              }
              className="min-h-28 rounded-2xl border-border bg-background/90 text-base shadow-soft backdrop-blur focus-visible:ring-primary"
            />
          </div>

          {/* Attached Files List */}
          {attachedFiles.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                <span className="flex items-center gap-1.5 text-foreground font-semibold">
                  <Icons.FileCheck className="h-3.5 w-3.5 text-primary" />
                  Attached Reference Materials ({attachedFiles.length})
                </span>
                <button
                  type="button"
                  onClick={() => setAttachedFiles([])}
                  className="text-muted-foreground hover:text-destructive hover:underline text-xs"
                >
                  Clear all
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {attachedFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-2 rounded-xl border border-border bg-background/95 px-3 py-1.5 text-xs shadow-xs"
                  >
                    {getFileIcon(file.type, file.name)}
                    <span
                      className="max-w-[180px] truncate font-medium text-foreground"
                      title={file.name}
                    >
                      {file.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({formatFileSize(file.size)})
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFile(file.id)}
                      className="ml-1 rounded-full p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      title="Remove file"
                    >
                      <Icons.X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-full bg-background/80 backdrop-blur text-xs hover:bg-background border-dashed border-primary/40 font-medium"
              >
                <Icons.Upload className="mr-1.5 h-3.5 w-3.5 text-primary" />
                Attach PDFs / Notes / Images
              </Button>

              <div className="h-4 w-px bg-border/60 hidden sm:block" />

              {["Summarize attached notes", "Make flashcards", "Quiz me", "Plan my week"].map(
                (c) => (
                  <Button
                    key={c}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleQuickChip(c)}
                    className="rounded-full bg-background/70 backdrop-blur text-xs hover:bg-background"
                  >
                    {c}
                  </Button>
                ),
              )}
            </div>

            <Button
              onClick={handleGenerate}
              disabled={loading}
              className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90 px-5"
            >
              {loading ? (
                <>
                  <Icons.Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Icons.Sparkles className="mr-2 h-4 w-4" />
                  Generate with Gemini
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>

      {/* Results View */}
      {activeTab === "current" && latestGeneration && (
        <Card className="mb-8 rounded-2xl border-border p-6 shadow-soft bg-background">
          <div className="flex items-center justify-between border-b border-border pb-4 mb-4">
            <div className="flex items-center gap-2">
              <Badge className="bg-gradient-primary text-primary-foreground border-0">
                {latestGeneration.toolName}
              </Badge>
              {Boolean(latestGeneration.filesCount) && latestGeneration.filesCount! > 0 && (
                <Badge
                  variant="secondary"
                  className="text-xs gap-1 bg-primary/10 text-primary border-primary/20"
                >
                  <Icons.Paperclip className="h-3 w-3" />
                  {latestGeneration.filesCount} file{latestGeneration.filesCount! > 1 ? "s" : ""}{" "}
                  referenced
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">{latestGeneration.timestamp}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(latestGeneration.response)}
                className="rounded-lg h-8 text-xs"
              >
                <Icons.Copy className="mr-1.5 h-3.5 w-3.5" />
                Copy
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerate}
                disabled={loading}
                className="rounded-lg h-8 text-xs"
              >
                <Icons.RotateCw className="mr-1.5 h-3.5 w-3.5" />
                Regenerate
              </Button>
            </div>
          </div>

          <div className="mb-3 rounded-lg bg-secondary/50 p-3 text-xs font-medium text-foreground">
            <span className="text-muted-foreground">Prompt: </span>
            {latestGeneration.prompt}
          </div>

          <div className="prose prose-sm max-w-none dark:prose-invert text-foreground whitespace-pre-wrap leading-relaxed font-sans border-t border-border/40 pt-4">
            {latestGeneration.response}
          </div>
        </Card>
      )}

      {/* History View */}
      {activeTab === "history" && (
        <div className="mb-8 space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Session History</h2>
          {generations.map((gen) => (
            <Card key={gen.id} className="rounded-2xl border-border p-5 shadow-soft">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{gen.toolName}</Badge>
                  <span className="text-xs text-muted-foreground">{gen.timestamp}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(gen.response)}
                  className="h-7 text-xs"
                >
                  <Icons.Copy className="h-3.5 w-3.5 mr-1" /> Copy
                </Button>
              </div>
              <p className="text-xs font-semibold text-foreground mb-2">Q: {gen.prompt}</p>
              <div className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6 bg-secondary/30 p-3 rounded-xl border border-border/50">
                {gen.response}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Tool Cards Grid */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          All AI Study Tools ({aiTools.length})
        </h2>
        <span className="text-xs text-muted-foreground">Click a tool to switch mode</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {aiTools.map((t) => {
          const Icon =
            (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
              t.icon
            ] ?? Icons.Sparkles;
          const isSelected = t.id === selectedToolId;

          return (
            <Card
              key={t.id}
              onClick={() => {
                setSelectedToolId(t.id);
                toast.info(`Switched to ${t.name}`);
              }}
              className={`group cursor-pointer rounded-2xl border p-5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-elegant ${
                isSelected
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div
                  className={`grid h-10 w-10 place-items-center rounded-xl transition ${
                    isSelected
                      ? "bg-gradient-primary text-primary-foreground"
                      : "bg-accent text-accent-foreground group-hover:bg-gradient-primary group-hover:text-primary-foreground"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                {isSelected && (
                  <Badge className="bg-primary text-primary-foreground text-xs">Active</Badge>
                )}
              </div>
              <div className="text-sm font-semibold tracking-tight">{t.name}</div>
              <div className="mt-1 text-xs text-muted-foreground leading-snug">{t.desc}</div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
