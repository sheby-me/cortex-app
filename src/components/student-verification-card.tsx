import { useMemo, useState } from "react";
import { BadgeCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useInstitutions } from "@/components/institution-select";
import { errorMessage } from "@/services/common";
import { checkUniversityEmail, confirmUniversityVerification, startUniversityVerification } from "@/services/university-verification";

interface Props {
  verified: boolean;
  verifiedName: string | null;
  institutionName: string;
  institutionId: string | null;
  accountEmail: string;
}

/**
 * Settings card: prove you study at the university chosen in your profile by confirming a code sent to your official
 * university email. The domain must belong to that university; the badge itself is granted only by a Cloud Function.
 */
export function StudentVerificationCard({ verified, verifiedName, institutionName, institutionId, accountEmail }: Props) {
  const institutions = useInstitutions();
  const inst = useMemo(() => institutions.find((i) => i.id === institutionId), [institutions, institutionId]);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    try {
      checkUniversityEmail(email, inst);
    } catch (err) {
      toast.error(errorMessage(err));
      return;
    }
    setBusy(true);
    try {
      const instantly = await startUniversityVerification(email);
      if (instantly) toast.success("Verified! Your Verified Student badge is now on your profile.");
      else {
        setSent(true);
        toast.success(`We emailed a 6-digit code to ${email.trim()}.`);
      }
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't start verification. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      toast.error("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    try {
      await confirmUniversityVerification(code);
      toast.success("Verified! Your Verified Student badge is now on your profile.");
      setSent(false);
      setCode("");
    } catch (err) {
      toast.error(errorMessage(err, "That code didn't work. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="rounded-3xl border-border p-6 shadow-soft space-y-4">
      <div className="flex items-center gap-2 border-b border-border pb-3 text-lg font-semibold">
        <BadgeCheck className="h-5 w-5 text-sky-500" aria-hidden="true" />
        Student verification
      </div>

      {verified ? (
        <p className="text-sm">
          <span className="font-semibold text-sky-600 dark:text-sky-400">Verified student</span> of{" "}
          <strong>{verifiedName ?? institutionName}</strong>. Your badge shows on your profile and in search. Your
          university can't be changed while you're verified.
        </p>
      ) : !institutionId ? (
        <p className="text-sm text-muted-foreground">
          Pick your university in <strong>Institution / University</strong> above and save — then come back here to verify
          with your official university email.
        </p>
      ) : inst && (inst.type !== "university" || inst.domains.length === 0) ? (
        <p className="text-sm text-muted-foreground">
          Email verification isn't available for <strong>{institutionName}</strong> yet.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Confirm you study at <strong className="text-foreground">{institutionName}</strong> with your official student
            email{inst?.domains[0] ? <> (ends with <span className="font-mono">@{inst.domains[0]}</span>)</> : null}. We send a
            one-time code to that address; it can only be linked to one Cortex account.
          </p>

          <form onSubmit={send} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem] flex-1">
              <Label htmlFor="uni-email" className="text-xs font-semibold">University email</Label>
              <Input
                id="uni-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={inst?.domains[0] ? `student@${inst.domains[0]}` : "student@university.edu"}
                className="mt-1.5 rounded-xl"
              />
              {accountEmail && <p className="mt-1 text-xs text-muted-foreground">Your sign-in email is {accountEmail}.</p>}
            </div>
            <Button type="submit" disabled={busy || !email.trim()} variant="outline" className="rounded-xl">
              {busy && !sent ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {sent ? "Send a new code" : "Send code"}
            </Button>
          </form>

          {sent && (
            <form onSubmit={confirm} className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="uni-code" className="text-xs font-semibold">6-digit code</Label>
                <Input
                  id="uni-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="mt-1.5 w-40 rounded-xl text-center font-mono tracking-[0.3em]"
                  placeholder="123456"
                />
              </div>
              <Button type="submit" disabled={busy || code.length !== 6} className="rounded-xl bg-gradient-primary text-primary-foreground">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Verify
              </Button>
            </form>
          )}
        </>
      )}
    </Card>
  );
}
