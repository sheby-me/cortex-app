import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CortexBrand } from "@/components/cortex-logo";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Mail,
  Lock,
  GraduationCap,
  BookOpen,
  ArrowRight,
  AlertCircle,
  Upload,
  FileCheck,
  FileText,
  MessageSquare,
  Video,
  Coins,
  X,
  Sparkles,
  Shield,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "@/integrations/firebase/client";
import { claimUsername, ensureUserDocument } from "@/services/users";
import { sendVerification } from "@/services/verification";
import { checkEmail } from "@/lib/email-policy";
import { Eye as EyeIcon, EyeOff as EyeOffIcon } from "lucide-react";
import { uploadFile, DOC_TYPES } from "@/services/storage";
import { toast } from "sonner";
import { formatAuthError, validateSignIn, validateSignUp } from "@/lib/auth-errors";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { checkUsernameAvailable, cleanUsername, registerUsername } from "@/lib/friends-service";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Cortex" },
      { name: "description", content: "Sign in to Cortex as a student, verified tutor, or admin." },
    ],
  }),
  component: AuthPage,
});

type Role = "student" | "tutor";

const ROLE_META: Record<
  Role,
  {
    title: string;
    blurb: string;
    icon: React.ComponentType<{ className?: string }>;
    allowSignup: boolean;
  }
> = {
  student: {
    title: "Student",
    blurb: "Learn from peers and tutors. Earn credits by helping others.",
    icon: BookOpen,
    allowSignup: true,
  },
  tutor: {
    title: "Verified Tutor",
    blurb: "Sign up to teach — share materials or run live sessions.",
    icon: GraduationCap,
    allowSignup: true,
  },
};

function AuthPage() {
  const [role, setRole] = useState<Role>("student");
  const { user, profile, role: userRole } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden border-r border-border bg-secondary lg:block">
        <div className="relative z-10 flex h-full flex-col justify-between p-12">
          <Link to="/">
            <CortexBrand />
          </Link>
          <div>
            <h2 className="font-display text-5xl font-medium leading-[1.05] tracking-tight">
              Teach. Learn.
              <br />
              Trade knowledge.
            </h2>
            <p className="mt-4 max-w-sm text-muted-foreground">
              One platform. Three ways in — depending on how you show up.
            </p>
            <div className="mt-8 space-y-3">
              {(Object.keys(ROLE_META) as Role[]).map((r) => {
                const M = ROLE_META[r];
                return (
                  <div
                    key={r}
                    className="flex items-start gap-3 rounded-md border border-border bg-background p-4"
                  >
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
                      <M.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{M.title}</div>
                      <div className="text-xs text-muted-foreground">{M.blurb}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">© 2026 Cortex</div>
        </div>
      </div>
      <div className="relative flex items-center justify-center p-6 md:p-12">
        <div className="absolute top-4 right-4">
          <ThemeToggle variant="outline" size="sm" showLabel />
        </div>
        <Card className="w-full max-w-md rounded-lg border-border p-8 shadow-soft">
          {user && (
            <div className="mb-6 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-foreground">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                <span className="truncate">
                  Signed in as{" "}
                  <strong className="font-semibold">{profile?.displayName || user.email}</strong>
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (userRole === "admin") navigate({ to: "/admin" });
                  else if (userRole === "tutor") navigate({ to: "/teacher" });
                  else navigate({ to: "/dashboard" });
                }}
                className="h-7 text-xs font-semibold text-primary hover:underline shrink-0 ml-2"
              >
                Continue →
              </Button>
            </div>
          )}
          <div className="mb-6">
            <h1 className="font-display text-3xl font-medium tracking-tight">Welcome to Cortex</h1>
            <p className="mt-1 text-sm text-muted-foreground">Choose how you're signing in.</p>
          </div>
          <Tabs value={role} onValueChange={(v) => setRole(v as Role)}>
            <TabsList className="grid w-full grid-cols-2 rounded-md">
              <TabsTrigger value="student" className="rounded-sm text-xs">
                Student
              </TabsTrigger>
              <TabsTrigger value="tutor" className="rounded-sm text-xs">
                Tutor
              </TabsTrigger>
            </TabsList>
            {(Object.keys(ROLE_META) as Role[]).map((r) => (
              <TabsContent key={r} value={r} className="mt-6">
                <RoleForm role={r} />
              </TabsContent>
            ))}
          </Tabs>
        </Card>
      </div>
    </div>
  );
}

function RoleForm({ role }: { role: Role }) {
  const meta = ROLE_META[role];
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameCheckMsg, setUsernameCheckMsg] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [credentials, setCredentials] = useState("");

  // Degree proof state
  const [degreeProof, setDegreeProof] = useState<{
    name: string;
    type: string;
    size: number;
    data: string;
  } | null>(null);

  // Service pricing rates
  const [materialsCredits, setMaterialsCredits] = useState<string>("15");
  const [asyncQaCredits, setAsyncQaCredits] = useState<string>("25");
  const [zoomCredits, setZoomCredits] = useState<string>("50");

  // The raw file is uploaded to Firebase Storage (tutor-proofs/{uid}/…) after the account exists.
  const [degreeFile, setDegreeFile] = useState<File | null>(null);

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestUsername = useRef("");
  const [emailHint, setEmailHint] = useState<string | null>(null);

  const canSignup = meta.allowSignup;

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Degree proof document should not exceed 5MB.");
      return;
    }
    if (!DOC_TYPES.includes(file.type)) {
      toast.error("Please upload a PDF or an image (JPG, PNG, WebP).");
      return;
    }

    setDegreeFile(file);
    setDegreeProof({
      name: file.name,
      type: file.type || "application/pdf",
      size: file.size,
      data: "",
    });
    toast.success(`Attached "${file.name}" as degree proof`);
  }

  /**
   * Claim admin rights if (and only if) this account's VERIFIED email is on the admin allow-list.
   * The decision is made by firestore.rules (see /admins/{uid}); the client just asks.
   * Nobody can become admin from the browser console.
   */
  async function tryClaimAdmin(user: User): Promise<boolean> {
    try {
      const existing = await getDoc(doc(db, "admins", user.uid));
      if (existing.exists()) return true;
      if (!user.emailVerified || !user.email) return false;
      await setDoc(doc(db, "admins", user.uid), {
        uid: user.uid,
        email: user.email.toLowerCase(),
        createdAt: serverTimestamp(),
      });
      return true;
    } catch {
      return false; // permission-denied => not on the allow-list
    }
  }

  async function routeAfterSignIn(user: User) {
    // Password accounts must prove they own the mailbox before anything else happens.
    if (!user.emailVerified) {
      navigate({ to: "/verify-email" });
      return;
    }
    const profileDoc = await ensureUserDocument(user, {
      displayName: user.displayName ?? undefined,
    });

    if (await tryClaimAdmin(user)) {
      toast.success("Welcome to Cortex Admin.");
      navigate({ to: "/admin" });
      return;
    }

    const currentRole = profileDoc.role ?? "student";
    const tutorStatus = profileDoc.tutorStatus ?? null;

    if (currentRole === "tutor") {
      toast.success("Welcome back, Verified Tutor.");
      navigate({ to: "/teacher" });
      return;
    }

    if (tutorStatus === "pending") {
      toast.info("Your tutor application is currently under review.");
      navigate({ to: "/pending" });
      return;
    }

    if (tutorStatus === "rejected") {
      toast.info("Your tutor application was not approved. You can still use Cortex as a student.");
    } else {
      toast.success("Signed in successfully.");
    }
    navigate({ to: profileDoc.onboarded === false ? "/onboarding" : "/dashboard" });
  }

  /** Send a password-reset email. The response never reveals whether the address has an account. */
  async function handleForgotPassword() {
    setFormError(null);
    const target = email.trim();
    if (!target || !/^\S+@\S+\.\S+$/.test(target)) {
      const err = "Enter your email address above, then click “Forgot password?”.";
      setFormError(err);
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, target);
    } catch (err) {
      const code = (err as { code?: string }).code;
      // Don't leak which emails exist: only surface errors that aren't about the account.
      if (code === "auth/invalid-email" || code === "auth/network-request-failed" || code === "auth/too-many-requests") {
        const msg = formatAuthError(err);
        setFormError(msg);
        toast.error(msg);
        setBusy(false);
        return;
      }
    }
    toast.success("If an account exists for that email, a password-reset link is on its way.");
    setBusy(false);
  }

  /** Google sign-ups have no username step, so derive a free one from the email (retries on collisions). */
  async function autoClaimUsername(uid: string, seed: string) {
    const base = cleanUsername(seed).slice(0, 14) || "learner";
    for (let i = 0; i < 4; i++) {
      const candidate = i === 0 ? base : `${base}${Math.floor(1000 + Math.random() * 9000)}`;
      try {
        await claimUsername(uid, candidate);
        return;
      } catch (err) {
        if ((err as Error).message !== "USERNAME_TAKEN") throw err;
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (mode === "signup" && canSignup) {
      const val = validateSignUp({ email, password, name, role, credentials, bio });
      if (!val.valid && val.error) {
        setFormError(val.error);
        toast.error(val.error);
        return;
      }

      if (role === "tutor") {
        if (!degreeProof) {
          const err = "Please upload your degree proof or qualification document.";
          setFormError(err);
          toast.error(err);
          return;
        }
        const matNum = Number(materialsCredits);
        const asyncNum = Number(asyncQaCredits);
        const zoomNum = Number(zoomCredits);
        if (
          isNaN(matNum) ||
          matNum < 1 ||
          isNaN(asyncNum) ||
          asyncNum < 1 ||
          isNaN(zoomNum) ||
          zoomNum < 1
        ) {
          const err = "Please enter valid credit amounts for all services.";
          setFormError(err);
          toast.error(err);
          return;
        }
      }
    } else {
      const val = validateSignIn(email, password);
      if (!val.valid && val.error) {
        setFormError(val.error);
        toast.error(val.error);
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === "signup" && canSignup) {
        const cleanU = cleanUsername(username);
        if (!cleanU || cleanU.length < 3) {
          const err =
            "Please enter a valid username (at least 3 characters, letters/numbers/underscores only).";
          setFormError(err);
          toast.error(err);
          return;
        }

        // Friendly pre-check (the transactional claim below is what actually guarantees uniqueness).
        const isAvail = await checkUsernameAvailable(cleanU);
        if (!isAvail) {
          const err = `Username "@${cleanU}" is already taken. Please choose another username.`;
          setFormError(err);
          toast.error(err);
          return;
        }

        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const display = name || email.split("@")[0];
        await updateProfile(cred.user, { displayName: display });

        // Everyone starts as a plain student; tutor/admin rights are granted by an admin only.
        await ensureUserDocument(cred.user, { displayName: display, tutorPending: role === "tutor" });

        // Transactionally reserve the username (usernames/{handle} + users/{uid}).
        const claimed = await registerUsername(cred.user.uid, cleanU);
        if (!claimed) {
          toast.warning(
            `@${cleanU} was just taken by someone else. Your account is ready — pick another username in Settings.`,
          );
        }

        if (role === "tutor") {
          // Upload the proof to Storage first, then file the application with a reference to it.
          let proof: { name: string; type: string; size: number; path: string } | null = null;
          if (degreeFile) {
            const up = await uploadFile({
              folder: `tutor-proofs/${cred.user.uid}`,
              file: degreeFile,
              maxBytes: 5 * 1024 * 1024,
              allowedTypes: DOC_TYPES,
            });
            proof = { name: degreeFile.name, type: up.contentType, size: up.size, path: up.path };
          }
          await setDoc(doc(db, "tutor_applications", cred.user.uid), {
            userId: cred.user.uid,
            displayName: display,
            email: email.toLowerCase(),
            bio,
            credentials,
            degreeProof: proof,
            rates: {
              materials: Number(materialsCredits) || 15,
              asyncQa: Number(asyncQaCredits) || 25,
              zoomMeeting: Number(zoomCredits) || 50,
            },
            status: "pending",
            createdAt: serverTimestamp(),
          });
          toast.success("Application submitted — verify your email to continue.");
        } else {
          toast.success("Account created — one more step: verify your email.");
        }

        // Prove the mailbox exists and is theirs (link or one-time code). Nothing else works until this is done.
        try {
          await sendVerification(cred.user);
        } catch (err) {
          toast.warning(formatAuthError(err));
        }
        navigate({ to: "/verify-email" });
      } else {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        await routeAfterSignIn(cred.user);
      }
    } catch (err: unknown) {
      const msg = formatAuthError(err);
      setFormError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setFormError(null);
    setBusy(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const u = cred.user;
      const email = u.email ?? "";
      const existing = await getDoc(doc(db, "users", u.uid));

      if (!existing.exists()) {
        const display = u.displayName ?? email.split("@")[0];
        await ensureUserDocument(u, { displayName: display, tutorPending: role === "tutor" });
        await autoClaimUsername(u.uid, email.split("@")[0] || display);
        if (role === "tutor") {
          await setDoc(doc(db, "tutor_applications", u.uid), {
            userId: u.uid,
            displayName: display,
            email: email.toLowerCase(),
            bio: "",
            credentials: "",
            status: "pending",
            createdAt: serverTimestamp(),
          });
          navigate({ to: "/pending" });
          return;
        }
      }
      await routeAfterSignIn(u);
    } catch (err: unknown) {
      const msg = formatAuthError(err);
      setFormError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-md border border-border bg-secondary p-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{meta.title}:</span> {meta.blurb}
      </div>

      <Button
        type="button"
        onClick={handleGoogle}
        disabled={busy}
        variant="outline"
        className="w-full h-11 rounded-md"
      >
        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
          />
        </svg>
        Continue with Google
      </Button>
      <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        or email
        <div className="h-px flex-1 bg-border" />
      </div>

      {mode === "signup" && (
        <>
          <div>
            <Label htmlFor={`${role}-name`}>Full name</Label>
            <Input
              id={`${role}-name`}
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 h-11 rounded-md"
              placeholder="Your name"
              required
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor={`${role}-username`}>Unique Username</Label>
              <span className="text-xs text-muted-foreground">
                Required for friends & search
              </span>
            </div>
            <div className="relative mt-1.5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-semibold">
                @
              </span>
              <Input
                id={`${role}-username`}
                name="username"
                autoComplete="username"
                maxLength={20}
                aria-describedby={`${role}-username-msg`}
                value={username}
                onChange={(e) => {
                  const cleaned = cleanUsername(e.target.value);
                  setUsername(cleaned);
                  // Debounced availability check; stale answers (an older keystroke finishing late) are ignored.
                  if (usernameTimer.current) clearTimeout(usernameTimer.current);
                  if (cleaned.length < 3) {
                    setUsernameCheckMsg(null);
                    return;
                  }
                  usernameTimer.current = setTimeout(async () => {
                    try {
                      const avail = await checkUsernameAvailable(cleaned);
                      if (latestUsername.current !== cleaned) return;
                      setUsernameCheckMsg(avail ? `@${cleaned} is available!` : `@${cleaned} is already taken`);
                    } catch {
                      setUsernameCheckMsg(null);
                    }
                  }, 350);
                  latestUsername.current = cleaned;
                }}
                className="h-11 pl-8 rounded-md font-mono text-sm"
                placeholder="username (e.g. alex_m)"
                required
              />
            </div>
            {usernameCheckMsg && (
              <p
                id={`${role}-username-msg`}
                role="status"
                className={`mt-1 text-xs font-medium ${
                  usernameCheckMsg.includes("available")
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive"
                }`}
              >
                {usernameCheckMsg}
              </p>
            )}
          </div>
        </>
      )}
      {mode === "signup" && role === "tutor" && (
        <>
          <div>
            <Label>Credentials & Qualifications</Label>
            <Input aria-label="e.g. MSc Physics, BS Computer Science"
              value={credentials}
              onChange={(e) => setCredentials(e.target.value)}
              className="mt-1.5 h-11 rounded-md"
              placeholder="e.g. MSc Physics, BS Computer Science"
              required
            />
          </div>

          <div>
            <Label>Short bio</Label>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="mt-1.5 rounded-md"
              placeholder="What you teach and how you help students"
              rows={2}
              required
            />
          </div>

          {/* Degree Proof Upload Section */}
          <div className="rounded-lg border border-border p-3.5 bg-card/50 space-y-2">
            <Label className="flex items-center gap-1.5 text-xs font-semibold">
              <FileCheck className="h-4 w-4 text-primary" />
              Degree Proof / Qualification Document
              <span className="text-destructive">*</span>
            </Label>
            <p className="text-xs text-muted-foreground">
              Upload a clear photo or PDF of your degree, diploma, or qualification certificate for
              admin approval.
            </p>

            {degreeProof ? (
              <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs">
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <FileText className="h-4 w-4 shrink-0 text-primary" />
                  <div className="truncate font-medium text-foreground">{degreeProof.name}</div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    ({(degreeProof.size / 1024).toFixed(0)} KB)
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDegreeProof(null)}
                  className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center rounded-md border border-dashed border-border p-4 text-center cursor-pointer hover:bg-secondary/50 transition-colors">
                <Upload className="h-5 w-5 text-muted-foreground mb-1" />
                <span className="text-xs font-medium text-foreground">
                  Click to upload Degree Proof
                </span>
                <span className="text-xs text-muted-foreground mt-0.5">
                  Supports PDF, PNG, JPG (Max 5MB)
                </span>
                <input
                  type="file"
                  accept="image/*,.pdf,.doc,.docx"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* Service Pricing Credits Section */}
          <div className="rounded-lg border border-border p-3.5 bg-card/50 space-y-3">
            <div>
              <Label className="flex items-center gap-1.5 text-xs font-semibold">
                <Coins className="h-4 w-4 text-amber-500" />
                Your Service Credit Rates
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Set how many credits students must spend for each service you offer:
              </p>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  Materials (Notes / Guides / Slides)
                </Label>
                <div className="relative mt-1">
                  <Input aria-label="15"
                    type="number"
                    min={1}
                    value={materialsCredits}
                    onChange={(e) => setMaterialsCredits(e.target.value)}
                    className="h-9 pr-16 font-mono text-xs"
                    placeholder="15"
                    required
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">
                    credits
                  </span>
                </div>
              </div>

              <div>
                <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MessageSquare className="h-3.5 w-3.5 text-primary" />
                  Async Q&A for 30 Mins
                </Label>
                <div className="relative mt-1">
                  <Input aria-label="25"
                    type="number"
                    min={1}
                    value={asyncQaCredits}
                    onChange={(e) => setAsyncQaCredits(e.target.value)}
                    className="h-9 pr-16 font-mono text-xs"
                    placeholder="25"
                    required
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">
                    credits
                  </span>
                </div>
              </div>

              <div>
                <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Video className="h-3.5 w-3.5 text-primary" />
                  Zoom Meeting of 45 Mins
                </Label>
                <div className="relative mt-1">
                  <Input aria-label="50"
                    type="number"
                    min={1}
                    value={zoomCredits}
                    onChange={(e) => setZoomCredits(e.target.value)}
                    className="h-9 pr-16 font-mono text-xs"
                    placeholder="50"
                    required
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">
                    credits
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border bg-secondary p-2.5 text-xs text-muted-foreground leading-relaxed">
            Admin verification is required before your profile and services become active on Cortex.
          </div>
        </>
      )}
      {formError && (
        <div role="alert" aria-live="assertive" className="flex items-start gap-2.5 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1 font-medium leading-relaxed">{formError}</div>
        </div>
      )}

      <div>
        <Label htmlFor={`${role}-email`}>Email</Label>
        <div className="relative mt-1.5">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id={`${role}-email`}
            name="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailHint(null);
              if (formError) setFormError(null);
            }}
            onBlur={() => {
              // Catch typos / throw-away inboxes while the user is still looking at the field.
              if (mode === "signup" && email.trim()) {
                const c = checkEmail(email);
                setEmailHint(c.ok ? null : (c.error ?? null));
              }
            }}
            aria-invalid={!!emailHint}
            aria-describedby={emailHint ? `${role}-email-hint` : undefined}
            type="email"
            required
            className="h-11 rounded-md pl-9"
            placeholder="you@example.com"
          />
        </div>
        {emailHint && (
          <p id={`${role}-email-hint`} className="mt-1 text-xs text-destructive">
            {emailHint}
          </p>
        )}
      </div>
      <div>
        <Label htmlFor={`${role}-password`} className="flex items-center justify-between">
          <span>Password</span>
          {mode === "signup" ? (
            <span className="text-xs text-muted-foreground font-normal">8+ characters, letters &amp; numbers</span>
          ) : (
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={busy}
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Forgot password?
            </button>
          )}
        </Label>
        <div className="relative mt-1.5">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id={`${role}-password`}
            name="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (formError) setFormError(null);
            }}
            type={showPassword ? "text" : "password"}
            required
            minLength={mode === "signup" ? 8 : undefined}
            className="h-11 rounded-md pl-9 pr-11"
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <Button type="submit" disabled={busy} className="w-full h-11 rounded-md">
        {mode === "signup" ? "Create account" : "Sign in"} <ArrowRight className="ml-1.5 h-4 w-4" />
      </Button>

      {canSignup && (
        <div className="text-center text-sm text-muted-foreground">
          {mode === "signin" ? (
            <>
              New here?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setFormError(null);
                }}
                className="font-semibold text-foreground underline underline-offset-4"
              >
                Create a {meta.title.toLowerCase()} account
              </button>
            </>
          ) : (
            <>
              Already have one?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setFormError(null);
                }}
                className="font-semibold text-foreground underline underline-offset-4"
              >
                Sign in
              </button>
            </>
          )}
        </div>
      )}
      {!canSignup && (
        <div className="text-center text-xs text-muted-foreground">
          Admin sign-ups are disabled. Contact your workspace owner.
        </div>
      )}
    </form>
  );
}
