/**
 * One place that decides what the user sees when something fails.
 *
 * Rules:
 *  • Users only ever see short, plain-language sentences — never Firebase codes, stack traces, SDK messages or
 *    anything about rules/indexes/domains.
 *  • Full technical detail goes to the developer console (console.error) so it can still be diagnosed.
 *  • Messages we write ourselves are thrown as `UserError` and shown as-is; every other error is mapped by code
 *    or replaced with a generic sentence.
 */

/** An error whose message was written for end users and is safe to display. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export const GENERIC_ERROR = "Something went wrong. Please try again.";

const BY_CODE: Record<string, string> = {
  // authentication
  "auth/wrong-password": "Incorrect email or password.",
  "auth/user-not-found": "Incorrect email or password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/invalid-login-credentials": "Incorrect email or password.",
  "auth/invalid-email": "That email address doesn't look right. Please check it.",
  "auth/email-already-in-use": "An account with this email already exists. Try signing in instead.",
  "auth/weak-password": "That password is too weak. Use at least 8 characters with letters and numbers.",
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  "auth/user-disabled": "This account has been disabled. Please contact support.",
  "auth/popup-closed-by-user": "The Google sign-in window was closed before finishing. Please try again.",
  "auth/cancelled-popup-request": "Another sign-in window is already open. Close it and try again.",
  "auth/popup-blocked": "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.",
  "auth/network-request-failed": "Network problem. Check your internet connection and try again.",
  "auth/requires-recent-login": "For your security, please sign in again and retry.",
  "auth/account-exists-with-different-credential": "An account with this email already exists using a different sign-in method.",
  "auth/missing-email": "Please enter your email address.",
  "auth/expired-action-code": "That link has expired. Please request a new one.",
  "auth/invalid-action-code": "That link is no longer valid. Please request a new one.",
  "auth/unauthorized-domain": "Google sign-in isn't available on this web address yet. Please contact the site administrator.",
  "auth/operation-not-allowed": "This sign-in method isn't available right now. Please try another one.",
  "auth/invalid-api-key": "Sign-in is temporarily unavailable. Please try again later.",
  "auth/api-key-not-valid": "Sign-in is temporarily unavailable. Please try again later.",
  "auth/configuration-not-found": "Sign-in is temporarily unavailable. Please try again later.",
  "auth/internal-error": "Sign-in is having a hiccup. Please try again in a moment.",
  // database
  "permission-denied": "You don't have permission to perform this action.",
  unauthenticated: "Please sign in again to continue.",
  "not-found": "That item no longer exists.",
  "already-exists": "That already exists.",
  unavailable: "You appear to be offline or the service is busy. Please try again.",
  "deadline-exceeded": "That took too long. Please try again.",
  "resource-exhausted": "Too many requests right now. Please wait a moment and try again.",
  "failed-precondition": "That isn't possible right now. Please try again in a moment.",
  aborted: "That conflicted with another change. Please try again.",
  cancelled: "Cancelled.",
  // storage
  "storage/unauthorized": "You don't have permission to upload that file.",
  "storage/canceled": "Upload cancelled.",
  "storage/retry-limit-exceeded": "The upload took too long. Check your connection and try again.",
  "storage/quota-exceeded": "Uploads are temporarily unavailable. Please try again later.",
  "storage/object-not-found": "That file no longer exists.",
  // cloud functions (code verification)
  "functions/unauthenticated": "Please sign in again to continue.",
  "functions/resource-exhausted": "Too many requests. Please wait a minute and try again.",
  "functions/invalid-argument": "That doesn't look right. Please check it and try again.",
  "functions/failed-precondition": "That isn't possible right now. Please try again.",
  "functions/not-found": "This feature isn't available yet.",
  "functions/unavailable": "The service is busy. Please try again shortly.",
  "functions/internal": GENERIC_ERROR,
};

const BY_SENTINEL: Record<string, string> = {
  USERNAME_TAKEN: "That username is already taken. Please choose another.",
};

export function errorCodeOf(err: unknown): string {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

/** Safe, human-readable text for any thrown value. Technical detail is logged, never returned. */
export function friendlyMessage(err: unknown, fallback: string = GENERIC_ERROR): string {
  // Developer-only diagnostics (visible in the browser console, not in the UI).
  if (typeof console !== "undefined" && err) {
    const code = errorCodeOf(err);
    if (code === "auth/unauthorized-domain" && typeof window !== "undefined") {
      console.error(
        `[Cortex] Google sign-in blocked: add "${window.location.hostname}" to Firebase console → Authentication → Settings → Authorized domains.`,
      );
    }
    console.error("[Cortex error]", err);
  }

  if (err instanceof UserError) return BY_SENTINEL[err.message] ?? err.message;
  const code = errorCodeOf(err);
  // Messages from OUR Cloud Functions (HttpsError) are written for users (“That code expired…”): show them as-is.
  if (code.startsWith("functions/") && !["functions/internal", "functions/unknown", "functions/unavailable", "functions/unauthenticated", "functions/not-found"].includes(code)) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0 && m.length < 220 && !/firebase|stack|undefined|exception/i.test(m)) return m;
  }
  if (code && BY_CODE[code]) return BY_CODE[code];
  if (typeof (err as { message?: unknown })?.message === "string") {
    const m = (err as { message: string }).message;
    if (m in BY_SENTINEL) return BY_SENTINEL[m];
  }
  return fallback;
}
