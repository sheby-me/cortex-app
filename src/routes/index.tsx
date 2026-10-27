import { createFileRoute, Link } from "@tanstack/react-router";
import { CortexBrand, CortexLogo } from "@/components/cortex-logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Sparkles,
  ArrowRight,
  Users,
  LifeBuoy,
  BookOpen,
  Trophy,
  Coins,
  Brain,
  ShieldCheck,
  MessagesSquare,
  Zap,
  GraduationCap,
  Check,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link to="/">
            <CortexBrand />
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <a href="#economy" className="hover:text-foreground">
              Credit Economy
            </a>
            <a href="#ai" className="hover:text-foreground">
              AI Tools
            </a>
            <a href="#teachers" className="hover:text-foreground">
              For Teachers
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="rounded-xl">
              <Link to="/auth">Sign in</Link>
            </Button>
            <Button
              asChild
              size="sm"
              className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90 font-medium"
            >
              <Link to="/onboarding">
                Get started
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-mesh">
        <div className="mx-auto max-w-7xl px-6 py-24 md:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <Badge
              variant="secondary"
              className="mb-6 rounded-full border border-border bg-background/70 px-3 py-1 text-xs font-medium backdrop-blur"
            >
              <Sparkles className="mr-1.5 inline h-3 w-3 text-primary" />
              AI-powered peer learning · Now in beta
            </Badge>
            <h1 className="font-display text-5xl leading-[1.05] tracking-tight md:text-7xl">
              Trade <em className="italic text-gradient">knowledge</em>,
              <br /> not money.
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
              Cortex is the peer learning ecosystem where students earn credits by teaching, spend
              them to learn, and let AI turn every study session into a step forward.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-xl bg-gradient-primary px-6 text-base text-primary-foreground shadow-elegant hover:opacity-90 font-medium"
              >
                <Link to="/onboarding">
                  Start learning free
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 rounded-xl border-border px-6 text-base"
              >
                <Link to="/auth">Sign in</Link>
              </Button>
            </div>
            <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>
                We&apos;re just getting started —{" "}
                <span className="font-semibold text-foreground">be one of the first to join</span> and
                help shape Cortex.
              </span>
            </div>
          </div>

          {/* App preview card */}
          <div className="relative mx-auto mt-16 max-w-5xl">
            <div className="rounded-3xl border border-border bg-card p-2 shadow-elegant animate-float">
              <div className="grid gap-2 rounded-2xl bg-muted/40 p-4 md:grid-cols-3">
                {[
                  { icon: Coins, label: "Welcome balance", value: "100", sub: "Free credits when you join" },
                  { icon: Zap, label: "Your streak", value: "Day 1", sub: "Start yours today" },
                  { icon: Trophy, label: "Leaderboard", value: "Open", sub: "Be the first on the board" },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="flex items-center gap-3 rounded-xl bg-background p-4 shadow-soft"
                  >
                    <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-primary text-primary-foreground">
                      <s.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">{s.label}</div>
                      <div className="text-xl font-bold tracking-tight">{s.value}</div>
                      <div className="text-xs text-muted-foreground">{s.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl px-6 py-24">
        <div className="mb-14 max-w-2xl">
          <h2 className="font-display text-4xl tracking-tight md:text-5xl">
            A whole learning ecosystem, not just a chatbot.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Every feature is designed around peer exchange. AI is the co-pilot, humans are the
            heart.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: Users,
              title: "Study Buddy Matching",
              desc: "Find students preparing for the same exam — matched by topic, timezone, and pace.",
            },
            {
              icon: LifeBuoy,
              title: "SOS Help",
              desc: "Urgent academic help in minutes. Post a request, get matched, jump into a private room.",
            },
            {
              icon: BookOpen,
              title: "Study Groups",
              desc: "Persistent rooms with pinned notes, shared calendar, tasks and progress tracking.",
            },
            {
              icon: MessagesSquare,
              title: "Community Feed",
              desc: "Ask, answer, share notes and PDFs. Accepted answers earn credits.",
            },
            {
              icon: Brain,
              title: "14 AI Study Tools",
              desc: "Flashcards, mind maps, roadmaps, mock interviews — all built for real study.",
            },
            {
              icon: ShieldCheck,
              title: "Verified Teachers",
              desc: "Book premium tutoring from vetted educators when you need the pros.",
            },
          ].map((f) => (
            <Card
              key={f.title}
              className="rounded-3xl border-border p-6 shadow-soft transition hover:shadow-elegant"
            >
              <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-accent text-accent-foreground">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold tracking-tight">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.desc}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Credit economy */}
      <section id="economy" className="border-y border-border bg-muted/30 py-24">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 lg:grid-cols-2">
          <div>
            <Badge variant="secondary" className="mb-4 rounded-full">
              Credit Economy
            </Badge>
            <h2 className="font-display text-4xl tracking-tight md:text-5xl">
              Earn by teaching. <br />
              Spend to learn.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Every new learner starts with <b className="text-foreground">100 credits</b>. Help a
              peer, share resources, keep a streak — credits flow to those who give back the most.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {[
                "Teach a session",
                "Answer SOS",
                "Upload notes",
                "Daily streak",
                "Community answer",
                "High rating",
              ].map((x) => (
                <div
                  key={x}
                  className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm"
                >
                  <Coins className="h-4 w-4 text-primary" />
                  {x}
                </div>
              ))}
            </div>
          </div>
          <Card className="rounded-3xl border-border p-6 shadow-elegant">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-muted-foreground">Your wallet</div>
              <Badge variant="secondary" className="rounded-full">
                Welcome bonus
              </Badge>
            </div>
            <div className="mt-2 flex items-end gap-2">
              <div className="font-display text-6xl tracking-tight text-gradient">100</div>
              <div className="mb-2 text-sm text-muted-foreground">credits to start</div>
            </div>
            <div className="mt-6 space-y-3">
              {[
                { t: "Help a peer with an SOS request", a: "Earn credits" },
                { t: "Teach a tutoring session", a: "Earn credits" },
                { t: "Book a tutor or ask for urgent help", a: "Spend credits" },
              ].map((r) => (
                <div
                  key={r.t}
                  className="flex items-center justify-between rounded-xl border border-border p-3 text-sm"
                >
                  <span className="text-muted-foreground">{r.t}</span>
                  <span className="font-semibold text-foreground">{r.a}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* AI tools */}
      <section id="ai" className="mx-auto max-w-7xl px-6 py-24">
        <div className="mb-12 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
          <div>
            <Badge variant="secondary" className="mb-3 rounded-full">
              AI Study Suite
            </Badge>
            <h2 className="font-display text-4xl tracking-tight md:text-5xl">
              14 tools to make studying feel <em className="italic text-gradient">easy</em>.
            </h2>
          </div>
          <p className="max-w-md text-muted-foreground">
            Study Assistant, Lecture Generator, Flashcards, Mind Maps, Mock Interview and more.
            Grounded in your own notes.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {[
            "Study Assistant",
            "Lecture Generator",
            "PDF Analysis",
            "Flashcards",
            "Mind Maps",
            "Quiz Generator",
            "Weakness Analysis",
            "Study Planner",
            "Roadmap Generator",
            "Coding Assistant",
            "Mock Interview",
            "Exam Preparation",
          ].map((t) => (
            <Card
              key={t}
              className="group flex items-center gap-3 rounded-2xl border-border p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-elegant"
            >
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-accent-foreground transition group-hover:bg-gradient-primary group-hover:text-primary-foreground">
                <Sparkles className="h-4 w-4" />
              </div>
              <span className="text-sm font-semibold">{t}</span>
            </Card>
          ))}
        </div>
      </section>

      {/* Teachers */}
      <section id="teachers" className="border-t border-border bg-muted/30 py-24">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 lg:grid-cols-2">
          <Card className="order-2 rounded-3xl border-border p-6 shadow-elegant lg:order-1">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-primary text-primary-foreground">
                <GraduationCap className="h-7 w-7" aria-hidden="true" />
              </div>
              <div>
                <div className="text-lg font-semibold">Become a founding tutor</div>
                <div className="text-sm text-muted-foreground">
                  Be among the first verified educators on Cortex
                </div>
              </div>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success" aria-hidden="true" /> Set your own credit rates
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success" aria-hidden="true" /> Choose your weekly availability
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success" aria-hidden="true" /> Get a Verified badge after a quick review
              </li>
            </ul>
          </Card>
          <div className="order-1 lg:order-2">
            <Badge variant="secondary" className="mb-3 rounded-full">
              For Verified Teachers
            </Badge>
            <h2 className="font-display text-4xl tracking-tight md:text-5xl">
              A studio built for educators.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Manage courses, availability, bookings, students and earnings. Add AI-generated lesson
              materials with a click.
            </p>
            <Button
              asChild
              size="lg"
              className="mt-6 h-12 rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90 font-medium"
            >
              <Link to="/auth">
                <GraduationCap className="mr-2 h-4 w-4" />
                Apply to teach
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h2 className="font-display text-5xl tracking-tight md:text-6xl">
          Your next breakthrough is <em className="italic text-gradient">one peer away</em>.
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
          Join a global classroom where every question is welcomed and every answer earns you
          something.
        </p>
        <Button
          asChild
          size="lg"
          className="mt-8 h-12 rounded-xl bg-gradient-primary px-8 text-base text-primary-foreground shadow-elegant hover:opacity-90 font-medium"
        >
          <Link to="/onboarding">
            Claim your 100 credits
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </section>

      <footer className="border-t border-border py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 text-sm text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2">
            <CortexLogo size={22} />
            <span className="font-semibold text-foreground">Cortex</span>
            <span>· © 2026</span>
          </div>
          <div className="flex gap-6">
            <Link to="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-foreground">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
