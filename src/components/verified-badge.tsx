import { BadgeCheck } from "lucide-react";

/** Small blue tick shown next to students whose official university email was verified. */
export function VerifiedBadge({ name, className = "" }: { name?: string | null; className?: string }) {
  const label = name ? `Verified student of ${name}` : "Verified student";
  return (
    <span title={label} className={`inline-flex shrink-0 align-middle ${className}`}>
      <BadgeCheck className="h-4 w-4 text-sky-500" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
