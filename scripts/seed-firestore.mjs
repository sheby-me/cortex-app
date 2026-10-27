#!/usr/bin/env node
/**
 * Seeds the built-in learning catalog (quizzes + roadmaps) and, optionally, the admin allow-list.
 *
 * Usage (needs a service-account key; NEVER commit it):
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *   node scripts/seed-firestore.mjs [--admin you@example.com] [--admin-uid <firebase-auth-uid>]
 *
 * Requires `npm i -D firebase-admin`.
 * --admin       adds the email to /admin_emails (that verified email may then claim admin rights on /admin)
 * --admin-uid   creates /admins/{uid} directly (use this for the very FIRST admin)
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const quizzes = [
  { id: "q1", title: "Deadlocks & Semaphores", subject: "Operating Systems", questions: 12, difficulty: "Medium", ai: true },
  { id: "q2", title: "Big-O Sprint", subject: "Algorithms", questions: 20, difficulty: "Easy", ai: true },
  { id: "q3", title: "SQL Joins Deep Dive", subject: "Databases", questions: 15, difficulty: "Hard", ai: false },
  { id: "q4", title: "React Hooks Essentials", subject: "Frontend", questions: 10, difficulty: "Easy", ai: true },
];

const roadmaps = [
  { id: "r1", title: "Machine Learning from Zero", weeks: 12, milestones: 24, color: "from-violet-500 to-fuchsia-500" },
  { id: "r2", title: "System Design Interview", weeks: 8, milestones: 18, color: "from-blue-500 to-cyan-500" },
  { id: "r3", title: "Full-Stack with Next.js", weeks: 10, milestones: 22, color: "from-emerald-500 to-teal-500" },
];

const batch = db.batch();
for (const { id, ...q } of quizzes) batch.set(db.doc(`quizzes/${id}`), { ...q, createdAt: FieldValue.serverTimestamp() }, { merge: true });
for (const { id, ...r } of roadmaps) batch.set(db.doc(`roadmaps/${id}`), { ...r, createdAt: FieldValue.serverTimestamp() }, { merge: true });

const adminEmail = flag("--admin");
if (adminEmail) {
  batch.set(db.doc(`admin_emails/${adminEmail.toLowerCase()}`), { email: adminEmail.toLowerCase(), createdAt: FieldValue.serverTimestamp() });
}
const adminUid = flag("--admin-uid");
if (adminUid) {
  batch.set(db.doc(`admins/${adminUid}`), { uid: adminUid, createdAt: FieldValue.serverTimestamp() });
}

await batch.commit();
console.log(`Seeded ${quizzes.length} quizzes and ${roadmaps.length} roadmaps.${adminEmail ? ` Allow-listed ${adminEmail}.` : ""}${adminUid ? ` Created admin ${adminUid}.` : ""}`);
