import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { MailCheck, Loader2, RefreshCw, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CortexBrand } from "@/components/cortex-logo";
import { useAuth } from "@/hooks/use-auth";
import { formatAuthError } from "@/lib/auth-errors";
import { OTP_ENABLED, confirmOtp, sendVerification } from "@/services/verification";

export const Route = createFileRoute("/verify-email")({
  head: () => ({
    meta: [
      { title: "Verify your email — Cortex" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VerifyEmailPage,
});

const RESEND_SECONDS = 60;

function VerifyEmailPage() {
  const navigate = useNavigate();
  const { user, profile, loading, emailVerified, refreshUser, signOut } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const sentOnce = useRef(false);

  const goOn = useCallback(() => {
    if (profile.tutorStatus === "pending") navigate({ to: "/pending" });
    else if (profile.onboarded === false || profile.onboarded === undefined) navigate({ to: "/onboarding" });
    else navigate({ to: "/dashboard" });
  }, [navigate, profile.onboarded, profile.tutorStatus]);

  // Not signed in → back to sign in. Already verified → continue.
  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
    else if (emailVerified) goOn();
  }, [loading, user, emailVerified, goOn, navigate]);

  // Link flow: poll quietly while the person checks their inbox (also re-checks when the tab regains focus).
  useEffect(() => {
    if (!user || emailVerified || OTP_ENABLED) return;
    const check = () => void refreshUser().catch(() => undefined);
    const t = setInterval(check, 4000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", check);
    };
  }, [user, emailVerified, refreshUser]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = useCallback(async () => {
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      await sendVerification(user);
      setCooldown(RESEND_SECONDS);
      toast.success(OTP_ENABLED ? "We emailed you a 6-digit code." : "Verification email sent — check your inbox (and spam).");
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  }, [user]);

  // In code mode, send the first code automatically when the page opens (sign-up may already have done it,
  // the server rate-limits repeats).
  useEffect(() => {
    if (OTP_ENABLED && user && !emailVerified && !sentOnce.current) {
      sentOnce.current = true;
      setCooldown(RESEND_SECONDS);
    }
  }, [user, emailVerified]);

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await confirmOtp(code);
      const ok = await refreshUser();
      if (!ok) throw new Error("The code was accepted but your account isn't verified yet. Please try again.");
      toast.success("Email verified — welcome to Cortex!");
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function checkNow() {
    setBusy(true);
    setError(null);
    try {
      const ok = await refreshUser();
      if (!ok) setError("We haven't seen your confirmation yet. Click the link in the email, then try again.");
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function switchAccount() {
    await signOut();
    navigate({ to: "/auth" });
  }

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-secondary p-6">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex justify-center">
          <CortexBrand />
        </Link>
        <Card className="rounded-lg border-border p-8 shadow-soft">
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
            <MailCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="font-display text-2xl font-medium tracking-tight">Verify your email</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {OTP_ENABLED ? "We sent a 6-digit code to " : "We sent a confirmation link to "}
            <strong className="text-foreground">{user.email}</strong>. This confirms the address is real and yours —
            Cortex stays locked until then.
          </p>

          {error && (
            <div role="alert" className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {OTP_ENABLED ? (
            <form onSubmit={submitCode} className="mt-5 space-y-3">
              <div>
                <Label htmlFor="otp">Verification code</Label>
                <Input
                  id="otp"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  className="mt-1.5 h-12 text-center font-mono text-xl tracking-[0.4em]"
                  autoFocus
                />
              </div>
              <Button type="submit" disabled={busy || code.length !== 6} className="h-11 w-full rounded-md">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Verify
              </Button>
            </form>
          ) : (
            <Button onClick={checkNow} disabled={busy} className="mt-5 h-11 w-full rounded-md">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              I've confirmed — continue
            </Button>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
            <Button variant="ghost" size="sm" onClick={send} disabled={busy || cooldown > 0}>
              {cooldown > 0 ? `Resend in ${cooldown}s` : OTP_ENABLED ? "Send a new code" : "Resend email"}
            </Button>
            <Button variant="ghost" size="sm" onClick={switchAccount}>
              <LogOut className="mr-1.5 h-4 w-4" /> Use a different account
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Can't find it? Check your spam folder. Wrong address? Use a different account and sign up again.
          </p>
        </Card>
      </div>
    </main>
  );
}
