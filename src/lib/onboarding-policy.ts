/**
 * Pure validation/normalisation for the onboarding ("complete your profile") form, kept out of the React component so
 * it can be unit-tested (tests/unit/onboarding-policy.test.cjs).
 */
import { validatePersonName } from "./name-policy";
import { checkUsernameFormat, cleanUsername } from "./username-policy";

export type UsernameState = "idle" | "checking" | "free" | "taken" | "invalid";

export interface OnboardingValues {
  name: string;
  username: string;
  usernameState: UsernameState;
  usernameMessage: string | null;
  country: string;
  institution: string;
  level: string;
  timezone: string;
}

export interface OnboardingErrors {
  name: string | null;
  username: string | null;
  country: string | null;
  institution: string | null;
  level: string | null;
  timezone: string | null;
}

export type OnboardingField = keyof OnboardingErrors;

/** Order in which fields appear on the page — the first invalid one is focused and reported. */
export const ONBOARDING_FIELD_ORDER: OnboardingField[] = ["name", "username", "country", "level", "institution", "timezone"];

export function validateOnboarding(v: OnboardingValues): {
  errors: OnboardingErrors;
  firstInvalid: OnboardingField | null;
  firstError: string | null;
  valid: boolean;
} {
  const name = validatePersonName(v.name, "full name");
  const clean = cleanUsername(v.username);
  const fmt = checkUsernameFormat(clean);

  let username: string | null = null;
  if (!clean) username = "Choose a username.";
  else if (!fmt.ok) username = fmt.error ?? "That username isn't valid.";
  else if (v.usernameState === "taken") username = v.usernameMessage ?? `@${clean} is already taken. Try another.`;
  // "checking" / "idle" / "free": the transactional claim on save is the real uniqueness guarantee.

  const errors: OnboardingErrors = {
    name: name.ok ? null : (name.error ?? "Please enter a valid name."),
    username,
    country: v.country ? null : "Select your country.",
    institution: v.institution.trim() ? null : "Select your school or university.",
    level: v.level ? null : "Select your academic level.",
    timezone: v.timezone ? null : "Select your timezone.",
  };
  const firstInvalid = ONBOARDING_FIELD_ORDER.find((f) => errors[f]) ?? null;
  return { errors, firstInvalid, firstError: firstInvalid ? errors[firstInvalid] : null, valid: firstInvalid === null };
}

/** Values that are persisted, normalised (trimmed name, lower-case username, empty optionals → null). */
export function buildOnboardingUpdate(v: {
  name: string;
  username: string;
  country: string;
  institution: string;
  institutionId: string | null;
  level: string;
  semester: string;
  degree: string;
  timezone: string;
  bio: string;
  teach: string[];
  learn: string[];
  hours: number;
}) {
  return {
    displayName: validatePersonName(v.name, "full name").value,
    username: cleanUsername(v.username),
    country: v.country,
    institution: v.institution.trim(),
    institutionId: v.institutionId,
    gradeLevel: v.level,
    semesterOrYear: v.semester.trim() || null,
    degreeOrStream: v.degree.trim() || null,
    timezone: v.timezone,
    about: v.bio.trim() || null,
    teach: v.teach,
    learn: v.learn,
    hoursGoal: Math.max(1, Number.isFinite(v.hours) && v.hours > 0 ? Math.round(v.hours) : 5),
    onboarded: true,
  };
}
