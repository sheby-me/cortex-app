import { useEffect, useId, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { VerifiedBadge } from "@/components/verified-badge";
import { useAuth } from "@/hooks/use-auth";
import { cleanUsername } from "@/lib/username-policy";
import { searchUsers } from "@/services/users";

export interface PickedUser {
  uid: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
}

interface Props {
  value: PickedUser[];
  onChange: (users: PickedUser[]) => void;
  /** People who must not be suggested (e.g. members already in the group). */
  excludeUids?: string[];
  placeholder?: string;
  max?: number;
  id?: string;
  "aria-label"?: string;
}

/**
 * Type a name or @username and pick from live Firestore suggestions; picks become removable chips.
 * Accessible combobox: ↑/↓ to move, Enter to pick, Esc to close, Backspace removes the last chip.
 */
export function UserAutocomplete({ value, onChange, excludeUids = [], placeholder = "Type a name or @username…", max = 20, id, ...rest }: Props) {
  const { user } = useAuth();
  const listId = useId();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PickedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = term.trim().replace(/^@+/, "");
    if (q.length < 1 || !user) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const found = await searchUsers(q, { excludeUid: user.uid, max: 12 });
        if (cancelled) return;
        const taken = new Set([...value.map((v) => v.uid), ...excludeUids]);
        setResults(
          found
            .filter((u) => u.username && !taken.has(u.uid))
            .slice(0, 8)
            .map((u) => ({ uid: u.uid, username: u.username as string, displayName: u.displayName || u.username || "Learner", avatarUrl: u.avatarUrl, verified: u.universityVerified } as PickedUser & { verified?: boolean })),
        );
        setActive(0);
      } catch (err) {
        console.error("[Cortex] user search failed", err);
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, user?.uid]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(u: PickedUser) {
    if (value.length >= max) return;
    onChange([...value, { uid: u.uid, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl }]);
    setTerm("");
    setResults([]);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      if (open && results[active]) {
        e.preventDefault();
        pick(results[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && !term && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  const showList = open && term.trim().length > 0;
  return (
    <div ref={boxRef} className="relative">
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-input bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
        {value.map((u) => (
          <span key={u.uid} className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-1 pr-1.5 text-xs">
            <Avatar className="h-5 w-5">
              <AvatarImage src={u.avatarUrl || undefined} />
              <AvatarFallback className="text-[9px]">{u.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            @{u.username}
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x.uid !== u.uid))}
              aria-label={`Remove @${u.username}`}
              className="rounded-full p-0.5 hover:bg-background"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={rest["aria-label"] ?? placeholder}
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length ? "" : placeholder}
          autoComplete="off"
          className="min-w-[8rem] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        />
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-border bg-popover p-1 shadow-elegant"
        >
          {!loading && results.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">No one found for “{cleanUsername(term) || term.trim()}”.</li>
          )}
          {results.map((u, i) => (
            <li
              id={`${listId}-${i}`}
              key={u.uid}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(u);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${i === active ? "bg-accent" : ""}`}
            >
              <Avatar className="h-8 w-8">
                <AvatarImage src={u.avatarUrl || undefined} />
                <AvatarFallback>{u.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <span className="flex items-center gap-1 truncate font-medium">
                  {u.displayName}
                  {(u as { verified?: boolean }).verified && <VerifiedBadge />}
                </span>
                <span className="block truncate font-mono text-xs text-muted-foreground">@{u.username}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
