import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CortexBrand } from "@/components/cortex-logo";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, X } from "lucide-react";
import { errorMessage } from "@/services/common";
import { useAuth, type GradeLevel } from "@/hooks/use-auth";
import { toast } from "sonner";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Get started — Cortex" },
      {
        name: "description",
        content: "Set up your Cortex profile — for learners of any subject or grade.",
      },
    ],
  }),
  component: OnboardingPage,
});

function ChipInput({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    if (!value.includes(t)) onChange([...value, t]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    }
  };
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background p-2 focus-within:ring-1 focus-within:ring-ring">
        {value.map((t) => (
          <Badge key={t} variant="secondary" className="rounded-md gap-1 pr-1">
            {t}
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== t))}
              className="ml-1 rounded p-0.5 hover:bg-muted-foreground/20"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={add}
          placeholder={value.length ? "" : placeholder}
          className="flex-1 min-w-[10ch] bg-transparent px-1 py-1 text-sm outline-none"
        />
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        Press Enter or comma to add. Anything goes — math, guitar, 8th-grade science, watercolor,
        business law…
      </div>
    </div>
  );
}

function OnboardingPage() {
  const navigate = useNavigate();
  const { updateProfile, profile, user, loading } = useAuth();

  // Protected route: only signed-in users can onboard.
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);
  const [name, setName] = useState("");
  const [country, setCountry] = useState("United States");
  const [institution, setInstitution] = useState("");
  const [level, setLevel] = useState<GradeLevel>("Undergraduate");
  const [semester, setSemester] = useState("");
  const [degree, setDegree] = useState("");
  const [timezone, setTimezone] = useState("UTC-5 (EST)");
  const [bio, setBio] = useState("");
  const [teach, setTeach] = useState<string[]>([]);
  const [learn, setLearn] = useState<string[]>([]);
  const [hours, setHours] = useState<number>(5);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim() && !profile.displayName) {
      toast.error("Please tell us your name.");
      return;
    }
    setSaving(true);
    try {
      // One validated write: updateProfile() whitelists fields and refreshes the search index.
      await updateProfile({
        displayName: name.trim() || profile.displayName || undefined,
        country,
        institution: institution.trim() || null,
        gradeLevel: level,
        semesterOrYear: semester.trim() || null,
        degreeOrStream: degree.trim() || null,
        timezone,
        about: bio.trim() || null,
        teach,
        learn,
        hoursGoal: hours,
        onboarded: true,
      });

      toast.success("Profile setup complete!");
      navigate({ to: "/dashboard" });
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Could not save profile"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-secondary">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link to="/">
          <CortexBrand />
        </Link>
        <div className="mt-8">
          <Badge variant="secondary" className="rounded-md bg-background">
            Step 1 of 3
          </Badge>
          <h1 className="mt-3 font-display text-5xl font-medium tracking-tight">
            Tell us about you.
          </h1>
          <p className="mt-2 text-muted-foreground">
            Cortex AI adapts its teaching explanations specifically to your selected Grade Level —
            from Matric to PhD.
          </p>
          <Progress value={33} className="mt-4 h-1.5" />
        </div>
        <Card className="mt-6 rounded-lg border-border p-6 shadow-soft">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Full name</Label>
              <Input aria-label="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 rounded-md"
                placeholder="Your name"
              />
            </div>
            <div>
              <Label>Country</Label>
              <Input aria-label="Where you're based"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="mt-1.5 rounded-md"
                placeholder="Where you're based"
              />
            </div>
            <div>
              <Label>Grade / Academic Level *</Label>
              <Select value={level} onValueChange={(v) => setLevel(v as GradeLevel)}>
                <SelectTrigger className="mt-1.5 rounded-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Matric">Matric (8th - 10th Grade)</SelectItem>
                  <SelectItem value="Intermediate">Intermediate (FSc / A-Levels)</SelectItem>
                  <SelectItem value="Undergraduate">Undergraduate (Bachelor's)</SelectItem>
                  <SelectItem value="Graduate">Graduate (Master's)</SelectItem>
                  <SelectItem value="Mphil">Mphil (Post-Graduate)</SelectItem>
                  <SelectItem value="Phd">Phd (Doctoral / Research)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>School / University Name</Label>
              <Input aria-label="e.g. Stanford University or Lincoln High"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                className="mt-1.5 rounded-md"
                placeholder="e.g. Stanford University or Lincoln High"
              />
            </div>
            <div>
              <Label>Semester / Class Year</Label>
              <Input aria-label="e.g. Semester 4 or Class 10"
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
                className="mt-1.5 rounded-md"
                placeholder="e.g. Semester 4 or Class 10"
              />
            </div>
            <div>
              <Label>Degree OR Science/Arts Stream</Label>
              <Input aria-label="e.g. BS Computer Science OR Science Stream"
                value={degree}
                onChange={(e) => setDegree(e.target.value)}
                className="mt-1.5 rounded-md"
                placeholder="e.g. BS Computer Science OR Science Stream"
              />
            </div>
            <div>
              <Label>Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger className="mt-1.5 rounded-md">
                  <SelectValue placeholder="Select Timezone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UTC+5 (PST, Pakistan Standard Time)">
                    UTC+5 (PST, Pakistan Standard Time)
                  </SelectItem>
                  <SelectItem value="UTC-5 (EST)">UTC-5 (EST, Eastern Standard Time)</SelectItem>
                  <SelectItem value="UTC-8 (PST)">UTC-8 (PST, Pacific Standard Time)</SelectItem>
                  <SelectItem value="UTC+0 (GMT)">UTC+0 (GMT, Greenwich Mean Time)</SelectItem>
                  <SelectItem value="UTC+1 (CET)">UTC+1 (CET, Central European Time)</SelectItem>
                  <SelectItem value="UTC+5:30 (IST)">
                    UTC+5:30 (IST, Indian Standard Time)
                  </SelectItem>
                  <SelectItem value="UTC+8 (SGT)">UTC+8 (SGT, Singapore Time)</SelectItem>
                  <SelectItem value="UTC+9 (JST)">UTC+9 (JST, Japan Standard Time)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Weekly study hours goal</Label>
              <Input
                type="number"
                min={1}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                className="mt-1.5 rounded-md"
              />
            </div>
            <div className="md:col-span-2">
              <Label>Short bio</Label>
              <Textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="mt-1.5 rounded-md"
                placeholder="What are you working on or learning?"
              />
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <ChipInput
              label="Subjects I can teach"
              placeholder="Add a subject and press Enter"
              value={teach}
              onChange={setTeach}
            />
            <ChipInput
              label="Topics I want to learn"
              placeholder="Add a topic and press Enter"
              value={learn}
              onChange={setLearn}
            />
          </div>

          <div className="mt-6 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              You start with <b className="text-foreground">100 credits</b> to spend on help.
            </div>
            <Button onClick={save} disabled={saving} className="rounded-md">
              Continue
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
