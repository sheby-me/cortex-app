/**
 * Cortex Cloud Functions — email one-time-code (OTP) verification.
 *
 *  sendEmailOtp   (callable, signed-in)  → checks the address's domain can receive mail (MX lookup), generates a
 *                                          6-digit code, stores only its salted SHA-256 hash, emails the code.
 *  verifyEmailOtp (callable, signed-in)  → constant-time compares the hash, max 5 attempts, 10-minute expiry; on success
 *                                          sets emailVerified=true through the Admin SDK.
 *
 * Abuse controls: 1 code / 60 s, 5 codes / hour per account, attempts capped, codes single-use, App Check recommended.
 * Secrets (set with `firebase functions:secrets:set`):  SMTP_URL (e.g. smtps://user:pass@smtp.example.com:465),
 *                                                       MAIL_FROM ("Cortex <no-reply@yourdomain.com>"), OTP_PEPPER (random 32+ chars)
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { promises as dns } from "node:dns";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";

initializeApp();
const db = getFirestore();

const SMTP_URL = defineSecret("SMTP_URL");
const MAIL_FROM = defineSecret("MAIL_FROM");
const OTP_PEPPER = defineSecret("OTP_PEPPER");

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

/** Keep in sync with src/lib/email-policy.ts and the regex in firestore.rules. */
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "yopmail.com", "trashmail.com", "getnada.com", "dispostable.com", "maildrop.cc", "throwawaymail.com",
  "fakeinbox.com", "mintemail.com", "emailondeck.com", "mohmal.com", "moakt.com", "burnermail.io", "tempr.email",
]);

const hash = (code: string, salt: string, pepper: string) =>
  createHash("sha256").update(`${salt}:${code}:${pepper}`).digest("hex");

export const sendEmailOtp = onCall(
  { secrets: [SMTP_URL, MAIL_FROM, OTP_PEPPER], region: "us-central1", enforceAppCheck: false, maxInstances: 10 },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const uid = req.auth.uid;
    const user = await getAuth().getUser(uid);
    const email = user.email?.toLowerCase();
    if (!email) throw new HttpsError("failed-precondition", "This account has no email address.");
    if (user.emailVerified) return { ok: true, alreadyVerified: true };

    const domain = email.split("@")[1] ?? "";
    if (DISPOSABLE.has(domain)) throw new HttpsError("invalid-argument", "Disposable email addresses can't be used.");

    // "Only emails that exist": the domain must publish mail servers. (The code round-trip proves the mailbox itself.)
    try {
      const mx = await dns.resolveMx(domain);
      if (!mx.length) throw new Error("no mx");
    } catch {
      throw new HttpsError("invalid-argument", `“${domain}” can't receive email. Check the address for typos.`);
    }

    const ref = db.doc(`email_otps/${uid}`);
    const now = Date.now();
    const code = String(randomInt(100000, 1000000));
    const salt = randomBytes(16).toString("hex");

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.data() as { lastSentAt?: Timestamp; windowStart?: Timestamp; sentCount?: number } | undefined;
      if (d?.lastSentAt && now - d.lastSentAt.toMillis() < RESEND_MS) {
        throw new HttpsError("resource-exhausted", "Please wait a minute before requesting another code.");
      }
      const inWindow = d?.windowStart && now - d.windowStart.toMillis() < 3600_000;
      const sentCount = inWindow ? (d?.sentCount ?? 0) : 0;
      if (sentCount >= MAX_SENDS_PER_HOUR) {
        throw new HttpsError("resource-exhausted", "Too many codes requested. Try again in an hour.");
      }
      tx.set(ref, {
        codeHash: hash(code, salt, OTP_PEPPER.value()),
        salt,
        email,
        expiresAt: Timestamp.fromMillis(now + CODE_TTL_MS),
        attempts: 0,
        lastSentAt: Timestamp.fromMillis(now),
        windowStart: inWindow ? d!.windowStart : Timestamp.fromMillis(now),
        sentCount: sentCount + 1,
      });
    });

    const transport = nodemailer.createTransport(SMTP_URL.value());
    await transport.sendMail({
      from: MAIL_FROM.value(),
      to: email,
      subject: `${code} is your Cortex verification code`,
      text: `Your Cortex verification code is ${code}. It expires in 10 minutes.\n\nIf you didn't create a Cortex account, ignore this email.`,
      html: `<p>Your Cortex verification code is</p><p style="font-size:28px;letter-spacing:6px;font-weight:700">${code}</p><p>It expires in 10 minutes. If you didn't create a Cortex account, you can ignore this email.</p>`,
    });
    return { ok: true };
  },
);

export const verifyEmailOtp = onCall(
  { secrets: [OTP_PEPPER], region: "us-central1", enforceAppCheck: false, maxInstances: 10 },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const uid = req.auth.uid;
    const code = String((req.data as { code?: unknown })?.code ?? "").trim();
    if (!/^\d{6}$/.test(code)) throw new HttpsError("invalid-argument", "Enter the 6-digit code.");

    const ref = db.doc(`email_otps/${uid}`);
    // The transaction RETURNS a status instead of throwing: a thrown error would roll back the attempt counter,
    // letting an attacker guess forever.
    const status = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return "missing" as const;
      const d = snap.data() as { codeHash: string; salt: string; expiresAt: Timestamp; attempts: number };
      if (Date.now() > d.expiresAt.toMillis()) {
        tx.delete(ref);
        return "expired" as const;
      }
      if (d.attempts >= MAX_ATTEMPTS) {
        tx.delete(ref);
        return "locked" as const;
      }
      const expected = Buffer.from(d.codeHash, "hex");
      const actual = Buffer.from(hash(code, d.salt, OTP_PEPPER.value()), "hex");
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        tx.update(ref, { attempts: FieldValue.increment(1) });
        return "wrong" as const;
      }
      tx.delete(ref); // single use
      return "ok" as const;
    });

    if (status === "missing") throw new HttpsError("failed-precondition", "No code was requested. Send a new one.");
    if (status === "expired") throw new HttpsError("failed-precondition", "That code expired. Send a new one.");
    if (status === "locked") throw new HttpsError("resource-exhausted", "Too many wrong attempts. Send a new code.");
    if (status === "wrong") throw new HttpsError("invalid-argument", "Incorrect code. Please check and try again.");

    await getAuth().updateUser(uid, { emailVerified: true });
    return { ok: true };
  },
);
