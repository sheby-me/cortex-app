import { checkEmail, checkPassword } from "./email-policy";
import { validatePersonName } from "./name-policy";
import { checkUsernameFormat } from "./username-policy";
import { errorCodeOf, friendlyMessage } from "./friendly-errors";

/**
 * Helper utilities for formatting and validating authentication errors
 */

/** Machine-readable code (for logic such as "popup blocked"); never shown to users. */
export function authErrorCode(err: unknown): string {
  return errorCodeOf(err);
}

/** Friendly text for any sign-in related failure (technical detail is logged to the console only). */
export function formatAuthError(err: unknown): string {
  if (typeof err === "string") return cleanRawErrorMessage(err);
  return friendlyMessage(err, "Something went wrong. Please try again.");
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
  username?: string;
  role: "student" | "tutor" | "admin";
  credentials?: string;
  bio?: string;
}): AuthValidationResult {
  const emailCheck = checkEmail(params.email);
  if (!emailCheck.ok) return { valid: false, error: emailCheck.error };

  if (params.name !== undefined) {
    const nameCheck = validatePersonName(params.name, "full name");
    if (!nameCheck.ok) return { valid: false, error: nameCheck.error };
  }

  if (params.username !== undefined) {
    const u = checkUsernameFormat(params.username);
    if (!u.ok) return { valid: false, error: u.error };
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
