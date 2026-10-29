/**
 * Realistic personal-name validation, following the conventions of names printed on Pakistani CNICs:
 * letters (any script, so Urdu names work too), single spaces between words, and the hyphen / apostrophe that occur in
 * real names (e.g. "Noor-ul-Ain", "Sa'ad"). Digits, emoji, symbols, punctuation such as "." or "_" and repeated or stray
 * spaces are rejected.
 */
export interface NameCheck {
  ok: boolean;
  /** Normalised value to store (trimmed, NFC). */
  value: string;
  error?: string;
}

const WORD = /^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*$/u;

export function validatePersonName(raw: string, label = "name"): NameCheck {
  const value = (raw ?? "").normalize("NFC").trim();
  const fail = (error: string): NameCheck => ({ ok: false, value, error });

  if (!value) return fail(`Please enter your ${label}.`);
  if (value.length < 2) return fail(`Your ${label} is too short.`);
  if (value.length > 60) return fail(`Your ${label} is too long (maximum 60 characters).`);
  if (/\s{2,}/.test(value)) return fail("Use a single space between words.");
  if (/\d/.test(value)) return fail(`Your ${label} can't contain numbers.`);
  if (/\p{Extended_Pictographic}/u.test(value)) return fail(`Your ${label} can't contain emojis.`);
  if (/[^\p{L}\p{M}' ’-]/u.test(value)) {
    return fail(`Use letters only — spaces, hyphens (-) and apostrophes (') are the only symbols allowed in a ${label}.`);
  }
  const words = value.split(" ");
  if (words.length > 6) return fail(`That's too many words for a ${label}.`);
  for (const w of words) {
    if (!WORD.test(w)) return fail(`“${w}” doesn't look like part of a real name. Hyphens and apostrophes must sit between letters.`);
  }
  if (/(\p{L})\1{3,}/iu.test(value)) return fail(`Please enter your real ${label} (letters repeated too many times).`);
  if (value.replace(/[^\p{L}]/gu, "").length < 2) return fail(`Your ${label} needs at least two letters.`);
  return { ok: true, value };
}
