/**
 * Security-rule tests: both sides of every core interaction.
 *
 *   npm i -D @firebase/rules-unit-testing
 *   npm run test:rules          (starts the Firestore emulator and runs this file)
 *
 * Each test acts as real users ("alice", "bob", "mallory") against the deployed rules in firestore.rules.
 * These were written without being able to execute them — if one fails, read the rule it names before assuming the test is wrong.
 */
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import firebase from "firebase/compat/app";
import "firebase/compat/firestore";

const TS = () => firebase.firestore.FieldValue.serverTimestamp();
const INC = (n) => firebase.firestore.FieldValue.increment(n);

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "cortex-rules-test",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
after(async () => env.cleanup());
beforeEach(async () => env.clearFirestore());

const as = (uid, extra = {}) =>
  env.authenticatedContext(uid, { email: `${uid}@university.edu.pk`, email_verified: true, ...extra }).firestore();
const asUnverified = (uid) => env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: false }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const seed = (fn) => env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));

const user = (uid, over = {}) => ({
  uid, displayName: uid, username: uid, usernameLower: uid, role: "student",
  credits: 100, creditsEarned: 0, teachingMinutes: 0, onboarded: true, ...over,
});
async function seedUsers(...uids) {
  await seed(async (db) => { for (const u of uids) await db.doc(`users/${u}`).set(user(u)); });
}

describe("sign-up and verification", () => {
  test("a new account can create its own profile as an unverified user, but only as a student with 100 credits", async () => {
    const db = asUnverified("newbie");
    await assertSucceeds(db.doc("users/newbie").set({ ...user("newbie"), createdAt: TS() }));
    await assertFails(asUnverified("cheat").doc("users/cheat").set(user("cheat", { credits: 5000 })));
    await assertFails(asUnverified("boss").doc("users/boss").set(user("boss", { role: "admin" })));
  });

  test("an unverified account can't read other people's data or post", async () => {
    await seedUsers("alice");
    const db = asUnverified("newbie");
    await assertFails(db.doc("users/alice").get());
    await assertFails(db.collection("posts").add({ authorId: "newbie" }));
  });

  test("signed-out visitors can only check whether a username is taken", async () => {
    await assertSucceeds(anon().doc("usernames/someone").get());
    await assertFails(anon().doc("users/alice").get());
  });

  test("usernames are unique, well-formed and not reserved", async () => {
    const a = as("alice");
    await assertSucceeds(a.doc("usernames/alice").set({ uid: "alice", username: "alice" }));
    await assertFails(as("bob").doc("usernames/admin").set({ uid: "bob", username: "admin" }));       // reserved
    await assertFails(as("bob").doc("usernames/alice").set({ uid: "bob", username: "alice" }));       // taken
    await assertFails(as("bob").doc("usernames/Bad Name").set({ uid: "bob", username: "Bad Name" })); // malformed
  });

  test("nobody can grant themselves a verified-student badge, admin rights or credits", async () => {
    await seedUsers("alice");
    const db = as("alice");
    await assertFails(db.doc("users/alice").update({ universityVerified: true }));
    await assertFails(db.doc("users/alice").update({ role: "admin" }));
    await assertFails(db.doc("users/alice").update({ credits: 99999 }));
    await assertFails(db.doc("admins/alice").set({ uid: "alice" }));
  });
});

describe("buddy requests (A → B)", () => {
  const reqId = "req_alice_bob";
  const send = (db) => {
    const batch = db.batch();
    batch.set(db.doc(`friend_requests/${reqId}`), {
      fromUid: "alice", toUid: "bob", status: "pending", createdAt: TS(),
      fromUser: { uid: "alice", username: "alice", displayName: "Alice" },
      toUser: { uid: "bob", username: "bob", displayName: "Bob" },
    });
    batch.set(db.doc(`users/bob/notifications/notif_${reqId}`), { type: "buddy_request", text: "Alice sent you a request", actorId: "alice", read: false, createdAt: TS() });
    return batch.commit();
  };

  test("checking for an existing request that doesn't exist yet is allowed (needed before sending)", async () => {
    await seedUsers("alice", "bob");
    await assertSucceeds(as("alice").doc("friend_requests/req_bob_alice").get());
    await assertSucceeds(as("alice").doc("friend_requests/req_alice_bob").get());
  });

  test("A sends, B receives; a stranger can't read it; A can't send as someone else", async () => {
    await seedUsers("alice", "bob", "mallory");
    await assertSucceeds(send(as("alice")));
    await assertSucceeds(as("bob").collection("friend_requests").where("toUid", "==", "bob").where("status", "==", "pending").get());
    await assertFails(as("mallory").doc(`friend_requests/${reqId}`).get());
    await assertFails(as("mallory").doc("friend_requests/req_alice_bob").set({ fromUid: "alice", toUid: "bob", status: "pending" }));
  });

  test("B accepts → both users get a friends record; A cannot accept their own request", async () => {
    await seedUsers("alice", "bob");
    await assertSucceeds(send(as("alice")));

    const forged = as("alice").batch();
    forged.set(as("alice").doc("users/bob/friends/alice"), { uid: "alice" });
    await assertFails(forged.commit());

    const db = as("bob");
    const accept = db.batch();
    accept.set(db.doc("users/bob/friends/alice"), { uid: "alice", since: TS() });
    accept.set(db.doc("users/alice/friends/bob"), { uid: "bob", since: TS() });
    accept.delete(db.doc(`friend_requests/${reqId}`));
    await assertSucceeds(accept.commit());

    await assertSucceeds(as("alice").doc("users/alice/friends/bob").get());
    await assertSucceeds(as("bob").doc("users/bob/friends/alice").get());
    await assertFails(as("bob").doc("users/alice/friends/bob").get()); // friend lists are private
  });

  test("A can cancel a pending request and either buddy can remove the friendship", async () => {
    await seedUsers("alice", "bob");
    await assertSucceeds(send(as("alice")));
    await assertSucceeds(as("alice").doc(`friend_requests/${reqId}`).delete());
    await seed(async (db) => { await db.doc("users/alice/friends/bob").set({ uid: "bob" }); await db.doc("users/bob/friends/alice").set({ uid: "alice" }); });
    const b = as("bob").batch();
    b.delete(as("bob").doc("users/bob/friends/alice"));
    b.delete(as("bob").doc("users/alice/friends/bob"));
    await assertSucceeds(b.commit());
  });
});

describe("messaging", () => {
  const cid = "alice_bob";
  const conv = (status = "accepted", extra = {}) => ({
    type: "direct", participants: ["alice", "bob"], participantInfo: {}, status, lastMessage: null, lastMessageAt: TS(),
    unread: { alice: 0, bob: 0 }, ...extra,
  });

  test("buddies start an accepted chat; opening a chat that doesn't exist yet can be checked first", async () => {
    await seedUsers("alice", "bob");
    await assertSucceeds(as("alice").doc(`conversations/${cid}`).get());
    await seed((db) => db.doc("users/alice/friends/bob").set({ uid: "bob" }));
    await assertSucceeds(as("alice").doc(`conversations/${cid}`).set(conv("accepted")));
  });

  test("non-buddies can only open a pending request, and only the recipient can accept it", async () => {
    await seedUsers("alice", "bob");
    await assertFails(as("alice").doc(`conversations/${cid}`).set(conv("accepted")));
    await assertSucceeds(as("alice").doc(`conversations/${cid}`).set(conv("pending", { requestedBy: "alice" })));
    await assertFails(as("alice").doc(`conversations/${cid}`).update({ status: "accepted" }));
    await assertSucceeds(as("bob").doc(`conversations/${cid}`).update({ status: "accepted" }));
  });

  test("A sends → B can read it; strangers can't; senders can't impersonate or edit messages", async () => {
    await seedUsers("alice", "bob", "mallory");
    await seed((db) => db.doc(`conversations/${cid}`).set({ ...conv("accepted"), lastMessageAt: new Date() }));
    const a = as("alice");
    const batch = a.batch();
    batch.set(a.collection(`conversations/${cid}/messages`).doc("m1"), { senderId: "alice", text: "hi", createdAt: TS() });
    batch.update(a.doc(`conversations/${cid}`), { lastMessage: { text: "hi", senderId: "alice" }, lastMessageAt: TS(), "unread.bob": INC(1) });
    await assertSucceeds(batch.commit());

    await assertSucceeds(as("bob").collection(`conversations/${cid}/messages`).get());
    await assertFails(as("mallory").collection(`conversations/${cid}/messages`).get());
    await assertFails(as("mallory").collection(`conversations/${cid}/messages`).add({ senderId: "mallory", text: "x", createdAt: TS() }));
    await assertFails(a.collection(`conversations/${cid}/messages`).add({ senderId: "bob", text: "forged", createdAt: TS() }));
    await assertFails(a.doc(`conversations/${cid}/messages/m1`).update({ text: "edited" }));
  });

  test("B can mark the chat read and show typing; a declined conversation blocks new messages", async () => {
    await seedUsers("alice", "bob");
    await seed((db) => db.doc(`conversations/${cid}`).set({ ...conv("accepted"), lastMessageAt: new Date() }));
    await assertSucceeds(as("bob").doc(`conversations/${cid}`).update({ "unread.bob": 0, "lastRead.bob": TS(), "typing.bob": TS() }));
    await seed((db) => db.doc(`conversations/${cid}`).update({ status: "declined" }));
    await assertFails(as("alice").collection(`conversations/${cid}/messages`).add({ senderId: "alice", text: "hi", createdAt: TS() }));
  });
});

describe("SOS (A creates → B offers → A accepts → A resolves → B is paid)", () => {
  const SOS = "sos1";
  const escrow = (db, credits = 50) => {
    const batch = db.batch();
    batch.set(db.doc(`sos_requests/${SOS}`), {
      requesterId: "alice", requester: { uid: "alice", displayName: "Alice" }, title: "Help", subject: "Math", urgency: "High", duration: "15 min",
      credits, status: "open", offersCount: 0, helperId: null, helper: null, escrowed: true, rewardClaimed: false, refundClaimed: false, createdAt: TS(),
    });
    batch.update(db.doc("users/alice"), { credits: INC(-credits), lastCreditKind: "sos_escrow", lastCreditId: SOS, updatedAt: TS() });
    return batch.commit();
  };

  test("creating a request must take the credits from the requester in the same batch", async () => {
    await seedUsers("alice", "bob");
    await assertSucceeds(escrow(as("alice")));
    // free request (no matching deduction) is refused
    await assertFails(as("alice").doc("sos_requests/free").set({
      requesterId: "alice", requester: { uid: "alice" }, title: "Free", status: "open", offersCount: 0, helperId: null, escrowed: true,
      rewardClaimed: false, refundClaimed: false, credits: 50, createdAt: TS(),
    }));
  });

  test("full happy path: offer → accept → resolve → reward, and the reward can only be claimed once", async () => {
    await seedUsers("alice", "bob");
    await assertSucceeds(escrow(as("alice")));

    const b = as("bob");
    const offer = b.batch();
    offer.set(b.doc(`sos_requests/${SOS}/offers/bob`), { helperId: "bob", helper: { uid: "bob", displayName: "Bob" }, note: "I can help", createdAt: TS() });
    offer.update(b.doc(`sos_requests/${SOS}`), { offersCount: INC(1) });
    await assertSucceeds(offer.commit());

    const a = as("alice");
    await assertSucceeds(a.doc(`sos_requests/${SOS}`).update({ status: "in_progress", helperId: "bob", helper: { uid: "bob", displayName: "Bob" }, acceptedAt: TS() }));
    await assertFails(b.doc(`sos_requests/${SOS}`).update({ status: "resolved" })); // only the requester resolves
    await assertSucceeds(a.doc(`sos_requests/${SOS}`).update({ status: "resolved", closedAt: TS() }));

    const claim = b.batch();
    claim.update(b.doc(`sos_requests/${SOS}`), { rewardClaimed: true });
    claim.update(b.doc("users/bob"), { credits: INC(50), creditsEarned: INC(50), teachingMinutes: INC(15), lastCreditKind: "sos_reward", lastCreditId: SOS, updatedAt: TS() });
    await assertSucceeds(claim.commit());

    const again = b.batch();
    again.update(b.doc(`sos_requests/${SOS}`), { rewardClaimed: true });
    again.update(b.doc("users/bob"), { credits: INC(50), creditsEarned: INC(50), lastCreditKind: "sos_reward", lastCreditId: SOS, updatedAt: TS() });
    await assertFails(again.commit());
  });

  test("credits can't be minted, over-claimed or claimed by the wrong person", async () => {
    await seedUsers("alice", "bob", "mallory");
    await assertSucceeds(escrow(as("alice")));
    await seed((db) => db.doc(`sos_requests/${SOS}`).update({ status: "resolved", helperId: "bob", helper: { uid: "bob" } }));
    const m = as("mallory");
    const steal = m.batch();
    steal.update(m.doc(`sos_requests/${SOS}`), { rewardClaimed: true });
    steal.update(m.doc("users/mallory"), { credits: INC(50), creditsEarned: INC(50), lastCreditKind: "sos_reward", lastCreditId: SOS, updatedAt: TS() });
    await assertFails(steal.commit());
    const b = as("bob");
    const greedy = b.batch();
    greedy.update(b.doc(`sos_requests/${SOS}`), { rewardClaimed: true });
    greedy.update(b.doc("users/bob"), { credits: INC(5000), creditsEarned: INC(5000), lastCreditKind: "sos_reward", lastCreditId: SOS, updatedAt: TS() });
    await assertFails(greedy.commit());
  });

  test("cancelling refunds the escrow exactly once", async () => {
    await seedUsers("alice");
    await assertSucceeds(escrow(as("alice")));
    const a = as("alice");
    await assertSucceeds(a.doc(`sos_requests/${SOS}`).update({ status: "cancelled", closedAt: TS() }));
    const refund = a.batch();
    refund.update(a.doc(`sos_requests/${SOS}`), { refundClaimed: true });
    refund.update(a.doc("users/alice"), { credits: INC(50), lastCreditKind: "sos_refund", lastCreditId: SOS, updatedAt: TS() });
    await assertSucceeds(refund.commit());
  });
});

describe("community", () => {
  const post = (uid) => ({
    authorId: uid, author: { uid, displayName: uid }, title: "Hello", body: "World", subject: "Math", tag: "Question",
    keywords: ["hello"], likesCount: 0, commentsCount: 0, reportCount: 0, createdAt: TS(),
  });

  test("create → like → unlike → comment → report, with counters that must move by one", async () => {
    await seedUsers("alice", "bob");
    await assertSucceeds(as("alice").doc("posts/p1").set(post("alice")));

    const b = as("bob");
    const like = b.batch();
    like.set(b.doc("posts/p1/likes/bob"), { uid: "bob", createdAt: TS() });
    like.update(b.doc("posts/p1"), { likesCount: INC(1) });
    await assertSucceeds(like.commit());

    await assertFails(b.doc("posts/p1").update({ likesCount: INC(5) }));         // inflate
    const unlike = b.batch();
    unlike.delete(b.doc("posts/p1/likes/bob"));
    unlike.update(b.doc("posts/p1"), { likesCount: INC(-1) });
    await assertSucceeds(unlike.commit());

    const comment = b.batch();
    comment.set(b.collection("posts/p1/comments").doc("c1"), { authorId: "bob", author: { uid: "bob" }, body: "nice", createdAt: TS() });
    comment.update(b.doc("posts/p1"), { commentsCount: INC(1) });
    await assertSucceeds(comment.commit());

    const report = b.batch();
    report.set(b.doc("reports/p1_bob"), { postId: "p1", postAuthorId: "alice", reporterId: "bob", reason: "Spam", status: "open", createdAt: TS() });
    report.update(b.doc("posts/p1"), { reportCount: INC(1) });
    await assertSucceeds(report.commit());
    await assertSucceeds(b.doc("reports/p1_bob").get());   // "have I reported this already?" check
  });

  test("only the author (or an admin) can delete a post; nobody can post as someone else", async () => {
    await seedUsers("alice", "bob");
    await assertFails(as("bob").doc("posts/x").set(post("alice")));
    await assertSucceeds(as("alice").doc("posts/p1").set(post("alice")));
    await assertFails(as("bob").doc("posts/p1").delete());
    await assertSucceeds(as("alice").doc("posts/p1").delete());
  });

  test("a post can't claim a verified-student badge the author doesn't have", async () => {
    await seedUsers("alice");
    await assertFails(as("alice").doc("posts/p2").set({ ...post("alice"), author: { uid: "alice", verified: true } }));
  });
});

describe("groups", () => {
  test("create → join → leave, and private groups need an invitation", async () => {
    await seedUsers("alice", "bob");
    const a = as("alice");
    const make = a.batch();
    make.set(a.doc("groups/g1"), { name: "Algo", subject: "CS", privacy: "public", ownerId: "alice", memberCount: 1, createdAt: TS() });
    make.set(a.doc("groups/g1/members/alice"), { uid: "alice", role: "owner", joinedAt: TS() });
    make.set(a.doc("conversations/group_g1"), { type: "group", groupId: "g1", participants: ["alice"], participantInfo: {}, status: "accepted", unread: {}, lastMessageAt: TS() });
    await assertSucceeds(make.commit());

    const b = as("bob");
    const join = b.batch();
    join.set(b.doc("groups/g1/members/bob"), { uid: "bob", role: "member", joinedAt: TS() });
    join.update(b.doc("groups/g1"), { memberCount: INC(1) });
    join.update(b.doc("conversations/group_g1"), { participants: firebase.firestore.FieldValue.arrayUnion("bob"), "unread.bob": 0 });
    await assertSucceeds(join.commit());

    await seed((db) => db.doc("groups/priv").set({ name: "Secret", privacy: "private", ownerId: "alice", memberCount: 1 }));
    const sneak = b.batch();
    sneak.set(b.doc("groups/priv/members/bob"), { uid: "bob", role: "member", joinedAt: TS() });
    sneak.update(b.doc("groups/priv"), { memberCount: INC(1) });
    await assertFails(sneak.commit());
  });
});

describe("tutor sessions", () => {
  test("a student can only book at the tutor's published price, paying the same amount into escrow", async () => {
    await seedUsers("alice", "bob");
    await seed((db) => db.doc("tutor_profiles/bob").set({ uid: "bob", acceptingSessions: true, rates: { materials: 15, asyncQa: 25, zoomMeeting: 50 }, ratingSum: 0, ratingCount: 0, sessionsCompleted: 0 }));
    const a = as("alice");
    const book = (credits) => {
      const batch = a.batch();
      batch.set(a.doc("tutor_sessions/s1"), {
        tutorId: "bob", studentId: "alice", mode: "zoomMeeting", credits, durationMin: 45, status: "pending", escrowed: true, payoutClaimed: false, refundClaimed: false, createdAt: TS(),
      });
      batch.update(a.doc("users/alice"), { credits: INC(-credits), lastCreditKind: "session_escrow", lastCreditId: "s1", updatedAt: TS() });
      return batch.commit();
    };
    await assertFails(book(1));      // underpay
    await assertSucceeds(book(50));
  });
});

describe("notifications & admin", () => {
  test("anyone can notify a user as themselves, only the owner can read; links must be in-app paths", async () => {
    await seedUsers("alice", "bob");
    await assertSucceeds(as("alice").collection("users/bob/notifications").add({ type: "like", text: "hi", actorId: "alice", read: false, actionUrl: "/community", createdAt: TS() }));
    await assertFails(as("alice").collection("users/bob/notifications").add({ type: "like", text: "hi", actorId: "bob", read: false, createdAt: TS() }));
    await assertFails(as("alice").collection("users/bob/notifications").add({ type: "like", text: "hi", actorId: "alice", read: false, actionUrl: "https://evil.example", createdAt: TS() }));
    await assertFails(as("alice").collection("users/bob/notifications").get());
    await assertSucceeds(as("bob").collection("users/bob/notifications").get());
  });

  test("admins can review reports; ordinary users can't", async () => {
    await seedUsers("alice", "root");
    await seed(async (db) => { await db.doc("admins/root").set({ uid: "root" }); await db.doc("reports/p_x").set({ postId: "p", reporterId: "x", status: "open", createdAt: new Date() }); });
    await assertSucceeds(as("root").collection("reports").where("status", "==", "open").get());
    await assertFails(as("alice").collection("reports").where("status", "==", "open").get());
  });
});
