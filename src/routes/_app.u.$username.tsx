import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, MapPin, GraduationCap, MessageSquare, UserPlus, Check } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { VerifiedBadge } from "@/components/verified-badge";
import { useAuth } from "@/hooks/use-auth";
import { areBuddies, getPendingRequestBetween } from "@/services/buddies";
import { errorMessage, isUserOnline } from "@/services/common";
import { getUserByUsername, type UserDoc } from "@/services/users";
import { sendFriendRequest } from "@/lib/friends-service";

export const Route = createFileRoute("/_app/u/$username")({
  head: ({ params }) => ({
    meta: [{ title: `@${params.username} — Cortex` }, { name: "robots", content: "noindex" }],
  }),
  component: PublicProfilePage,
});

function PublicProfilePage() {
  const { username } = Route.useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [person, setPerson] = useState<UserDoc | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [relation, setRelation] = useState<"none" | "buddy" | "pending" | "self">("none");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const u = await getUserByUsername(username);
        if (cancelled) return;
        if (!u) {
          setState("missing");
          return;
        }
        setPerson(u);
        if (user && u.uid === user.uid) setRelation("self");
        else if (user) {
          const [buddy, pending] = await Promise.all([areBuddies(user.uid, u.uid), getPendingRequestBetween(user.uid, u.uid)]);
          if (!cancelled) setRelation(buddy ? "buddy" : pending ? "pending" : "none");
        }
        setState("ready");
      } catch (err) {
        console.error("[Cortex] public profile failed", err);
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, user]);

  async function addBuddy() {
    if (!person || !user) return;
    setBusy(true);
    try {
      const res = await sendFriendRequest({ ...(profile as unknown as UserDoc), uid: user.uid }, { uid: person.uid, displayName: person.displayName } as never);
      res.success ? toast.success(res.message) : toast.info(res.message);
      if (res.success) setRelation("pending");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't send the request."));
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return (
      <div className="grid place-items-center p-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading profile" />
      </div>
    );
  }
  if (state === "missing" || state === "error" || !person) {
    return (
      <div className="mx-auto max-w-lg p-10 text-center">
        <h1 className="font-display text-2xl">{state === "error" ? "Couldn't load this profile" : "Profile not found"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {state === "error" ? "Please check your connection and try again." : `There's no one on Cortex with the username @${username}.`}
        </p>
        <Button asChild className="mt-6 rounded-xl"><Link to="/buddy">Find study buddies</Link></Button>
      </div>
    );
  }

  const online = isUserOnline(person);
  return (
    <div className="mx-auto max-w-3xl p-6 md:p-8">
      <Card className="overflow-hidden rounded-3xl border-border p-0 shadow-soft">
        <div
          className={`h-36 w-full bg-cover bg-center md:h-44 ${person.coverImageUrl ? "" : "bg-gradient-primary"}`}
          style={person.coverImageUrl ? { backgroundImage: `url(${person.coverImageUrl})` } : undefined}
        />
        <div className="relative p-6 pt-0">
          <Avatar className="-mt-14 h-28 w-28 rounded-3xl border-4 border-background shadow-elegant">
            <AvatarImage src={person.avatarUrl || undefined} />
            <AvatarFallback className="bg-primary text-2xl font-bold text-primary-foreground">
              {(person.displayName || "S").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-1.5 font-display text-2xl tracking-tight">
                {person.displayName}
                {person.universityVerified && <VerifiedBadge name={person.verifiedUniversityName} />}
              </h1>
              <div className="font-mono text-sm text-muted-foreground">@{person.username}</div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {person.institution && (
                  <span className="flex items-center gap-1"><GraduationCap className="h-4 w-4" aria-hidden="true" />{person.institution}</span>
                )}
                {person.country && (
                  <span className="flex items-center gap-1"><MapPin className="h-4 w-4" aria-hidden="true" />{person.country}</span>
                )}
                <span className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-muted-foreground/40"}`} aria-hidden="true" />
                  {online ? "Online now" : "Offline"}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              {relation === "self" ? (
                <Button asChild variant="outline" className="rounded-xl"><Link to="/profile">Edit my profile</Link></Button>
              ) : (
                <>
                  {relation === "buddy" ? (
                    <Badge variant="secondary" className="h-10 rounded-xl px-3"><Check className="mr-1.5 h-4 w-4" />Study buddies</Badge>
                  ) : (
                    <Button onClick={addBuddy} disabled={busy || relation === "pending"} className="rounded-xl bg-gradient-primary text-primary-foreground">
                      <UserPlus className="mr-1.5 h-4 w-4" />
                      {relation === "pending" ? "Request pending" : "Add study buddy"}
                    </Button>
                  )}
                  <Button variant="outline" className="rounded-xl" onClick={() => navigate({ to: "/messages", search: { user: person.username } as never })}>
                    <MessageSquare className="mr-1.5 h-4 w-4" /> Message
                  </Button>
                </>
              )}
            </div>
          </div>

          {person.about && <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{person.about}</p>}

          {(person.degreeOrStream || person.semesterOrYear) && (
            <p className="mt-4 text-sm"><span className="text-muted-foreground">Studying:</span> {[person.degreeOrStream, person.semesterOrYear].filter(Boolean).join(" · ")}</p>
          )}

          {(person.teach?.length || person.learn?.length) ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {person.teach?.length ? (
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Can help with</div>
                  <div className="flex flex-wrap gap-1.5">{person.teach.map((t) => <Badge key={t} variant="secondary" className="rounded-full">{t}</Badge>)}</div>
                </div>
              ) : null}
              {person.learn?.length ? (
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Wants to learn</div>
                  <div className="flex flex-wrap gap-1.5">{person.learn.map((t) => <Badge key={t} variant="outline" className="rounded-full">{t}</Badge>)}</div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
