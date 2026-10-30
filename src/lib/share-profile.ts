import { UserError } from "./friendly-errors";

/** Public profile address, e.g. https://cortex.example/u/ayesha_khan */
export function profileUrl(username: string | null | undefined): string {
  if (!username) throw new UserError("Choose a username first — your profile link is built from it.");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/u/${encodeURIComponent(username)}`;
}

export async function copyProfileLink(username: string | null | undefined): Promise<string> {
  const url = profileUrl(username);
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // Clipboard API can be blocked (insecure context / permissions): fall back to a temporary textarea.
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (!ok) throw new UserError("Couldn't copy the link. Please copy it from the address bar of your profile page.");
  }
  return url;
}

export function openProfileLink(username: string | null | undefined): void {
  const url = profileUrl(username);
  window.open(url, "_blank", "noopener,noreferrer");
}

export const canNativeShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

/** Opens the device share sheet (Web Share API). Resolves false when the user dismissed it. */
export async function nativeShareProfile(username: string | null | undefined, name: string): Promise<boolean> {
  const url = profileUrl(username);
  try {
    await navigator.share({ title: `${name} on Cortex`, text: `Study with ${name} on Cortex`, url });
    return true;
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") return false;
    throw err;
  }
}

/** Convenience used by the Share menu. */
export const shareProfile = { profileUrl, copyProfileLink, openProfileLink, canNativeShare, nativeShareProfile };
