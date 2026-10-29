import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { OUT_OF_SCOPE_REPLY, SUGGESTED_QUESTIONS, isAboutCortex, searchGuide, type GuideEntry } from "@/lib/app-guide";
import { authedFetch } from "@/services/ai";

interface Turn {
  q: string;
  a: string;
  links: GuideEntry[];
  pending?: boolean;
}

/**
 * Global "Ask AI" help: answers questions about USING Cortex only (not a general chatbot).
 * Flow: off-topic questions are refused instantly in the browser → on-topic ones go to the scoped endpoint
 * (toolId "cortex-help") → if the AI is unreachable the answer comes from the built-in guide, so help always works.
 */
export function CortexHelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setText("");
    const links = searchGuide(q, 2).filter((g) => g.route);

    if (!isAboutCortex(q)) {
      setTurns((t) => [...t, { q, a: OUT_OF_SCOPE_REPLY, links: [] }]);
      return;
    }
    setBusy(true);
    setTurns((t) => [...t, { q, a: "", links, pending: true }]);
    let answer = "";
    try {
      const res = await authedFetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: q, toolId: "cortex-help" }),
      });
      const data = (await res.json()) as { success?: boolean; text?: string };
      if (data.success && data.text) answer = data.text;
    } catch (err) {
      console.error("[Cortex] help request failed", err);
    }
    if (!answer) {
      // Offline / AI unavailable → answer straight from the built-in guide
      const best = searchGuide(q, 1)[0];
      answer = best
        ? `${best.title}\n\n${best.answer}`
        : "I couldn't find that in the Cortex guide. Try rephrasing, or look in Settings and the left-hand menu.";
    }
    setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: answer, pending: false } : x)));
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" /> Cortex Help
          </DialogTitle>
          <DialogDescription>
            Ask how to do anything in Cortex — for example changing your username or sending a buddy request.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[8rem] flex-1 space-y-4 overflow-y-auto pr-1" aria-live="polite">
          {turns.length === 0 && (
            <div>
              <p className="mb-2 text-sm text-muted-foreground">Try one of these:</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED_QUESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="rounded-full border border-border bg-secondary px-3 py-1.5 text-left text-sm transition hover:border-primary/50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className="space-y-2">
              <div className="ml-8 rounded-2xl bg-primary px-3.5 py-2 text-sm text-primary-foreground">{t.q}</div>
              <div className="mr-8 rounded-2xl border border-border bg-card px-3.5 py-2.5 text-sm">
                {t.pending ? (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Looking that up…
                  </span>
                ) : (
                  <>
                    <p className="whitespace-pre-line leading-relaxed">{t.a}</p>
                    {t.links.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {t.links.map((g) => (
                          <Button key={g.id} asChild size="sm" variant="outline" className="h-8 rounded-full text-xs" onClick={() => onOpenChange(false)}>
                            <Link to={g.route as never}>{g.routeLabel ?? "Open"}</Link>
                          </Button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(text);
          }}
          className="flex items-center gap-2"
        >
          <Input
            aria-label="Ask a question about using Cortex"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
            placeholder="e.g. How do I change my username?"
            className="rounded-xl"
            autoFocus
          />
          <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label="Send question" className="rounded-xl">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
