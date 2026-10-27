import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, LogOut } from "lucide-react";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/pending")({
  head: () => ({
    meta: [
      { title: "Application under review — Cortex" },
      { name: "description", content: "Your tutor application is awaiting admin verification." },
    ],
  }),
  component: PendingPage,
});

function PendingPage() {
  const navigate = useNavigate();
  const { user, role, loading, signOut: ctxSignOut } = useAuth();

  // Live status: the moment an admin approves the application the profile flips to "tutor".
  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
    else if (role === "tutor") navigate({ to: "/teacher" });
  }, [loading, user, role, navigate]);

  async function signOut() {
    await ctxSignOut();
    navigate({ to: "/auth" });
  }
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <Card className="w-full max-w-lg rounded-lg border-border p-8 shadow-soft text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-secondary">
          <Clock className="h-6 w-6" />
        </div>
        <h1 className="mt-5 font-display text-3xl tracking-tight">Application under review</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Thanks for applying to teach on Cortex. An admin will review your credentials shortly.
          You'll get access to the Teacher Studio the moment you're approved.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild variant="outline" className="rounded-md">
            <Link to="/">Back to home</Link>
          </Button>
          <Button onClick={signOut} className="rounded-md">
            <LogOut className="mr-1.5 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}
