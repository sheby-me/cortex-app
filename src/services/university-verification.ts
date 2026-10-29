/** Student verification with an official university email (Cloud Functions: startUniversityVerification / confirmUniversityVerification). */
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/integrations/firebase/client";
import { emailMatchesInstitution, type Institution } from "@/data/universities";
import { checkEmail } from "@/lib/email-policy";
import { UserError } from "@/lib/friendly-errors";

/** Quick client-side check (the Cloud Function repeats it — this only avoids a wasted round trip). */
export function checkUniversityEmail(email: string, inst: Institution | undefined): void {
  if (!inst) throw new UserError("Select your university in your profile first, then save.");
  if (inst.type !== "university" || inst.domains.length === 0) {
    throw new UserError("Email verification isn't available for your institution yet.");
  }
  const basic = checkEmail(email);
  if (!basic.ok) throw new UserError(basic.error ?? "Enter a valid email address.");
  if (!emailMatchesInstitution(email, inst)) {
    throw new UserError(`Use your official ${inst.name} email address (it ends with @${inst.domains[0]}).`);
  }
}

/** Returns true when verification was granted immediately (the address was already the proven sign-in email). */
export async function startUniversityVerification(email: string): Promise<boolean> {
  const res = await httpsCallable<{ email: string }, { ok: boolean; verified: boolean }>(getFunctions(app), "startUniversityVerification")({ email: email.trim() });
  return !!res.data.verified;
}

export async function confirmUniversityVerification(code: string): Promise<void> {
  await httpsCallable(getFunctions(app), "confirmUniversityVerification")({ code: code.trim() });
}
