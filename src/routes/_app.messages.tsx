import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Send,
  Paperclip,
  Smile,
  Search,
  MessageSquarePlus,
  UserCheck,
  FileText,
  Image as ImageIcon,
  X,
  Download,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  FileUp,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  searchNetworkUsers,
  cleanHandle,
  getUserByUsername,
  getUserByUid,
  type NetworkUser,
} from "@/lib/user-network";
import {
  conversationAvatar,
  conversationTitle,
  getOrCreateDirectConversation,
  isSeenByOthers,
  isTyping,
  markConversationRead,
  otherParticipant,
  respondToMessageRequest,
  sendMessage,
  setTypingState,
  subscribeConversations,
  subscribeMessages,
  uploadChatAttachments,
  formatBytes,
  type ConversationDoc,
  type MessageDoc,
} from "@/services/messaging";
import { isSafeStorageUrl } from "@/lib/safe-url";
import { errorMessage, isUserOnline, timeAgoShort, toMillis } from "@/services/common";
import { getUsersByIds, type UserDoc } from "@/services/users";

export const Route = createFileRoute("/_app/messages")({
  head: () => ({
    meta: [
      { title: "Messages — Cortex" },
      { name: "description", content: "Private chats, tutors, study buddies, and groups." },
    ],
  }),
  component: MsgPage,
});

export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: "image" | "file";
  size: string;
}

interface ChatMessage {
  id: string;
  me: boolean;
  text: string;
  time: string;
  attachments?: Attachment[];
  /** Local write not yet acknowledged by the server. */
  pending?: boolean;
  /** The other participant has read up to this message. */
  seen?: boolean;
}

interface Conversation {
  id: string;
  name: string;
  username?: string;
  avatar: string;
  online: boolean;
  last: string;
  time: string;
  unread: number;
  status: "accepted" | "pending_request";
  chatHistory: ChatMessage[];
  isGroup?: boolean;
}

const clockTime = (v: unknown) =>
  new Date(toMillis(v as never)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function MsgPage() {
  const { profile, user } = useAuth();
  const me = user?.uid ?? "";
  const meDoc = { ...(profile as unknown as UserDoc), uid: me };

  // ── real-time data ─────────────────────────────────────────────────────────
  const [rawConvs, setRawConvs] = useState<ConversationDoc[]>([]);
  const [convsLoading, setConvsLoading] = useState(true);
  const [convsError, setConvsError] = useState<string | null>(null);
  const [people, setPeople] = useState<Record<string, UserDoc>>({});
  const [rawMessages, setRawMessages] = useState<MessageDoc[]>([]);
  const [, forceTick] = useState(0);

  const [activeChatId, setActiveChatId] = useState<string>("");
  const [inputText, setInputText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "requests">("all");
  const [sending, setSending] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  // Conversation list (ordered by latest activity, server-side)
  useEffect(() => {
    if (!me) return;
    setConvsLoading(true);
    const unsub = subscribeConversations(
      me,
      (list) => {
        setRawConvs(list);
        setConvsLoading(false);
        setConvsError(null);
      },
      (err) => {
        setConvsLoading(false);
        setConvsError(errorMessage(err, "Couldn't load your conversations."));
      },
    );
    return unsub;
  }, [me]);

  // Fresh avatars / online status for the people I talk to (refreshed every minute)
  const otherUids = rawConvs
    .filter((c) => c.type === "direct")
    .map((c) => otherParticipant(c, me))
    .filter((x): x is string => !!x)
    .sort()
    .join(",");
  useEffect(() => {
    if (!otherUids) return;
    let cancelled = false;
    const load = () =>
      getUsersByIds(otherUids.split(","))
        .then((u) => !cancelled && setPeople(u))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [otherUids]);

  // Messages of the open conversation
  useEffect(() => {
    setRawMessages([]);
    if (!activeChatId) return;
    return subscribeMessages(activeChatId, setRawMessages, (err) =>
      toast.error(errorMessage(err, "Couldn't load messages.")),
    );
  }, [activeChatId]);

  // Re-evaluate "typing…" every 2s (the data itself doesn't change when someone stops typing)
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);

  // UI-shaped conversations
  const conversations: Conversation[] = rawConvs
    .filter((c) => c.status !== "declined")
    .map((c) => {
      const otherUid = c.type === "direct" ? otherParticipant(c, me) : undefined;
      const u = otherUid ? people[otherUid] : undefined;
      const incomingRequest = c.status === "pending" && c.requestedBy !== me;
      return {
        id: c.id,
        name: conversationTitle(c, me),
        username: c.type === "group" ? undefined : (u?.username ?? (otherUid ? c.participantInfo?.[otherUid]?.username : undefined)),
        avatar: u?.avatarUrl || conversationAvatar(c, me),
        online: !!u && isUserOnline(u),
        last: c.lastMessage?.text || (incomingRequest ? "Wants to message you" : "Say hello 👋"),
        time: c.lastMessage ? timeAgoShort(c.lastMessageAt as never) : "",
        unread: c.unread?.[me] ?? 0,
        status: incomingRequest ? "pending_request" : "accepted",
        chatHistory: [],
        isGroup: c.type === "group",
      } satisfies Conversation;
    });

  const activeRaw = rawConvs.find((c) => c.id === activeChatId);
  const activeBase = conversations.find((c) => c.id === activeChatId);
  const activeChat: Conversation | undefined = activeBase
    ? {
        ...activeBase,
        chatHistory: rawMessages.map((m) => ({
          id: m.id,
          me: m.senderId === me,
          text: m.text,
          time: clockTime(m.createdAt),
          attachments: m.attachments,
          pending: m.pending,
          seen: activeRaw ? isSeenByOthers(activeRaw, me, m) : false,
        })),
      }
    : undefined;
  const someoneTyping =
    !!activeRaw && activeRaw.participants.some((p) => p !== me && isTyping(activeRaw, p));

  // Pick a conversation: ?conversation=<id> | ?user=<handle|uid>; otherwise the most recent one
  const [deepLinkDone, setDeepLinkDone] = useState(false);
  useEffect(() => {
    if (!me || deepLinkDone || typeof window === "undefined") return;
    setDeepLinkDone(true);
    const params = new URLSearchParams(window.location.search);
    const convParam = params.get("conversation");
    const targetQuery = params.get("user") || params.get("username") || params.get("uid");
    (async () => {
      try {
        if (convParam) {
          setActiveChatId(convParam);
        } else if (targetQuery) {
          const clean = cleanHandle(targetQuery);
          const target = (await getUserByUsername(clean)) ?? (await getUserByUid(targetQuery));
          if (!target) return toast.error(`No user found for "${targetQuery}".`);
          const id = await getOrCreateDirectConversation(meDoc, target as unknown as UserDoc);
          setActiveChatId(id);
        }
      } catch (err) {
        toast.error(errorMessage(err, "Couldn't open that conversation."));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, deepLinkDone]);

  useEffect(() => {
    if (!activeChatId && conversations.length > 0) setActiveChatId(conversations[0].id);
  }, [activeChatId, conversations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read receipts + unread counter: reset when I'm looking at an accepted conversation
  useEffect(() => {
    if (!me || !activeChat || activeChat.status === "pending_request") return;
    if (activeChat.unread > 0 && document.visibilityState === "visible") {
      void markConversationRead(activeChat.id, me).catch(() => undefined);
    }
  }, [me, activeChat?.id, activeChat?.unread, activeChat?.status, rawMessages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the newest message in view
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [rawMessages.length, someoneTyping, activeChatId]);

  // ── typing indicator (throttled writes, auto-clears after 4s idle) ─────────
  const lastTypingWrite = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleInputChange = (value: string) => {
    setInputText(value);
    if (!activeChat || !me) return;
    const now = Date.now();
    if (value && now - lastTypingWrite.current > 2500) {
      lastTypingWrite.current = now;
      void setTypingState(activeChat.id, me, true);
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      lastTypingWrite.current = 0;
      void setTypingState(activeChat.id, me, false);
    }, 4000);
  };

  // ── attachments (real files, uploaded to Storage on send) ──────────────────
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const pendingFiles = useRef<Map<string, File>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── new chat modal ─────────────────────────────────────────────────────────
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<NetworkUser | null>(null);
  const [customContactName, setCustomContactName] = useState("");
  const [initialMessage, setInitialMessage] = useState("");
  const [searchedUsers, setSearchedUsers] = useState<NetworkUser[]>([]);
  const [startingChat, setStartingChat] = useState(false);

  useEffect(() => {
    if (!isNewChatOpen || !me) return;
    let cancelled = false;
    const t = setTimeout(() => {
      searchNetworkUsers(contactSearch, me)
        .then((r) => !cancelled && setSearchedUsers(r))
        .catch(() => !cancelled && setSearchedUsers([]));
    }, 250); // debounce
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [contactSearch, isNewChatOpen, me]);

  const handleStartNewChat = async () => {
    const handle = selectedContact ? selectedContact.username : cleanHandle(customContactName);
    if (!selectedContact && !handle) {
      toast.error("Please select a student or enter a valid @username.");
      return;
    }
    setStartingChat(true);
    try {
      const target = selectedContact ?? (await getUserByUsername(handle));
      if (!target) {
        toast.error(`No user found with the username @${handle}.`);
        return;
      }
      if (target.uid === me) {
        toast.error("You can't message yourself.");
        return;
      }
      const id = await getOrCreateDirectConversation(meDoc, target as unknown as UserDoc);
      if (initialMessage.trim()) {
        await sendMessage({
          conversation: {
            id,
            type: "direct",
            participants: [me, target.uid],
            participantInfo: {},
          },
          sender: meDoc,
          text: initialMessage,
        });
      }
      setActiveChatId(id);
      toast.success(`Chat opened with ${target.displayName} (@${target.username})`);
      setSelectedContact(null);
      setCustomContactName("");
      setInitialMessage("");
      setContactSearch("");
      setIsNewChatOpen(false);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't start the chat."));
    } finally {
      setStartingChat(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const accepted: Attachment[] = [];
    Array.from(files as FileList).forEach((f: File, idx: number) => {
      const okType = f.type.startsWith("image/") || f.type === "application/pdf";
      if (!okType) return toast.error(`"${f.name}" isn't supported — attach images or PDFs.`);
      if (f.size > 10 * 1024 * 1024) return toast.error(`"${f.name}" is larger than 10 MB.`);
      const id = `att_${Date.now()}_${idx}`;
      pendingFiles.current.set(id, f);
      accepted.push({
        id,
        name: f.name,
        url: f.type.startsWith("image/") ? URL.createObjectURL(f) : "#",
        type: f.type.startsWith("image/") ? "image" : "file",
        size: formatBytes(f.size),
      });
    });

    if (accepted.length) {
      setPendingAttachments((prev) => [...prev, ...accepted]);
      toast.success(`${accepted.length} file(s) attached`);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const pickFiles = (accept: string) => {
    if (!fileInputRef.current) return;
    fileInputRef.current.accept = accept;
    fileInputRef.current.click();
  };

  const handleRemovePendingAttachment = (id: string) => {
    pendingFiles.current.delete(id);
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  // ── message requests ───────────────────────────────────────────────────────
  const handleAcceptRequest = async (id: string) => {
    try {
      await respondToMessageRequest(id, true);
      toast.success(`Message request from ${activeChat?.name || "sender"} accepted!`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't accept the request."));
    }
  };

  const handleDeclineRequest = async (id: string) => {
    const chatName = activeChat?.name || "sender";
    try {
      await respondToMessageRequest(id, false);
      toast.info(`Message request from ${chatName} declined.`);
      const remaining = conversations.filter((c) => c.id !== id);
      setActiveChatId(remaining[0]?.id ?? "");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't decline the request."));
    }
  };

  // ── sending ────────────────────────────────────────────────────────────────
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputText.trim() && pendingAttachments.length === 0) || !activeChat || !activeRaw || sending) return;

    const text = inputText.trim();
    const attachmentsMeta = [...pendingAttachments];
    const files = attachmentsMeta.map((a) => pendingFiles.current.get(a.id)).filter((f): f is File => !!f);

    setSending(true);
    try {
      let uploaded: Awaited<ReturnType<typeof uploadChatAttachments>> = [];
      if (files.length) uploaded = await uploadChatAttachments(activeRaw.id, files, setUploadPct);

      setInputText("");
      setPendingAttachments([]);
      pendingFiles.current.clear();
      if (typingTimer.current) clearTimeout(typingTimer.current);

      await sendMessage({ conversation: activeRaw, sender: meDoc, text, attachments: uploaded });
    } catch (err) {
      toast.error(errorMessage(err, "Message not sent."));
    } finally {
      setSending(false);
      setUploadPct(null);
    }
  };

  const pendingCount = conversations.filter((c) => c.status === "pending_request").length;

  const filteredChats = conversations.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.last.toLowerCase().includes(searchQuery.toLowerCase());

    if (filterTab === "requests") {
      return matchesSearch && c.status === "pending_request";
    }
    return matchesSearch;
  });

  return (
    <div className="grid h-[calc(100vh-4rem)] lg:grid-cols-[340px_1fr]">
      {/* Hidden native file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        multiple
        className="hidden"
        accept="image/*,.pdf,.doc,.docx,.txt,.zip"
      />

      {/* Sidebar Chat List */}
      <aside className="flex flex-col border-r border-border bg-card">
        <div className="border-b border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl tracking-tight font-medium">Messages</h2>
            <Dialog open={isNewChatOpen} onOpenChange={setIsNewChatOpen}>
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  className="rounded-xl gap-1.5 bg-gradient-primary text-primary-foreground shadow-soft"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                  New Chat
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[480px] rounded-2xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-xl font-display">
                    <MessageSquarePlus className="h-5 w-5 text-primary" />
                    Start New Chat
                  </DialogTitle>
                  <DialogDescription>
                    Connect with any peer or tutor on Cortex. New messages will arrive as a message
                    request for first-time senders.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                  {/* Search / Filter Contacts */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                      Search Network by Name, @username, or Specialization
                    </label>
                    <div className="relative mb-2">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input aria-label="Search @handle, name, institution, or topic..."
                        value={contactSearch}
                        onChange={(e) => setContactSearch(e.target.value)}
                        placeholder="Search @handle, name, institution, or topic..."
                        className="pl-8 h-9 text-xs rounded-xl"
                      />
                    </div>

                    <div className="max-h-52 overflow-y-auto space-y-1 border border-border rounded-xl p-1.5 bg-muted/20">
                      {searchedUsers.length === 0 ? (
                        <div className="text-center py-6 px-3 text-xs text-muted-foreground">
                          No users matching &quot;{contactSearch}&quot;. Type a custom @username
                          below to send a message request.
                        </div>
                      ) : (
                        searchedUsers.map((u) => {
                          const isSelected = selectedContact?.uid === u.uid;
                          return (
                            <button
                              key={u.uid}
                              type="button"
                              onClick={() => {
                                setSelectedContact(isSelected ? null : u);
                                setCustomContactName("");
                              }}
                              className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition text-xs ${
                                isSelected
                                  ? "bg-primary/10 border border-primary/30 text-primary font-medium"
                                  : "hover:bg-muted/80 text-foreground"
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <Avatar className="h-8 w-8 shrink-0">
                                  <AvatarImage src={u.avatarUrl} />
                                  <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
                                    {u.displayName.slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                  <div className="font-semibold flex items-center gap-1.5">
                                    <span className="truncate">{u.displayName}</span>
                                    <span className="font-mono text-xs text-primary bg-primary/10 px-1.5 py-0.2 rounded shrink-0">
                                      @{u.username}
                                    </span>
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate">
                                    {u.role === "tutor" ? "🎓 Tutor" : "📚 Student"} ·{" "}
                                    {u.institution || "Cortex Network"}
                                    {u.degreeOrStream ? ` (${u.degreeOrStream})` : ""}
                                  </div>
                                </div>
                              </div>
                              {isSelected && (
                                <UserCheck className="h-4 w-4 text-primary shrink-0 ml-1" />
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Custom Handle fallback if not selecting from list */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                      Or type custom @username or display name
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-xs select-none">
                        @
                      </span>
                      <Input aria-label="e.g. ken_watanabe or Prof. Miller"
                        value={customContactName}
                        onChange={(e) => {
                          setCustomContactName(e.target.value);
                          if (e.target.value) setSelectedContact(null);
                        }}
                        placeholder="e.g. ken_watanabe or Prof. Miller"
                        className="pl-7 h-9 text-xs rounded-xl font-mono"
                      />
                    </div>
                  </div>

                  {/* Optional initial message */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                      Initial Message (Optional)
                    </label>
                    <Textarea
                      value={initialMessage}
                      onChange={(e) => setInitialMessage(e.target.value)}
                      placeholder="Hi! Would you like to study together or discuss review topics?"
                      className="text-xs rounded-xl min-h-[70px] resize-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsNewChatOpen(false)}
                    className="rounded-xl text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={startingChat}
                    type="button"
                    onClick={handleStartNewChat}
                    className="rounded-xl text-xs bg-gradient-primary text-primary-foreground shadow-soft"
                  >
                    Start Chat
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search chats…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 rounded-xl pl-9 bg-muted/50 text-xs"
              placeholder="Search chats…"
            />
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-xl text-xs">
            <button
              type="button"
              onClick={() => setFilterTab("all")}
              className={`flex-1 py-1 rounded-lg font-medium transition text-center ${
                filterTab === "all"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All Chats
            </button>
            <button
              type="button"
              onClick={() => setFilterTab("requests")}
              className={`flex-1 py-1 rounded-lg font-medium transition text-center flex items-center justify-center gap-1 ${
                filterTab === "requests"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>Requests</span>
              {pendingCount > 0 && (
                <Badge className="h-4 px-1.5 text-xs bg-amber-500 text-white border-0 font-bold rounded-full">
                  {pendingCount}
                </Badge>
              )}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-2 space-y-1">
          {filteredChats.length === 0 ? (
            <div className="text-center py-8 px-4 text-muted-foreground text-xs">
              {convsLoading
                ? "Loading conversations…"
                : convsError
                  ? convsError
                  : conversations.length === 0
                    ? "No conversations yet. Tap “New Chat” to message a study buddy or tutor."
                    : "No conversations found."}
            </div>
          ) : (
            filteredChats.map((m) => (
              <button
                key={m.id}
                onClick={() => setActiveChatId(m.id)}
                className={`w-full rounded-xl p-3 text-left transition ${
                  activeChatId === m.id
                    ? "bg-accent text-accent-foreground font-medium"
                    : "hover:bg-muted/60"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="relative shrink-0">
                    <Avatar className="h-11 w-11">
                      <AvatarImage src={m.avatar} />
                      <AvatarFallback className="bg-primary/10 text-primary font-bold">
                        {m.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {m.online && (
                      <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background bg-emerald-500" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <div className="truncate text-sm font-semibold flex items-center gap-1.5">
                        <span className="truncate">{m.name}</span>
                        {m.username && (
                          <span className="font-mono text-xs text-muted-foreground shrink-0">
                            @{m.username}
                          </span>
                        )}
                        {m.status === "pending_request" && (
                          <Badge
                            variant="outline"
                            className="text-xs px-1 py-0 bg-amber-500/10 text-amber-600 border-amber-300 dark:border-amber-700 shrink-0"
                          >
                            Request
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0">{m.time}</div>
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-0.5">
                      <div className="truncate text-xs text-muted-foreground">{m.last}</div>
                      {m.unread > 0 && (
                        <Badge className="rounded-full bg-gradient-primary text-primary-foreground border-0 h-4 min-w-[16px] px-1 text-xs shrink-0">
                          {m.unread}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Main Active Chat Area */}
      {!activeChat ? (
        <section className="grid h-full place-items-center bg-background p-8 text-center text-sm text-muted-foreground">
          <div>
            <MessageSquarePlus className="mx-auto mb-3 h-8 w-8" />
            {convsLoading ? "Loading…" : "Select a conversation or start a new chat."}
          </div>
        </section>
      ) : (
      <section className="flex flex-col h-full bg-background min-w-0">
        <div className="flex items-center justify-between border-b border-border p-4 bg-card">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={activeChat.avatar} />
              <AvatarFallback className="bg-primary/10 text-primary font-bold">
                {activeChat.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="text-sm font-semibold flex items-center gap-2">
                <span>{activeChat.name}</span>
                {activeChat.username && (
                  <Badge
                    variant="outline"
                    className="font-mono text-xs px-2 py-0.2 border-primary/30 text-primary bg-primary/5"
                  >
                    @{activeChat.username}
                  </Badge>
                )}
                {activeChat.status === "pending_request" && (
                  <Badge
                    variant="outline"
                    className="text-xs bg-amber-500/10 text-amber-600 border-amber-300 dark:border-amber-700"
                  >
                    Pending Message Request
                  </Badge>
                )}
              </div>
              <div className="text-xs text-emerald-600 font-medium">
                {activeChat.online ? "Online · Active now" : "Offline"}
              </div>
            </div>
          </div>
        </div>

        {/* Message Bubble History */}
        <div className="flex-1 space-y-3 overflow-auto bg-muted/20 p-6">
          {activeChat.chatHistory.length === 0 && (
            <div className="py-10 text-center text-xs text-muted-foreground">
              No messages yet — say hello!
            </div>
          )}
          {activeChat.chatHistory.map((b) => (
            <div key={b.id} className={`flex ${b.me ? "justify-end" : "justify-start"}`}>
              <div className="max-w-md">
                <Card
                  className={`rounded-2xl border-none p-3.5 text-sm shadow-soft ${
                    b.me
                      ? "bg-gradient-primary text-primary-foreground"
                      : "bg-card text-foreground border border-border"
                  }`}
                >
                  {b.text && <p className="whitespace-pre-wrap">{b.text}</p>}

                  {/* Attachment Cards in Message */}
                  {b.attachments && b.attachments.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {b.attachments.map((att) =>
                        att.type === "image" ? (
                          <div
                            key={att.id}
                            className="relative group overflow-hidden rounded-xl border border-white/20"
                          >
                            <img
                              src={isSafeStorageUrl(att.url) ? att.url : undefined}
                              alt={att.name}
                              className="max-h-52 w-full object-cover rounded-xl transition duration-200 group-hover:scale-105"
                            />
                            <div className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded-md backdrop-blur-sm">
                              {att.size}
                            </div>
                          </div>
                        ) : (
                          <div
                            key={att.id}
                            className={`flex items-center justify-between p-2.5 rounded-xl text-xs gap-3 ${
                              b.me
                                ? "bg-white/15 text-white border border-white/20"
                                : "bg-muted/80 text-foreground border border-border"
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div
                                className={`p-2 rounded-lg shrink-0 ${
                                  b.me ? "bg-white/20" : "bg-primary/10 text-primary"
                                }`}
                              >
                                <FileText className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold truncate">{att.name}</p>
                                <p className="text-xs opacity-80">{att.size}</p>
                              </div>
                            </div>
                            <Button aria-label="Download attachment"
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() => (isSafeStorageUrl(att.url) ? window.open(att.url, "_blank", "noopener,noreferrer") : toast.error("This attachment link isn't trusted, so it was blocked."))}
                              className="h-7 w-7 rounded-lg hover:bg-white/20 shrink-0"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </Card>
                <div
                  className={`text-xs text-muted-foreground mt-1 px-1 ${
                    b.me ? "text-right" : "text-left"
                  }`}
                >
                  {b.time}
                  {b.me && (b.pending ? " · Sending…" : b.seen ? " · Seen" : " · Delivered")}
                </div>
              </div>
            </div>
          ))}
          {someoneTyping && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-border bg-card px-3.5 py-2 text-xs italic text-muted-foreground shadow-soft">
                {activeChat.name} is typing…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Message Request Accept Banner OR Input Box */}
        {activeChat.status === "pending_request" ? (
          <div className="border-t border-border bg-card p-4 shadow-soft">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-2xl bg-amber-500/10 border border-amber-300 dark:border-amber-800">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 shrink-0">
                  <AvatarImage src={activeChat.avatar} />
                  <AvatarFallback className="bg-amber-500/20 text-amber-700 font-bold">
                    {activeChat.name.slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="text-sm font-semibold flex items-center gap-1.5 text-foreground">
                    <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                    <span>Message Request from {activeChat.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Do you want to allow {activeChat.name} to message you? Once accepted, you can
                    chat freely on Cortex.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleDeclineRequest(activeChat.id)}
                  className="rounded-xl text-xs flex-1 sm:flex-initial text-destructive border-destructive/30 hover:bg-destructive/10"
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" />
                  Decline
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleAcceptRequest(activeChat.id)}
                  className="rounded-xl text-xs flex-1 sm:flex-initial bg-gradient-primary text-primary-foreground shadow-soft"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                  Accept Request
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="border-t border-border p-4 bg-card space-y-2">
            {/* Pending Attachments Preview List */}
            {pendingAttachments.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {pendingAttachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center gap-2 bg-muted/80 border border-border px-2.5 py-1.5 rounded-xl text-xs shrink-0"
                  >
                    {att.type === "image" ? (
                      <ImageIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                    )}
                    <div className="max-w-[120px] truncate font-medium">{att.name}</div>
                    <span className="text-xs text-muted-foreground">({att.size})</span>
                    <button
                      type="button"
                      onClick={() => handleRemovePendingAttachment(att.id)}
                      className="text-muted-foreground hover:text-destructive p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form
              onSubmit={handleSendMessage}
              className="flex items-center gap-2 rounded-2xl border border-border bg-background p-2 shadow-soft"
            >
              {/* Paperclip button with Dropdown for Upload file or Sample Attachment */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button aria-label="Attach a file" type="button" variant="ghost" size="icon" className="rounded-xl shrink-0">
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48 rounded-xl">
                  <DropdownMenuItem
                    onClick={() => pickFiles("image/*,application/pdf")}
                    className="gap-2 text-xs"
                  >
                    <FileUp className="h-4 w-4 text-primary" />
                    Upload File / Photo
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => pickFiles("image/*")}
                    className="gap-2 text-xs"
                  >
                    <ImageIcon className="h-4 w-4 text-emerald-500" />
                    Attach Diagram Photo
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => pickFiles("application/pdf")}
                    className="gap-2 text-xs"
                  >
                    <FileText className="h-4 w-4 text-blue-500" />
                    Attach Study PDF
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Input
                value={inputText}
                onChange={(e) => handleInputChange(e.target.value)}
                onBlur={() => activeChat && void setTypingState(activeChat.id, me, false)}
                className="border-none focus-visible:ring-0 text-sm"
                placeholder={`Message ${activeChat.name}…`}
              />

              <Button aria-label="Send message"
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setInputText((prev) => prev + " 😊")}
                className="rounded-xl shrink-0"
              >
                <Smile className="h-4 w-4 text-muted-foreground" />
              </Button>

              {uploadPct !== null && (
                <span className="text-xs text-muted-foreground shrink-0">{uploadPct}%</span>
              )}
              <Button aria-label="Send message"
                type="submit"
                size="icon"
                disabled={sending}
                className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90 shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        )}
      </section>
      )}
    </div>
  );
}
