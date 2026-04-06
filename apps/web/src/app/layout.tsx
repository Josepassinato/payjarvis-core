import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { I18nProvider } from "@/components/i18n-provider";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { PwaInstallBanner } from "@/components/pwa-install-banner";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.payjarvis.com"),
  title: "PayJarvis — Spending Firewall for AI Agents | Open-source",
  description: "Open-source spending firewall for autonomous AI agents. BDIT cryptographic identity, CredScore behavioral trust, and granular policy control. Self-hosted or Hosted SaaS.",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "PayJarvis — Spending Firewall for AI Agents",
    description: "Control how your AI agents spend money. Open-source under Apache 2.0.",
    images: ["https://www.payjarvis.com/og-image.png"],
    url: "https://www.payjarvis.com",
    siteName: "PayJarvis",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PayJarvis — Spending Firewall for AI Agents",
    description: "Control how your AI agents spend money. Open-source under Apache 2.0.",
    images: ["https://www.payjarvis.com/og-image.png"],
  },
  other: {
    "theme-color": "#f59e0b",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "application-name": "PayJarvis",
    "apple-mobile-web-app-title": "PayJarvis",
  },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en" className="dark">
        <head>
          <link rel="icon" href="/favicon.ico" sizes="32x32" />
          <link rel="icon" type="image/png" href="/icon-192.png" sizes="192x192" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
          <meta name="theme-color" content="#f59e0b" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          <meta name="apple-mobile-web-app-title" content="PayJarvis" />
          <meta name="application-name" content="PayJarvis" />
        </head>
        <body className="bg-surface text-gray-100 antialiased font-body">
          <I18nProvider>
            {children}
          </I18nProvider>
          <ServiceWorkerRegister />
          <PwaInstallBanner />
        </body>
      </html>
    </ClerkProvider>
  );
}
