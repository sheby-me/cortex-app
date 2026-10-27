/**
 * Email ownership verification. Two interchangeable mechanisms:
 *
 *  • Verification LINK (default): Firebase sends an email with a link; clicking it marks the account verified.
 *  • One-time CODE (VITE_EMAIL_OTP=true): the `sendEmailOtp` / `verifyEmailOtp` Cloud Functions (see /functions) email a
 *    6-digit code that expires after 10 minutes and allows 5 attempts. Requires the Blaze plan + SMTP credentials.
 *
 * Either way firestore.rules refuses everything except sign-up writes until the ID token says email_verified = true.
 */
import { sendEmailVerification, type User } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/integrations/firebase/client";

export const OTP_ENABLED = import.meta.env.VITE_EMAIL_OTP === "true";

export async function sendVerification(user: User): Promise<void> {
  if (OTP_ENABLED) {
    await httpsCallable(getFunctions(app), "sendEmailOtp")({});
    return;
  }
  await sendEmailVerification(user);
}

/** Returns normally when the code was accepted; throws a `functions/...` error otherwise. */
export async function confirmOtp(code: string): Promise<void> {
  await httpsCallable(getFunctions(app), "verifyEmailOtp")({ code: code.trim() });
}
