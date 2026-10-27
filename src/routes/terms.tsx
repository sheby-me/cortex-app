import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal-page";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Use — Cortex" },
      { name: "description", content: "The rules for using Cortex, including credits, tutoring and community conduct." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage title="Terms of Use" updated="October 2026">
      <p>
        By creating an account you agree to these terms. They are a plain-language starting point; the operator of this site should have
        them reviewed by a qualified adviser and add their legal name and contact details before launch.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>Use a real email address you control. We verify it, and accounts using throw-away addresses may be removed.</li>
        <li>You are responsible for activity on your account. Keep your password private.</li>
        <li>One person, one account. Don’t impersonate others or create accounts to manipulate credits, ratings or leaderboards.</li>
      </ul>

      <h2>Community conduct</h2>
      <ul>
        <li>Be respectful. No harassment, hate speech, threats, sexual content, spam or scams.</li>
        <li>Share only content you have the right to share. Don’t post other people’s private information.</li>
        <li>Don’t use Cortex to cheat on assessments where help is prohibited — you are responsible for your institution’s academic-integrity rules.</li>
        <li>Posts can be reported; administrators may remove content and suspend accounts that break these rules.</li>
      </ul>

      <h2>Credits</h2>
      <p>
        Credits are an in-app unit for peer help and tutoring. They have no cash value, can’t be bought, sold or transferred outside
        the app, and may be adjusted or removed if they were obtained through abuse or error.
      </p>

      <h2>Tutors</h2>
      <p>
        Tutors are independent community members approved after a review of the information they provide. Approval is not a guarantee
        of quality or an employment relationship. Sessions are confirmed by the student; unconfirmed delivered sessions are released to the
        tutor after 72 hours.
      </p>

      <h2>AI tools</h2>
      <p>AI answers can be wrong. Check important facts before relying on them. Don’t submit confidential information.</p>

      <h2>Availability and liability</h2>
      <p>
        The service is provided “as is”, without warranties, and may change or be interrupted. To the extent the law allows, the operator
        is not liable for indirect losses arising from use of the service.
      </p>

      <h2>Ending your account</h2>
      <p>You can delete your account in Settings at any time. We may suspend or end accounts that seriously or repeatedly break these terms.</p>
    </LegalPage>
  );
}
