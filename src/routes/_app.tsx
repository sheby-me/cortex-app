import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bell, Search, Sparkles, LogOut, Loader2 } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/use-auth";
import { CortexHelpDialog } from "@/components/cortex-help";
import { getUnreadNotificationCount, NOTIFICATION_EVENT } from "@/lib/notifications-store";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

const STUDENT_HOME = "/dashboard";

// Routes that students are not allowed to visit
const STUDENT_BLOCKED = ["/teacher"];

function AppLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { user, role, loading, profile, emailVerified, signOut: ctxSignOut } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const updateCount = () => {
      setUnreadCount(getUnreadNotificationCount());
    };
    updateCount();

    if (typeof window !== "undefined") {
      window.addEventListener(NOTIFICATION_EVENT, updateCount);
      return () => window.removeEventListener(NOTIFICATION_EVENT, updateCount);
    }
  }, []);

  // Route protection: wait for the session to be restored, then bounce anonymous visitors to /auth,
  // admins to /admin and pending tutor applicants to /pending.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    if (!emailVerified) {
      navigate({ to: "/verify-email" });
      return;
    }
    if (role === "admin") {
      navigate({ to: "/admin" });
      return;
    }
    // Profile creation can't be skipped: a unique username and the required details come first.
    if (role !== "admin" && (!profile.username || profile.onboarded !== true) && pathname !== "/onboarding") {
      navigate({ to: "/onboarding" });
      return;
    }
    if (role === "student" && profile.tutorStatus === "pending") {
      navigate({ to: "/pending" });
      return;
    }
    if (
      role === "student" &&
      STUDENT_BLOCKED.some((p) => pathname === p || pathname.startsWith(p + "/"))
    ) {
      navigate({ to: STUDENT_HOME });
    }
  }, [user, role, loading, emailVerified, pathname, navigate, profile.tutorStatus, profile.username, profile.onboarded]);

  async function signOut() {
    await ctxSignOut();
    navigate({ to: "/auth" });
  }

  // Never render protected pages (and their Firestore listeners) before we know who the user is.
  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-elegant focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur md:px-6">
            <SidebarTrigger className="shrink-0" />
            <div className="relative hidden max-w-md flex-1 md:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Search tutors, topics, groups…"
                placeholder="Search tutors, topics, groups…"
                className="h-10 rounded-md border-border bg-secondary pl-9 focus-visible:bg-background"
              />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
              <Button asChild size="sm" variant="ghost" className="rounded-md relative">
                <Link to="/notifications" title="Notifications">
                  <Bell className="h-4 w-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-destructive text-xs font-bold text-destructive-foreground">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </Link>
              </Button>
              <Button size="sm" className="rounded-md" onClick={() => setHelpOpen(true)} aria-haspopup="dialog">
                <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Ask AI
              </Button>
              <Button
                onClick={signOut}
                size="sm"
                variant="ghost"
                className="rounded-md"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </header>
          <main id="main" tabIndex={-1} className="flex-1 min-w-0 outline-none">
            <Outlet />
          </main>
        </div>
      </div>
      <CortexHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </SidebarProvider>
  );
}
