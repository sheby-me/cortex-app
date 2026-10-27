import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal-page";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Cortex" },
      { name: "description", content: "What data Cortex collects, why, and how you can control or delete it." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="October 2026">
      <p>
        Cortex is a peer-learning platform. This page explains, in plain language, what we store about you and what you can do about it.
        It describes how the app actually works today; if you operate this deployment, review it with a qualified adviser and add your
        company name and contact address before launch.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account data:</strong> email address (kept private — visible only to you and administrators), display name, username, profile picture.</li>
        <li><strong>Profile data you choose to add:</strong> institution, course, bio, topics you teach or want to learn, country, timezone.</li>
        <li><strong>Activity you create:</strong> posts, comments, likes, messages and attachments, study-group memberships, SOS requests, tutoring sessions, ratings and reviews.</li>
        <li><strong>Credits and progress:</strong> credit balance and history, quiz results, roadmap progress, achievements, streaks and the minutes the app is open while you study.</li>
        <li><strong>Presence:</strong> whether you are online and when you were last active, visible to signed-in users.</li>
        <li><strong>Tutor applications:</strong> qualification details and the document you upload, visible only to you and administrators.</li>
      </ul>

      <h2>Who can see what</h2>
      <ul>
        <li>Your public profile (name, username, picture, institution, topics) is visible to other signed-in users.</li>
        <li>Your messages are visible only to the people in the conversation.</li>
        <li>Your email, notifications, bookmarks and progress are visible only to you.</li>
        <li>Leaderboard: you appear only while “show me on leaderboards” is on in Settings.</li>
      </ul>

      <h2>Where it is stored</h2>
      <p>
        Data is stored with Google Firebase (Authentication, Cloud Firestore and Cloud Storage). Requests to the AI study tools are
        sent to Google’s Gemini API to generate a reply; do not include information you want to keep private.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Edit your profile or hide yourself from leaderboards in <em>Settings</em> at any time.</li>
        <li>Delete your account in <em>Settings → Delete account</em>. This removes your profile, username, private data and sign-in. Content you posted in shared places (for example group messages) may remain until an administrator removes it; contact us to have it erased.</li>
        <li>Ask us to export or erase your data by contacting the address published by the operator of this site.</li>
      </ul>

      <h2>Security</h2>
      <p>
        Sign-in requires a verified email address. Access to data is enforced by server-side security rules, files are served only to
        authorised users, and administrators’ actions are limited to moderation. No system is perfectly secure; please use a strong,
        unique password.
      </p>

      <h2>Children</h2>
      <p>Cortex is intended for learners aged 16 and over. If you believe a younger child has registered, contact us and we will remove the account.</p>

      <h2>Changes</h2>
      <p>If this policy changes materially we will tell you in the app before the change takes effect.</p>
    </LegalPage>
  );
}
