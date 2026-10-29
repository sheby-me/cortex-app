import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import {
  Star,
  Coins,
  Clock,
  GraduationCap,
  Edit3,
  Share2,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Users,
  BookOpen,
  Building2,
  Calendar,
  Sparkles,
  MessageSquare,
  Upload,
  Camera,
  Image as ImageIcon,
} from "lucide-react";
import {
  collection,
  limit as qLimit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { ACHIEVEMENTS, subscribeAchievements } from "@/services/gamification";
import { subscribeBuddies, type FriendUserData } from "@/services/buddies";
import { leaveReview, subscribeProfileReviews, type ProfileReview } from "@/services/reviews";
import { subscribeMySessions, type Session } from "@/services/tutors";
import { getClassmates, removeAvatar, removeCover, uploadAvatar, uploadCover, type UserDoc } from "@/services/users";
import { ImageCropDialog } from "@/components/image-crop-dialog";
import { VerifiedBadge } from "@/components/verified-badge";
import { RequiredMark } from "@/components/required-mark";
import { CountrySelect } from "@/components/country-select";
import { InstitutionSelect } from "@/components/institution-select";
import { validatePersonName } from "@/lib/name-policy";
import { shareProfile } from "@/lib/share-profile";
import { errorMessage, timeAgo } from "@/services/common";
import { sendFriendRequest } from "@/lib/friends-service";
import {
  useAuth,
  calculateProfileCompletion,
  type GradeLevel,
  type EducationEntry,
} from "@/hooks/use-auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/profile")({
  head: () => ({
    meta: [
      { title: "Student Profile — Cortex" },
      {
        name: "description",
        content: "View and edit your profile, education history, grade level, and batchmates.",
      },
    ],
  }),
  component: ProfilePage,
});

// No stock images: pictures are uploaded by the user and stored in Firebase Storage.
const PRESET_AVATARS: string[] = [];
const PRESET_COVERS: string[] = [];

export function ProfilePage() {
  const { user, profile, role, updateProfile } = useAuth();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddEduModalOpen, setIsAddEduModalOpen] = useState(false);
  const [isLeaveReviewOpen, setIsLeaveReviewOpen] = useState(false);

  // Profile Edit Form State
  const [editName, setEditName] = useState(profile.displayName || "");
  const [editAvatar, setEditAvatar] = useState(profile.avatarUrl || "");
  const [editCover, setEditCover] = useState(profile.coverImageUrl || "");
  const [editGrade, setEditGrade] = useState<GradeLevel>(
    (profile.gradeLevel as GradeLevel) || "Undergraduate",
  );
  const [editInst, setEditInst] = useState(profile.institution || "");
  const [editInstId, setEditInstId] = useState<string | null>((profile.institutionId as string | null) ?? null);
  const [editSem, setEditSem] = useState(profile.semesterOrYear || "");
  const [editDeg, setEditDeg] = useState(profile.degreeOrStream || "");
  const [editAbout, setEditAbout] = useState(profile.about || "");
  const [editCountry, setEditCountry] = useState(profile.country || "");
  const [editTimezone, setEditTimezone] = useState(profile.timezone || "");

  // Files picked inside the edit dialog are previewed locally and uploaded to Firebase Storage on Save.
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [pendingCover, setPendingCover] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  // Every picked image is cropped first. `mode` decides what happens with the cropped result:
  //  "dialog" → keep it as a preview until "Save"   |   "direct" → upload straight away (header camera buttons)
  const [crop, setCrop] = useState<{ file: File; kind: "avatar" | "cover"; mode: "dialog" | "direct" } | null>(null);
  const [removeAvatarFlag, setRemoveAvatarFlag] = useState(false);
  const [removeCoverFlag, setRemoveCoverFlag] = useState(false);

  const startCrop = (file: File | undefined, kind: "avatar" | "cover", mode: "dialog" | "direct") => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file (JPG, PNG or WebP).");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error("That image is too large. Please choose one under 15 MB.");
      return;
    }
    setCrop({ file, kind, mode });
  };

  const handleCropped = async (cropped: File) => {
    const c = crop;
    setCrop(null);
    if (!c || !user) return;
    if (c.mode === "dialog") {
      if (c.kind === "avatar") {
        setPendingAvatar(cropped);
        setEditAvatar(URL.createObjectURL(cropped));
        setRemoveAvatarFlag(false);
      } else {
        setPendingCover(cropped);
        setEditCover(URL.createObjectURL(cropped));
        setRemoveCoverFlag(false);
      }
      return;
    }
    try {
      setUploadPct(0);
      if (c.kind === "avatar") await uploadAvatar(user.uid, cropped, profile.avatarUrl, setUploadPct);
      else await uploadCover(user.uid, cropped, profile.coverImageUrl, setUploadPct);
      toast.success(c.kind === "avatar" ? "Profile picture updated!" : "Cover banner updated!");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't upload that image. Please try again."));
    } finally {
      setUploadPct(null);
    }
  };

  const handleAvatarFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    startCrop(e.target.files?.[0], "avatar", "dialog");
    e.target.value = "";
  };
  const handleCoverFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    startCrop(e.target.files?.[0], "cover", "dialog");
    e.target.value = "";
  };
  const handleDirectHeaderAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    startCrop(e.target.files?.[0], "avatar", "direct");
    e.target.value = "";
  };
  const handleDirectHeaderCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    startCrop(e.target.files?.[0], "cover", "direct");
    e.target.value = "";
  };

  const handleRemoveCoverNow = async () => {
    if (!user) return;
    try {
      await removeCover(user.uid, profile.coverImageUrl);
      toast.success("Cover banner removed.");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't remove the banner."));
    }
  };


  // Education History State
  const [eduList, setEduList] = useState<EducationEntry[]>(profile.educationHistory || []);

  // New Education Form State
  const [newEduInst, setNewEduInst] = useState("");
  const [newEduDeg, setNewEduDeg] = useState("");
  const [newEduStream, setNewEduStream] = useState("");
  const [newEduStartYear, setNewEduStartYear] = useState("2022");
  const [newEduEndYear, setNewEduEndYear] = useState("2026");
  const [newEduStatus, setNewEduStatus] = useState<"Completed" | "In Progress" | "Pursuing">(
    "In Progress",
  );
  const [newEduGrade, setNewEduGrade] = useState<GradeLevel>("Undergraduate");

  // Review Form State
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [reviewTarget, setReviewTarget] = useState<string>("");
  const [reviewsList, setReviewsList] = useState<ProfileReview[]>([]);

  // ── live data (all from Firestore) ─────────────────────────────────────────
  const [creditLog, setCreditLog] = useState<
    { id: string; type: "earn" | "spend"; amount: number; reason: string; time: string }[]
  >([]);
  const [unlocked, setUnlocked] = useState<Record<string, unknown>>({});
  const [myBuddies, setMyBuddies] = useState<FriendUserData[]>([]);
  const [classmates, setClassmates] = useState<UserDoc[]>([]);
  const [taught, setTaught] = useState<Session[]>([]);

  useEffect(() => {
    if (!user) return;
    const unsubs = [
      onSnapshot(
        query(collection(db, "users", user.uid, "creditHistory"), orderBy("createdAt", "desc"), qLimit(50)),
        (snap) =>
          setCreditLog(
            snap.docs.map((d) => {
              const c = d.data({ serverTimestamps: "estimate" }) as Record<string, unknown>;
              return {
                id: d.id,
                type: (c.type as "earn" | "spend") ?? "earn",
                amount: Math.abs(Number(c.amount) || 0),
                reason: (c.reason as string) || "Credit movement",
                time: timeAgo(c.createdAt as never),
              };
            }),
          ),
        () => setCreditLog([]),
      ),
      subscribeAchievements(user.uid, setUnlocked),
      subscribeBuddies(user.uid, setMyBuddies),
      subscribeProfileReviews(user.uid, setReviewsList),
      subscribeMySessions(user.uid, ({ asTutor }) => setTaught(asTutor.filter((s) => s.status === "completed"))),
    ];
    return () => unsubs.forEach((u) => u());
  }, [user]);

  useEffect(() => {
    if (!user || !profile.institution) {
      setClassmates([]);
      return;
    }
    getClassmates(profile.institution, user.uid)
      .then(setClassmates)
      .catch(() => setClassmates([]));
  }, [user, profile.institution]);

  const avgRating = useMemo(
    () =>
      reviewsList.length
        ? Math.round((reviewsList.reduce((n, r) => n + r.rating, 0) / reviewsList.length) * 10) / 10
        : null,
    [reviewsList],
  );

  const { percentage, missingFields } = calculateProfileCompletion({
    ...profile,
    educationHistory: eduList,
  });

  const handleOpenEdit = () => {
    setEditName(profile.displayName || "");
    setEditAvatar(profile.avatarUrl || "");
    setEditCover(profile.coverImageUrl || "");
    setEditGrade((profile.gradeLevel as GradeLevel) || "Undergraduate");
    setEditInst(profile.institution || "");
    setEditSem(profile.semesterOrYear || "");
    setEditDeg(profile.degreeOrStream || "");
    setEditAbout(profile.about || "");
    setEditCountry(profile.country || "United States");
    setEditTimezone(profile.timezone || "UTC-5 (EST)");
    setIsEditModalOpen(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const nameCheck = validatePersonName(editName, "full name");
    if (!nameCheck.ok) {
      toast.error(nameCheck.error ?? "Please enter a valid name.");
      return;
    }
    setSaving(true);
    try {
      let avatarUrl: string | null = editAvatar || null;
      let coverImageUrl: string | null = editCover || null;
      if (removeAvatarFlag) {
        await removeAvatar(user.uid, profile.avatarUrl);
        avatarUrl = null;
      } else if (pendingAvatar) {
        avatarUrl = await uploadAvatar(user.uid, pendingAvatar, profile.avatarUrl, setUploadPct);
      }
      if (removeCoverFlag) {
        await removeCover(user.uid, profile.coverImageUrl);
        coverImageUrl = null;
      } else if (pendingCover) {
        coverImageUrl = await uploadCover(user.uid, pendingCover, profile.coverImageUrl, setUploadPct);
      }
      await updateProfile({
        displayName: nameCheck.value,
        avatarUrl,
        coverImageUrl,
        gradeLevel: editGrade,
        institution: editInst,
        institutionId: editInstId,
        semesterOrYear: editSem,
        degreeOrStream: editDeg,
        about: editAbout,
        country: editCountry,
        timezone: editTimezone,
        educationHistory: eduList,
      });
      setPendingAvatar(null);
      setPendingCover(null);
      setRemoveAvatarFlag(false);
      setRemoveCoverFlag(false);
      setIsEditModalOpen(false);
      toast.success("Profile updated successfully!");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save your profile. Please try again."));
    } finally {
      setSaving(false);
      setUploadPct(null);
    }
  };

  const handleAddEducation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEduInst.trim() || !newEduDeg.trim()) {
      toast.error("Please enter institution name and degree/class.");
      return;
    }
    const entry: EducationEntry = {
      id: "edu_" + Date.now(),
      institution: newEduInst.trim(),
      degreeOrClass: newEduDeg.trim(),
      streamOrMajor: newEduStream.trim(),
      startYear: newEduStartYear,
      endYear: newEduEndYear,
      status: newEduStatus,
      gradeLevel: newEduGrade,
    };
    const updated = [entry, ...eduList];
    setEduList(updated);
    updateProfile({ educationHistory: updated }).catch((err) => {
      setEduList(eduList);
      toast.error(errorMessage(err, "Could not save education history."));
    });
    setIsAddEduModalOpen(false);
    toast.success("Education history entry added!");

    // Reset
    setNewEduInst("");
    setNewEduDeg("");
    setNewEduStream("");
  };

  const handleDeleteEdu = (id: string) => {
    const updated = eduList.filter((e) => e.id !== id);
    setEduList(updated);
    updateProfile({ educationHistory: updated }).catch((err) => {
      setEduList(eduList);
      toast.error(errorMessage(err, "Could not update education history."));
    });
    toast.info("Education history removed.");
  };

  const withShare = async (fn: () => Promise<unknown> | void, ok?: string) => {
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't share your profile. Please try again."));
    }
  };

  /** Reviews are written ON a study buddy's profile (they appear in that buddy's "Public Reviews" tab). */
  const handleLeaveReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!reviewTarget) {
      toast.error("Choose which study buddy you're reviewing.");
      return;
    }
    if (!reviewText.trim()) return;
    try {
      await leaveReview({ ...(profile as unknown as UserDoc), uid: user.uid }, reviewTarget, reviewRating, reviewText);
      setIsLeaveReviewOpen(false);
      setReviewText("");
      setReviewTarget("");
      toast.success("Review posted to their public profile!");
    } catch (err) {
      toast.error(errorMessage(err, "Could not post your review."));
    }
  };

  // Batch mates: real people at my institution (or, without one, my study buddies).
  const batchMates = classmates.map((c) => ({
    id: c.uid,
    name: c.displayName || "Learner",
    uni: c.institution || "",
    topic: (c.degreeOrStream || c.teach?.[0] || "Open to study"),
    tz: c.timezone || "—",
    avatar: c.avatarUrl || "",
  }));

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      {/* Profile Header Banner */}
      <Card className="mb-6 overflow-hidden rounded-3xl border-border p-0 shadow-soft bg-background">
        <div
          className={`h-44 md:h-52 w-full bg-cover bg-center relative transition-all group ${profile.coverImageUrl ? "" : "bg-gradient-primary"}`}
          style={
            profile.coverImageUrl ? { backgroundImage: `url(${profile.coverImageUrl})` } : undefined
          }
        >
          <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/30 to-transparent" />

          {/* Quick upload cover banner button */}
          <label className="absolute top-3 right-3 cursor-pointer z-10 bg-background/80 hover:bg-background text-foreground text-xs font-medium px-3 py-1.5 rounded-xl border border-border shadow-soft transition flex items-center gap-1.5 backdrop-blur-md">
            <Camera className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            <span>{profile.coverImageUrl ? "Replace banner" : "Upload cover banner"}</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleDirectHeaderCoverUpload}
            />
          </label>
          {profile.coverImageUrl && (
            <button
              type="button"
              onClick={handleRemoveCoverNow}
              className="absolute top-3 right-[11.5rem] z-10 rounded-xl border border-border bg-background/80 px-3 py-1.5 text-xs font-medium shadow-soft backdrop-blur-md transition hover:bg-background"
            >
              Remove banner
            </button>
          )}
          {uploadPct !== null && (
            <div className="absolute bottom-3 right-3 z-10 rounded-lg bg-background/90 px-2.5 py-1 text-xs shadow-soft">Uploading… {uploadPct}%</div>
          )}
        </div>

        <div className="p-6 relative pt-0">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 -mt-16 md:-mt-20 mb-4">
            <div className="flex items-end gap-4">
              <div className="relative group">
                <Avatar className="h-28 w-28 md:h-32 md:w-32 border-4 border-background shadow-elegant rounded-3xl">
                  <AvatarImage src={profile.avatarUrl || user?.photoURL || undefined} />
                  <AvatarFallback className="bg-primary text-primary-foreground text-2xl font-bold">
                    {(profile.displayName || "S").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                {/* Quick upload avatar overlay button */}
                <label className="absolute inset-0 bg-black/40 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white cursor-pointer z-10">
                  <Camera className="h-6 w-6 mb-1 drop-shadow" />
                  <span className="text-xs font-semibold tracking-wide uppercase bg-black/60 px-2 py-0.5 rounded-full">
                    Upload
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleDirectHeaderAvatarUpload}
                  />
                </label>
              </div>

              <div className="pb-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="font-display text-3xl md:text-4xl font-medium tracking-tight">
                    {profile.displayName || "Your name"}
                  {profile.universityVerified && <VerifiedBadge name={profile.verifiedUniversityName as string | null} className="ml-1.5" />}
                  </h1>
                  <Badge
                    variant="outline"
                    className="font-mono text-xs px-2.5 py-0.5 border-primary/30 text-primary bg-primary/5"
                  >
                    @{profile.username || "choose-a-username"}
                  </Badge>
                  <Badge className="bg-gradient-primary text-primary-foreground border-0 font-medium px-3 py-1 text-xs">
                    <GraduationCap className="mr-1 h-3.5 w-3.5" />
                    {profile.gradeLevel || "Undergraduate"}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs md:text-sm text-muted-foreground">
                  <span className="flex items-center gap-1 text-foreground font-medium">
                    <Building2 className="h-3.5 w-3.5 text-primary" />
                    {profile.institution || "Stanford University"}
                  </span>
                  <span>·</span>
                  <span>{profile.semesterOrYear || "Semester 4"}</span>
                  <span>·</span>
                  <span>{profile.degreeOrStream || "Add your degree or stream"}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="rounded-xl border-border">
                    <Share2 className="mr-1.5 h-4 w-4" /> Share
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52 rounded-xl">
                  <DropdownMenuItem
                    onClick={() => withShare(() => shareProfile.copyProfileLink(profile.username), "Profile link copied!")}
                    className="text-sm"
                  >
                    Copy profile link
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => withShare(() => shareProfile.openProfileLink(profile.username))} className="text-sm">
                    Open profile link
                  </DropdownMenuItem>
                  {shareProfile.canNativeShare() && (
                    <DropdownMenuItem
                      onClick={() => withShare(() => shareProfile.nativeShareProfile(profile.username, profile.displayName || "My profile"))}
                      className="text-sm"
                    >
                      Share via…
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                onClick={handleOpenEdit}
                className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90"
              >
                <Edit3 className="mr-1.5 h-4 w-4" /> Edit Profile
              </Button>
            </div>
          </div>

          {/* Profile Completion Bar */}
          <Card className="mb-4 rounded-2xl border-border bg-gradient-mesh p-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Profile Completion</span>
                <Badge
                  variant={percentage === 100 ? "default" : "secondary"}
                  className="rounded-full text-xs font-bold"
                >
                  {percentage}% Complete
                </Badge>
              </div>

              {percentage < 100 && (
                <Button
                  onClick={handleOpenEdit}
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs font-medium text-primary hover:underline p-0"
                >
                  Complete profile steps →
                </Button>
              )}
            </div>

            <Progress value={percentage} className="h-2 rounded-full mb-2" />

            {missingFields.length > 0 ? (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <span>Next steps to reach 100%:</span>
                <span className="text-foreground font-medium">
                  {missingFields.slice(0, 3).join(", ")}
                </span>
              </div>
            ) : (
              <div className="text-xs text-emerald-600 flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                Your profile is 100% complete! Great job representing your student identity.
              </div>
            )}
          </Card>

          {/* Stats Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-border pt-4">
            <div className="flex items-center gap-3 rounded-2xl bg-secondary/50 p-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                <Coins className="h-5 w-5" />
              </div>
              <div>
                <div className="text-lg font-bold">{profile.credits || 120}</div>
                <div className="text-xs text-muted-foreground">Study Credits</div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl bg-secondary/50 p-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500 text-white">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <div className="text-lg font-bold">{profile.hoursGoal || 10}h/wk</div>
                <div className="text-xs text-muted-foreground">Study Goal</div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl bg-secondary/50 p-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500 text-white">
                <Star className="h-5 w-5" />
              </div>
              <div>
                <div className="text-lg font-bold">{avgRating ? `${avgRating} ★` : "—"}</div>
                <div className="text-xs text-muted-foreground">Peer Rating</div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl bg-secondary/50 p-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-purple-500 text-white">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <div className="text-lg font-bold">{batchMates.length} Peers</div>
                <div className="text-xs text-muted-foreground">Batch Mates</div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Profile Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="rounded-2xl bg-secondary/60 p-1 flex-wrap h-auto">
          <TabsTrigger value="overview" className="rounded-xl text-xs font-semibold">
            Overview & Bio
          </TabsTrigger>
          <TabsTrigger value="education" className="rounded-xl text-xs font-semibold">
            Education History ({eduList.length})
          </TabsTrigger>
          <TabsTrigger value="batchmates" className="rounded-xl text-xs font-semibold">
            Batch Mates ({batchMates.length})
          </TabsTrigger>
          <TabsTrigger value="credits" className="rounded-xl text-xs font-semibold">
            Credits Log
          </TabsTrigger>
          <TabsTrigger value="teaching" className="rounded-xl text-xs font-semibold">
            Teaching Hours
          </TabsTrigger>
          <TabsTrigger value="badges" className="rounded-xl text-xs font-semibold">
            Badges
          </TabsTrigger>
          <TabsTrigger value="reviews" className="rounded-xl text-xs font-semibold">
            Public Reviews ({reviewsList.length})
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4 grid gap-4 md:grid-cols-3">
          <Card className="md:col-span-2 rounded-2xl border-border p-6 shadow-soft space-y-4">
            <div>
              <h3 className="text-base font-semibold tracking-tight mb-2 flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" />
                About Me
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                {profile.about ||
                  "You haven't written a bio yet. Use “Edit Profile” to tell peers what you study and what you can help with."}
              </p>
            </div>

            <div className="border-t border-border pt-4 grid sm:grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                  Subjects I Can Teach
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {(profile.teach || ["Python Basics", "Data Structures", "Linear Algebra"]).map(
                    (sub) => (
                      <Badge key={sub} variant="secondary" className="rounded-lg">
                        {sub}
                      </Badge>
                    ),
                  )}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                  Topics I Want To Learn
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {(profile.learn || ["Operating Systems", "React 19", "AI Model Grounding"]).map(
                    (top) => (
                      <Badge
                        key={top}
                        variant="outline"
                        className="rounded-lg border-primary/30 text-primary"
                      >
                        {top}
                      </Badge>
                    ),
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* Profile Quick Details Sidebar */}
          <Card className="rounded-2xl border-border p-6 shadow-soft space-y-4">
            <h3 className="text-base font-semibold tracking-tight border-b border-border pb-3">
              Academic Details
            </h3>

            <div className="space-y-3 text-sm">
              <div>
                <span className="text-xs text-muted-foreground block">Grade / Class Level</span>
                <span className="font-semibold text-foreground flex items-center gap-1.5 mt-0.5">
                  <GraduationCap className="h-4 w-4 text-primary" />
                  {profile.gradeLevel || "Undergraduate"}
                </span>
              </div>

              <div>
                <span className="text-xs text-muted-foreground block">Institution / School</span>
                <span className="font-semibold text-foreground flex items-center gap-1.5 mt-0.5">
                  <Building2 className="h-4 w-4 text-primary" />
                  {profile.institution || "Stanford University"}
                </span>
              </div>

              <div>
                <span className="text-xs text-muted-foreground block">Semester / Class Year</span>
                <span className="font-semibold text-foreground mt-0.5 block">
                  {profile.semesterOrYear || "Semester 4"}
                </span>
              </div>

              <div>
                <span className="text-xs text-muted-foreground block">Degree / Stream</span>
                <span className="font-semibold text-foreground mt-0.5 block">
                  {profile.degreeOrStream || "Add your degree or stream"}
                </span>
              </div>

              <div>
                <span className="text-xs text-muted-foreground block">Location & Timezone</span>
                <span className="font-semibold text-foreground mt-0.5 block">
                  {profile.country || "United States"} · {profile.timezone || "UTC-5 (EST)"}
                </span>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Education History Tab */}
        <TabsContent value="education" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Education Timeline</h2>
              <p className="text-xs text-muted-foreground">
                Your past and current educational background.
              </p>
            </div>
            <Button
              onClick={() => setIsAddEduModalOpen(true)}
              className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant"
            >
              <Plus className="mr-1.5 h-4 w-4" /> Add Education
            </Button>
          </div>

          <div className="space-y-3">
            {eduList.map((edu) => (
              <Card key={edu.id} className="rounded-2xl border-border p-5 shadow-soft">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary shrink-0">
                      <GraduationCap className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-base">{edu.institution}</h3>
                        <Badge variant="secondary" className="rounded-md text-xs">
                          {edu.status}
                        </Badge>
                      </div>
                      <p className="text-sm font-medium text-foreground mt-0.5">
                        {edu.degreeOrClass} {edu.streamOrMajor ? `(${edu.streamOrMajor})` : ""}
                      </p>
                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {edu.startYear} – {edu.endYear}
                        </span>
                        {edu.gradeLevel && (
                          <Badge variant="outline" className="text-xs">
                            {edu.gradeLevel}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <Button
                    onClick={() => handleDeleteEdu(edu.id)}
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Batch Mates Tab */}
        <TabsContent value="batchmates" className="mt-4 space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">University & Batch Mates</h2>
            <p className="text-xs text-muted-foreground">
              Peers from {profile.institution || "your university"} and matching academic streams.
            </p>
          </div>

          {batchMates.length === 0 && (
            <Card className="rounded-2xl border-border p-8 text-center text-sm text-muted-foreground shadow-soft">
              {profile.institution
                ? `No one else from ${profile.institution} has joined yet — invite your classmates!`
                : "Add your institution in Edit Profile to find batch mates."}
            </Card>
          )}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {batchMates.map((b) => (
              <Card key={b.id} className="rounded-2xl border-border p-5 shadow-soft">
                <div className="flex items-center gap-3 mb-3">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={b.avatar} />
                    <AvatarFallback>{b.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{b.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{b.uni}</div>
                  </div>
                </div>

                <div className="rounded-xl bg-secondary/50 p-3 text-xs space-y-1 mb-3">
                  <div className="font-semibold text-foreground">Topic: {b.topic}</div>
                  <div className="text-muted-foreground">Timezone: {b.tz}</div>
                </div>

                <Button
                  onClick={async () => {
                    const res = await sendFriendRequest(
                      { ...(profile as unknown as UserDoc), uid: user!.uid },
                      { uid: b.id, displayName: b.name } as never,
                    );
                    res.success ? toast.success(res.message) : toast.info(res.message);
                  }}
                  className="w-full rounded-xl bg-gradient-primary text-primary-foreground"
                >
                  <MessageSquare className="mr-1.5 h-4 w-4" /> Connect & Study
                </Button>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Credits Log Tab */}
        <TabsContent value="credits" className="mt-4">
          <Card className="rounded-2xl border-border p-3 shadow-soft">
            {creditLog.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No credit activity yet. Credits you earn or spend on SOS requests and tutor sessions will show up here.
              </p>
            )}
            {creditLog.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-xl p-3 hover:bg-secondary/50 transition"
              >
                <div>
                  <div className="text-sm font-medium">{c.reason}</div>
                  <div className="text-xs text-muted-foreground">{c.time}</div>
                </div>
                <div
                  className={`text-sm font-bold ${
                    c.type === "earn" ? "text-emerald-600" : "text-destructive"
                  }`}
                >
                  {c.type === "earn" ? "+" : "-"}
                  {c.amount} credits
                </div>
              </div>
            ))}
          </Card>
        </TabsContent>

        {/* Teaching Tab */}
        <TabsContent value="teaching" className="mt-4">
          <Card className="rounded-2xl border-border p-5 shadow-soft">
            {taught.length === 0 ? (
              <div className="p-3 text-center text-muted-foreground">
                <Clock className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm font-medium">
                  Teaching history and logged tutor hours will appear here.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-3 text-sm font-semibold">
                  {Math.round((Number(profile.teachingMinutes) || 0) / 6) / 10} hours taught · {taught.length}{" "}
                  completed session{taught.length === 1 ? "" : "s"}
                </div>
                {taught.map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-xl p-3 hover:bg-secondary/50 transition">
                    <div>
                      <div className="text-sm font-medium">{t.topic}</div>
                      <div className="text-xs text-muted-foreground">
                        with {t.student.displayName} · {t.durationMin} min
                      </div>
                    </div>
                    <div className="text-sm font-bold text-emerald-600">+{t.credits} credits</div>
                  </div>
                ))}
              </>
            )}
          </Card>
        </TabsContent>

        {/* Badges Tab */}
        <TabsContent value="badges" className="mt-4 grid gap-3 sm:grid-cols-3">
          {ACHIEVEMENTS.filter((a) => unlocked[a.id]).length === 0 && (
            <Card className="sm:col-span-3 rounded-2xl border-border p-6 text-center text-sm text-muted-foreground shadow-soft">
              No badges yet — finish onboarding, keep a streak or help a peer to unlock your first one.
            </Card>
          )}
          {ACHIEVEMENTS.filter((a) => unlocked[a.id]).map((a) => (
            <Card key={a.id} className="rounded-2xl border-border p-5 text-center shadow-soft">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-primary text-primary-foreground font-bold text-lg mb-2">
                ✦
              </div>
              <div className="text-sm font-semibold">{a.name}</div>
              <div className="text-xs text-muted-foreground mt-1">Unlocked achievement badge</div>
            </Card>
          ))}
        </TabsContent>

        {/* Public Reviews Tab */}
        <TabsContent value="reviews" className="mt-4 space-y-4">
          <Card className="rounded-2xl border-border p-5 shadow-soft flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-3xl font-bold">{avgRating ?? "—"}</span>
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {reviewsList.length} reviews from peers and study buddies
              </p>
            </div>
            <Button onClick={() => setIsLeaveReviewOpen(true)} className="rounded-xl">
              Leave a Review
            </Button>
          </Card>

          {reviewsList.length === 0 && (
            <Card className="rounded-2xl border-border p-6 text-center text-sm text-muted-foreground shadow-soft">
              No reviews yet. Study buddies can leave one after working with you.
            </Card>
          )}
          {reviewsList.map((r) => (
            <Card key={r.id} className="rounded-2xl border-border p-5 shadow-soft">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-sm">{r.name}</div>
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className={`h-3.5 w-3.5 ${
                        n <= r.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
                      }`}
                    />
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{r.text}</p>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {/* Edit Profile Dialog */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-xl rounded-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Profile & Student Credentials</DialogTitle>
            <DialogDescription>
              Complete your profile details so AI and peers tailor learning to your exact level.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveProfile} className="space-y-4 py-2">
            <div>
              <Label htmlFor="pf-name" className="text-xs font-semibold">Full Name<RequiredMark /></Label>
              <Input
                id="pf-name"
                autoComplete="name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="rounded-xl mt-1"
                required
              />
            </div>

            {/* Clear Face Picture Selection */}
            <div>
              <Label className="text-xs font-semibold mb-1.5 block">Profile Picture (Avatar)</Label>
              <div className="flex items-center gap-3 mb-2">
                <Avatar className="h-16 w-16 border-2 border-primary shrink-0 shadow-sm">
                  <AvatarImage src={editAvatar || undefined} />
                  <AvatarFallback className="bg-primary/10 text-primary font-bold">
                    AV
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <label className="cursor-pointer inline-flex items-center justify-center h-8 px-3 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl shadow-soft transition gap-1.5">
                      <Upload className="h-3.5 w-3.5" />
                      Upload Picture from Device
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleAvatarFileUpload}
                      />
                    </label>
                    {(editAvatar || profile.avatarUrl) && !removeAvatarFlag && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditAvatar("");
                          setPendingAvatar(null);
                          setRemoveAvatarFlag(true);
                        }}
                        className="h-8 rounded-xl border border-border px-3 text-xs font-medium hover:bg-secondary"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                
                {PRESET_AVATARS.map((url, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setEditAvatar(url)}
                    className={`h-8 w-8 rounded-full overflow-hidden border-2 transition ${
                      editAvatar === url
                        ? "border-primary ring-2 ring-primary/40 scale-105"
                        : "border-transparent opacity-70 hover:opacity-100"
                    }`}
                  >
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>

            {/* Cover Banner Selection */}
            <div>
              <Label className="text-xs font-semibold mb-1.5 block">Cover Banner Image</Label>
              <div className="space-y-2 mb-2">
                <div className="relative h-20 w-full rounded-2xl overflow-hidden border border-border bg-muted shadow-inner">
                  {editCover ? (
                    <img src={editCover} alt="Cover preview" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-gradient-primary" aria-label="No banner" />
                  )}
                  <label className="absolute bottom-2 right-2 cursor-pointer inline-flex items-center gap-1.5 bg-background/90 hover:bg-background text-foreground text-xs font-medium px-2.5 py-1 rounded-xl border border-border shadow-soft transition backdrop-blur-md">
                    <Upload className="h-3.5 w-3.5 text-primary" />
                    <span>Upload Banner from Device</span>
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleCoverFileUpload}
                    />
                  </label>
                  {(editCover || profile.coverImageUrl) && !removeCoverFlag && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditCover("");
                        setPendingCover(null);
                        setRemoveCoverFlag(true);
                      }}
                      className="absolute bottom-2 left-2 inline-flex items-center rounded-xl border border-border bg-background/90 px-2.5 py-1 text-xs font-medium shadow-soft backdrop-blur-md hover:bg-background"
                    >
                      Remove banner
                    </button>
                  )}
                </div>
                
              </div>
              <div className="flex items-center gap-2">
                
                {PRESET_COVERS.map((url, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setEditCover(url)}
                    className={`h-10 flex-1 rounded-xl overflow-hidden border-2 transition ${
                      editCover === url
                        ? "border-primary ring-2 ring-primary/40 scale-102"
                        : "border-border opacity-70 hover:opacity-100"
                    }`}
                  >
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>

            {/* Academic Level Dropdown */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold">Grade / Class Level<RequiredMark /></Label>
                <Select value={editGrade} onValueChange={(v) => setEditGrade(v as GradeLevel)}>
                  <SelectTrigger className="rounded-xl mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Matric">Matric (8th - 10th Grade)</SelectItem>
                    <SelectItem value="Intermediate">Intermediate (FSc / A-Levels)</SelectItem>
                    <SelectItem value="Undergraduate">Undergraduate (Bachelor's)</SelectItem>
                    <SelectItem value="Graduate">Graduate (Master's)</SelectItem>
                    <SelectItem value="Mphil">Mphil (Post-Graduate)</SelectItem>
                    <SelectItem value="Phd">Phd (Doctoral / Research)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="pf-inst" className="text-xs font-semibold">Institution / University<RequiredMark /></Label>
                <InstitutionSelect
                  id="pf-inst"
                  value={editInst}
                  onChange={(v, inst) => {
                    setEditInst(v);
                    setEditInstId(inst?.id ?? null);
                  }}
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold">Semester / Year</Label>
                <Input aria-label="e.g. Semester 4 or Class 10"
                  value={editSem}
                  onChange={(e) => setEditSem(e.target.value)}
                  placeholder="e.g. Semester 4 or Class 10"
                  className="rounded-xl mt-1"
                />
              </div>

              <div>
                <Label className="text-xs font-semibold">Degree OR Science/Arts Stream</Label>
                <Input aria-label="e.g. BS Computer Science OR Science Stream"
                  value={editDeg}
                  onChange={(e) => setEditDeg(e.target.value)}
                  placeholder="e.g. BS Computer Science OR Science Stream"
                  className="rounded-xl mt-1"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold">About / Bio</Label>
              <Textarea
                value={editAbout}
                onChange={(e) => setEditAbout(e.target.value)}
                placeholder="Share your learning goals, interest, or study schedule..."
                rows={3}
                className="rounded-xl mt-1"
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pf-country" className="text-xs font-semibold">Country<RequiredMark /></Label>
                <CountrySelect id="pf-country" value={editCountry} onChange={setEditCountry} />
              </div>
              <div>
                <Label className="text-xs font-semibold">Timezone<RequiredMark /></Label>
                <Select value={editTimezone} onValueChange={setEditTimezone}>
                  <SelectTrigger className="rounded-xl mt-1">
                    <SelectValue placeholder="Select Timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UTC+5 (PST, Pakistan Standard Time)">
                      UTC+5 (PST, Pakistan Standard Time)
                    </SelectItem>
                    <SelectItem value="UTC-5 (EST)">UTC-5 (EST, Eastern Standard Time)</SelectItem>
                    <SelectItem value="UTC-8 (PST)">UTC-8 (PST, Pacific Standard Time)</SelectItem>
                    <SelectItem value="UTC+0 (GMT)">UTC+0 (GMT, Greenwich Mean Time)</SelectItem>
                    <SelectItem value="UTC+1 (CET)">UTC+1 (CET, Central European Time)</SelectItem>
                    <SelectItem value="UTC+5:30 (IST)">
                      UTC+5:30 (IST, Indian Standard Time)
                    </SelectItem>
                    <SelectItem value="UTC+8 (SGT)">UTC+8 (SGT, Singapore Time)</SelectItem>
                    <SelectItem value="UTC+9 (JST)">UTC+9 (JST, Japan Standard Time)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditModalOpen(false)}
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant"
              >
                {saving ? (uploadPct !== null ? `Uploading… ${uploadPct}%` : "Saving…") : "Save Profile Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Education Modal */}
      <Dialog open={isAddEduModalOpen} onOpenChange={setIsAddEduModalOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Add Education History</DialogTitle>
            <DialogDescription>
              Add past or current school, college, or university entries.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddEducation} className="space-y-3 py-1">
            <div>
              <Label className="text-xs font-semibold">School / University Name<RequiredMark /></Label>
              <Input aria-label="e.g. Harvard University"
                value={newEduInst}
                onChange={(e) => setNewEduInst(e.target.value)}
                placeholder="e.g. Harvard University"
                className="rounded-xl mt-1"
                required
              />
            </div>

            <div>
              <Label className="text-xs font-semibold">Degree / Class<RequiredMark /></Label>
              <Input aria-label="e.g. BS Computer Science or Matric Science"
                value={newEduDeg}
                onChange={(e) => setNewEduDeg(e.target.value)}
                placeholder="e.g. BS Computer Science or Matric Science"
                className="rounded-xl mt-1"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold">Start Year</Label>
                <Input
                  value={newEduStartYear}
                  onChange={(e) => setNewEduStartYear(e.target.value)}
                  className="rounded-xl mt-1"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold">End Year (or Expected)</Label>
                <Input
                  value={newEduEndYear}
                  onChange={(e) => setNewEduEndYear(e.target.value)}
                  className="rounded-xl mt-1"
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddEduModalOpen(false)}
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant"
              >
                Add Education
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Leave Review Dialog */}
      <Dialog open={isLeaveReviewOpen} onOpenChange={setIsLeaveReviewOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Leave a Public Review</DialogTitle>
            <DialogDescription>
              Share feedback regarding your study session experience.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleLeaveReview} className="space-y-3 py-1">
            <div>
              <Label className="text-xs font-semibold mb-1 block">Who are you reviewing?</Label>
              <Select value={reviewTarget} onValueChange={setReviewTarget}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue
                    placeholder={myBuddies.length ? "Choose a study buddy" : "Connect with a study buddy first"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {myBuddies.map((b) => (
                    <SelectItem key={b.uid} value={b.uid}>
                      {b.displayName} (@{b.username})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold mb-1 block">Rating (1 to 5 Stars)</Label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setReviewRating(n)} className="p-1">
                    <Star
                      className={`h-6 w-6 ${
                        n <= reviewRating
                          ? "fill-amber-400 text-amber-400"
                          : "text-muted-foreground/30"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold">Feedback Comment</Label>
              <Textarea
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
                placeholder="Great explanation of the concepts..."
                rows={3}
                className="rounded-xl mt-1"
                required
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsLeaveReviewOpen(false)}
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant"
              >
                Submit Review
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ImageCropDialog
        file={crop?.file ?? null}
        aspect={crop?.kind === "avatar" ? 1 : 3.2}
        outputWidth={crop?.kind === "avatar" ? 512 : 1600}
        maxBytes={crop?.kind === "avatar" ? 150_000 : 450_000}
        round={crop?.kind === "avatar"}
        title={crop?.kind === "avatar" ? "Adjust your profile picture" : "Adjust your cover banner"}
        onCancel={() => setCrop(null)}
        onDone={handleCropped}
      />
    </div>
  );
}
