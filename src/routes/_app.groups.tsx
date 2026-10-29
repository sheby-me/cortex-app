import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Users, MessagesSquare, Check, Calendar, FileText, Lock, Globe, Loader2, LogOut, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  createGroup,
  declineInvite,
  deleteGroup,
  inviteToGroup,
  joinGroup,
  leaveGroup,
  subscribeGroupMembers,
  subscribeGroups,
  subscribeMyInvites,
  type Group,
  type GroupMember,
} from "@/services/groups";
import { groupConversationId } from "@/services/messaging";
import { errorMessage, timeAgo } from "@/services/common";
import { UserAutocomplete, type PickedUser } from "@/components/user-autocomplete";
import { RequiredMark } from "@/components/required-mark";
import type { UserDoc } from "@/services/users";

export const Route = createFileRoute("/_app/groups")({
  head: () => ({
    meta: [
      { title: "Study Groups — Cortex" },
      {
        name: "description",
        content: "Persistent study rooms with chat, notes, files and progress.",
      },
    ],
  }),
  component: GroupsPage,
});

interface GroupItem extends Group {
  members: number;
  active: string;
  joined: boolean;
}

export function GroupsPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const me = user?.uid ?? "";
  const meDoc = { ...(profile as unknown as UserDoc), uid: me };

  const [groupList, setGroupList] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invites, setInvites] = useState<
    Array<{ id: string; groupId: string; groupName: string; from: { uid: string; displayName: string } }>
  >([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    const unsubs = [
      subscribeGroups(
        me,
        (groups, memberOf) => {
          setGroupList(
            groups.map((g) => ({
              ...g,
              members: g.memberCount,
              active: g.lastActivityAt ? `Active ${timeAgo(g.lastActivityAt as never)}` : "New group",
              joined: memberOf.has(g.id),
            })),
          );
          setLoading(false);
          setLoadError(null);
        },
        (err) => {
          setLoading(false);
          setLoadError(errorMessage(err, "Couldn't load study groups."));
        },
      ),
      subscribeMyInvites(me, setInvites),
    ];
    return () => unsubs.forEach((u) => u());
  }, [me]);

  // Modal States
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSubject, setNewSubject] = useState("Computer Science");
  const [newDesc, setNewDesc] = useState("");
  const [newSchedule, setNewSchedule] = useState("Weekly on Mondays at 6:00 PM");
  const [newPrivacy, setNewPrivacy] = useState<"public" | "private">("public");
  const [invitedUsers, setInvitedUsers] = useState<PickedUser[]>([]);
  const [creating, setCreating] = useState(false);

  // Preview Modal
  const [previewGroup, setPreviewGroup] = useState<GroupItem | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [inviteMore, setInviteMore] = useState<PickedUser[]>([]);
  useEffect(() => {
    if (!previewGroup) {
      setMembers([]);
      return;
    }
    return subscribeGroupMembers(previewGroup.id, setMembers);
  }, [previewGroup?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the preview in sync with live data (member count, joined state)
  const livePreview = previewGroup ? (groupList.find((g) => g.id === previewGroup.id) ?? previewGroup) : null;

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      toast.error("Please enter a group name.");
      return;
    }

    const handles = invitedUsers.map((u) => u.username);

    setCreating(true);
    try {
      const res = await createGroup({
        owner: meDoc,
        name: newName,
        subject: newSubject,
        description: newDesc,
        schedule: newSchedule,
        privacy: newPrivacy,
        invitedHandles: handles,
      });
      setIsCreateModalOpen(false);
      if (res.invited.length > 0) {
        toast.success(`Group "${newName}" created! Invites sent to: ${res.invited.map((h) => `@${h}`).join(", ")}`);
      } else {
        toast.success(`Study group "${newName}" created successfully!`);
      }
      if (res.notFound.length > 0) {
        toast.warning(`No user found for: ${res.notFound.map((h) => `@${h}`).join(", ")}`);
      }
      setNewName("");
      setNewDesc("");
      setInvitedUsers([]);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create the group."));
    } finally {
      setCreating(false);
    }
  };

  const handleToggleJoin = async (g: GroupItem) => {
    setBusy(g.id);
    try {
      if (g.joined) {
        await leaveGroup(g, me);
        toast.info(`Left group "${g.name}".`);
      } else {
        await joinGroup(g, meDoc);
        toast.success(`You joined "${g.name}"!`);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (g: GroupItem) => {
    if (!window.confirm(`Delete "${g.name}" for everyone? This can't be undone.`)) return;
    try {
      await deleteGroup(g);
      setPreviewGroup(null);
      toast.success("Group deleted.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleInviteMore = async (g: GroupItem) => {
    const handles = inviteMore.map((u) => u.username);
    if (handles.length === 0) return;
    try {
      const res = await inviteToGroup(g, meDoc, handles);
      if (res.invited.length) toast.success(`Invited ${res.invited.map((h) => `@${h}`).join(", ")}`);
      if (res.notFound.length) toast.warning(`No user found for: ${res.notFound.map((h) => `@${h}`).join(", ")}`);
      setInviteMore([]);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const acceptInvite = async (inv: (typeof invites)[number]) => {
    setBusy(inv.id);
    try {
      // The invitation lets us read the (possibly private) group document by id.
      await joinGroup({ id: inv.groupId, privacy: "private", name: inv.groupName }, meDoc);
      toast.success(`You joined "${inv.groupName}"!`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl md:text-4xl tracking-tight font-medium">
            Study Groups
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Chat, notes, calendars and shared progress — one dedicated room per goal.
          </p>
        </div>
        <Button
          onClick={() => setIsCreateModalOpen(true)}
          className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Create Group
        </Button>
      </div>

      {invites.length > 0 && (
        <Card className="mb-6 rounded-2xl border-primary/30 bg-primary/5 p-4 shadow-soft">
          <div className="mb-2 text-sm font-semibold">You have {invites.length} group invitation{invites.length === 1 ? "" : "s"}</div>
          {invites.map((inv) => (
            <div key={inv.id} className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <b>{inv.from.displayName}</b> invited you to <b>{inv.groupName}</b>
              </span>
              <span className="flex gap-1.5">
                <Button size="sm" variant="outline" className="rounded-xl" onClick={() => declineInvite(inv.groupId, me).catch((e) => toast.error(errorMessage(e)))}>
                  Decline
                </Button>
                <Button size="sm" disabled={busy === inv.id} className="rounded-xl bg-gradient-primary text-primary-foreground" onClick={() => acceptInvite(inv)}>
                  Join
                </Button>
              </span>
            </div>
          ))}
        </Card>
      )}

      {loading && (
        <div className="py-12 text-center text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading study groups…
        </div>
      )}
      {loadError && <div className="py-12 text-center text-destructive">{loadError}</div>}
      {!loading && !loadError && groupList.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          No study groups yet — be the first to start one and invite your friends!
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groupList.map((g) => (
          <Card
            key={g.id}
            className="group flex flex-col justify-between overflow-hidden rounded-2xl border-border p-0 shadow-soft transition hover:-translate-y-0.5 hover:shadow-elegant"
          >
            <div>
              <div
                className={`h-24 bg-gradient-to-br ${g.color} p-4 flex items-start justify-between text-white`}
              >
                <Badge className="bg-white/20 text-white backdrop-blur-md border-0 rounded-full text-xs">
                  {g.subject}
                </Badge>
                <span className="flex items-center gap-1.5 text-xs font-medium bg-black/20 backdrop-blur-md px-2.5 py-1 rounded-full">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  {g.active}
                </span>
              </div>

              <div className="p-5">
                <h3 className="text-lg font-semibold tracking-tight">{g.name}</h3>
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  {g.members} member{g.members === 1 ? "" : "s"}{g.privacy === "private" ? " · private" : ""}
                </div>
                <p className="mt-2 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  {g.description}
                </p>
              </div>
            </div>

            <div className="p-5 pt-0">
              <div className="mt-2 flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setPreviewGroup(g)}
                  className="rounded-xl flex-1"
                >
                  Preview
                </Button>
                <Button
                  disabled={busy === g.id}
                  onClick={() => handleToggleJoin(g)}
                  className={`rounded-xl flex-1 transition ${
                    g.joined
                      ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 hover:bg-emerald-500/20"
                      : "bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90"
                  }`}
                >
                  {g.joined ? (
                    <>
                      <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> Joined
                    </>
                  ) : (
                    <>
                      <MessagesSquare className="mr-1.5 h-4 w-4" /> Join
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Create Group Modal */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Create New Study Group</DialogTitle>
            <DialogDescription>
              Set up a persistent study room for your course, exam, or project team.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateGroup} className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Group Name<RequiredMark />
              </label>
              <Input aria-label="e.g. Advanced Operating Systems Sprint"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Advanced Operating Systems Sprint"
                required
                className="rounded-xl"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Subject
              </label>
              <Select value={newSubject} onValueChange={setNewSubject}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Computer Science">Computer Science</SelectItem>
                  <SelectItem value="Mathematics">Mathematics</SelectItem>
                  <SelectItem value="Data Science">Data Science</SelectItem>
                  <SelectItem value="Chemistry">Chemistry</SelectItem>
                  <SelectItem value="Medical & Bio">Medical & Bio</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Meeting / Study Schedule
              </label>
              <Input aria-label="e.g. Weekly on Tuesdays at 7:00 PM"
                value={newSchedule}
                onChange={(e) => setNewSchedule(e.target.value)}
                placeholder="e.g. Weekly on Tuesdays at 7:00 PM"
                className="rounded-xl"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Invite members & study buddies
              </label>
              <UserAutocomplete
                value={invitedUsers}
                onChange={setInvitedUsers}
                aria-label="Invite members by name or username"
                placeholder="Start typing a name or @username…"
              />
              <span className="text-xs text-muted-foreground block mt-0.5">
                Pick people from the suggestions — they get an invitation notification.
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Group Description
              </label>
              <Textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Describe what your group will focus on (e.g. practice problems, weekly mock tests)..."
                rows={3}
                className="rounded-xl"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Privacy</label>
              <Select value={newPrivacy} onValueChange={(v) => setNewPrivacy(v as "public" | "private")}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public — anyone can join</SelectItem>
                  <SelectItem value="private">Private — invitation only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateModalOpen(false)}
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creating}
                className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant"
              >
                Create Room
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Group Preview Modal */}
      <Dialog open={!!livePreview} onOpenChange={(open) => !open && setPreviewGroup(null)}>
        <DialogContent className="sm:max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>{livePreview?.name}</span>
            </DialogTitle>
            <DialogDescription>
              {livePreview?.subject} · {livePreview?.members} members
            </DialogDescription>
          </DialogHeader>

          {livePreview && (
            <div className="space-y-4 py-2">
              <div className="p-4 rounded-xl bg-secondary/30 border border-border text-sm leading-relaxed">
                <div className="font-semibold text-xs text-muted-foreground mb-1 uppercase tracking-wider">
                  About Group
                </div>
                {livePreview.description}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl border border-border bg-background">
                  <div className="flex items-center gap-1.5 font-semibold mb-1">
                    <Calendar className="h-4 w-4 text-primary" />
                    Regular Schedule
                  </div>
                  <div className="text-muted-foreground">{livePreview.schedule}</div>
                </div>

                <div className="p-3 rounded-xl border border-border bg-background">
                  <div className="flex items-center gap-1.5 font-semibold mb-1">
                    <FileText className="h-4 w-4 text-primary" />
                    Shared Assets
                  </div>
                  <div className="text-muted-foreground">
                    Group chat &amp; shared files in Messages
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Members ({members.length})
                </div>
                <div className="max-h-32 space-y-1 overflow-y-auto rounded-xl border border-border p-2 text-xs">
                  {members.length === 0 && <div className="text-muted-foreground">Members are visible to group members.</div>}
                  {members.map((m) => (
                    <div key={m.uid} className="flex items-center justify-between">
                      <span className="truncate">
                        {m.displayName}
                        {m.username && <span className="ml-1 font-mono text-xs text-muted-foreground">@{m.username}</span>}
                      </span>
                      {m.role === "owner" && <Badge variant="secondary" className="rounded-full text-xs">Owner</Badge>}
                    </div>
                  ))}
                </div>
              </div>

              {livePreview.ownerId === me && (
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <UserAutocomplete
                      value={inviteMore}
                      onChange={setInviteMore}
                      excludeUids={members.map((m) => m.uid)}
                      aria-label="Invite people to this group"
                      placeholder="Invite by name or @username…"
                    />
                  </div>
                  <Button size="sm" onClick={() => handleInviteMore(livePreview)} className="rounded-xl">
                    Invite
                  </Button>
                </div>
              )}

              <DialogFooter className="pt-2">
                <Button
                  variant="outline"
                  onClick={() => setPreviewGroup(null)}
                  className="rounded-xl"
                >
                  Close
                </Button>
                {livePreview.ownerId === me ? (
                  <Button variant="ghost" onClick={() => handleDelete(livePreview)} className="rounded-xl text-destructive">
                    <Trash2 className="mr-1.5 h-4 w-4" /> Delete group
                  </Button>
                ) : livePreview.joined ? (
                  <Button variant="ghost" onClick={() => handleToggleJoin(livePreview)} className="rounded-xl text-destructive">
                    <LogOut className="mr-1.5 h-4 w-4" /> Leave
                  </Button>
                ) : null}
                {livePreview.joined ? (
                  <Button
                    onClick={() => {
                      setPreviewGroup(null);
                      navigate({ to: "/messages", search: { conversation: groupConversationId(livePreview.id) } as never });
                    }}
                    className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant"
                  >
                    <MessagesSquare className="mr-1.5 h-4 w-4" /> Enter Group Chat
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      handleToggleJoin(livePreview);
                      setPreviewGroup(null);
                    }}
                    className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant"
                  >
                    Join Study Group
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
