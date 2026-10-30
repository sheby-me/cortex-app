# Cortex — debugging, permission repair and verification report

> Scope note: the brief mentions "OnAcad", academies and REST "requests/messages/SOS endpoints". This repository is **Cortex**: it has no academy
> concept, and apart from `POST /api/ai/generate` there are no HTTP endpoints — the features use Firestore operations directly. "Requests" =
> study-buddy requests (and tutor-session requests, message requests, group invites); every path below is taken from the code.

## What was actually executed
| Check | Result |
|---|---|
| `node scripts/run-unit-tests.mjs` (9 tests: name/username/email/password rules, friendly-error mapping, safe URLs, help scope gate, university-domain matching, onboarding validation + payload) | **9 passed, 0 failed** (run in this environment) |
| TypeScript parse of every changed file | no syntax errors; remaining diagnostics are only "module not found"/implicit-any caused by `node_modules` being absent |
| Static cross-check: every Firestore collection used in code has a rules block | **no gaps** |
| `npm install`, `npm run build`, lint, Firestore-emulator rules tests, anything against a real Firebase project | **NOT RUN — no network, no `node_modules`, no Firebase credentials in this environment** |

Nothing below marked "static review" has been observed running. Run the steps in section E.

## B. Root causes

### 1. `/onboarding` Continue button appears dead
* **Root cause (found in the code, also in your original upload):** no `<Toaster />` is mounted anywhere. `sonner`'s `toast.success/error` are
  called throughout the app, but without a mounted container they are silently discarded. On `/onboarding` that meant validation failures
  ("Select your country"), username errors and save failures produced *no visible feedback at all*, so the button looked unresponsive.
  The same bug hid errors/success on every other page.
* **Contributing causes:** (a) validation was inline in the component and reported only through a toast; (b) failures from the save were never shown
  persistently; (c) after v3, the app shell forces `/onboarding` until username + required fields exist, so users hit this screen more often.
* **Fix:** `src/routes/__root.tsx` mounts `<Toaster position="top-center" richColors closeButton />`. Validation moved to the pure module
  `src/lib/onboarding-policy.ts` (unit-tested). `src/routes/onboarding.tsx` now: focuses the first invalid field, shows an inline message under every
  required field, shows a persistent red alert above the button for any validation/save error, labels the button "Saving…", ignores double clicks, and
  navigates only after `updateProfile()` resolves (Firestore acknowledged the write → `onboarded: true`, `username`, etc. are persisted; the app shell
  reads them back, so refresh/sign-in again keeps the user out of onboarding). Nothing marks onboarding complete unless the write succeeded.

### 2. "You don't have permission to perform this action" — four distinct causes
| # | Cause | Where | Fix |
|---|---|---|---|
| a | **Reads of documents that don't exist yet were denied.** Rules touched `resource.data` when `resource` is null; our code does "does it exist?" reads before writing (buddy request pre-check, open/create chat, join via invite, report-once check). Those pre-checks threw permission-denied, so the action failed. | `firestore.rules` — `conversations`, `friend_requests`, `group_invites`, `groups`, `reports`, `sos offers`, `tutor_sessions` | every one of those reads now allows `resource == null` (existing documents are still fully protected) |
| b | **Stale ID token.** Rules require `email_verified == true` *in the token*. A user who verified in another browser/tab keeps a token that says `false` for up to an hour, so every query was denied. | `src/hooks/use-auth.tsx` | on sign-in/restore, `user.reload()` then `getIdToken(true)` **before** the app starts querying |
| c | **Group list query the rules cannot authorise.** `where(documentId(), "in", ids)` on `groups` with a rule that checks membership per document is rejected. | `src/services/groups.ts` | one single-document listener per membership (`get groups/{id}` is authorisable) |
| d | **Requests started before auth/profile were ready.** | `_app.tsx`, `use-auth.tsx` | the shell renders nothing and starts no listeners until the session is restored, the email is verified and the profile has loaded (already in place; verified by reading the code) |

Authorization is not weakened anywhere: no collection was opened, no admin grants were added; admin remains `/admins/{uid}` only.

### 3–5. Requests, messages, SOS
No logic bug beyond the permission causes above and the invisible toasts (success *and* failure messages were never shown) was found by reading the code.
Success states are only shown after the awaited Firestore write resolves; failed sends surface an error; duplicate submits are blocked by disabled buttons.
**Runtime behaviour was not observed** — see the table.

## C. Operation verification (Firestore, derived from the code; HTTP where it exists)
Status legend: **unit-verified** = logic executed here; **static** = read against the rules, not executed; **blocked** = needs the emulator/real project.

| Feature | Operation (file) | Auth / authorization (rule) | Test performed | Result | Status |
|---|---|---|---|---|---|
| Onboarding | `claimUsername` transaction: `usernames/{handle}` create + `users/{uid}` update (`services/users.ts`) | signed in; handle format, not reserved, not owned by someone else | rules/format reviewed; reserved/format logic unit-tested | format + reserved ✓ | unit-verified (format) / blocked (transaction) |
| Onboarding | `setDoc users/{uid}` merge with `onboarded:true` (`updateUserProfile`) | owner, verified; protected fields untouched | validation + payload unit-tested; rule path reviewed | 9/9 unit tests pass | unit-verified / blocked |
| Buddy request | `getDoc friend_requests/req_A_B` (pre-check) | participant; **null-resource read now allowed** | rule fix + emulator test written | not run | static / blocked |
| Buddy request | batch: create `friend_requests/req_A_B` + notification (`services/buddies.ts`) | sender == auth uid; no self-request; not already friends | emulator test written | not run | static / blocked |
| Buddy request | accept batch: both `friends` docs + delete request | recipient only; counterpart doc allowed only while the request exists | emulator test written (incl. A cannot self-accept) | not run | static / blocked |
| Buddy request | decline/cancel = delete request | either party | emulator test written | not run | static / blocked |
| Messages | `getDoc conversations/{a_b}` then `setDoc` (`messaging.ts`) | buddies → accepted; others → pending request | null-read fix; tests written | not run | static / blocked |
| Messages | batch: add `messages/{id}` + update conversation + notification | participant; `senderId == uid`; `createdAt == request.time`; not declined; messages immutable | tests written (incl. impersonation, stranger read, edit) | not run | static / blocked |
| Messages | listeners: `conversations` (array-contains + order), `messages` | participant only | index present in `firestore.indexes.json` | not run | static / blocked |
| Tutor session request | batch: `tutor_sessions` create + escrow on `users/{uid}` | price must equal tutor's published rate | test written (underpay refused) | not run | static / blocked |
| SOS | batch: create `sos_requests/{id}` + escrow + history | requester; credits 10–1000 taken from the requester in the same batch | test written (free request refused) | not run | static / blocked |
| SOS | offer → accept → resolve → claim reward / refund | helper offers once; only requester accepts/resolves; reward claimable once, only by the helper | tests written (double claim, wrong claimer, over-claim) | not run | static / blocked |
| SOS | board listeners (`status==open`, `requesterId==`, `helperId==`) | signed in | indexes present | not run | static / blocked |
| AI | `POST /api/ai/generate` | `Authorization: Bearer <Firebase ID token>` verified via Identity Toolkit; per-user rate limit; size caps; 401 / 413 / 429 / 200 `{success,text}` | code reviewed; scope gate unit-tested | gate ✓ | unit-verified (gate) / blocked (endpoint) |

**Not implemented / cannot be verified (stated, not invented):** SOS has *no* push/SMS/email alerting or emergency contacts — helpers matching the subject
get an in-app notification (capped at 20) only. There is no email/push delivery anywhere. Real-time listeners exist for requests, messages and SOS; their runtime
behaviour is unobserved.

## D. Security-rule changes (this round)
* Reads of non-existent documents allowed for `conversations`, `friend_requests`, `group_invites`, `groups`, `reports`, `sos_requests/*/offers`, `tutor_sessions` (existing docs unchanged).
* Reserved usernames blocked; verification fields (`universityVerified`, …) writable only by Cloud Functions; verified users can't swap university; `author.verified` on posts can't be forged;
  `universities` collection (read: signed-in, write: admin).
* Who can do what is unchanged: signed-in **verified** users act on their own data; recipients accept/decline requests addressed to them; participants read/write their
  conversations; requesters/helpers follow the SOS state machine; tutors/students follow the session state machine; admins moderate and approve tutors.
  Unverified accounts can only create their own profile, username and tutor application.

## E. Build, test and deploy
```bash
npm install                      # bun.lock was not regenerated here (Supabase dependency removed, test deps added) — run `bun install` too if you deploy with bun
npm run test:unit                # 9 pure-logic tests
npm i -D @firebase/rules-unit-testing && npm run test:rules   # needs the Firebase CLI + Java (emulator)
npm run build
firebase deploy --only firestore:rules,firestore:indexes,storage
(cd functions && npm install) && firebase deploy --only functions   # optional features: sign-up code, student verification
```
Environment variables (names only): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`,
`VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID` (client); `FIREBASE_API_KEY` (same value, server — verifies AI calls),
`GEMINI_API_KEY` (server); optional `VITE_EMAIL_OTP`; function secrets `SMTP_URL`, `MAIL_FROM`, `OTP_PEPPER`.

## Remaining verification you must do (blocked here)
1. `npm run build` + type-check; fix anything the missing `node_modules` hid.
2. Emulator rules tests (above) — each failure names a rule.
3. Two-browser manual pass: onboarding (empty form → errors visible; valid form → dashboard; refresh stays), buddy request A→B→accept, message A→B (seen/typing), SOS create→offer→accept→resolve→reward, group invite, sign-in with a verified and an unverified account.
4. Dependency tree: I could not run the resolver. Check `npm ls` for peer-dependency warnings after `npm install`; do not use `--force`.
