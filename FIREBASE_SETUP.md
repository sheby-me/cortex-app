# Cortex — Firebase backend reference

Everything below is implemented in `src/services/*` (Firestore/Storage logic), `firestore.rules`, `storage.rules`
and `firestore.indexes.json`. Screens keep their original layout and call these services.

## 1. Firestore schema

| Path | Purpose / key fields |
|---|---|
| `users/{uid}` | Public profile: `username(+Lower)`, `displayName(+Lower)`, `avatarUrl`, `coverImageUrl`, `role` (student\|tutor), `tutorStatus`, `gradeLevel`, `institution`, `semesterOrYear`, `degreeOrStream`, `about`, `country`, `timezone`, `hoursGoal`, `teach[]`, `learn[]`, `educationHistory[]`, `credits`, `creditsEarned`, `teachingMinutes`, `studyStreak`, `lastStudyDate`, `online`, `lastSeen`, `searchTokens[]`, `teachTokens[]`, `onboarded`, `showLeaderboard`, `sosAvailable`, `emailNotifications`, `darkMode`, `lastCreditKind/Id` (rules markers) |
| `users_private/{uid}` | `email` (owner + admin only) |
| `usernames/{handle}` | `{uid, username}` — uniqueness lock, claimed in a transaction |
| `admins/{uid}` / `admin_emails/{email}` | Admin authority / allow-list (admin-only) |
| `users/{uid}/friends/{friendUid}` | Mutual buddy record (written for both users on accept) |
| `friend_requests/{req_FROM_TO}` | Pending requests only |
| `users/{uid}/notifications/{id}` | `type, title, text, read, actorId, actor, actionUrl, entityType/Id, requestStatus, createdAt` |
| `users/{uid}/creditHistory/{id}` | Credit ledger shown on the profile |
| `users/{uid}/{achievements,bookmarks,sosBookmarks,sosOffers,groups,quizzes,roadmaps,quizProgress,roadmapProgress,studyDays}` | Per-user data (owner only) |
| `users/{uid}/reviews/{reviewerUid}` | Peer review (reviewer must be a buddy) |
| `conversations/{id}` | `type, participants[], participantInfo{}, status, requestedBy, lastMessage, lastMessageAt, unread{uid:n}, lastRead{uid:ts}, typing{uid:ts}, groupId` — direct id = sorted `uidA_uidB`, group id = `group_{groupId}` |
| `conversations/{id}/messages/{id}` | `senderId, text, attachments[], createdAt` (immutable) |
| `posts/{id}` | `authorId, author{}, title, body, subject, tag, imageUrls[], imagePaths[], keywords[], likesCount, commentsCount, reportCount, createdAt` |
| `posts/{id}/likes/{uid}`, `posts/{id}/comments/{id}` | Likes (existence = liked) and comments |
| `reports/{postId_reporterUid}` | Moderation queue (admin-readable) |
| `sos_requests/{id}` | `requesterId, requester{}, title, subject, urgency, duration, credits, status (open→in_progress→resolved\|cancelled), offersCount, helperId, helper{}, escrowed, rewardClaimed, refundClaimed` |
| `sos_requests/{id}/offers/{helperUid}` | Helper offers |
| `tutor_applications/{uid}` | Application + `degreeProof{name,type,size,path}` (file lives in Storage) |
| `tutor_profiles/{uid}` | Public tutor listing: `credentials, bio, subjects[], languages[], timezone, rates{materials,asyncQa,zoomMeeting}, availability[{day,start,end}], acceptingSessions, ratingSum, ratingCount, sessionsCompleted` |
| `tutor_sessions/{id}` | `tutorId, studentId, mode, topic, slotLabel, credits, durationMin, status (pending→accepted→delivered→completed \| declined \| cancelled), payoutClaimed, refundClaimed, rating, review` |
| `groups/{id}` · `groups/{id}/members/{uid}` · `group_invites/{gid_uid}` | Study groups, membership, invitations |
| `quizzes/{id}`, `roadmaps/{id}` | Built-in catalog (public read, admin write; seeded by script) |

## 2. Storage structure

```
avatars/{uid}/{ts}-{file}            images ≤ 5 MB      read: signed-in      write: owner
covers/{uid}/{ts}-{file}             images ≤ 8 MB      read: signed-in      write: owner
posts/{uid}/{postId}/{ts}-{file}     images ≤ 8 MB      read: signed-in      write: owner
chat/{conversationId}/{ts}-{file}    images/PDF ≤ 10 MB read+write: conversation participants
tutor-proofs/{uid}/{ts}-{file}       images/PDF ≤ 10 MB read: owner + admin  write: owner
```

## 3. Indexes
All composite indexes are in `firestore.indexes.json` (conversations inbox, post feed filters, SOS board, tutor
sessions, groups, leaderboards, claim queries). Deploy with `firebase deploy --only firestore:indexes` and wait until
they show **Enabled** in the console before testing.

## 4. Credit-economy integrity (no Cloud Functions needed)
Balances can only change in the same batch as a state change on an escrow document (see `src/services/credits.ts`
and the `creditChangeOk()` rule): SOS escrow/reward/refund and tutor-session escrow/payout/refund. Each reward or refund
is claimable once (`rewardClaimed`/`payoutClaimed`/`refundClaimed` flips false→true). Streaks and achievements are
self-reported/cosmetic and grant no credits.

## 5. Manual steps before deployment
1. **Rotate the admin password** that was committed in the old README (`admin.cortex@gmail.com`) — treat it as compromised.
2. Firebase console → Authentication: enable **Email/Password** and **Google**; add your production domain(s) to *Authorized domains*; customise the *password reset* and *verification* email templates.
3. Create the Storage bucket (Firebase console → Storage) so `VITE_FIREBASE_STORAGE_BUCKET` is valid.
4. Copy `.env.example` → `.env` / Vercel env vars. Set `FIREBASE_API_KEY` (same as `VITE_FIREBASE_API_KEY`) and `GEMINI_API_KEY` on the **server**.
5. `npm i -g firebase-tools && firebase login && firebase use <project>`, then
   `firebase deploy --only firestore:rules,firestore:indexes,storage`.
6. **Bootstrap the first admin:** sign up normally, copy your UID from Authentication → Users, then run
   `GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/seed-firestore.mjs --admin-uid <UID> --admin you@domain.com`
   (also seeds the quiz/roadmap catalog; needs `npm i -D firebase-admin`). Later admins: add their email to `admin_emails`; they verify their email and sign in at `/admin`.
7. **Run the rules against the emulator** (`firebase emulators:start`) and exercise every flow — buddy accept, message request, like/unlike, SOS create→offer→accept→resolve→claim, tutor request→accept→deliver→rate→payout, group join/leave/delete. The rules could not be executed in the environment this was written in.
8. Existing data: any `users/{uid}` documents written by the previous version may contain `email` (now stored in `users_private`) and base64 avatars; migrate or let users re-save their profile. Old `tutor_applications` with inline base64 proofs still open in the admin viewer.
9. Enable **App Check** (reCAPTCHA v3) for Firestore/Storage/Auth to limit scripted abuse; set billing budget alerts.
10. All demo/mock data, the demo-login buttons, stock avatars and the unused Supabase code have been removed.

## 6. Known limitations (be aware before launch)
- **Notifications are client-created.** Any signed-in user can drop a notification in another user's inbox as themselves (rules pin `actorId`). They can be spammed; move fan-out to Cloud Functions + App Check at scale. SOS fan-out is capped at 20 matching helpers.
- **No email/push delivery.** `emailNotifications` is stored but nothing sends email; add FCM / a mail extension via Cloud Functions.
- **Search** is prefix + token matching, not full-text/fuzzy (use Algolia/Typesense if needed).
- **Deleting a user/group/conversation** leaves orphaned message subcollections and Storage files; schedule a Cloud Function cleanup.
- **Post reports** hide a post after 5 reports but there is no admin reports UI yet (reports are in `reports/`).
- **Presence** is heartbeat based (`online` + `lastSeen` < 2.5 min); a Realtime Database `onDisconnect` is more precise.
- **Study time** counts minutes the tab is open and visible (it feeds the dashboard goal), not verified studying.
- Landing-page marketing numbers/testimonials are static copy.


## 7. Email verification, one-time codes and sign-in hardening
- **Real emails only.** Password sign-ups must verify their mailbox before anything works: until `email_verified` is true the
  Firestore/Storage rules reject every read/write except the sign-up writes (own profile, username, tutor application). Google
  accounts are verified by Google. Common typos (`gmial.com`) and ~20 disposable-mail domains are rejected in the form **and**
  in `firestore.rules`.
- **Link mode (default):** Firebase emails a verification link; `/verify-email` waits for the click.
- **Code (OTP) mode:** set `VITE_EMAIL_OTP=true` and deploy `/functions`:
  1. Upgrade the Firebase project to **Blaze**; `cd functions && npm install`.
  2. `firebase functions:secrets:set SMTP_URL` (e.g. `smtps://apikey:SECRET@smtp.sendgrid.net:465`), `MAIL_FROM` (`Cortex <no-reply@yourdomain>`), `OTP_PEPPER` (random 32+ chars).
  3. `firebase deploy --only functions`. Codes expire after 10 min, allow 5 attempts, 1 send/min and 5/hour; the function also checks the domain has MX records.
  4. **Not tested here** — send yourself a code end-to-end before launch.
- **Console settings to switch on:** Authentication → Settings → *User actions* → enable **Email enumeration protection**; *Password policy* → require 8+ chars with upper/lower/number; *Authorized domains* → your Vercel domain(s).
- **Sign-in errors** now name the cause (e.g. unauthorized domain → tells you the exact hostname to add; permission-denied after sign-in → rules not deployed) and append the Firebase error code.

## 8. Security measures added in this pass
- Admin: reports queue at `/admin` (keep/remove post, author is notified); admin authority only via `/admins/{uid}`.
- Rules: verified-email gate, field-length and https-only URL checks on profiles, notification `actionUrl` must be an in-app path, attachments capped, disposable domains blocked.
- Links/images from other users are opened only if they point at our Firebase Storage (`src/lib/safe-url.ts`).
- AI endpoint: Firebase ID-token required, per-user rate limit (best effort, in-memory), body/prompt/file caps.
- `vercel.json`: HSTS, `X-Frame-Options: DENY`, `nosniff`, referrer/permissions policies, COOP `same-origin-allow-popups` (needed for Google popup). CSP is **Report-Only** — watch the browser console for violations for a week, then rename the header to `Content-Security-Policy`.
- Account deletion in Settings (re-auth → erases profile, username, private data, friendships, personal sub-collections → deletes the sign-in). Posts/messages in shared spaces stay until an admin removes them (needs a Cloud Function to automate).
- `.gitignore` now excludes `.env*` and service-account keys. Privacy and Terms pages exist (`/privacy`, `/terms`) — have them reviewed and add your company name/contact.

## 9. What "no vulnerabilities" can honestly mean
Nothing here has been penetration-tested or run, and no software is vulnerability-free. Before launch: run `npm audit` and update dependencies, run the rules in the emulator with negative tests (e.g. an unverified user, a user editing someone else's data, forging credits), enable App Check and billing alerts, and review the Known limitations list in §6.

---

# v3 — profile, verification, help assistant and error handling

## 10. What changed in v3 (and the one correction to earlier advice)
- **User-facing errors never show Firebase codes or internals.** `src/lib/friendly-errors.ts` maps everything to plain sentences and logs the real error to the browser console only (`[Cortex error]`). This replaces the "append the error code" behaviour from v2. For Google sign-in on an unauthorised domain, users see a neutral message and the console prints the exact hostname to add under Authentication → Settings → Authorized domains.
- **Permission bug fixed in the rules.** Reading a document that does *not exist yet* used to be denied (the rule touched `resource.data` on a null resource). Our code does exactly that before sending a buddy request, opening a chat, joining a group via invite, and reporting a post, so those flows failed with "You don't have permission". Rules for `conversations`, `friend_requests`, `group_invites`, `groups`, `reports`, `sos offers` and `tutor_sessions` now allow `resource == null` reads. **Redeploy the rules.**
- **Usernames:** globally unique via the transactional `usernames/{handle}` lock, live availability check while typing, reserved names blocked (client + rules), and a unique username is mandatory — `/onboarding` can't be skipped, and the app shell redirects there until a username and the required fields exist (Google sign-ups no longer get an auto-generated name).
- **Names** (`src/lib/name-policy.ts`): letters (any script, so Urdu works), single spaces, hyphen and apostrophe only; digits, emoji, symbols, double spaces and repeated-letter junk are rejected at sign-up, onboarding, profile and settings. Rules can't express this reliably, so it's enforced in the app (a determined user calling Firestore directly could bypass it).
- **Required fields** show a red `*` (and "required" for screen readers) on sign-up, onboarding, profile, settings, groups, SOS, quizzes, roadmaps and tutor booking. Required for a profile: name, username, country, school/university, academic level, timezone.
- **Country** and **school/university** are searchable alphabetical dropdowns (196 countries; 225 institutions — 206 universities with official email domains, plus well-known Pakistani schools). Unlisted places can be typed ("Use …"). Admins can add institutions in the Firestore `universities` collection (`{name, country, type, domains[]}`) with no redeploy.
- **Verified Student badge:** Settings → Student verification. The email's domain must belong to the university the user selected; a code is emailed to that address (Cloud Functions `startUniversityVerification` / `confirmUniversityVerification`); the badge is set only by the function; the address is reserved so it can verify just one account; a verified user can't change their university. The sign-in email is accepted instantly if it already matches and is verified.
- **"Ask AI" button** now opens *Cortex Help*, which answers only questions about using Cortex (grounded in `src/lib/app-guide.ts`). Off-topic questions are refused in the browser and again on the server before any model call; if the AI is unreachable the answer comes from the built-in guide. The general chatbot remains on the *AI Assistant* page in the menu.
- **Banner / avatar:** crop (drag + zoom, live preview), resize (1600 px / 512 px), JPEG compression (~450 KB / ~150 KB), replace and remove, in Profile and Settings.
- **Share profile:** menu with Copy link, Open link and the Web Share sheet; links go to the new public profile page `/u/<username>` (signed-in users only).
- **Invites:** typing a name or @username shows live Firestore suggestions (accessible combobox, chips) when creating a group and when inviting more people.
- **Create Room** = *Groups → create* (public/private, schedule, invites, its own chat). It uses the corrected rules above.

## 11. Tests (both sides of each interaction)
`tests/firestore.rules.test.mjs` runs against the Firestore emulator as separate users (A sends → B receives → B accepts → both are buddies; A messages → B reads, strangers can't; SOS create → offer → accept → resolve → reward once; posts/likes/comments/reports; groups; tutor pricing; notifications; admin; verification and credit-forgery attempts):
```
npm install
npm i -D @firebase/rules-unit-testing
npm run test:rules
```
**These tests and the app have not been run by the author** (no install or network access where this was written). Run them first; a failure points at the exact rule to fix. UI-level end-to-end checks (two browsers) still need doing by hand — see §14.

## 12. Cloud Functions in the project (`/functions`)
| Function | Purpose |
|---|---|
| `sendEmailOtp` / `verifyEmailOtp` | optional 6-digit sign-up code (`VITE_EMAIL_OTP=true`) |
| `startUniversityVerification` / `confirmUniversityVerification` | student email verification → Verified Student badge |
Both need the Blaze plan and three secrets: `SMTP_URL`, `MAIL_FROM`, `OTP_PEPPER`. `functions/src/universities.json` is a copy of `src/data/universities.json` — if you edit one, copy it to the other. Extra institutions added in Firestore are read by the function too.

## 13. Firestore collections, indexes, rules and storage — what's new in v3
- **New collections:** `universities` (admin-managed, readable by signed-in users); function-only collections `email_otps`, `uni_otps`, `verified_emails` (no client access — the default-deny rule covers them).
- **New user fields:** `institutionId`; function-written `universityVerified`, `verifiedUniversityId`, `verifiedUniversityName`, `verifiedAt` (protected in rules).
- **Indexes:** no new composite indexes in v3 (v2's `reports(status, createdAt)` is already in `firestore.indexes.json`).
- **Rules changes:** null-resource reads; reserved usernames; verification fields write-protected; verified users can't change university; posts can't forge `author.verified`; `universities` collection; plus v2's verified-email gate. **Storage rules:** unchanged (images are cropped and compressed client-side before upload; limits stay 5 MB / 8 MB).

## 14. Remaining manual setup and things that need outside services
1. Deploy rules, indexes and storage rules; `cd functions && npm install`; set the three secrets; `firebase deploy --only functions` (**SMTP provider required** — SendGrid, Resend, Mailgun, Amazon SES or a mailbox).
2. **Verify the university list.** Domains were written from general knowledge and have not been checked against each university; some universities give students sub-domains or different domains (subdomains are accepted automatically). Spot-check the ones you care about (UMT, LUMS, UET, NUST, FAST, COMSATS…) and fix `src/data/universities.json` + `functions/src/universities.json`, or override via the `universities` collection.
3. Run the rules tests, then test with two real accounts in two browsers: buddy request both ways, messaging with read receipts, SOS escrow, community, group invite via autocomplete, Verified Student flow, password reset, Google sign-in from your Vercel domain.
4. Firebase console: authorize your Vercel domain, enable Email enumeration protection and a password policy, enable App Check.
5. Existing users created before v3 who have no username are sent to `/onboarding` on next sign-in.
6. Needs external services: **Google Gemini** (`GEMINI_API_KEY`) for AI features; **SMTP** for codes; Firebase **Blaze** plan for Functions.
7. Known gaps: name rules and the 4-image/size limits are partly client-side; the community "post title" field has no visible `*`; the in-memory AI rate limit is per serverless instance; deleting accounts leaves orphaned posts/messages; notification spam still needs a Cloud Function + App Check.
