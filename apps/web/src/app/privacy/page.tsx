import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — PayJarvis",
  description:
    "How PayJarvis collects, uses, stores, and protects your personal data. LGPD, GDPR, and CCPA compliant.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800">
        <div className="mx-auto max-w-4xl px-6 py-8 sm:py-12">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to PayJarvis
          </Link>
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-4 text-lg text-gray-400">
            Effective Date: March 20, 2026
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-4xl px-6 py-12 sm:py-16">
        <div className="space-y-12">
          {/* Introduction */}
          <Section>
            <p className="text-gray-300 leading-relaxed">
              PayJarvis (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;)
              operates the PayJarvis AI assistant platform. This Privacy Policy
              explains how we collect, use, disclose, and safeguard your
              information when you use our service. Please read this policy
              carefully. By accessing or using PayJarvis, you agree to the
              collection and use of information in accordance with this policy.
            </p>
          </Section>

          {/* 1. Data Collection */}
          <Section title="1. Data We Collect">
            <p className="mb-4 text-gray-300">
              We collect the following categories of personal and usage data to
              provide and improve our service:
            </p>
            <ul className="space-y-3">
              <ListItem>
                <Strong>Personal Information:</Strong> Name, email address, and
                phone number provided during account registration.
              </ListItem>
              <ListItem>
                <Strong>Location Data:</Strong> GPS coordinates used to power
                local commerce features (e.g., finding nearby restaurants and
                stores).
              </ListItem>
              <ListItem>
                <Strong>Conversation History:</Strong> Messages and interactions
                with the PayJarvis AI assistant.
              </ListItem>
              <ListItem>
                <Strong>Audio Transcriptions:</Strong> Voice messages processed
                through speech-to-text (STT) technology. Raw audio is not
                retained after transcription.
              </ListItem>
              <ListItem>
                <Strong>Amazon Store Credentials:</Strong> Credentials for your
                Amazon account, stored in our AES-256 encrypted credentials
                vault to enable purchase automation on your behalf.
              </ListItem>
              <ListItem>
                <Strong>Purchase History &amp; Transaction Data:</Strong> Records
                of purchases and transactions executed through PayJarvis.
              </ListItem>
              <ListItem>
                <Strong>Device Information &amp; IP Address:</Strong> Browser
                type, operating system, device identifiers, and IP address
                collected automatically during service use.
              </ListItem>
            </ul>
          </Section>

          {/* 2. How We Use Data */}
          <Section title="2. How We Use Your Data">
            <ul className="space-y-3">
              <ListItem>
                <Strong>Service Delivery &amp; Personalization:</Strong> To
                provide, operate, and personalize the PayJarvis AI assistant
                experience.
              </ListItem>
              <ListItem>
                <Strong>Transaction Processing:</Strong> To process purchases
                and transactions on your behalf across integrated platforms.
              </ListItem>
              <ListItem>
                <Strong>Product Improvement:</Strong> To analyze usage patterns
                and improve product quality, reliability, and user experience.
              </ListItem>
              <ListItem>
                <Strong>Notifications:</Strong> To send service-related
                notifications via Telegram, WhatsApp, and email (e.g.,
                transaction confirmations, security alerts).
              </ListItem>
              <ListItem>
                <Strong>Security &amp; Fraud Prevention:</Strong> To detect,
                prevent, and respond to fraud, unauthorized access, and other
                security threats.
              </ListItem>
            </ul>
          </Section>

          {/* 3. Third-Party Sharing */}
          <Section title="3. Third-Party Service Providers">
            <p className="mb-4 text-gray-300">
              We share data with the following third-party providers strictly to
              operate our service. We do{" "}
              <Strong>not sell your personal data</Strong> to any third party.
            </p>
            <div className="overflow-hidden rounded-xl border border-gray-800">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/50">
                    <th className="px-4 py-3 font-semibold text-gray-200">
                      Provider
                    </th>
                    <th className="px-4 py-3 font-semibold text-gray-200">
                      Purpose
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  <TableRow provider="Stripe" purpose="Payment processing" />
                  <TableRow
                    provider="Twilio"
                    purpose="WhatsApp messaging delivery"
                  />
                  <TableRow
                    provider="Google (Gemini, Places API)"
                    purpose="AI processing and location services"
                  />
                  <TableRow
                    provider="Amazon"
                    purpose="Purchase automation (user's own account)"
                  />
                  <TableRow
                    provider="Amadeus"
                    purpose="Travel search and booking"
                  />
                  <TableRow
                    provider="BrowserBase"
                    purpose="Browser automation infrastructure"
                  />
                  <TableRow
                    provider="Clerk"
                    purpose="User authentication and identity management"
                  />
                  <TableRow
                    provider="Hostinger"
                    purpose="Hosting infrastructure"
                  />
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm text-gray-400">
              Each provider processes data in accordance with their own privacy
              policy. We encourage you to review those policies.
            </p>
          </Section>

          {/* 4. Data Storage & Security */}
          <Section title="4. Data Storage &amp; Security">
            <p className="mb-4 text-gray-300">
              We implement industry-standard security measures to protect your
              data:
            </p>
            <ul className="space-y-3">
              <ListItem>
                <Strong>Hosting:</Strong> Virtual Private Server (VPS) hosted by
                Hostinger in the United States.
              </ListItem>
              <ListItem>
                <Strong>Database:</Strong> PostgreSQL database with access
                controls and regular backups.
              </ListItem>
              <ListItem>
                <Strong>Caching:</Strong> Redis for ephemeral caching; cached
                data is not persisted long-term.
              </ListItem>
              <ListItem>
                <Strong>Credentials Vault:</Strong> All stored credentials
                (e.g., Amazon account) are encrypted with AES-256 encryption.
              </ListItem>
              <ListItem>
                <Strong>Data in Transit:</Strong> All communications are
                encrypted using HTTPS/TLS.
              </ListItem>
              <ListItem>
                <Strong>Password Security:</Strong> User passwords are hashed
                with bcrypt and never stored in plain text.
              </ListItem>
            </ul>
          </Section>

          {/* 5. Data Retention */}
          <Section title="5. Data Retention">
            <div className="overflow-hidden rounded-xl border border-gray-800">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/50">
                    <th className="px-4 py-3 font-semibold text-gray-200">
                      Data Type
                    </th>
                    <th className="px-4 py-3 font-semibold text-gray-200">
                      Retention Period
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  <TableRow
                    provider="Account data"
                    purpose="Retained while your account is active"
                  />
                  <TableRow
                    provider="Conversation history"
                    purpose="Retained for service improvement; deletable on request"
                  />
                  <TableRow
                    provider="Credentials vault"
                    purpose="Deletable at any time by the user"
                  />
                  <TableRow
                    provider="Transaction logs"
                    purpose="Retained for 7 years (legal and tax requirements)"
                  />
                  <TableRow
                    provider="Post-deletion cleanup"
                    purpose="All data removed within 30 days of account deletion"
                  />
                </tbody>
              </table>
            </div>
          </Section>

          {/* 6. User Rights */}
          <Section title="6. Your Rights (LGPD / GDPR / CCPA)">
            <p className="mb-4 text-gray-300">
              Depending on your jurisdiction, you may have the following rights
              regarding your personal data:
            </p>
            <ul className="space-y-3">
              <ListItem>
                <Strong>Right to Access:</Strong> Request a copy of all personal
                data we hold about you.
              </ListItem>
              <ListItem>
                <Strong>Right to Correction:</Strong> Request correction of
                inaccurate or incomplete data.
              </ListItem>
              <ListItem>
                <Strong>Right to Deletion:</Strong> Request deletion of your
                personal data, subject to legal retention requirements.
              </ListItem>
              <ListItem>
                <Strong>Right to Data Portability:</Strong> Receive your data in
                a structured, machine-readable format.
              </ListItem>
              <ListItem>
                <Strong>Right to Withdraw Consent:</Strong> Withdraw consent for
                data processing at any time.
              </ListItem>
              <ListItem>
                <Strong>Right to Restrict Processing:</Strong> Request
                limitation of how we process your data.
              </ListItem>
            </ul>
            <p className="mt-4 text-gray-300">
              To exercise any of these rights, contact us at{" "}
              <a
                href="mailto:privacy@payjarvis.com"
                className="text-blue-400 underline underline-offset-2 transition-colors hover:text-blue-300"
              >
                privacy@payjarvis.com
              </a>
              . We will respond within 15 business days.
            </p>
          </Section>

          {/* 7. Cookies */}
          <Section title="7. Cookies">
            <p className="text-gray-300 leading-relaxed">
              We use <Strong>essential cookies only</Strong>, required for
              authentication through Clerk. These cookies are strictly necessary
              for the service to function and cannot be disabled. We do{" "}
              <Strong>not</Strong> use tracking cookies, advertising cookies, or
              any third-party analytics cookies.
            </p>
          </Section>

          {/* 8. Children */}
          <Section title="8. Children&apos;s Privacy">
            <p className="text-gray-300 leading-relaxed">
              PayJarvis is not intended for users under 18 years of age. We do
              not knowingly collect personal data from minors. If we become aware
              that we have collected data from a user under 18, we will take
              steps to delete that information promptly.
            </p>
          </Section>

          {/* 9. Changes */}
          <Section title="9. Changes to This Policy">
            <p className="text-gray-300 leading-relaxed">
              We may update this Privacy Policy from time to time. When we do,
              we will revise the &quot;Effective Date&quot; at the top of this
              page and notify you via email or in-app notification for material
              changes. Continued use of PayJarvis after changes constitutes
              acceptance of the updated policy.
            </p>
          </Section>

          {/* 10. Contact */}
          <Section title="10. Contact Us">
            <p className="text-gray-300 leading-relaxed">
              If you have questions or concerns about this Privacy Policy or our
              data practices, contact us at:
            </p>
            <div className="mt-4 rounded-xl border border-gray-800 bg-gray-900/50 p-6">
              <p className="font-semibold text-gray-200">PayJarvis</p>
              <p className="mt-1 text-gray-400">
                Email:{" "}
                <a
                  href="mailto:privacy@payjarvis.com"
                  className="text-blue-400 underline underline-offset-2 transition-colors hover:text-blue-300"
                >
                  privacy@payjarvis.com
                </a>
              </p>
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="mt-16 border-t border-gray-800 pt-8 text-center text-sm text-gray-500">
          <p>Last updated: March 20, 2026</p>
          <p className="mt-2">
            <Link
              href="/"
              className="text-gray-400 underline underline-offset-2 transition-colors hover:text-gray-200"
            >
              Return to PayJarvis
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

/* ── Helper Components ── */

function Section({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      {title && (
        <h2 className="mb-4 text-2xl font-bold tracking-tight text-gray-100">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

function ListItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-gray-300 leading-relaxed">
      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-500" />
      <span>{children}</span>
    </li>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-gray-100">{children}</span>;
}

function TableRow({ provider, purpose }: { provider: string; purpose: string }) {
  return (
    <tr className="transition-colors hover:bg-gray-900/30">
      <td className="px-4 py-3 font-medium text-gray-200">{provider}</td>
      <td className="px-4 py-3 text-gray-400">{purpose}</td>
    </tr>
  );
}
