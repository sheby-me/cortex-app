import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Users,
  Sparkles,
  Plus,
  MessageSquare,
  Check,
  Search,
  UserPlus,
  UserCheck,
  UserX,
  Clock,
  Building2,
  Trash2,
  Inbox,
  Send,
} from "lucide-react";
import { useAuth, type GradeLevel, type UserProfile } from "@/hooks/use-auth";
import { toast } from "sonner";
import {
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  removeFriend,
  subscribeIncomingRequests,
  subscribeOutgoingRequests,
  subscribeFriendsList,
  searchUsersByUsername,
  type FriendRequestData,
  type FriendUserData,
} from "@/lib/friends-service";
import { cleanHandle } from "@/lib/user-network";
import { getClassmates, searchUsers, type UserDoc } from "@/services/users";
import { getOrCreateDirectConversation, sendMessage } from "@/services/messaging";
import { errorMessage } from "@/services/common";

export const Route = createFileRoute("/_app/buddy")({
  head: () => ({
    meta: [
      { title: "Friends & Study Buddies — Cortex" },
      {
        name: "description",
        content:
          "Search users by username, send friend requests, and match with campus study buddies.",
      },
    ],
  }),
  component: BuddyPage,
});

interface CampusBuddyItem {
  id: string;
  name: string;
  username?: string;
  avatar: string;
  uni: string;
  semesterOrYear?: string;
  degreeOrStream?: string;
  tz: string;
  topic: string;
  exam: string;
  match: number;
  gradeLevel?: GradeLevel | string;
  isBatchmate?: boolean;
}

export function BuddyPage() {
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const currentUid = user?.uid || profile?.uid || "";

  // Active Tab
  const [activeTab, setActiveTab] = useState<"search" | "requests" | "friends" | "buddies">(
    "search",
  );

  // Real-time Firestore & Local State
  const [incomingRequests, setIncomingRequests] = useState<FriendRequestData[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestData[]>([]);
  const [friendsList, setFriendsList] = useState<FriendUserData[]>([]);

  // Search Screen state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [actionBusyUid, setActionBusyUid] = useState<string | null>(null);

  // Quick Message state
  const [selectedFriendForMsg, setSelectedFriendForMsg] = useState<FriendUserData | null>(null);
  const [msgText, setMsgText] = useState("");

  // Campus Study Buddies state
  const [campusBuddies, setCampusBuddies] = useState<CampusBuddyItem[]>([]);

  // 1. Subscribe to Real-Time Listeners
  useEffect(() => {
    if (!currentUid) return;

    const unsubIncoming = subscribeIncomingRequests(currentUid, (reqs) => {
      setIncomingRequests(reqs);
    });

    const unsubOutgoing = subscribeOutgoingRequests(currentUid, (reqs) => {
      setOutgoingRequests(reqs);
    });

    const unsubFriends = subscribeFriendsList(currentUid, (friends) => {
      setFriendsList(friends);
    });

    return () => {
      unsubIncoming();
      unsubOutgoing();
      unsubFriends();
    };
  }, [currentUid]);

  const [campusLoading, setCampusLoading] = useState(true);

  /** Suggested peers: classmates first, then the most recent members — with a real overlap-based match score. */
  useEffect(() => {
    if (!currentUid) return;
    let cancelled = false;
    setCampusLoading(true);
    (async () => {
      try {
        const [mates, recent] = await Promise.all([
          profile.institution ? getClassmates(profile.institution, currentUid, 12) : Promise.resolve([] as UserDoc[]),
          searchUsers("", { excludeUid: currentUid, max: 18 }),
        ]);
        const merged = new Map<string, UserDoc>();
        [...mates, ...recent].forEach((u) => merged.set(u.uid, u));

        const myLearn = (profile.learn ?? []).map((t) => t.toLowerCase());
        const myTeach = (profile.teach ?? []).map((t) => t.toLowerCase());
        const items: CampusBuddyItem[] = Array.from(merged.values()).map((u) => {
          const sameUni = Boolean(
            u.institution &&
              profile.institution &&
              u.institution.toLowerCase().includes(profile.institution.toLowerCase()),
          );
          // +12 for every topic one of us wants to learn and the other can teach (either direction)
          const overlap =
            (u.teach ?? []).filter((t) => myLearn.includes(t.toLowerCase())).length +
            (u.learn ?? []).filter((t) => myTeach.includes(t.toLowerCase())).length;
          return {
            id: u.uid,
            name: u.displayName || "Learner",
            username: u.username || undefined,
            avatar: u.avatarUrl || "",
            uni: u.institution || "Cortex Global Network",
            semesterOrYear: u.semesterOrYear || undefined,
            degreeOrStream: u.degreeOrStream || (u.role === "tutor" ? "Verified Tutor" : "Student"),
            tz: u.timezone || "—",
            topic: u.learn?.length ? `Learning: ${u.learn.join(", ")}` : u.about || "Peer Learning",
            exam: u.role === "tutor" ? "Expert Tutor" : u.semesterOrYear || "Open to study",
            match: Math.min(98, 50 + (sameUni ? 20 : 0) + overlap * 12),
            gradeLevel: (u.gradeLevel as string | null) || undefined,
            isBatchmate: sameUni,
          };
        });
        items.sort((a, b) => b.match - a.match);
        if (!cancelled) setCampusBuddies(items);
      } catch (err) {
        console.error("Could not load suggested buddies:", err);
        if (!cancelled) setCampusBuddies([]);
      } finally {
        if (!cancelled) setCampusLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUid, profile.institution, profile.learn, profile.teach]);

  // 2. Perform Real-time Search
  const handleSearch = useCallback(
    async (q: string) => {
      setSearchQuery(q);
      if (!q.trim()) {
        setSearchResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const matches = await searchUsersByUsername(q, currentUid);
        const map = new Map<string, UserProfile>();
        matches.forEach((u) => map.set(u.uid, u));

        setSearchResults(Array.from(map.values()));
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        setIsSearching(false);
      }
    },
    [currentUid],
  );

  // Helper status checkers
  const isFriend = useCallback(
    (targetUid: string) => friendsList.some((f) => f.uid === targetUid),
    [friendsList],
  );

  const getOutgoingReq = useCallback(
    (targetUid: string) => outgoingRequests.find((r) => r.toUid === targetUid),
    [outgoingRequests],
  );

  const getIncomingReq = useCallback(
    (targetUid: string) => incomingRequests.find((r) => r.fromUid === targetUid),
    [incomingRequests],
  );

  // 3. Actions: Add Friend, Accept, Decline, Cancel, Remove
  const handleSendRequest = async (targetUser: Partial<UserProfile>) => {
    const sender = { ...profile, uid: currentUid };
    if (!currentUid || !targetUser.uid) {
      toast.error("Invalid user target.");
      return;
    }
    setActionBusyUid(targetUser.uid);
    try {
      const res = await sendFriendRequest(sender, targetUser);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      console.error("Error sending request:", err);
      toast.error("Failed to send friend request.");
    } finally {
      setActionBusyUid(null);
    }
  };

  const handleAcceptRequest = async (req: FriendRequestData) => {
    setActionBusyUid(req.id);
    try {
      await acceptFriendRequest(req);
      toast.success(`Accepted friend request from ${req.fromUser.displayName}!`);
    } catch (err) {
      console.error("Error accepting request:", err);
      toast.error("Failed to accept friend request.");
    } finally {
      setActionBusyUid(null);
    }
  };

  const handleDeclineRequest = async (reqId: string) => {
    setActionBusyUid(reqId);
    try {
      await declineFriendRequest(reqId);
      toast.info("Friend request declined.");
    } catch (err) {
      console.error("Error declining request:", err);
    } finally {
      setActionBusyUid(null);
    }
  };

  const handleCancelRequest = async (reqId: string) => {
    setActionBusyUid(reqId);
    try {
      await cancelFriendRequest(reqId);
      toast.info("Friend request cancelled.");
    } catch (err) {
      console.error("Error cancelling request:", err);
    } finally {
      setActionBusyUid(null);
    }
  };

  const handleRemoveFriend = async (friendUid: string, friendName: string) => {
    if (!window.confirm(`Are you sure you want to remove ${friendName} from your friends list?`))
      return;
    setActionBusyUid(friendUid);
    try {
      await removeFriend(currentUid, friendUid);
      toast.info(`Removed ${friendName} from friends.`);
    } catch (err) {
      console.error("Error removing friend:", err);
      toast.error("Failed to remove friend.");
    } finally {
      setActionBusyUid(null);
    }
  };

  const [sendingQuickMsg, setSendingQuickMsg] = useState(false);

  /** Sends a REAL message (creating the conversation if needed) and jumps to it. */
  const handleSendQuickMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgText.trim() || !selectedFriendForMsg || !currentUid) return;
    setSendingQuickMsg(true);
    try {
      const me = { ...(profile as unknown as UserDoc), uid: currentUid };
      const other = { ...(selectedFriendForMsg as unknown as UserDoc), uid: selectedFriendForMsg.uid };
      const convId = await getOrCreateDirectConversation(me, other);
      await sendMessage({
        conversation: {
          id: convId,
          type: "direct",
          participants: [currentUid, selectedFriendForMsg.uid],
          participantInfo: {},
        },
        sender: me,
        text: msgText,
      });
      toast.success(`Message sent to ${selectedFriendForMsg.displayName}!`);
      const target = selectedFriendForMsg;
      setSelectedFriendForMsg(null);
      setMsgText("");
      navigate({ to: "/messages", search: { conversation: convId, user: target.uid } as never });
    } catch (err) {
      toast.error(errorMessage(err, "Could not send your message."));
    } finally {
      setSendingQuickMsg(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-3xl md:text-4xl tracking-tight font-bold">
              Friends & Peer Network
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Search unique usernames, manage real-time friend requests, and study with verified
            campus peers.
          </p>
        </div>
      </div>

      {/* Tabs Layout */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "search" | "requests" | "friends" | "buddies")}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-4 rounded-2xl bg-muted/60 p-1.5">
          <TabsTrigger value="search" className="rounded-xl text-xs md:text-sm font-medium gap-1.5">
            <Search className="h-4 w-4" />
            Find Users
          </TabsTrigger>
          <TabsTrigger
            value="requests"
            className="rounded-xl text-xs md:text-sm font-medium gap-1.5 relative"
          >
            <Inbox className="h-4 w-4" />
            Requests
            {incomingRequests.length > 0 && (
              <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {incomingRequests.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="friends"
            className="rounded-xl text-xs md:text-sm font-medium gap-1.5 relative"
          >
            <Users className="h-4 w-4" />
            My Friends
            {friendsList.length > 0 && (
              <span className="ml-1 text-xs font-semibold text-muted-foreground">
                ({friendsList.length})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="buddies"
            className="rounded-xl text-xs md:text-sm font-medium gap-1.5"
          >
            <Sparkles className="h-4 w-4" />
            Campus Matcher
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: SEARCH USERS BY USERNAME */}
        <TabsContent value="search" className="mt-6 space-y-6">
          <Card className="rounded-2xl border-border bg-gradient-mesh p-6 shadow-soft">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Search className="h-4 w-4 text-primary" />
              Discover Students & Tutors by Username
            </div>
            <div className="relative mt-4 max-w-xl">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Type username (e.g. jane_doe) or name..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Type username (e.g. jane_doe) or name..."
                className="h-12 rounded-xl pl-10 pr-4 font-mono text-sm shadow-inner"
              />
            </div>
          </Card>

          {/* Search Results Grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                {searchQuery.trim()
                  ? `Search Results for "${searchQuery}"`
                  : "Discover Featured Learners"}
              </h3>
              {isSearching && (
                <span className="text-xs text-muted-foreground animate-pulse">
                  Searching Network...
                </span>
              )}
            </div>

            {searchResults.length === 0 && searchQuery.trim() && !isSearching ? (
              <Card className="rounded-2xl border-dashed border-border p-8 text-center text-muted-foreground">
                <UserX className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm font-medium text-foreground">
                  No users found matching "@{searchQuery}"
                </p>
                <p className="text-xs mt-1">
                  Make sure the username is spelled correctly or try searching by display name.
                </p>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {(searchQuery.trim()
                  ? searchResults
                  : campusBuddies.map((b) => ({
                      uid: b.id,
                      displayName: b.name,
                      username: b.username,
                      avatarUrl: b.avatar,
                      institution: b.uni,
                      gradeLevel: b.gradeLevel as GradeLevel,
                      role: "student" as const,
                    }))
                ).map((u) => {
                  const friend = isFriend(u.uid);
                  const outgoing = getOutgoingReq(u.uid);
                  const incoming = getIncomingReq(u.uid);
                  const isSelf = u.uid === currentUid;
                  const uName = u.username || cleanHandle(u.displayName || "user");

                  return (
                    <Card
                      key={u.uid}
                      className="rounded-2xl border-border p-5 shadow-soft flex flex-col justify-between hover:shadow-md transition-shadow"
                    >
                      <div className="space-y-3">
                        <div className="flex items-start gap-3">
                          <Avatar className="h-12 w-12 border border-border">
                            <AvatarImage
                              src={u.avatarUrl || undefined}
                            />
                            <AvatarFallback className="bg-primary/10 text-primary font-bold">
                              {(u.displayName || uName).slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-sm truncate flex items-center gap-1.5">
                              <span className="truncate">{u.displayName || uName}</span>
                            </div>
                            <span className="inline-flex items-center gap-1 font-mono text-xs text-primary font-medium">
                              @{uName}
                            </span>
                            <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1 truncate">
                              <Building2 className="h-3 w-3 shrink-0" />
                              <span className="truncate">{u.institution || "Cortex Global"}</span>
                            </div>
                          </div>
                        </div>

                        {u.gradeLevel && (
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="secondary"
                              className="rounded-md text-xs font-medium"
                            >
                              {u.gradeLevel}
                            </Badge>
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="mt-4 pt-3 border-t border-border flex items-center justify-end">
                        {isSelf ? (
                          <Badge variant="outline" className="rounded-xl text-xs py-1 px-3">
                            You
                          </Badge>
                        ) : friend ? (
                          <div className="flex items-center gap-2">
                            <Badge className="rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 py-1 px-3 text-xs gap-1">
                              <UserCheck className="h-3.5 w-3.5" />
                              Friends
                            </Badge>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSelectedFriendForMsg({
                                  uid: u.uid,
                                  displayName: u.displayName || uName,
                                  username: uName,
                                  avatarUrl: u.avatarUrl,
                                  institution: u.institution,
                                });
                              }}
                              className="rounded-xl h-8 px-2.5 text-xs gap-1"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              Message
                            </Button>
                          </div>
                        ) : outgoing ? (
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant="secondary"
                              className="rounded-xl py-1 px-2.5 text-xs gap-1"
                            >
                              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                              Request Pending
                            </Badge>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={actionBusyUid === outgoing.id}
                              onClick={() => handleCancelRequest(outgoing.id)}
                              className="rounded-xl h-8 text-xs text-destructive hover:text-destructive"
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : incoming ? (
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              disabled={actionBusyUid === incoming.id}
                              onClick={() => handleAcceptRequest(incoming)}
                              className="rounded-xl h-8 text-xs bg-emerald-600 text-white hover:bg-emerald-700 gap-1"
                            >
                              <Check className="h-3.5 w-3.5" />
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actionBusyUid === incoming.id}
                              onClick={() => handleDeclineRequest(incoming.id)}
                              className="rounded-xl h-8 text-xs text-destructive hover:bg-destructive/10"
                            >
                              Decline
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            disabled={actionBusyUid === u.uid}
                            onClick={() => handleSendRequest(u as UserProfile)}
                            className="rounded-xl h-8.5 px-3.5 text-xs bg-primary text-primary-foreground gap-1.5 hover:opacity-90"
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                            Add Friend
                          </Button>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* TAB 2: FRIEND REQUESTS */}
        <TabsContent value="requests" className="mt-6 space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Incoming Requests */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Inbox className="h-4 w-4 text-primary" />
                  Incoming Requests ({incomingRequests.length})
                </h3>
              </div>

              {incomingRequests.length === 0 ? (
                <Card className="rounded-2xl border-dashed border-border p-6 text-center text-muted-foreground">
                  <Inbox className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm font-medium">No pending incoming requests</p>
                  <p className="text-xs mt-1">
                    When someone sends you a request, it will appear here in real time.
                  </p>
                </Card>
              ) : (
                incomingRequests.map((req) => (
                  <Card
                    key={req.id}
                    className="rounded-2xl border-border p-4 shadow-soft flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar className="h-11 w-11 border border-border">
                        <AvatarImage
                          src={req.fromUser.avatarUrl || undefined}
                        />
                        <AvatarFallback className="bg-primary/10 font-bold">
                          {req.fromUser.displayName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate">
                          {req.fromUser.displayName}
                        </div>
                        <span className="font-mono text-xs text-primary">
                          @{req.fromUser.username}
                        </span>
                        {req.fromUser.institution && (
                          <div className="text-xs text-muted-foreground truncate">
                            {req.fromUser.institution}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        disabled={actionBusyUid === req.id}
                        onClick={() => handleAcceptRequest(req)}
                        className="rounded-xl h-8 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actionBusyUid === req.id}
                        onClick={() => handleDeclineRequest(req.id)}
                        className="rounded-xl h-8 px-2.5 text-xs text-destructive hover:bg-destructive/10"
                      >
                        Decline
                      </Button>
                    </div>
                  </Card>
                ))
              )}
            </div>

            {/* Outgoing Requests */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Send className="h-4 w-4 text-primary" />
                  Sent Requests ({outgoingRequests.length})
                </h3>
              </div>

              {outgoingRequests.length === 0 ? (
                <Card className="rounded-2xl border-dashed border-border p-6 text-center text-muted-foreground">
                  <Send className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm font-medium">No pending sent requests</p>
                  <p className="text-xs mt-1">
                    Search for peers by username to send your first friend request.
                  </p>
                </Card>
              ) : (
                outgoingRequests.map((req) => (
                  <Card
                    key={req.id}
                    className="rounded-2xl border-border p-4 shadow-soft flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar className="h-11 w-11 border border-border">
                        <AvatarImage
                          src={req.toUser.avatarUrl || undefined}
                        />
                        <AvatarFallback className="bg-primary/10 font-bold">
                          {req.toUser.displayName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate">
                          {req.toUser.displayName}
                        </div>
                        <span className="font-mono text-xs text-primary">
                          @{req.toUser.username}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="secondary" className="rounded-xl text-xs gap-1 py-1">
                        <Clock className="h-3 w-3" />
                        Pending
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={actionBusyUid === req.id}
                        onClick={() => handleCancelRequest(req.id)}
                        className="rounded-xl h-8 text-xs text-destructive hover:bg-destructive/10"
                      >
                        Cancel
                      </Button>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </div>
        </TabsContent>

        {/* TAB 3: MY FRIENDS LIST */}
        <TabsContent value="friends" className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-500" />
              Connected Friends ({friendsList.length})
            </h3>
          </div>

          {friendsList.length === 0 ? (
            <Card className="rounded-2xl border-dashed border-border p-10 text-center text-muted-foreground">
              <Users className="mx-auto h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-base font-semibold text-foreground">
                You don't have any friends added yet
              </p>
              <p className="text-xs max-w-sm mx-auto mt-1">
                Use the <span className="font-medium text-foreground font-mono">"Find Users"</span>{" "}
                tab to search by username and send friend requests!
              </p>
              <Button
                onClick={() => setActiveTab("search")}
                className="mt-4 rounded-xl bg-primary text-primary-foreground text-xs"
              >
                Search Users by Username
              </Button>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {friendsList.map((friend) => (
                <Card
                  key={friend.uid}
                  className="rounded-2xl border-border p-5 shadow-soft flex flex-col justify-between"
                >
                  <div className="flex items-start gap-3">
                    <Avatar className="h-12 w-12 border border-border">
                      <AvatarImage
                        src={friend.avatarUrl || undefined}
                      />
                      <AvatarFallback className="bg-primary/10 text-primary font-bold">
                        {friend.displayName.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm truncate">{friend.displayName}</div>
                      <span className="font-mono text-xs text-primary font-medium">
                        @{friend.username}
                      </span>
                      <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1 truncate">
                        <Building2 className="h-3 w-3 shrink-0" />
                        <span className="truncate">{friend.institution || "Cortex Learner"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedFriendForMsg(friend)}
                      className="rounded-xl h-8.5 text-xs gap-1.5 border-primary/20 text-primary hover:bg-primary/10"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Message
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={actionBusyUid === friend.uid}
                      onClick={() => handleRemoveFriend(friend.uid, friend.displayName)}
                      className="rounded-xl h-8.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* TAB 4: CAMPUS MATCHER */}
        <TabsContent value="buddies" className="mt-6 space-y-4">
          <Card className="rounded-2xl border-border bg-gradient-mesh p-6 shadow-soft">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Campus Peer Matcher
            </div>
            <p className="mt-1 max-w-xl text-xs md:text-sm text-muted-foreground">
              Match with study partners at your university or academic level for upcoming exams and
              projects.
            </p>
          </Card>

          {campusLoading && (
            <Card className="rounded-2xl border-border p-8 text-center text-sm text-muted-foreground shadow-soft">
              Finding study partners…
            </Card>
          )}
          {!campusLoading && campusBuddies.length === 0 && (
            <Card className="rounded-2xl border-border p-8 text-center text-sm text-muted-foreground shadow-soft">
              You're one of the first here — be the first to build your campus network! Add your institution and topics to your profile and invite classmates; matches will appear as people join.
            </Card>
          )}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {campusBuddies.map((b) => {
              const friend = isFriend(b.id);
              const outgoing = getOutgoingReq(b.id);
              const incoming = getIncomingReq(b.id);
              const isSelf = b.id === currentUid;

              return (
                <Card
                  key={b.id}
                  className="rounded-2xl border-border p-5 shadow-soft flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start gap-3">
                      <Avatar className="h-12 w-12 border border-border">
                        <AvatarImage src={b.avatar} />
                        <AvatarFallback className="bg-primary/10 text-primary font-bold">
                          {b.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm truncate flex items-center justify-between gap-1">
                          <span className="truncate">{b.name}</span>
                          <Badge className="rounded-full bg-primary/10 text-primary text-xs shrink-0">
                            {b.match}% match
                          </Badge>
                        </div>
                        {b.username && (
                          <span className="font-mono text-xs text-primary">@{b.username}</span>
                        )}
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">{b.uni}</div>
                      </div>
                    </div>
                    <p className="mt-3 text-xs bg-muted/50 p-2.5 rounded-xl border border-border/50 text-muted-foreground">
                      {b.topic}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border flex items-center justify-end gap-2">
                    {isSelf ? (
                      <Badge variant="outline" className="rounded-xl text-xs py-1 px-3">
                        You
                      </Badge>
                    ) : friend ? (
                      <div className="flex items-center gap-2">
                        <Badge className="rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 py-1 px-3 text-xs gap-1">
                          <UserCheck className="h-3.5 w-3.5" />
                          Friends
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSelectedFriendForMsg({
                              uid: b.id,
                              displayName: b.name,
                              username: b.username || cleanHandle(b.name),
                              avatarUrl: b.avatar,
                              institution: b.uni,
                            });
                          }}
                          className="rounded-xl h-8 px-2.5 text-xs gap-1"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          Message
                        </Button>
                      </div>
                    ) : outgoing ? (
                      <div className="flex items-center gap-1.5">
                        <Badge variant="secondary" className="rounded-xl py-1 px-2.5 text-xs gap-1">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          Request Pending
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={actionBusyUid === outgoing.id}
                          onClick={() => handleCancelRequest(outgoing.id)}
                          className="rounded-xl h-8 text-xs text-destructive hover:text-destructive"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : incoming ? (
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          disabled={actionBusyUid === incoming.id}
                          onClick={() => handleAcceptRequest(incoming)}
                          className="rounded-xl h-8 text-xs bg-emerald-600 text-white hover:bg-emerald-700 gap-1"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={actionBusyUid === incoming.id}
                          onClick={() => handleDeclineRequest(incoming.id)}
                          className="rounded-xl h-8 text-xs text-destructive hover:bg-destructive/10"
                        >
                          Decline
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        disabled={actionBusyUid === b.id}
                        onClick={() =>
                          handleSendRequest({
                            uid: b.id,
                            displayName: b.name,
                            username: b.username,
                            avatarUrl: b.avatar,
                            institution: b.uni,
                            role: "student" as const,
                          } as UserProfile)
                        }
                        className="rounded-xl h-8.5 px-3.5 text-xs bg-primary text-primary-foreground gap-1.5"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        Add Friend
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Quick Message Modal */}
      {selectedFriendForMsg && (
        <Dialog
          open={Boolean(selectedFriendForMsg)}
          onOpenChange={(open) => !open && setSelectedFriendForMsg(null)}
        >
          <DialogContent className="sm:max-w-md rounded-2xl border-border bg-card p-6 shadow-elegant">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-display font-semibold">
                <MessageSquare className="h-4.5 w-4.5 text-primary" />
                Message {selectedFriendForMsg.displayName}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Send a quick chat message to @{selectedFriendForMsg.username}.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSendQuickMessage} className="space-y-4">
              <Textarea
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                placeholder={`Hi ${selectedFriendForMsg.displayName}, want to coordinate a study session?`}
                className="min-h-[100px] rounded-xl text-sm"
                required
              />
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSelectedFriendForMsg(null)}
                  className="rounded-xl text-xs"
                >
                  Cancel
                </Button>
                <Button
                  disabled={sendingQuickMsg}
                  type="submit"
                  className="rounded-xl text-xs bg-primary text-primary-foreground gap-1.5"
                >
                  <Send className="h-3.5 w-3.5" />
                  Send Message
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
