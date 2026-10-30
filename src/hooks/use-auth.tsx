import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { toast } from "sonner";
import { auth, db } from "@/integrations/firebase/client";
import {
  ensureUserDocument,
  startPresence,
  subscribeUser,
  updateUserProfile,
  type UserDoc,
} from "@/services/users";
import { settlePendingCredits } from "@/services/credits";
import { evaluateAchievements, startStudyTimer, touchStudyStreak } from "@/services/gamification";
import { startNotificationListener, stopNotificationListener } from "@/lib/notifications-store";

export type AppRole = "student" | "tutor" | "admin";

export type GradeLevel = "Matric" | "Intermediate" | "Undergraduate" | "Graduate" | "Mphil" | "Phd";

export interface EducationEntry {
  id: string;
  institution: string;
  degreeOrClass: string;
  streamOrMajor?: string;
  startYear: string;
  endYear: string;
  status: "Completed" | "In Progress" | "Pursuing";
  gradeLevel?: GradeLevel;
}

export type UserProfile = {
  uid: string;
  username?: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl?: string | null;
  coverImageUrl?: string | null;
  role: AppRole;
  tutorStatus?: "pending" | "approved" | "rejected" | null;
  gradeLevel?: GradeLevel | null;
  institution?: string | null;
  semesterOrYear?: string | null;
  degreeOrStream?: string | null;
  about?: string | null;
  country?: string | null;
  timezone?: string | null;
  hoursGoal?: number;
  teach?: string[];
  learn?: string[];
  educationHistory?: EducationEntry[];
  credits?: number;
  darkMode?: boolean;
  emailNotifications?: boolean;
  showLeaderboard?: boolean;
  sosAvailable?: boolean;
  onboarded?: boolean;
  institutionId?: string | null;
  universityVerified?: boolean;
  verifiedUniversityId?: string | null;
  verifiedUniversityName?: string | null;
  creditsEarned?: number;
  teachingMinutes?: number;
  studyStreak?: number;
  lastStudyDate?: string | null;
  online?: boolean;
  [k: string]: unknown;
};

/** Blank profile used while signed out / loading. (Previously a fake "Alex Morgan" demo user.) */
const EMPTY_PROFILE: UserProfile = {
  uid: "",
  username: null,
  email: null,
  displayName: "",
  avatarUrl: null,
  coverImageUrl: null,
  role: "student",
  gradeLevel: null,
  institution: null,
  semesterOrYear: null,
  degreeOrStream: null,
  about: null,
  country: null,
  timezone: null,
  hoursGoal: 5,
  teach: [],
  learn: [],
  educationHistory: [],
  credits: 0,
  darkMode: false,
  emailNotifications: true,
  showLeaderboard: true,
  sosAvailable: true,
};

export function calculateProfileCompletion(profile: Partial<UserProfile> | null) {
  if (!profile) return { percentage: 0, missingFields: ["Profile data"] };

  const checks = [
    {
      key: "displayName",
      label: "Full Name",
      done: Boolean(profile.displayName && profile.displayName.trim().length > 2),
    },
    {
      key: "avatarUrl",
      label: "Clear Face Picture",
      done: Boolean(profile.avatarUrl && profile.avatarUrl.trim().length > 5),
    },
    {
      key: "coverImageUrl",
      label: "Cover Banner Image",
      done: Boolean(profile.coverImageUrl && profile.coverImageUrl.trim().length > 5),
    },
    { key: "gradeLevel", label: "Grade / Class Level", done: Boolean(profile.gradeLevel) },
    {
      key: "institution",
      label: "School / University Name",
      done: Boolean(profile.institution && profile.institution.trim().length > 2),
    },
    {
      key: "semesterOrYear",
      label: "Semester / Year",
      done: Boolean(profile.semesterOrYear && profile.semesterOrYear.trim().length > 1),
    },
    {
      key: "degreeOrStream",
      label: "Degree / Stream",
      done: Boolean(profile.degreeOrStream && profile.degreeOrStream.trim().length > 2),
    },
    {
      key: "about",
      label: "About / Bio Summary",
      done: Boolean(profile.about && profile.about.trim().length >= 15),
    },
    {
      key: "educationHistory",
      label: "Education History",
      done: Boolean(profile.educationHistory && profile.educationHistory.length > 0),
    },
    {
      key: "topics",
      label: "Teach/Learn Topics",
      done: Boolean(
        (profile.teach && profile.teach.length > 0) || (profile.learn && profile.learn.length > 0),
      ),
    },
  ];

  const completedCount = checks.filter((c) => c.done).length;
  const percentage = Math.round((completedCount / checks.length) * 100);
  const missingFields = checks.filter((c) => !c.done).map((c) => c.label);

  return { percentage, missingFields, checks };
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile;
  role: AppRole;
  /** True only when an /admins/{uid} document exists — the authoritative admin check (also enforced by rules). */
  isAdmin: boolean;
  /** False for password accounts that haven't proven they own the mailbox yet (Google accounts are always verified). */
  emailVerified: boolean;
  /** True until Firebase has restored the session AND the first profile snapshot has arrived. */
  loading: boolean;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads the account from Firebase (after the user clicked the link / entered the code). Returns the verified flag. */
  refreshUser: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: EMPTY_PROFILE,
  role: "student",
  isAdmin: false,
  emailVerified: false,
  loading: true,
  updateProfile: async () => {},
  signOut: async () => {},
  refreshUser: async () => false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [profileReady, setProfileReady] = useState(false);
  const [role, setRole] = useState<AppRole>("student");
  const [isAdmin, setIsAdmin] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const sessionInit = useRef<string | null>(null);

  // 1) Session persistence: Firebase restores the signed-in user from IndexedDB; we just observe it.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        // The email_verified flag the security rules check lives in the ID token. A token minted before the user
        // confirmed their mailbox (e.g. they clicked the link in another browser) keeps saying "false" for up to an hour,
        // which shows up as "You don't have permission" on every query. Re-read the account and force a fresh token
        // BEFORE the rest of the app starts querying.
        try {
          await u.reload();
          if (u.emailVerified) await u.getIdToken(true);
        } catch (err) {
          console.warn("[Cortex] could not refresh the session token", err);
        }
      }
      setUser(u);
      setEmailVerified(!!u?.emailVerified);
      setAuthReady(true);
      if (!u) {
        setProfile(EMPTY_PROFILE);
        setProfileReady(false);
        setRole("student");
        setIsAdmin(false);
        sessionInit.current = null;
        stopNotificationListener();
      }
    });
    return () => unsub();
  }, []);

  // 2) Live profile document. Creates it if the account has none yet (e.g. first Google sign-in on a new device).
  useEffect(() => {
    // Unverified accounts are held on /verify-email; Firestore rules reject their reads anyway.
    if (!user || !emailVerified) {
      if (user) setProfileReady(true);
      return;
    }
    let cancelled = false;

    // Safety net: never leave the app on a spinner if Firestore is blocked (e.g. rules misconfigured).
    const timer = setTimeout(() => !cancelled && setProfileReady(true), 6000);

    const unsub = subscribeUser(
      user.uid,
      async (data) => {
        if (cancelled) return;
        if (!data) {
          try {
            await ensureUserDocument(user); // snapshot fires again once created
          } catch (err) {
            console.error("Could not create user profile:", err);
            setProfileReady(true);
          }
          return;
        }
        clearTimeout(timer);
        setProfile({
          ...EMPTY_PROFILE,
          ...(data as unknown as UserProfile),
          uid: user.uid,
          email: user.email ?? null,
          displayName: data.displayName || user.displayName || "",
        });
        setRole((data.role as AppRole) ?? "student");
        setProfileReady(true);
      },
      (err) => {
        console.warn("User profile listener error:", err);
        clearTimeout(timer);
        setProfileReady(true);
      },
    );

    // Authoritative admin flag (rules only honour /admins/{uid}).
    // Live, so claiming admin rights on /admin takes effect without a reload.
    const unsubAdmin = onSnapshot(
      doc(db, "admins", user.uid),
      (s) => !cancelled && setIsAdmin(s.exists()),
      () => !cancelled && setIsAdmin(false),
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsub();
      unsubAdmin();
    };
  }, [user, emailVerified]);

  // 3) Per-session background work: presence, notifications, payouts, streak, achievements.
  useEffect(() => {
    if (!user || !profileReady || !emailVerified) return;
    const stopPresence = startPresence(user.uid);
    const stopStudyTimer = startStudyTimer(user.uid);
    startNotificationListener(user.uid);
    return () => {
      stopPresence();
      stopStudyTimer();
    };
  }, [user, profileReady, emailVerified]);

  useEffect(() => {
    if (!user || !profileReady || !emailVerified || !profile.uid || sessionInit.current === user.uid) return;
    sessionInit.current = user.uid;
    (async () => {
      try {
        const claims = await settlePendingCredits(user.uid);
        claims.forEach((m) => toast.success(m));
        const streak = await touchStudyStreak({
          uid: user.uid,
          studyStreak: profile.studyStreak as number | undefined,
          lastStudyDate: profile.lastStudyDate as string | undefined,
        });
        const unlocked = await evaluateAchievements({
          ...(profile as unknown as UserDoc),
          uid: user.uid,
          studyStreak: streak,
        });
        unlocked.forEach((a) => toast.success(`Achievement unlocked: ${a.name}`));
      } catch (err) {
        console.warn("Session init tasks failed:", err);
      }
    })();
  }, [user, profileReady, profile]);

  const effectiveRole: AppRole = isAdmin ? "admin" : role === "admin" ? "student" : role;

  const updateProfile = useCallback(
    async (updates: Partial<UserProfile>) => {
      if (!user) throw new Error("You need to be signed in to update your profile.");
      const previous = profile;
      // Optimistic UI: show the change instantly, roll back if Firestore rejects it.
      setProfile((p) => ({ ...p, ...updates, username: updates.username ?? p.username }));
      try {
        await updateUserProfile(user.uid, updates as Partial<UserDoc>, previous as unknown as Partial<UserDoc>);
      } catch (err) {
        setProfile(previous);
        throw err;
      }
    },
    [user, profile],
  );

  const signOut = useCallback(async () => {
    stopNotificationListener();
    if (user) {
      // Mark offline while we still have permission to write.
      await updateDoc(doc(db, "users", user.uid), { online: false, lastSeen: serverTimestamp() }).catch(() => undefined);
    }
    await fbSignOut(auth);
  }, [user]);

  const refreshUser = useCallback(async () => {
    const u = auth.currentUser;
    if (!u) return false;
    await u.reload();
    if (u.emailVerified) {
      // The Firestore/Storage rules read `email_verified` from the ID token, so force a fresh one.
      await u.getIdToken(true);
    }
    setEmailVerified(u.emailVerified);
    return u.emailVerified;
  }, []);

  const loading = !authReady || (!!user && !profileReady);

  return (
    <AuthContext.Provider
      value={{ user, profile, role: effectiveRole, isAdmin, emailVerified, loading, updateProfile, signOut, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
