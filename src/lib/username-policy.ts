/** Usernames: 3–20 chars, lowercase letters/digits/underscore, not reserved. Keep RESERVED in sync with firestore.rules. */
export const RESERVED_USERNAMES = [
  "admin", "administrator", "root", "system", "support", "help", "cortex", "cortexai", "official", "staff",
  "moderator", "mod", "owner", "team", "security", "contact", "info", "noreply", "null", "undefined",
  "api", "www", "about", "settings", "profile", "login", "logout", "signup", "register", "auth",
  "dashboard", "community", "tutors", "groups", "messages", "notifications", "leaderboard", "sos",
  "verify", "privacy", "terms", "anonymous", "everyone", "me", "you",
];

export function cleanUsername(raw: string): string {
  return (raw ?? "").trim().toLowerCase().replace(/^@+/, "").replace(/[^a-z0-9_]/g, "");
}

export function checkUsernameFormat(raw: string): { ok: boolean; error?: string } {
  const u = cleanUsername(raw);
  if (!u) return { ok: false, error: "Choose a username." };
  if (u.length < 3) return { ok: false, error: "Usernames need at least 3 characters." };
  if (u.length > 20) return { ok: false, error: "Usernames can be at most 20 characters." };
  if (u.startsWith("_") || u.endsWith("_")) return { ok: false, error: "A username can't start or end with an underscore." };
  if (/^\d+$/.test(u)) return { ok: false, error: "A username can't be only numbers." };
  if (RESERVED_USERNAMES.includes(u)) return { ok: false, error: "That username is reserved. Please choose another." };
  return { ok: true };
}
