import { Link, useRouterState } from "@tanstack/react-router";
import { CortexBrand } from "@/components/cortex-logo";
import {
  LayoutDashboard,
  Search,
  Users,
  LifeBuoy,
  BookOpen,
  MessagesSquare,
  Sparkles,
  ListChecks,
  Map,
  Trophy,
  Award,
  Mail,
  Bell,
  User,
  Settings,
  GraduationCap,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";

const learn = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Find Tutors", url: "/tutors", icon: Search },
  { title: "Study Buddy", url: "/buddy", icon: Users },
  { title: "SOS Help", url: "/sos", icon: LifeBuoy },
  { title: "Study Groups", url: "/groups", icon: BookOpen },
  { title: "Community", url: "/community", icon: MessagesSquare },
];
const grow = [
  { title: "AI Assistant", url: "/ai", icon: Sparkles },
  { title: "Quizzes", url: "/quizzes", icon: ListChecks },
  { title: "Roadmaps", url: "/roadmaps", icon: Map },
  { title: "Leaderboard", url: "/leaderboard", icon: Trophy },
  { title: "Achievements", url: "/achievements", icon: Award },
];
const me = [
  { title: "Messages", url: "/messages", icon: Mail },
  { title: "Notifications", url: "/notifications", icon: Bell },
  { title: "Profile", url: "/profile", icon: User },
  { title: "Settings", url: "/settings", icon: Settings },
];
export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (p: string) => pathname === p || pathname.startsWith(p + "/");
  const { user, profile, role } = useAuth();
  const displayName =
    profile?.displayName || user?.displayName || user?.email?.split("@")[0] || "Guest";
  const initials = displayName.slice(0, 2).toUpperCase();

  const section = (label: string, items: typeof learn) => (
    <SidebarGroup>
      <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton
                asChild
                isActive={isActive(item.url)}
                className="rounded-xl h-10 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-semibold"
              >
                <Link to={item.url as string} className="flex items-center gap-3">
                  <item.icon className="h-4 w-4" />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  const isTutor = role === "tutor";

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="p-4">
        <Link to="/">
          <CortexBrand subtitle="Peer Learning" />
        </Link>
      </SidebarHeader>
      <SidebarContent className="px-2">
        {isTutor ? (
          <>
            {section("Workspace", [
              { title: "Teacher Studio", url: "/teacher", icon: GraduationCap },
            ])}
            {section("Learn", learn)}
            {section("Grow", grow)}
            {section("You", me)}
          </>
        ) : (
          <>
            {section("Learn", learn)}
            {section("Grow", grow)}
            {section("You", me)}
          </>
        )}
      </SidebarContent>
      <SidebarFooter className="p-3">
        <Link
          to="/profile"
          className="flex items-center gap-3 rounded-md border border-sidebar-border bg-sidebar-accent/40 p-2.5 transition hover:bg-sidebar-accent"
        >
          <Avatar className="h-9 w-9">
            <AvatarImage src={profile?.avatarUrl || user?.photoURL || undefined} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{displayName}</div>
            <div className="flex items-center gap-1">
              <Badge
                variant="secondary"
                className="h-4 rounded-md px-1.5 text-xs font-medium capitalize"
              >
                {role ?? "guest"}
              </Badge>
            </div>
          </div>
        </Link>
      </SidebarFooter>
    </Sidebar>
  );
}
