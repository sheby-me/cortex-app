import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  User,
  GraduationCap,
  ShieldCheck,
  Bell,
  Moon,
  Trash2,
  Lock,
  Save,
  CheckCircle2,
  AtSign,
  AlertCircle,
  Check,
  Upload,
  Camera,
} from "lucide-react";
import { useAuth, type GradeLevel } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { toast } from "sonner";
import { cleanHandle, isValidHandle, isUsernameTaken } from "@/lib/user-network";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { auth } from "@/integrations/firebase/client";
import { deleteMyAccountData, uploadAvatar, uploadCover } from "@/services/users";
import { deleteUser, reauthenticateWithPopup } from "firebase/auth";
import { googleProvider } from "@/integrations/firebase/client";
import { errorMessage } from "@/services/common";
import { RequiredMark } from "@/components/required-mark";
import { StudentVerificationCard } from "@/components/student-verification-card";
import { ImageCropDialog } from "@/components/image-crop-dialog";
import { CountrySelect } from "@/components/country-select";
import { InstitutionSelect } from "@/components/institution-select";
import { validatePersonName } from "@/lib/name-policy";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Cortex" },
      {
        name: "description",
        content: "Account, grade level, notifications and security settings.",
      },
    ],
  }),
  component: SettingsPage,
});

export function SettingsPage() {
  const { profile, updateProfile } = useAuth();
  const { isDark, setTheme } = useTheme();

  // Form State
  const [name, setName] = useState(profile.displayName || "");
  const [username, setUsername] = useState(profile.username || "");
  const [email, setEmail] = useState(profile.email || "");
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl || "");
  const [coverImageUrl, setCoverImageUrl] = useState(profile.coverImageUrl || "");
  const [grade, setGrade] = useState<GradeLevel>(
    (profile.gradeLevel as GradeLevel) || "Undergraduate",
  );
  const [institutionId, setInstitutionId] = useState<string | null>((profile.institutionId as string | null) ?? null);
  const [institution, setInstitution] = useState(profile.institution || "");
  const [semester, setSemester] = useState(profile.semesterOrYear || "");
  const [degree, setDegree] = useState(profile.degreeOrStream || "");
  const [country, setCountry] = useState(profile.country || "");
  const [timezone, setTimezone] = useState(profile.timezone || "");
  const [bio, setBio] = useState(profile.about || "");

  // Image files are previewed locally and uploaded to Firebase Storage when settings are saved.
  const settingsAvatarInputRef = useRef<HTMLInputElement>(null);
  const settingsCoverInputRef = useRef<HTMLInputElement>(null);
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [pendingCover, setPendingCover] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const [crop, setCrop] = useState<{ file: File; kind: "avatar" | "cover" } | null>(null);

  const startCrop = (e: React.ChangeEvent<HTMLInputElement>, kind: "avatar" | "cover") => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file (JPG, PNG or WebP).");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error("That image is too large. Please choose one under 15 MB.");
      return;
    }
    setCrop({ file, kind });
  };

  const handleCropped = (cropped: File) => {
    const c = crop;
    setCrop(null);
    if (!c) return;
    const preview = URL.createObjectURL(cropped);
    if (c.kind === "avatar") {
      setPendingAvatar(cropped);
      setAvatarUrl(preview);
    } else {
      setPendingCover(cropped);
      setCoverImageUrl(preview);
    }
    toast.success("Picture ready — save to apply it.");
  };

  const handleSettingsAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => startCrop(e, "avatar");
  const handleSettingsCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => startCrop(e, "cover");

  // Username live validation (format locally, availability against Firestore, debounced)
  const cleanedHandle = cleanHandle(username);
  const handleVal = isValidHandle(cleanedHandle);
  const [handleTaken, setHandleTaken] = useState(false);
  useEffect(() => {
    if (!handleVal.valid || cleanedHandle === (profile.username || "")) {
      setHandleTaken(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      isUsernameTaken(cleanedHandle, profile.uid)
        .then((taken) => !cancelled && setHandleTaken(taken))
        .catch(() => !cancelled && setHandleTaken(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [cleanedHandle, handleVal.valid, profile.uid, profile.username]);

  // Preference Switches State
  const [darkMode, setDarkMode] = useState(isDark);
  const [emailNotifs, setEmailNotifs] = useState(profile.emailNotifications !== false);
  const [showLeaderboard, setShowLeaderboard] = useState(profile.showLeaderboard !== false);
  const [sosAvailable, setSosAvailable] = useState(profile.sosAvailable !== false);

  // Security Dialogs
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setName(profile.displayName || "");
    setUsername(profile.username || "");
    setEmail(profile.email || "");
    setAvatarUrl(profile.avatarUrl || "");
    setCoverImageUrl(profile.coverImageUrl || "");
    setGrade((profile.gradeLevel as GradeLevel) || "Undergraduate");
    setInstitution(profile.institution || "");
    setSemester(profile.semesterOrYear || "");
    setDegree(profile.degreeOrStream || "");
    setCountry(profile.country || "");
    setTimezone(profile.timezone || "");
    setBio(profile.about || "");
    setDarkMode(Boolean(profile.darkMode));
    setEmailNotifs(profile.emailNotifications !== false);
    setShowLeaderboard(profile.showLeaderboard !== false);
    setSosAvailable(profile.sosAvailable !== false);
  }, [profile]);

  const handleSaveChanges = async () => {
    if (!handleVal.valid) {
      toast.error(handleVal.reason || "Invalid username format.");
      return;
    }
    const nameCheck = validatePersonName(name, "full name");
    if (!nameCheck.ok) {
      toast.error(nameCheck.error ?? "Please enter a valid name.");
      return;
    }
    if (!country || !institution.trim() || !grade || !timezone) {
      toast.error("Please fill in all required fields (marked with *).");
      return;
    }
    if (handleTaken) {
      toast.error(`The username @${cleanedHandle} is already taken by another user.`);
      return;
    }

    setSaving(true);
    try {
      let newAvatar = avatarUrl;
      let newCover = coverImageUrl;
      if (pendingAvatar) newAvatar = await uploadAvatar(profile.uid, pendingAvatar, profile.avatarUrl);
      if (pendingCover) newCover = await uploadCover(profile.uid, pendingCover, profile.coverImageUrl);

      // The username is claimed in a transaction (usernames/{handle}) so two people can never share one.
      await updateProfile({
        displayName: nameCheck.value,
        username: cleanedHandle,
        institutionId,
        avatarUrl: newAvatar,
        coverImageUrl: newCover,
        gradeLevel: grade,
        institution,
        semesterOrYear: semester,
        degreeOrStream: degree,
        country,
        timezone,
        about: bio,
        darkMode,
        emailNotifications: emailNotifs,
        showLeaderboard,
        sosAvailable,
      });
      setPendingAvatar(null);
      setPendingCover(null);
      toast.success("Settings saved successfully!");
    } catch (err) {
      const msg =
        (err as Error)?.message === "USERNAME_TAKEN"
          ? `The username @${cleanedHandle} was just taken. Please choose another.`
          : errorMessage(err, "Couldn't save your settings.");
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  /** Real password change: re-authenticate with the current password, then update it. */
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match.");
      return;
    }
    const current = auth.currentUser;
    if (!current?.email) {
      toast.error("You're not signed in with an email and password.");
      return;
    }
    if (!current.providerData.some((p) => p.providerId === "password")) {
      toast.error("This account signs in with Google — manage its password in your Google account.");
      return;
    }
    try {
      await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, currentPassword));
      await updatePassword(current, newPassword);
      setIsPasswordModalOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated successfully!");
    } catch (err) {
      const code = (err as { code?: string }).code;
      toast.error(
        code === "auth/wrong-password" || code === "auth/invalid-credential"
          ? "Your current password is incorrect."
          : errorMessage(err, "Couldn't update your password."),
      );
    }
  };

  /** Re-authenticate, erase the user's data, then delete the sign-in itself. */
  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const current = auth.currentUser;
    if (!current) return;
    setDeleting(true);
    try {
      const usesPassword = current.providerData.some((p) => p.providerId === "password");
      if (usesPassword) {
        await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email ?? "", deletePassword));
      } else {
        await reauthenticateWithPopup(current, googleProvider);
      }
      await deleteMyAccountData(current.uid, profile.username);
      await deleteUser(current);
      toast.success("Your account was deleted. Take care!");
      window.location.assign("/");
    } catch (err) {
      const code = (err as { code?: string }).code;
      toast.error(
        code === "auth/wrong-password" || code === "auth/invalid-credential"
          ? "That password is incorrect."
          : errorMessage(err, "Couldn't delete your account."),
      );
    } finally {
      setDeleting(false);
    }
  };

  /** Resets preference switches (not your account data) to their defaults. */
  const handleResetData = async () => {
    try {
      await updateProfile({
        darkMode: false,
        emailNotifications: true,
        showLeaderboard: true,
        sosAvailable: true,
      });
      toast.info("Preferences reset to default!");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't reset preferences."));
    }
    setIsResetModalOpen(false);
  };

  return (
    <div className="mx-auto max-w-4xl p-6 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl md:text-4xl tracking-tight font-medium">
            Account Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your student profile, academic level, preferences, and privacy.
          </p>
        </div>

        <Button
          onClick={handleSaveChanges}
          disabled={saving}
          className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant hover:opacity-90 px-5"
        >
          <Save className="mr-1.5 h-4 w-4" /> {saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>

      {/* Profile & Academic Info */}
      <Card className="rounded-3xl border-border p-6 shadow-soft space-y-4">
        <div className="flex items-center gap-2 font-semibold text-lg border-b border-border pb-3">
          <User className="h-5 w-5 text-primary" />
          Student Account & Credentials
        </div>

        {/* Profile Picture & Cover Photo Local Storage Upload Section */}
        <div className="grid gap-4 md:grid-cols-2 bg-secondary/30 p-4 rounded-2xl border border-border">
          {/* Profile Picture Upload */}
          <div>
            <Label className="text-xs font-semibold mb-2 block">Profile Picture (Avatar)</Label>
            <div className="flex items-center gap-3">
              <Avatar className="h-14 w-14 border-2 border-primary shrink-0 shadow-sm">
                <AvatarImage src={avatarUrl} />
                <AvatarFallback className="bg-primary/10 text-primary font-bold">ST</AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-1.5">
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl shadow-soft transition">
                  <Upload className="h-3.5 w-3.5" />
                  Upload Local Photo
                  <input
                    ref={settingsAvatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleSettingsAvatarUpload}
                  />
                </label>
                <Input aria-label="Or paste photo URL..."
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="Or paste photo URL..."
                  className="rounded-xl text-xs h-7"
                />
              </div>
            </div>
          </div>

          {/* Cover Photo Upload */}
          <div>
            <Label className="text-xs font-semibold mb-2 block">Cover Banner Photo</Label>
            <div className="space-y-1.5">
              <div className="relative h-14 w-full rounded-xl overflow-hidden border border-border bg-muted">
                {coverImageUrl ? (
                  <img
                    src={coverImageUrl}
                    alt="Cover preview"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
                    No cover banner set
                  </div>
                )}
                <label className="absolute bottom-1 right-1 cursor-pointer inline-flex items-center gap-1 bg-background/90 text-foreground text-xs font-medium px-2 py-0.5 rounded-lg border border-border shadow-soft hover:bg-background transition backdrop-blur-md">
                  <Camera className="h-3 w-3 text-primary" />
                  <span>Upload Local Cover</span>
                  <input
                    ref={settingsCoverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleSettingsCoverUpload}
                  />
                </label>
              </div>
              <Input aria-label="Or paste cover URL..."
                value={coverImageUrl}
                onChange={(e) => setCoverImageUrl(e.target.value)}
                placeholder="Or paste cover URL..."
                className="rounded-xl text-xs h-7"
              />
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="st-name" className="text-xs font-semibold">Full Name<RequiredMark /></Label>
            <Input
              id="st-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 rounded-xl"
            />
          </div>

          <div>
            <Label className="text-xs font-semibold flex items-center justify-between">
              <span>Unique ID / Username (@handle)<RequiredMark /></span>
              {handleVal.valid && !handleTaken && (
                <span className="text-xs font-normal text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <Check className="h-3 w-3" /> Available
                </span>
              )}
            </Label>
            <div className="relative mt-1.5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium text-sm select-none">
                @
              </span>
              <Input aria-label="unique_handle"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="unique_handle"
                className={`pl-8 rounded-xl font-mono text-sm ${
                  handleTaken || !handleVal.valid
                    ? "border-destructive focus-visible:ring-destructive"
                    : "focus-visible:ring-emerald-500"
                }`}
              />
            </div>
            {handleTaken ? (
              <p className="text-xs text-destructive mt-1 flex items-center gap-1 font-medium">
                <AlertCircle className="h-3 w-3" /> @{cleanedHandle} is already taken by another
                user.
              </p>
            ) : !handleVal.valid && username.length > 0 ? (
              <p className="text-xs text-destructive mt-1 flex items-center gap-1 font-medium">
                <AlertCircle className="h-3 w-3" /> {handleVal.reason}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                Other students & tutors can search, message, and invite you using @
                {cleanedHandle || "username"}.
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs font-semibold">Email Address</Label>
            <Input
              value={email}
              readOnly
              disabled
              title="Your sign-in email can't be changed here"
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 rounded-xl"
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Grade / Academic Level<RequiredMark /></Label>
            <Select value={grade} onValueChange={(v) => setGrade(v as GradeLevel)}>
              <SelectTrigger className="mt-1.5 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Matric">Matric (High School 8th-10th)</SelectItem>
                <SelectItem value="Intermediate">Intermediate (FSc / A-Levels)</SelectItem>
                <SelectItem value="Undergraduate">Undergraduate (Bachelor's)</SelectItem>
                <SelectItem value="Graduate">Graduate (Master's)</SelectItem>
                <SelectItem value="Mphil">Mphil (Post-Graduate)</SelectItem>
                <SelectItem value="Phd">Phd (Doctoral / Research)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              AI assistant will tailor its responses and problem depth to your selected grade.
            </p>
          </div>

          <div>
            <Label htmlFor="st-institution" className="text-xs font-semibold">Institution / University<RequiredMark /></Label>
            <InstitutionSelect
              id="st-institution"
              value={institution}
              onChange={(v, inst) => {
                setInstitution(v);
                setInstitutionId(inst?.id ?? null);
              }}
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Semester / Class Year</Label>
            <Input aria-label="e.g. Semester 4 (2025)"
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
              placeholder="e.g. Semester 4 (2025)"
              className="mt-1.5 rounded-xl"
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Degree OR Science/Arts Stream</Label>
            <Input aria-label="e.g. BS Computer Science OR Science Stream"
              value={degree}
              onChange={(e) => setDegree(e.target.value)}
              placeholder="e.g. BS Computer Science OR Science Stream"
              className="mt-1.5 rounded-xl"
            />
          </div>

          <div>
            <Label htmlFor="st-country" className="text-xs font-semibold">Country<RequiredMark /></Label>
            <CountrySelect id="st-country" value={country} onChange={setCountry} />
          </div>

          <div>
            <Label className="text-xs font-semibold">Timezone<RequiredMark /></Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger className="mt-1.5 rounded-xl">
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
                <SelectItem value="UTC+5:30 (IST)">UTC+5:30 (IST, Indian Standard Time)</SelectItem>
                <SelectItem value="UTC+8 (SGT)">UTC+8 (SGT, Singapore Time)</SelectItem>
                <SelectItem value="UTC+9 (JST)">UTC+9 (JST, Japan Standard Time)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="md:col-span-2">
            <Label className="text-xs font-semibold">Bio / Learning Goals</Label>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              className="mt-1.5 rounded-xl"
            />
          </div>
        </div>
      </Card>


      {/* Student verification */}
      <StudentVerificationCard
        verified={!!profile.universityVerified}
        verifiedName={(profile.verifiedUniversityName as string | null) ?? null}
        institutionName={profile.institution || ""}
        institutionId={(profile.institutionId as string | null) ?? null}
        accountEmail={profile.email || ""}
      />

      {/* Preferences Section */}
      <Card className="rounded-3xl border-border p-6 shadow-soft space-y-4">
        <div className="flex items-center gap-2 font-semibold text-lg border-b border-border pb-3">
          <Bell className="h-5 w-5 text-primary" />
          App Preferences & Visibility
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Dark Mode</div>
              <div className="text-xs text-muted-foreground">
                Switch to dark visual canvas theme.
              </div>
            </div>
            <Switch
              checked={darkMode}
              onCheckedChange={(checked) => {
                setDarkMode(checked);
                setTheme(checked ? "dark" : "light");
              }}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Email Notifications</div>
              <div className="text-xs text-muted-foreground">
                Receive study buddy invites, session bookings, and credit alerts.
              </div>
            </div>
            <Switch checked={emailNotifs} onCheckedChange={setEmailNotifs} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Show Me On Leaderboards</div>
              <div className="text-xs text-muted-foreground">
                Display your study streak and teaching hours on global leaderboards.
              </div>
            </div>
            <Switch checked={showLeaderboard} onCheckedChange={setShowLeaderboard} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Available for SOS Help</div>
              <div className="text-xs text-muted-foreground">
                Allow nearby peers to send emergency study help requests to you.
              </div>
            </div>
            <Switch checked={sosAvailable} onCheckedChange={setSosAvailable} />
          </div>
        </div>
      </Card>

      {/* Security & Danger Zone */}
      <Card className="rounded-3xl border-border p-6 shadow-soft space-y-4">
        <div className="flex items-center gap-2 font-semibold text-lg border-b border-border pb-3">
          <ShieldCheck className="h-5 w-5 text-primary" />
          Security & Account Control
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-medium text-sm">Account Password</div>
            <div className="text-xs text-muted-foreground">
              Update your account password or security key.
            </div>
          </div>
          <Button
            onClick={() => setIsPasswordModalOpen(true)}
            variant="outline"
            className="rounded-xl"
          >
            <Lock className="mr-1.5 h-4 w-4" /> Change Password
          </Button>
        </div>

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <div>
            <div className="font-medium text-sm text-destructive">Danger Zone</div>
            <div className="text-xs text-muted-foreground">
              Reset your preference switches to their defaults.
            </div>
          </div>
          <Button
            onClick={() => setIsResetModalOpen(true)}
            variant="outline"
            className="rounded-xl"
          >
            Reset preferences
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <div>
            <div className="font-medium text-sm text-destructive">Delete account</div>
            <div className="text-xs text-muted-foreground">
              Permanently remove your profile, credits and sign-in. This can't be undone.
            </div>
          </div>
          <Button onClick={() => setIsDeleteOpen(true)} variant="destructive" className="rounded-xl">
            <Trash2 className="mr-1.5 h-4 w-4" /> Delete account
          </Button>
        </div>
      </Card>

      {/* Change Password Modal */}
      <Dialog open={isPasswordModalOpen} onOpenChange={setIsPasswordModalOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Change Account Password</DialogTitle>
            <DialogDescription>
              Enter your current password and choose a new secure password.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUpdatePassword} className="space-y-3 py-2">
            <div>
              <Label className="text-xs font-semibold">Current Password</Label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="rounded-xl mt-1"
                required
              />
            </div>

            <div>
              <Label className="text-xs font-semibold">New Password</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="rounded-xl mt-1"
                required
              />
            </div>

            <div>
              <Label className="text-xs font-semibold">Confirm New Password</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="rounded-xl mt-1"
                required
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsPasswordModalOpen(false)}
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant"
              >
                Update Password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reset Data Confirmation */}
      <Dialog open={isResetModalOpen} onOpenChange={setIsResetModalOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Reset preferences?</DialogTitle>
            <DialogDescription>
              Notification, privacy and appearance switches go back to their defaults. Your profile and activity are not touched.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="pt-2">
            <Button
              variant="outline"
              onClick={() => setIsResetModalOpen(false)}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button onClick={handleResetData} variant="destructive" className="rounded-xl">
              Reset preferences
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete account */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your profile, username, credits, friendships and sign-in. Posts and messages you
              shared with others may remain until an administrator removes them.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleDeleteAccount} className="space-y-3 py-1">
            {auth.currentUser?.providerData.some((p) => p.providerId === "password") && (
              <div>
                <Label htmlFor="delete-password" className="text-xs font-semibold">Your password</Label>
                <Input
                  id="delete-password"
                  type="password"
                  autoComplete="current-password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  required
                  className="mt-1 rounded-xl"
                />
              </div>
            )}
            <div>
              <Label htmlFor="delete-confirm" className="text-xs font-semibold">
                Type <span className="font-mono">DELETE</span> to confirm
              </Label>
              <Input
                id="delete-confirm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                autoComplete="off"
                className="mt-1 rounded-xl"
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsDeleteOpen(false)} className="rounded-xl">
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={deleting || deleteConfirmText !== "DELETE"}
                className="rounded-xl"
              >
                {deleting ? "Deleting…" : "Delete forever"}
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
