/**
 * Client-side email hygiene. This is a *usability* filter (catch typos and throw-away inboxes early);
 * the real guarantees are enforced server-side: the account must prove it owns the mailbox (verification link or
 * one-time code) and firestore.rules refuses writes from unverified accounts and known disposable domains.
 */

/** Well-known throw-away mailbox providers. Not exhaustive — keep in sync with the regex in firestore.rules. */
export const DISPOSABLE_DOMAINS = [
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "sharklasers.com",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "throwawaymail.com",
  "fakeinbox.com",
  "mintemail.com",
  "emailondeck.com",
  "mohmal.com",
  "moakt.com",
  "burnermail.io",
  "tempr.email",
];

/** Common typos of big providers → what the user probably meant. */
const TYPO_FIXES: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gamil.com": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "yaho.com": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "outlok.com": "outlook.com",
  "outlook.con": "outlook.com",
  "icloud.con": "icloud.com",
};

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export function domainOf(email: string): string {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

export interface EmailCheck {
  ok: boolean;
  error?: string;
}

export function checkEmail(raw: string): EmailCheck {
  const email = raw.trim();
  if (!email) return { ok: false, error: "Please enter your email address." };
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, error: "That doesn't look like a valid email address (e.g. name@university.edu)." };
  }
  const domain = domainOf(email);
  if (TYPO_FIXES[domain]) {
    return { ok: false, error: `Did you mean ${email.split("@")[0]}@${TYPO_FIXES[domain]}?` };
  }
  if (DISPOSABLE_DOMAINS.includes(domain)) {
    return {
      ok: false,
      error: "Temporary or disposable email addresses can't be used. Please use your real email address.",
    };
  }
  return { ok: true };
}

/** At least 8 characters with a letter and a number; rejects the most common passwords. */
const COMMON = ["password", "password1", "12345678", "123456789", "qwerty123", "iloveyou", "11111111", "abc12345", "password123", "cortex123"];
export function checkPassword(pw: string): EmailCheck {
  if (pw.length < 8) return { ok: false, error: `Password must be at least 8 characters (currently ${pw.length}).` };
  if (pw.length > 128) return { ok: false, error: "Password is too long (max 128 characters)." };
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return { ok: false, error: "Use a mix of letters and numbers in your password." };
  if (COMMON.includes(pw.toLowerCase())) return { ok: false, error: "That password is too common. Please choose a less guessable one." };
  return { ok: true };
}
