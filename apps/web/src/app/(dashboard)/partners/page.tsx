"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

export default function PartnersPage() {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    company: "",
    website: "",
    volume: "",
    email: "",
  });
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden px-6 py-24 text-center">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-600/20 via-transparent to-purple-600/10" />
        <div className="relative mx-auto max-w-3xl">
          <div className="mb-4 inline-block rounded-full bg-brand-600/20 px-4 py-1 text-sm text-brand-400">
            {t("partners.badge")}
          </div>
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
            {t("partners.title")}{" "}
            <span className="text-brand-400">{t("partners.titleHighlight")}</span>
          </h1>
          <p className="mt-6 text-lg text-gray-400">
            {t("partners.subtitle")}
          </p>
        </div>
      </section>

      {/* The Problem */}
      <section className="mx-auto max-w-4xl px-6 py-16">
        <h2 className="mb-6 text-2xl font-bold">{t("partners.problemTitle")}</h2>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-8">
          <p className="text-lg leading-relaxed text-gray-300">
            {t("partners.problemDesc")}
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              { num: t("partners.stat1Num"), label: t("partners.stat1Label") },
              { num: t("partners.stat2Num"), label: t("partners.stat2Label") },
              { num: t("partners.stat3Num"), label: t("partners.stat3Label") },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl font-bold text-red-400">{stat.num}</div>
                <div className="mt-1 text-sm text-gray-500">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The Solution */}
      <section className="mx-auto max-w-4xl px-6 py-16">
        <h2 className="mb-6 text-2xl font-bold">{t("partners.solutionTitle")}</h2>
        <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-8">
          <div className="grid gap-8 sm:grid-cols-3">
            {[
              {
                icon: (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                  />
                ),
                title: t("partners.sol1Title"),
                desc: t("partners.sol1Desc"),
              },
              {
                icon: (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
                  />
                ),
                title: t("partners.sol2Title"),
                desc: t("partners.sol2Desc"),
              },
              {
                icon: (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 4.5c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H14.23c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904M14.25 9h2.25M5.904 18.75c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 01-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 10.62 4.26 10.5 4.904 10.5c.448 0 .72.498.523.898a8.963 8.963 0 00-.723 3.477 8.963 8.963 0 001.2 3.875z"
                  />
                ),
                title: t("partners.sol3Title"),
                desc: t("partners.sol3Desc"),
              },
            ].map((item) => (
              <div key={item.title} className="text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600/20">
                  <svg
                    className="h-6 w-6 text-brand-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    {item.icon}
                  </svg>
                </div>
                <h3 className="font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm text-gray-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How to Integrate */}
      <section className="mx-auto max-w-4xl px-6 py-16">
        <h2 className="mb-8 text-2xl font-bold">{t("partners.howTitle")}</h2>
        <div className="space-y-6">
          {[
            {
              step: "1",
              title: t("partners.how1Title"),
              code: "npm install @payjarvis/verify-sdk",
              desc: t("partners.how1Desc"),
            },
            {
              step: "2",
              title: t("partners.how2Title"),
              code: `const result = await verifyBdit({
  token: req.headers['x-bdit-token'],
  merchantId: 'your-merchant-id'
})`,
              desc: t("partners.how2Desc"),
            },
            {
              step: "3",
              title: t("partners.how3Title"),
              code: `if (result.verified) {
  // Bot authorized — allow checkout
  // Display: "Verified Bot — Trust Score: 94/100"
}`,
              desc: "",
            },
          ].map((item) => (
            <div
              key={item.step}
              className="flex gap-6 rounded-xl border border-gray-200 bg-white p-6"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-bold">
                {item.step}
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold">{item.title}</h3>
                {item.desc && <p className="mt-1 text-sm text-gray-400">{item.desc}</p>}
                <pre className="mt-3 overflow-x-auto rounded-lg bg-gray-900 p-4 text-sm text-green-400">
                  {item.code}
                </pre>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Benefits */}
      <section className="mx-auto max-w-4xl px-6 py-16">
        <h2 className="mb-8 text-2xl font-bold">{t("partners.benefitsTitle")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { title: t("partners.ben1Title"), desc: t("partners.ben1Desc") },
            { title: t("partners.ben2Title"), desc: t("partners.ben2Desc") },
            { title: t("partners.ben3Title"), desc: t("partners.ben3Desc") },
            { title: t("partners.ben4Title"), desc: t("partners.ben4Desc") },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-gray-200 bg-white p-6"
            >
              <div className="mb-2 text-lg font-semibold text-brand-400">
                &#10003; {item.title}
              </div>
              <p className="text-sm text-gray-400">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Form */}
      <section className="mx-auto max-w-2xl px-6 py-16">
        <h2 className="mb-8 text-center text-2xl font-bold">
          {t("partners.formTitle")}
        </h2>

        {submitted ? (
          <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-8 text-center">
            <div className="mb-2 text-4xl">&#10003;</div>
            <h3 className="text-xl font-semibold text-green-400">
              {t("partners.thankYou")}
            </h3>
            <p className="mt-2 text-gray-400">
              {t("partners.thankYouDesc")}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">
                {t("partners.companyName")}
              </label>
              <input
                type="text"
                required
                value={formData.company}
                onChange={(e) =>
                  setFormData({ ...formData, company: e.target.value })
                }
                className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder-gray-500 outline-none focus:border-brand-500"
                placeholder={t("partners.companyPlaceholder")}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">
                {t("partners.website")}
              </label>
              <input
                type="url"
                required
                value={formData.website}
                onChange={(e) =>
                  setFormData({ ...formData, website: e.target.value })
                }
                className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder-gray-500 outline-none focus:border-brand-500"
                placeholder="https://www.example.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">
                {t("partners.email")}
              </label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder-gray-500 outline-none focus:border-brand-500"
                placeholder="contact@example.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">
                {t("partners.volume")}
              </label>
              <select
                required
                value={formData.volume}
                onChange={(e) =>
                  setFormData({ ...formData, volume: e.target.value })
                }
                className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-900 outline-none focus:border-brand-500"
              >
                <option value="">{t("partners.volumeSelect")}</option>
                <option value="<1000">{t("partners.volume1")}</option>
                <option value="1000-10000">{t("partners.volume2")}</option>
                <option value="10000-100000">{t("partners.volume3")}</option>
                <option value="100000+">{t("partners.volume4")}</option>
              </select>
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-brand-600 px-6 py-3 font-semibold text-gray-900 transition-colors hover:bg-brand-500"
            >
              {t("partners.submitButton")}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
