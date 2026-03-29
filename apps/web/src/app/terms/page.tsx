import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — PayJarvis",
  description:
    "Terms of Service for PayJarvis, the AI-powered personal assistant for commerce, travel, documents, and daily tasks.",
  openGraph: {
    title: "Terms of Service — PayJarvis",
    description:
      "Terms of Service for PayJarvis, the AI-powered personal assistant for commerce, travel, documents, and daily tasks.",
    type: "website",
    url: "https://www.payjarvis.com/terms",
  },
};

export default function TermsOfServicePage() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-300">
      <div className="mx-auto max-w-4xl px-6 py-20 sm:py-28">
        {/* Header */}
        <header className="mb-16 text-center">
          <h1 className="mb-4 font-display text-4xl font-extrabold tracking-tight text-gray-100 sm:text-5xl">
            Terms of Service
          </h1>
          <p className="text-lg text-gray-400">
            Effective Date: March 20, 2026
          </p>
        </header>

        <div className="space-y-12 text-base leading-relaxed">
          {/* 1. Service Description */}
          <section>
            <h2 className="mb-4 font-display text-2xl font-bold text-gray-100">
              1. Service Description
            </h2>
            <p>
              PayJarvis is an AI-powered personal assistant that helps users
              with commerce (finding products, comparing prices, and making
              purchases), travel planning, document generation, and daily task
              management. The Service operates primarily through Telegram and
              WhatsApp messaging platforms.
            </p>
            <p className="mt-3">
              By accessing or using PayJarvis (&quot;the Service&quot;), you
              agree to be bound by these Terms of Service (&quot;Terms&quot;).
              If you do not agree to these Terms, you may not use the Service.
            </p>
          </section>

          {/* 2. Eligibility */}
          <section>
            <h2 className="mb-4 font-display text-2xl font-bold text-gray-100">
              2. Eligibility
            </h2>
            <p>
              You must be at least 18 years of age to use PayJarvis. By
              creating an account, you represent and warrant that you meet this
              age requirement.
            </p>
            <p className="mt-3">
              PayJarvis is available internationally, with primary operations
              in the United States and Brazil. You are responsible for
              complying with all local laws and regulations applicable to your
              use of the Service in your jurisdiction.
            </p>
          </section>

          {/* 3. Account */}
          <section>
            <h2 className="mb-4 font-display text-2xl font-bold text-gray-100">
              3. Account Responsibilities
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>
                You are responsible for maintaining the confidentiality of your
                account credentials, including any API keys or tokens
                associated with your account.
              </li>
              <li>
                Only one account per person is permitted. Creating multiple
                accounts may result in suspension or termination of all
                associated accounts.
              </li>
              <li>
                You must provide accurate, current, and complete information
                during registration and keep your account information
                up-to-date.
              </li>
              <li>
                You are solely responsible for all activity that occurs under
                your account.
              </li>
            </ul>
          </section>

          {/* 4. Acceptable Use */}
          <section>
            <h2 className="mb-4 font-display text-2xl font-bold text-gray-100">
              4. Acceptable Use
            </h2>
            <p>You agree not to use PayJarvis to:</p>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>
                Engage in any illegal activities or violate any applicable
                laws or regulations.
              </li>
              <li>
                Send spam, unsolicited messages, or conduct fraudulent
                activities.
              </li>
              <li>
                Abuse, manipulate, or attempt to exploit the AI system in ways
                that degrade the Service for other users.
              </li>
              <li>
                Attempt to circumvent security measures, authentication
                mechanisms, or access controls.
              </li>
              <li>
                Reverse-engineer, decompile, disassemble, or otherwise attempt
                to derive the source code or underlying algorithms of the
                Service.
              </li>
              <li>
                Use the Service to harm, harass, threaten, or infringe upon
                the rights of others.
              </li>
            </ul>
            <p className="mt-3">
              Violation of this section may result in immediate suspension or
              termination of your account.
            </p>
          </section>

          {/* 5. Payments and Billing */}
          <section>
            <h2 className="mb-4 font-display text-2xl font-bold text-gray-100">
              5. Payments and Billing
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>
                PayJarvis offers a subscription plan at{" "}
                <strong className="text-gray-100">$20.00 USD per month</strong>,
                billed through Stripe.
              </li>
              <li>
                Each interaction with the AI assistant consumes LLM
                (Large Language Model) credits. Credit usage varies based on the
                complexity and length of the interaction.
              </li>
              <li>
                A free tier is available with limited functionality and credit
                allocation.
              </li>
              <li>
                Refund requests are handled on a case-by-case basis at our
                sole discretion. To request a refund, contact{" "}
                <a
                  href="mailto:legal@payjarvis.com"
                  className="text-brand-400 underline hover:text-brand-300"
                >
                  legal@payjarvis.com
                </a>
                .
              </li>
              <li>
                All payment processing is handled by Stripe. By subscribing,
                you also agree to{" "}
                <a
                  href="https://stripe.com/legal"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-400 underline hover:text-brand-300"
                >
                  Stripe&apos;s Terms of Service
                </a>
                .
              </li>
            </ul>
          </section>

          {/* 6. Agent Commerce */}
          <section>
            <h2 className="mb-4 font-display text-2xl font-bold text-gray-100">
              6. Agent Commerce
            </h2>
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-5">
              <p className="mb-3 font-semibold text-yellow-300">
                Important: Please read this section carefully.
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  PayJarvis acts solely as{" "}
                  <strong className="text-gray-100">your agent</strong>,
                  executing actions on your behalf. PayJarvis is{" "}
                  <strong className="text-gray-100">not a merchant</strong>{" "}
                  and does not sell, fulfill, or ship any products or services.
                </li>
                <li>
                  When purchases are made through PayJarvis, they are executed
                  on <strong className="text-gray-100">your own accounts</strong>{" "}
                  (e.g., Amazon, retail store accounts). PayJarvis is not the
                  merchant of record for any transaction.
                </li>
                <li>
                  You will be prompted to approve all purchases that exceed
                  your configured approval threshold before they are executed.
                </li>
                <li>
                  PayJarvis is{" "}
                  <strong className="text-gray-100">not responsible</strong>{" "}
                  for product quality, accuracy of product descriptions,
                  shipping, delivery timelines, or any issues arising from
                  products or services purchased through the Service.
                </li>
                <li>
                  All returns, refunds, and disputes related to purchased
                  products must be handled directly with the respective
                  merchant or retailer. PayJarvis has no obligation or ability
                  to process returns or refunds for third-party transactions.
                </li>
              </ul>
            </div>
          </section>

          {/* 7. Browser Automation */}
          <section>
            <h2 className="mb-4 font-display text-2xl font-bold text-gray-100">
              7. Browser Automation
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>
                PayJarvis uses automated browser technology to facilitate
                purchases, bookings, and other actions on third-party websites
                on your behalf.
              </li>
              <li>
                The use of automated browsers on third-party sites may be
                subject to those sites&apos; own Terms of Service. You
                acknowledge this risk and agree that PayJarvis is not liable
                for any consequences arising from automated access to
                third-party platforms.
              </li>
              <li>
                By using PayJarvis, you explicitly authorize the Service to
                act on your behalf when interacting with third-party websites
                and services.
              </li>
              <li>
                Any credentials you store with PayJarvis are encrypted using{" "}
                <strong className="text-gray-100">AES-256 encryption</strong>.
                You may request deletion of your stored credentials at any
                time through your account settings or by contacting support.
              </li>
            </ul>
          </section>

          {/* 8. AI Disclaimer */}
          <section>
            <h2 className="mb-4 font-display text-2xl font-bold text-gray-100">
              8. AI Disclaimer
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>
                PayJarvis utilizes artificial intelligence technology
                (including Google Gemini) to provide its services. AI systems
                may produce inaccurate, incomplete, or inappropriate
                responses. You should always verify critical information
                independently.
              </li>
              <li>
                You retain final approval authority on all transactions and
                actions. PayJarvis will not execute purchases or irreversible
                actions without your confirmation (subject to your configured
                approval thresholds).
              </li>
              <li>
                Documents generated by PayJarvis (e.g., contracts, letters,
                itineraries) are provided as{" "}
                <strong className="text-gray-100">templates only</strong> and
                do not constitute legal, financial, tax, or professional
                advice. You should consult qualified professionals for such
                matters.
              </li>
              <li>
                PayJarvis is not liable for any decisions made or actions
                taken based on AI-generated recommendations or content.
              </li>
            </ul>
          </section>

          {/* 9. Limitation of Liability */}
          <section>
            <h2 className="mb-4 font-display text-2xl font-bold text-gray-100">
              9. Limitation of Liability
            </h2>
            <p>
              THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS
              AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS
              OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF
              MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
              NON-INFRINGEMENT.
            </p>
            <p className="mt-3">
              To the maximum extent permitted by applicable law, PayJarvis and
              its officers, directors, employees, and agents shall not be
              liable for:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>
                Incorrect, unintended, or unauthorized purchases made through
                the Service.
              </li>
              <li>
                Price changes, stock availability, or other fluctuations on
                third-party platforms.
              </li>
              <li>
                Failed, incomplete, or delayed transactions.
              </li>
              <li>
                Outages, downtime, or disruptions of third-party services
                (including messaging platforms, retailers, or payment
                processors).
              </li>
              <li>
                Data loss beyond what is covered by our backup and recovery
                systems.
              </li>
            </ul>
            <p className="mt-3">
              In no event shall PayJarvis&apos;s total aggregate liability
              exceed the total fees paid by you to PayJarvis during the{" "}
              <strong className="text-gray-100">
                twelve (12) months
              </strong>{" "}
              immediately preceding the event giving rise to the claim.
            </p>
          </section>

          {/* 10. Intellectual Property */}
          <section>
            <h2 className="mb-4 font-display text-2xl font-bold text-gray-100">
              10. Intellectual Property
            </h2>
            <p>
              The PayJarvis brand, logo, website, source code, AI models,
              agent systems, and all related intellectual property are the
              exclusive property of PayJarvis and are protected by applicable
              intellectual property laws.
            </p>
            <p className="mt-3">
              You retain full ownership of your personal data, documents, and
              content created through the Service. By using PayJarvis, you
              grant us a limited license to process your data solely for the
              purpose of providing and improving the Service.
            </p>
          </section>

          {/* 11. Termination */}
          <section>
            <h2 className="mb-4 font-display text-2xl font-bold text-gray-100">
              11. Termination
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>
                We reserve the right to suspend or terminate your account at
                any time, with or without notice, for violations of these
                Terms or for any conduct that we determine, in our sole
                discretion, to be harmful to the Service or other users.
              </li>
              <li>
                You may delete your account at any time through your account
                settings or by contacting support.
              </li>
              <li>
                Upon termination, your stored data (including credentials,
                conversation history, and personal information) will be
                permanently deleted within{" "}
                <strong className="text-gray-100">thirty (30) days</strong>,
                except where retention is required by law.
              </li>
            </ul>
          </section>

          {/* 12. Dispute Resolution */}
          <section>
            <h2 className="mb-4 font-display text-2xl font-bold text-gray-100">
              12. Dispute Resolution
            </h2>
            <p>
              Any disputes arising out of or relating to these Terms or the
              Service shall be resolved through{" "}
              <strong className="text-gray-100">binding arbitration</strong>{" "}
              in accordance with the rules of the American Arbitration
              Association (AAA).
            </p>
            <p className="mt-3">
              The arbitration shall take place in{" "}
              <strong className="text-gray-100">
                Miami-Dade County, Florida, USA
              </strong>
              . These Terms and any disputes arising hereunder shall be
              governed by and construed in accordance with the laws of the
              State of Florida, without regard to its conflict of law
              provisions.
            </p>
            <p className="mt-3">
              You agree to waive any right to participate in a class action
              lawsuit or class-wide arbitration against PayJarvis.
            </p>
          </section>

          {/* 13. Changes to These Terms */}
          <section>
            <h2 className="mb-4 font-display text-2xl font-bold text-gray-100">
              13. Changes to These Terms
            </h2>
            <p>
              We reserve the right to modify or update these Terms at any
              time. When we make material changes, we will notify you via
              email or through a message in the PayJarvis bot.
            </p>
            <p className="mt-3">
              Your continued use of the Service after any such changes
              constitutes your acceptance of the revised Terms. If you do not
              agree with the updated Terms, you must discontinue use of the
              Service and delete your account.
            </p>
          </section>

          {/* 14. Contact */}
          <section>
            <h2 className="mb-4 font-display text-2xl font-bold text-gray-100">
              14. Contact
            </h2>
            <p>
              If you have any questions, concerns, or requests regarding these
              Terms of Service, please contact us at:
            </p>
            <p className="mt-3">
              <a
                href="mailto:legal@payjarvis.com"
                className="text-brand-400 underline hover:text-brand-300"
              >
                legal@payjarvis.com
              </a>
            </p>
          </section>

          {/* Divider */}
          <hr className="border-gray-800" />

          {/* Footer note */}
          <p className="text-center text-sm text-gray-500">
            A plain-text version of these Terms is available at{" "}
            <a
              href="/terms-of-service.md"
              className="text-brand-400 underline hover:text-brand-300"
            >
              /terms-of-service.md
            </a>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
