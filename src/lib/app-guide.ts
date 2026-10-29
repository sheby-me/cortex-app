/**
 * Cortex in-app guide: what every feature does and where to find it.
 * Used (1) by the Help assistant dialog as an offline fallback / quick links and (2) by the server to ground the AI
 * and to refuse questions that aren't about using Cortex. Keep this file dependency-free (it is imported by api/).
 */
export interface GuideEntry {
  id: string;
  title: string;
  /** Words people use when asking about it (lower-case). */
  keywords: string[];
  /** Plain-language, step-by-step answer. */
  answer: string;
  /** In-app page that does it. */
  route?: string;
  routeLabel?: string;
}

export const APP_GUIDE: GuideEntry[] = [
  {
    id: "username",
    title: "Change your username",
    keywords: ["username", "handle", "change name", "@", "unique name"],
    answer:
      "Open Settings, find the Username field at the top of your account details, type a new one (3–20 letters, numbers or underscores) and press Save Changes. We check it's available while you type. Reserved names like “admin” can't be used. Your username is also how friends find you and the end of your profile link.",
    route: "/settings",
    routeLabel: "Open Settings",
  },
  {
    id: "buddy-send",
    title: "Send a study-buddy request",
    keywords: ["buddy", "friend", "request", "connect", "add", "study buddy", "send request"],
    answer:
      "Go to Study Buddy, type a name, @username, university or topic in the search box and press Enter, then press “Add buddy” on the person. You can also open someone's profile link and press “Add study buddy”. They get a notification and you can cancel the request any time from the Requests tab → Sent.",
    route: "/buddy",
    routeLabel: "Open Study Buddy",
  },
  {
    id: "buddy-respond",
    title: "Accept, decline or remove a buddy",
    keywords: ["accept", "reject", "decline", "remove buddy", "unfriend", "incoming", "pending", "cancel request"],
    answer:
      "Incoming requests appear in Study Buddy → Requests (and in Notifications). Press Accept or Decline. Requests you sent are under Requests → Sent where you can cancel them. To remove a buddy open the My Buddies tab and use Remove on their card.",
    route: "/buddy",
    routeLabel: "Open Study Buddy",
  },
  {
    id: "messages",
    title: "Send and read messages",
    keywords: ["message", "chat", "dm", "conversation", "unread", "typing", "seen", "attachment", "send message"],
    answer:
      "Open Messages and choose a conversation, or press New Chat and pick a person. Study buddies can chat straight away; anyone else sends a message request that they must accept first. You'll see unread counts, “Seen” receipts and a typing indicator. Use the paperclip to attach images or PDFs (up to 10 MB).",
    route: "/messages",
    routeLabel: "Open Messages",
  },
  {
    id: "notifications",
    title: "Find your notifications",
    keywords: ["notification", "notifications", "bell", "alerts", "where are"],
    answer:
      "Press the bell icon at the top right of any page, or open Notifications from the menu. You'll see buddy requests, messages, likes, comments, SOS offers, tutor requests and achievements. Press a notification to jump to where it happened; you can mark all as read or delete them.",
    route: "/notifications",
    routeLabel: "Open Notifications",
  },
  {
    id: "sos-create",
    title: "Create an SOS request",
    keywords: ["sos", "urgent", "help request", "emergency", "ask for help", "create sos", "credits for help"],
    answer:
      "Open SOS and press the new-request button. Describe the problem, choose a subject, urgency and the credits you'll pay (the credits are held safely until it's solved). Helpers who teach that subject are notified. When someone offers, press “View offers”, Accept the helper, and press “Mark resolved” when you're done — the helper then receives the credits. You can cancel an open request and get the credits back.",
    route: "/sos",
    routeLabel: "Open SOS",
  },
  {
    id: "sos-help",
    title: "Help someone with an SOS request",
    keywords: ["offer help", "helper", "accept sos", "earn credits", "answer sos", "open requests"],
    answer:
      "Open SOS, pick a request you can help with and press “Offer Help” with a short note. If the requester accepts you, message them and help. When they mark it resolved you receive the credits automatically the next time you open Cortex.",
    route: "/sos",
    routeLabel: "Open SOS",
  },
  {
    id: "community",
    title: "Post, like and comment in the Community",
    keywords: ["community", "post", "like", "unlike", "comment", "delete post", "report", "feed", "image", "bookmark", "save"],
    answer:
      "In Community write a title (and details), choose Question, Notes, Resource or Poll plus a subject, optionally add up to 4 images, then Post. Use the heart to like or unlike, the comment button to discuss, Save to bookmark. The ⋯ menu on your own post lets you delete it; on others' posts it lets you report it. Use the filters and trending topics to narrow the feed.",
    route: "/community",
    routeLabel: "Open Community",
  },
  {
    id: "groups",
    title: "Create, join or invite to a study group / room",
    keywords: ["group", "room", "study room", "create room", "create group", "join group", "leave group", "invite", "members", "group chat"],
    answer:
      "Open Groups. Press the create button, name your group, choose a subject, schedule and whether it's Public or Private, and type @usernames to invite people (suggestions appear as you type). Public groups can be joined with one tap; private ones need an invitation. Every group has its own chat in Messages. Owners can invite more people or delete the group from its preview; members can leave.",
    route: "/groups",
    routeLabel: "Open Groups",
  },
  {
    id: "tutors",
    title: "Book a tutor and rate a session",
    keywords: ["tutor", "book", "session", "rate", "rating", "review tutor", "zoom", "verified tutor"],
    answer:
      "Open Find Tutors, search or filter, then press Book Session on a tutor. Choose the service (material review, async Q&A or live session), a time and your topic; the price is held in escrow. The tutor accepts and delivers the session; you then press “Confirm & rate” to release the credits and leave a 1–5 star rating.",
    route: "/tutors",
    routeLabel: "Open Tutors",
  },
  {
    id: "become-tutor",
    title: "Become a verified tutor",
    keywords: ["become tutor", "teach", "apply tutor", "teacher", "tutor application", "teacher studio", "availability", "rates"],
    answer:
      "Sign out, choose the Tutor tab on the sign-in page and create an account with your qualifications and a degree proof. An admin reviews it. Once approved, open Teacher Studio to set your bio, subjects, credit rates and weekly availability, and to accept session requests.",
    route: "/teacher",
    routeLabel: "Open Teacher Studio",
  },
  {
    id: "credits",
    title: "How credits work",
    keywords: ["credits", "credit", "balance", "earn", "spend", "wallet", "history", "escrow"],
    answer:
      "Everyone starts with 100 credits. You earn credits by helping with SOS requests and teaching tutor sessions, and spend them on SOS requests and tutor bookings. Credits are held in escrow while a request or session is in progress, then released or refunded. Your balance is on the dashboard and your history is on your Profile → Credits tab. Credits have no cash value.",
    route: "/profile",
    routeLabel: "Open Profile",
  },
  {
    id: "profile",
    title: "Edit your profile, banner and picture",
    keywords: ["profile", "edit profile", "banner", "cover", "avatar", "picture", "photo", "crop", "bio", "education"],
    answer:
      "Open Profile and press Edit Profile (or use the camera buttons on the picture/banner). When you choose an image you can drag and zoom it into place before saving; you can also remove or replace it. Name, country, university and level are required.",
    route: "/profile",
    routeLabel: "Open Profile",
  },
  {
    id: "share-profile",
    title: "Share your profile",
    keywords: ["share", "profile link", "copy link", "share profile", "public profile"],
    answer:
      "On your Profile press Share, then choose Copy profile link, Open profile link, or Share via… (on devices that support it). Your link looks like /u/yourusername and shows your public profile to other signed-in Cortex users.",
    route: "/profile",
    routeLabel: "Open Profile",
  },
  {
    id: "verify-student",
    title: "Get the Verified Student badge",
    keywords: ["verify", "verified", "student verification", "university email", "badge", "student email", "edu"],
    answer:
      "First choose your university in Settings (Institution / University) and save. Then, in Settings → Student verification, enter your official university email (it must end with your university's domain), press Send code and enter the 6-digit code we email you. A university email can only be linked to one account.",
    route: "/settings",
    routeLabel: "Open Settings",
  },
  {
    id: "password",
    title: "Change or reset your password",
    keywords: ["password", "forgot password", "reset password", "change password", "can't sign in", "cannot log in"],
    answer:
      "Forgot it? On the sign-in page type your email and press “Forgot password?” — we email a reset link. Already signed in? Go to Settings → Security → Change password and enter your current and new password.",
    route: "/settings",
    routeLabel: "Open Settings",
  },
  {
    id: "verify-email",
    title: "Verify your email",
    keywords: ["verify email", "verification", "confirmation", "code", "otp", "email link", "didn't get email", "resend"],
    answer:
      "After signing up we send a confirmation (a link or a 6-digit code). Open it to unlock Cortex. Didn't get it? Check spam, then press Resend on the verification page. Wrong address? Use a different account and sign up again.",
  },
  {
    id: "delete-account",
    title: "Delete your account",
    keywords: ["delete account", "close account", "remove account", "erase data", "deactivate"],
    answer:
      "Settings → Danger zone → Delete account. You'll confirm with your password (or Google) and by typing DELETE. This permanently removes your profile, credits and sign-in.",
    route: "/settings",
    routeLabel: "Open Settings",
  },
  {
    id: "leaderboard",
    title: "Leaderboards and achievements",
    keywords: ["leaderboard", "rank", "ranking", "achievement", "badge", "streak", "top"],
    answer:
      "Leaderboard ranks learners by credits earned, teaching hours, community help, streak and tutor ratings. Show or hide yourself in Settings → App Preferences. Achievements unlock automatically as you use Cortex and are listed under Achievements.",
    route: "/leaderboard",
    routeLabel: "Open Leaderboard",
  },
  {
    id: "quizzes",
    title: "Quizzes and roadmaps",
    keywords: ["quiz", "quizzes", "roadmap", "study plan", "milestone", "progress", "generate quiz"],
    answer:
      "Quizzes: open a quiz to play it, or use “Generate with AI” to create one on any topic; your best score is saved. Roadmaps: open one or generate a plan, then tick off milestones to track your progress.",
    route: "/quizzes",
    routeLabel: "Open Quizzes",
  },
  {
    id: "ai-tools",
    title: "AI study tools",
    keywords: ["ai", "study tools", "summarize", "flashcards", "homework", "lecture", "ai chat"],
    answer:
      "The AI Study Tools page (in the left menu) can explain topics, make flashcards, summarise lectures and more. This Help button only answers questions about using Cortex itself.",
    route: "/ai",
    routeLabel: "Open AI Study Tools",
  },
  {
    id: "settings",
    title: "Settings, dark mode and privacy",
    keywords: ["settings", "dark mode", "theme", "privacy", "email notifications", "visibility", "sos available"],
    answer:
      "Settings lets you edit account details, change your password, switch dark mode, choose whether you appear on leaderboards, whether you're available for SOS matches, and delete your account. Privacy and Terms are linked in the footer of the home page.",
    route: "/settings",
    routeLabel: "Open Settings",
  },
];

export const SUGGESTED_QUESTIONS = [
  "How do I change my username?",
  "How do I send a buddy request?",
  "Where are my notifications?",
  "How do I create an SOS request?",
  "How do I create a study group?",
  "How do I get the Verified Student badge?",
];

/** Words that mark a question as being about the product (used by the server-side scope gate). */
const APP_VOCAB = [
  "cortex", "app", "website", "site", "account", "profile", "username", "password", "email", "sign", "login", "log in", "logout",
  "buddy", "friend", "request", "message", "chat", "notification", "sos", "credit", "credits", "tutor", "session", "group", "room",
  "community", "post", "comment", "like", "quiz", "roadmap", "leaderboard", "achievement", "setting", "settings", "dashboard",
  "banner", "avatar", "picture", "share", "verify", "verified", "university", "badge", "invite", "button", "page", "menu",
];

export function tokensOf(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9@' ]+/g, " ").split(/\s+/).filter((t) => t.length > 1);
}

/** Best guide entries for a question, most relevant first (empty when nothing matches). */
export function searchGuide(question: string, max = 3): GuideEntry[] {
  const q = question.toLowerCase();
  const toks = new Set(tokensOf(question));
  return APP_GUIDE.map((e) => {
    let score = 0;
    for (const k of e.keywords) {
      if (q.includes(k)) score += k.includes(" ") ? 3 : 2;
      else if (toks.has(k)) score += 2;
    }
    for (const t of tokensOf(e.title)) if (toks.has(t) && t.length > 3) score += 1;
    return { e, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.e);
}

/** Is this question plausibly about using Cortex? Anything else is refused without calling the model. */
export function isAboutCortex(question: string): boolean {
  if (searchGuide(question, 1).length > 0) return true;
  const q = ` ${question.toLowerCase()} `;
  return APP_VOCAB.some((w) => q.includes(w.length <= 4 ? ` ${w} ` : w));
}

export const OUT_OF_SCOPE_REPLY =
  "I can only help with using Cortex — things like changing your username, sending buddy requests, finding notifications, creating an SOS request or a study group. For general study questions, try the AI Study Tools page in the menu.";

/** Compact text version of the guide for grounding the model. */
export function guideAsContext(): string {
  return APP_GUIDE.map((e) => `## ${e.title}${e.route ? ` (page: ${e.route})` : ""}\n${e.answer}`).join("\n\n");
}
