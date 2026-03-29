import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Security — PayJarvis",
  description:
    "Learn how PayJarvis protects your sensitive data with Zero-Knowledge encryption, AES-256-GCM, and a security architecture where only you hold the keys.",
  openGraph: {
    title: "Security — PayJarvis",
    description:
      "Zero-Knowledge encryption means we literally cannot read your sensitive data. Your keys, your data.",
  },
};

/* ── Inline SVG Icons ── */

function ShieldIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
      />
    </svg>
  );
}

function LockIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
      />
    </svg>
  );
}

function KeyIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
      />
    </svg>
  );
}

function EyeOffIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
      />
    </svg>
  );
}

function TrashIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
      />
    </svg>
  );
}

function MagnifyingGlassIcon({
  className = "h-6 w-6",
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  );
}

/* ── Page ── */

export default function SecurityPage() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      {/* ── Hero Section ── */}
      <section className="relative overflow-hidden border-b border-gray-800">
        {/* Subtle radial glow */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[600px] w-[600px] rounded-full bg-emerald-500/5 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-5xl px-6 py-20 sm:py-28 text-center">
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
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

          <div className="mx-auto mb-6">
            <Image src="/logo-medium.png" alt="PayJarvis" width={120} height={120} className="mx-auto rounded-2xl" />
          </div>

          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
            Your data is yours.{" "}
            <span className="text-emerald-400">Period.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-400 sm:text-xl leading-relaxed">
            PayJarvis uses Zero-Knowledge encryption so your most sensitive
            data is encrypted with a key that only you control. We
            literally cannot read it — even if we wanted to.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-sm">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-emerald-300">
              <ShieldIcon className="h-4 w-4" />
              AES-256-GCM
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-emerald-300">
              <LockIcon className="h-4 w-4" />
              Zero-Knowledge
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-emerald-300">
              <KeyIcon className="h-4 w-4" />
              PBKDF2 + SHA-512
            </span>
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="border-b border-gray-800 bg-gradient-to-b from-gray-950 to-gray-900/50">
        <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
            How It Works
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-gray-400">
            Four simple steps between you and unbreakable encryption.
          </p>

          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <StepCard
              step={1}
              title="Set your PIN"
              description="You choose a 6-digit PIN during setup. This is your secret — we never see it or store it."
            />
            <StepCard
              step={2}
              title="Key derivation"
              description="Your PIN is processed through PBKDF2 with 100,000 iterations and a unique salt to generate a powerful AES-256 encryption key."
            />
            <StepCard
              step={3}
              title="Client-side encryption"
              description="Sensitive data is encrypted BEFORE it ever leaves your device. Our servers only see ciphertext — unreadable gibberish."
            />
            <StepCard
              step={4}
              title="Only you can decrypt"
              description="Your PIN is the only key that unlocks your data. Lose it and not even we can recover it — that's real zero-knowledge."
            />
          </div>

          {/* Visual flow connector for larger screens */}
          <div className="mt-8 hidden lg:flex items-center justify-center">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="h-px w-12 bg-gray-700" />
              Your PIN never leaves your device
              <span className="h-px w-12 bg-gray-700" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Three Layers of Protection ── */}
      <section className="border-b border-gray-800">
        <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
            Three Layers of Protection
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-gray-400">
            Not all data is equal. We protect each category with the
            appropriate level of security.
          </p>

          <div className="mt-16 space-y-6">
            <LayerCard
              layer={1}
              label="Public"
              color="blue"
              title="Public Data"
              items={["Name", "Email address"]}
              description="Minimal data needed to provide the service. Protected by standard access controls and TLS in transit."
            />
            <LayerCard
              layer={2}
              label="Encrypted"
              color="amber"
              title="Operational Data"
              items={[
                "Conversation history",
                "Preferences",
                "AI context",
              ]}
              description="Encrypted at rest with our server-managed encryption key. Protected but accessible to our systems for service delivery."
            />
            <LayerCard
              layer={3}
              label="Zero-Knowledge"
              color="emerald"
              title="Sensitive Data"
              items={[
                "Payment cards",
                "Stored credentials",
                "Personal documents",
              ]}
              description="Encrypted with YOUR personal key derived from your PIN. We cannot decrypt this data under any circumstances — only you can."
            />
          </div>
        </div>
      </section>

      {/* ── Key Features Grid ── */}
      <section className="border-b border-gray-800 bg-gradient-to-b from-gray-950 to-gray-900/50">
        <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
            Built for Trust
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-gray-400">
            Every design decision prioritizes your privacy and security.
          </p>

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={<ShieldIcon className="h-6 w-6 text-emerald-400" />}
              title="Military-grade encryption"
              description="AES-256-GCM — the same standard used by governments and banks worldwide to protect classified information."
            />
            <FeatureCard
              icon={<EyeOffIcon className="h-6 w-6 text-emerald-400" />}
              title="Zero-Knowledge Architecture"
              description="We mathematically cannot read your sensitive data. No backdoors, no master keys, no exceptions."
            />
            <FeatureCard
              icon={<KeyIcon className="h-6 w-6 text-emerald-400" />}
              title="Your keys, your data"
              description="Your PIN generates the encryption key and is never stored on our servers. You are the sole custodian."
            />
            <FeatureCard
              icon={<TrashIcon className="h-6 w-6 text-emerald-400" />}
              title="Instant deletion"
              description="Remove any stored item at any time. Deletion is immediate and irreversible — no shadow copies."
            />
            <FeatureCard
              icon={
                <MagnifyingGlassIcon className="h-6 w-6 text-emerald-400" />
              }
              title="Open audit"
              description="Our encryption implementation is transparent and auditable. Security through openness, not obscurity."
            />
            <FeatureCard
              icon={<LockIcon className="h-6 w-6 text-emerald-400" />}
              title="End-to-end protection"
              description="TLS 1.3 in transit, AES-256 at rest, and zero-knowledge for sensitive items. No gaps in the chain."
            />
          </div>
        </div>
      </section>

      {/* ── Comparison Table ── */}
      <section className="border-b border-gray-800">
        <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
            How We Compare
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-gray-400">
            PayJarvis follows the same Zero-Knowledge principles as the
            most trusted privacy tools in the world.
          </p>

          <div className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-2xl border border-gray-800">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/70">
                  <th className="px-6 py-4 font-semibold text-gray-200">Feature</th>
                  <th className="px-4 py-4 font-semibold text-emerald-400 text-center">PayJarvis</th>
                  <th className="px-4 py-4 font-semibold text-gray-200 text-center">Signal</th>
                  <th className="px-4 py-4 font-semibold text-gray-200 text-center">ProtonMail</th>
                  <th className="px-4 py-4 font-semibold text-gray-200 text-center">1Password</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {[
                  { feature: "Zero-Knowledge Architecture", pj: true, signal: true, proton: true, onepass: true },
                  { feature: "End-to-End Encryption", pj: true, signal: true, proton: true, onepass: true },
                  { feature: "User-Held Key", pj: true, signal: false, proton: false, onepass: true },
                  { feature: "Financial Data Protection", pj: true, signal: false, proton: false, onepass: false },
                  { feature: "AI Agent Commerce", pj: true, signal: false, proton: false, onepass: false },
                  { feature: "Credential Vault", pj: true, signal: false, proton: false, onepass: true },
                ].map((row) => (
                  <tr key={row.feature} className="transition-colors hover:bg-gray-900/30">
                    <td className="px-6 py-3.5 font-medium text-gray-200">{row.feature}</td>
                    <td className="px-4 py-3.5 text-center">{row.pj ? <span className="text-emerald-400">&#10003;</span> : <span className="text-gray-600">&mdash;</span>}</td>
                    <td className="px-4 py-3.5 text-center">{row.signal ? <span className="text-emerald-400">&#10003;</span> : <span className="text-gray-600">&mdash;</span>}</td>
                    <td className="px-4 py-3.5 text-center">{row.proton ? <span className="text-emerald-400">&#10003;</span> : <span className="text-gray-600">&mdash;</span>}</td>
                    <td className="px-4 py-3.5 text-center">{row.onepass ? <span className="text-emerald-400">&#10003;</span> : <span className="text-gray-600">&mdash;</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-10 text-center">
            <div className="inline-flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-8 py-4">
              <ShieldIcon className="h-8 w-8 text-emerald-400" />
              <div className="text-left">
                <div className="text-sm font-bold text-emerald-300">Zero-Knowledge Certified</div>
                <div className="text-xs text-gray-400">Your data, your keys, your control</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Technical Details ── */}
      <section className="border-b border-gray-800 bg-gradient-to-b from-gray-950 to-gray-900/50">
        <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
            Under the Hood
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-gray-400">
            For the technically inclined — here is exactly what powers our
            security.
          </p>

          <div className="mx-auto mt-12 max-w-3xl">
            <div className="overflow-hidden rounded-2xl border border-gray-800">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/70">
                    <th className="px-6 py-4 font-semibold text-gray-200">
                      Component
                    </th>
                    <th className="px-6 py-4 font-semibold text-gray-200">
                      Implementation
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  <TechRow
                    component="Key Derivation"
                    detail="PBKDF2 with 100,000 iterations and SHA-512"
                  />
                  <TechRow
                    component="Symmetric Encryption"
                    detail="AES-256-GCM with random IV per operation"
                  />
                  <TechRow
                    component="Authentication Tags"
                    detail="GCM mode provides built-in integrity verification"
                  />
                  <TechRow
                    component="Salt Strategy"
                    detail="Cryptographically random, unique salt per user"
                  />
                  <TechRow
                    component="Data in Transit"
                    detail="HTTPS with TLS 1.3 enforced"
                  />
                  <TechRow
                    component="Password Hashing"
                    detail="bcrypt with adaptive cost factor"
                  />
                  <TechRow
                    component="PIN Storage"
                    detail="Never stored — derived key exists only in client memory"
                  />
                </tbody>
              </table>
            </div>

            <div className="mt-8 rounded-2xl border border-gray-800 bg-gray-900/30 p-6">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                Why this matters
              </h3>
              <p className="mt-3 text-sm text-gray-400 leading-relaxed">
                Even in the event of a complete database breach, your
                Layer 3 data (cards, credentials, documents) remains
                encrypted with a key derived from your PIN — which we
                never store. An attacker would need to brute-force each
                user&apos;s key individually against 100,000 PBKDF2 iterations,
                making mass decryption computationally infeasible.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="border-b border-gray-800">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
            Frequently Asked Questions
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-gray-400">
            Everything you need to know about how we protect your data.
          </p>

          <div className="mt-12 space-y-6">
            <FaqItem
              question="What happens if I forget my PIN?"
              answer="Since we use true Zero-Knowledge encryption, we do NOT store your PIN or encryption key. If you forget your PIN, your Layer 3 sensitive data (payment cards, stored credentials, documents) cannot be recovered — by you or by us. This is by design: it guarantees that no one else can ever access your data. You can reset your PIN, but previously encrypted data will be lost. We recommend storing your PIN securely."
            />
            <FaqItem
              question="Can you see my data?"
              answer="It depends on the layer. Layer 1 (name, email) — yes, we need this to provide the service. Layer 2 (conversations, preferences) — encrypted with our server key, accessible to our systems for service delivery. Layer 3 (cards, credentials, documents) — absolutely not. This data is encrypted with a key derived from YOUR PIN, which we never see or store. We literally cannot decrypt it."
            />
            <FaqItem
              question="What if your server gets hacked?"
              answer="In the worst case of a complete database breach, your Layer 3 data remains encrypted with your personal key. An attacker would need to brute-force each user's encryption key individually against 100,000 PBKDF2 iterations — making mass decryption computationally infeasible. Your most sensitive data stays safe even in a breach scenario."
            />
            <FaqItem
              question="How is this different from regular encryption?"
              answer="Most services encrypt your data with THEIR key — meaning they (or a hacker who steals their key) can decrypt everything. PayJarvis uses YOUR PIN to derive the encryption key for sensitive data. We never see the key, never store it, and cannot reconstruct it. This is called Zero-Knowledge encryption — the same principle used by Signal, ProtonMail, and 1Password."
            />
            <FaqItem
              question="Is my data safe during transit?"
              answer="Yes. All data in transit is protected by HTTPS with TLS 1.3 enforced. Combined with AES-256-GCM at rest and Zero-Knowledge for sensitive items, there are no gaps in the protection chain."
            />
          </div>
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <section>
        <div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10">
              <ShieldIcon className="h-6 w-6 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Security is not a feature. It&apos;s the foundation.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-gray-400">
              Read more about how we handle your data and the terms of our
              service.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/privacy"
                className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900 px-6 py-3 text-sm font-medium text-gray-200 transition-colors hover:border-gray-600 hover:bg-gray-800"
              >
                Privacy Policy
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
                    d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                  />
                </svg>
              </Link>
              <Link
                href="/terms"
                className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900 px-6 py-3 text-sm font-medium text-gray-200 transition-colors hover:border-gray-600 hover:bg-gray-800"
              >
                Terms of Service
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
                    d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                  />
                </svg>
              </Link>
            </div>
          </div>

          <div className="mt-12 border-t border-gray-800 pt-8 text-center text-sm text-gray-500">
            <p>
              <Link
                href="/"
                className="text-gray-400 underline underline-offset-2 transition-colors hover:text-gray-200"
              >
                Return to PayJarvis
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

/* ── Helper Components ── */

function StepCard({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description: string;
}) {
  return (
    <div className="group relative rounded-2xl border border-gray-800 bg-gray-900/50 p-6 transition-colors hover:border-emerald-500/30 hover:bg-gray-900/80">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-sm font-bold text-emerald-400">
        {step}
      </div>
      <h3 className="text-lg font-semibold text-gray-100">{title}</h3>
      <p className="mt-2 text-sm text-gray-400 leading-relaxed">
        {description}
      </p>
    </div>
  );
}

function LayerCard({
  layer,
  label,
  color,
  title,
  items,
  description,
}: {
  layer: number;
  label: string;
  color: "blue" | "amber" | "emerald";
  title: string;
  items: string[];
  description: string;
}) {
  const colorMap = {
    blue: {
      border: "border-blue-500/20",
      bg: "bg-blue-500/5",
      badge: "bg-blue-500/10 text-blue-300 border-blue-500/20",
      dot: "bg-blue-400",
      number: "text-blue-400",
    },
    amber: {
      border: "border-amber-500/20",
      bg: "bg-amber-500/5",
      badge: "bg-amber-500/10 text-amber-300 border-amber-500/20",
      dot: "bg-amber-400",
      number: "text-amber-400",
    },
    emerald: {
      border: "border-emerald-500/20",
      bg: "bg-emerald-500/5",
      badge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
      dot: "bg-emerald-400",
      number: "text-emerald-400",
    },
  };

  const c = colorMap[color];

  return (
    <div
      className={`rounded-2xl border ${c.border} ${c.bg} p-6 sm:p-8 transition-colors`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <div className="flex items-center gap-3 sm:min-w-[200px]">
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900/80 text-sm font-bold ${c.number}`}
          >
            {layer}
          </span>
          <div>
            <span
              className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${c.badge}`}
            >
              {label}
            </span>
            <h3 className="mt-1 font-semibold text-gray-100">{title}</h3>
          </div>
        </div>
        <div className="flex-1">
          <div className="mb-3 flex flex-wrap gap-2">
            {items.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-1.5 text-sm text-gray-300"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${c.dot}`}
                />
                {item}
              </span>
            ))}
          </div>
          <p className="text-sm text-gray-400 leading-relaxed">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 transition-colors hover:border-emerald-500/20 hover:bg-gray-900/80">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-gray-700 bg-gray-800/50">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-gray-100">{title}</h3>
      <p className="mt-2 text-sm text-gray-400 leading-relaxed">
        {description}
      </p>
    </div>
  );
}

function TechRow({
  component,
  detail,
}: {
  component: string;
  detail: string;
}) {
  return (
    <tr className="transition-colors hover:bg-gray-900/30">
      <td className="px-6 py-4 font-medium text-gray-200">{component}</td>
      <td className="px-6 py-4 text-gray-400">
        <code className="rounded bg-gray-800/80 px-2 py-0.5 text-xs text-emerald-300">
          {detail}
        </code>
      </td>
    </tr>
  );
}

function FaqItem({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  return (
    <details className="group rounded-2xl border border-gray-800 bg-gray-900/30 transition-colors hover:border-gray-700">
      <summary className="flex cursor-pointer items-center justify-between px-6 py-5 text-lg font-semibold text-gray-100 [&::-webkit-details-marker]:hidden">
        {question}
        <svg
          className="h-5 w-5 shrink-0 text-gray-500 transition-transform group-open:rotate-180"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="border-t border-gray-800 px-6 py-5 text-sm text-gray-400 leading-relaxed">
        {answer}
      </div>
    </details>
  );
}
