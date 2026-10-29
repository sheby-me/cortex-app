import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CortexBrand } from "@/components/cortex-logo";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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
import { RequiredMark } from "@/components/required-mark";
import { CountrySelect } from "@/components/country-select";
import { InstitutionSelect } from "@/components/institution-select";
import { validatePersonName } from "@/lib/name-policy";
import { checkUsernameFormat, cleanUsername } from "@/lib/username-policy";
import { checkUsernameAvailable } from "@/lib/friends-service";
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
  const { updateProfile, profile, user, loading, emailVerified } = useAuth();

  // Protected route: only signed-in users with a verified email can onboard.
  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
    else if (!emailVerified) navigate({ to: "/verify-email" });
  }, [loading, user, emailVerified, navigate]);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameState, setUsernameState] = useState<"idle" | "checking" | "free" | "taken" | "invalid">("idle");
  const [usernameMsg, setUsernameMsg] = useState<string | null>(null);
  const [country, setCountry] = useState("");
  const [institution, setInstitution] = useState("");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [level, setLevel] = useState<GradeLevel | "">("");
  const [semester, setSemester] = useState("");
  const [degree, setDegree] = useState("");
  const [timezone, setTimezone] = useState("");
  const [bio, setBio] = useState("");
  const [teach, setTeach] = useState<string[]>([]);
  const [learn, setLearn] = useState<string[]>([]);
  const [hours, setHours] = useState<number>(5);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  // Pre-fill anything we already know (Google sign-ins, returning users)
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || loading || !user) return;
    prefilled.current = true;
    setName(profile.displayName || user.displayName || "");
    setUsername(profile.username || "");
    setCountry(profile.country || "");
    setInstitution(profile.institution || "");
    setInstitutionId((profile.institutionId as string | null) ?? null);
    setLevel((profile.gradeLevel as GradeLevel) || "");
    setSemester(profile.semesterOrYear || "");
    setDegree(profile.degreeOrStream || "");
    setTimezone(profile.timezone || "");
    setBio(profile.about || "");
    setTeach(profile.teach || []);
    setLearn(profile.learn || []);
    setHours(Number(profile.hoursGoal) || 5);
  }, [loading, user, profile]);

  // Username: format + reserved words locally, availability against Firestore (debounced, stale answers ignored)
  const latest = useRef("");
  useEffect(() => {
    const clean = cleanUsername(username);
    latest.current = clean;
    if (!clean) {
      setUsernameState("idle");
      setUsernameMsg(null);
      return;
    }
    const fmt = checkUsernameFormat(clean);
    if (!fmt.ok) {
      setUsernameState("invalid");
      setUsernameMsg(fmt.error ?? null);
      return;
    }
    if (clean === profile.username) {
      setUsernameState("free");
      setUsernameMsg(`@${clean} is yours.`);
      return;
    }
    setUsernameState("checking");
    setUsernameMsg("Checking availability…");
    const t = setTimeout(async () => {
      try {
        const free = await checkUsernameAvailable(clean, user?.uid);
        if (latest.current !== clean) return;
        setUsernameState(free ? "free" : "taken");
        setUsernameMsg(free ? `@${clean} is available!` : `@${clean} is already taken. Try another.`);
      } catch {
        if (latest.current === clean) {
          setUsernameState("idle");
          setUsernameMsg("Couldn't check right now — we'll check again when you continue.");
        }
      }
    }, 350);
    return () => clearTimeout(t);
  }, [username, profile.username, user?.uid]);

  const nameCheck = validatePersonName(name, "full name");
  const errors = {
    name: nameCheck.ok ? null : nameCheck.error,
    username: usernameState === "free" || usernameState === "checking" ? null : (usernameMsg ?? "Choose a username."),
    country: country ? null : "Select your country.",
    institution: institution.trim() ? null : "Select your school or university.",
    level: level ? null : "Select your academic level.",
    timezone: timezone ? null : "Select your timezone.",
  };
  const firstError = Object.values(errors).find(Boolean);

  async function save() {
    setTouched(true);
    if (firstError) {
      toast.error(firstError);
      return;
    }
    setSaving(true);
    try {
      // Re-check just before saving: the claim below is transactional, so two people can never end up with one username.
      await updateProfile({
        displayName: nameCheck.value,
        username: cleanUsername(username),
        country,
        institution: institution.trim(),
        institutionId,
        gradeLevel: level as GradeLevel,
        semesterOrYear: semester.trim() || null,
        degreeOrStream: degree.trim() || null,
        timezone,
        about: bio.trim() || null,
        teach,
        learn,
        hoursGoal: Math.max(1, hours || 5),
        onboarded: true,
      });

      toast.success("Profile setup complete!");
      navigate({ to: "/dashboard" });
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Couldn't save your profile. Please try again."));
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
          <p className="mb-4 text-xs text-muted-foreground">
            Fields marked <span className="font-semibold text-destructive">*</span> are required.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="ob-name">
                Full name
                <RequiredMark />
              </Label>
              <Input
                id="ob-name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={touched && !!errors.name}
                aria-describedby="ob-name-err"
                className="mt-1.5 rounded-md"
                placeholder="As on your CNIC / student card"
              />
              {(touched || name) && errors.name && (
                <p id="ob-name-err" className="mt-1 text-xs text-destructive">{errors.name}</p>
              )}
            </div>
            <div>
              <Label htmlFor="ob-username">
                Username
                <RequiredMark />
              </Label>
              <div className="relative mt-1.5">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
                <Input
                  id="ob-username"
                  autoComplete="username"
                  maxLength={20}
                  value={username}
                  onChange={(e) => setUsername(cleanUsername(e.target.value))}
                  aria-invalid={usernameState === "taken" || usernameState === "invalid"}
                  aria-describedby="ob-username-msg"
                  className="rounded-md pl-7 font-mono text-sm"
                  placeholder="choose_a_username"
                />
              </div>
              <p
                id="ob-username-msg"
                role="status"
                className={`mt-1 text-xs ${
                  usernameState === "free"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : usernameState === "taken" || usernameState === "invalid"
                      ? "text-destructive"
                      : "text-muted-foreground"
                }`}
              >
                {usernameMsg ?? "3–20 letters, numbers or underscores. This is how friends will find you."}
              </p>
            </div>
            <div>
              <Label htmlFor="ob-country">
                Country
                <RequiredMark />
              </Label>
              <CountrySelect id="ob-country" value={country} onChange={setCountry} invalid={touched && !country} />
            </div>
            <div>
              <Label htmlFor="ob-level">
                Grade / Academic Level
                <RequiredMark />
              </Label>
              <Select value={level} onValueChange={(v) => setLevel(v as GradeLevel)}>
                <SelectTrigger id="ob-level" className="mt-1.5 rounded-md" aria-invalid={touched && !level}>
                  <SelectValue placeholder="Select your level" />
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
            <div className="md:col-span-2">
              <Label htmlFor="ob-institution">
                School / University
                <RequiredMark />
              </Label>
              <InstitutionSelect
                id="ob-institution"
                value={institution}
                invalid={touched && !institution.trim()}
                onChange={(v, inst) => {
                  setInstitution(v);
                  setInstitutionId(inst?.id ?? null);
                }}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                You can verify your university email later in Settings to get a Verified Student badge.
              </p>
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
              <Label htmlFor="ob-tz">
                Timezone
                <RequiredMark />
              </Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="ob-tz" className="mt-1.5 rounded-md" aria-invalid={touched && !timezone}>
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
            <Button onClick={save} disabled={saving} className="rounded-md" aria-busy={saving}>
              Continue
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
