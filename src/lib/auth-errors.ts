import { checkEmail, checkPassword } from "./email-policy";

/**
 * Helper utilities for formatting and validating authentication errors
 */

/** Machine-readable code (Firebase `auth/...`, Firestore `permission-denied`, `storage/...`), if any. */
export function authErrorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") {
      const m = message.match(/\((auth\/[a-z0-9-]+)\)/i);
      if (m) return m[1];
    }
  }
  return "";
}

const MESSAGES: Record<string, string> = {
  "auth/invalid-api-key":
    "The Firebase API key is missing or invalid. The site owner must set the VITE_FIREBASE_* environment variables (Vercel → Project Settings → Environment Variables) and redeploy.",
  "auth/api-key-not-valid":
    "The Firebase API key is missing or invalid. The site owner must set the VITE_FIREBASE_* environment variables and redeploy.",
  "auth/configuration-not-found":
    "Authentication isn't set up for this Firebase project yet. The site owner must open Firebase console → Authentication → Get started.",
  "auth/operation-not-allowed":
    "This sign-in method is turned off. The site owner must enable it in Firebase console → Authentication → Sign-in method.",
  "auth/wrong-password": "Incorrect email or password. Please check your details and try again.",
  "auth/user-not-found": "Incorrect email or password. Please check your details and try again.",
  "auth/invalid-credential": "Incorrect email or password. Please check your details and try again.",
  "auth/invalid-login-credentials": "Incorrect email or password. Please check your details and try again.",
  "auth/invalid-email": "That email address isn't valid. Please check for typos.",
  "auth/email-already-in-use": "An account with this email already exists. Try signing in instead.",
  "auth/weak-password": "That password is too weak. Use at least 8 characters with letters and numbers.",
  "auth/too-many-requests":
    "Too many attempts. For your security this device is temporarily blocked — wait a few minutes, or reset your password.",
  "auth/user-disabled": "This account has been disabled. Please contact support.",
  "auth/popup-closed-by-user": "The Google sign-in window was closed before finishing. Please try again.",
  "auth/cancelled-popup-request": "Another sign-in window was already open. Close it and try again.",
  "auth/popup-blocked":
    "Your browser blocked the Google sign-in window. Allow pop-ups for this site (look for the blocked-popup icon in the address bar) and try again.",
  "auth/network-request-failed": "Network error — check your internet connection and try again.",
  "auth/requires-recent-login": "For your security, please sign in again and retry.",
  "auth/account-exists-with-different-credential":
    "An account already exists with this email using a different sign-in method. Sign in with that method instead.",
  "auth/internal-error": "Sign-in service hiccup on Google's side. Please try again in a moment.",
  "auth/missing-email": "Please enter your email address.",
  "auth/expired-action-code": "That link has expired. Please request a new one.",
  "auth/invalid-action-code": "That link is invalid or has already been used. Please request a new one.",
  "auth/captcha-check-failed": "Security check failed. Please refresh the page and try again.",
  "permission-denied":
    "You're signed in, but the database refused to set up your profile. If you're the site owner: the deployed Firestore rules don't match this version of the app — redeploy them (firebase deploy --only firestore:rules).",
  unavailable: "The service is temporarily unreachable. Check your connection and try again.",
  "failed-precondition":
    "A required database index is still building or missing. If you're the site owner, deploy firestore.indexes.json and wait for it to finish.",
  "resource-exhausted": "Too many requests right now. Please wait a moment and try again.",
  "storage/unauthorized": "You don't have permission to upload that file.",
  "storage/retry-limit-exceeded": "The upload timed out. Check your connection and try again.",
  "storage/quota-exceeded": "Storage quota exceeded. Please contact support.",
  "functions/unauthenticated": "Please sign in again and retry.",
  "functions/resource-exhausted": "Too many requests. Please wait a minute before asking for another code.",
  "functions/failed-precondition": "That request can't be completed right now.",
  "functions/invalid-argument": "That doesn't look right — please check and try again.",
};

/**
 * Turn any thrown value into a message people can act on. For domain problems — the most common cause of Google
 * sign-in failing right after a new deployment — we tell the site owner exactly which hostname to authorize.
 * A short error code is appended so a screenshot is enough to diagnose the problem.
 */
export function formatAuthError(err: unknown): string {
  if (!err) return "An unknown error occurred. Please try again.";
  if (typeof err === "string") return cleanRawErrorMessage(err);

  const code = authErrorCode(err);
  const rawMessage = typeof (err as { message?: unknown }).message === "string" ? (err as { message: string }).message : "";

  if (code === "auth/unauthorized-domain") {
    const host = typeof window !== "undefined" ? window.location.hostname : "this domain";
    return `Google sign-in isn't allowed from “${host}”. If you're the site owner: Firebase console → Authentication → Settings → Authorized domains → Add domain → ${host}. [${code}]`;
  }

  if (code && MESSAGES[code]) {
    return `${MESSAGES[code]}${isSensitiveCode(code) ? "" : ` [${code}]`}`;
  }

  // Our own thrown Errors (validation, "Username taken", …) carry a readable message and no code.
  if (!code && rawMessage && !/^Firebase:/i.test(rawMessage)) return rawMessage;

  if (rawMessage) {
    if (/api key/i.test(rawMessage) || /invalid-api-key/i.test(rawMessage)) return MESSAGES["auth/invalid-api-key"];
    return `${cleanRawErrorMessage(rawMessage)}${code ? ` [${code}]` : ""}`;
  }
  return `Something went wrong. Please try again.${code ? ` [${code}]` : ""}`;
}

/** Don't append codes to the generic wrong-password family (adds noise and nothing useful). */
function isSensitiveCode(code: string): boolean {
  return ["auth/wrong-password", "auth/user-not-found", "auth/invalid-credential", "auth/invalid-login-credentials"].includes(code);
}

function cleanRawErrorMessage(msg: string): string {
  return msg
    .replace(/^Firebase:\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .replace(/\s*\(auth\/[^)]+\)\.?$/i, "")
    .trim();
}

export interface AuthValidationResult {
  valid: boolean;
  error?: string;
}

export function validateSignIn(email: string, password: string): AuthValidationResult {
  const trimmedEmail = email.trim();
  if (!trimmedEmail) {
    return { valid: false, error: "Please enter your email address." };
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    return { valid: false, error: "Please enter a valid email address (e.g. user@example.com)." };
  }
  if (!password) {
    return { valid: false, error: "Please enter your password." };
  }
  return { valid: true };
}

export function validateSignUp(params: {
  email: string;
  password: string;
  name?: string;
  role: "student" | "tutor" | "admin";
  credentials?: string;
  bio?: string;
}): AuthValidationResult {
  const emailCheck = checkEmail(params.email);
  if (!emailCheck.ok) return { valid: false, error: emailCheck.error };

  if (params.name !== undefined && !params.name.trim()) {
    return { valid: false, error: "Please enter your full name." };
  }

  const pwCheck = checkPassword(params.password);
  if (!pwCheck.ok) return { valid: false, error: pwCheck.error };

  if (params.role === "tutor") {
    if (params.credentials !== undefined && !params.credentials.trim()) {
      return { valid: false, error: "Please provide your academic or tutoring credentials." };
    }
    if (params.bio !== undefined && !params.bio.trim()) {
      return { valid: false, error: "Please provide a short bio explaining what you teach." };
    }
  }

  return { valid: true };
}
