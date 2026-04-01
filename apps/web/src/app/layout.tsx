import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { I18nProvider } from "@/components/i18n-provider";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { PwaInstallBanner } from "@/components/pwa-install-banner";
import "./globals.css";

export const metadata: Metadata = {
  title: "PayJarvis — Agente de Compras Inteligente",
  description: "Acha o melhor preço, compara, monitora e compra pra você",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "PayJarvis — Agente de Compras Inteligente",
    description: "Acha o melhor preço, compara, monitora e compra pra você",
    images: ["/og-image.png"],
    siteName: "PayJarvis",
  },
  other: {
    "theme-color": "#00BFFF",
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
          <meta name="theme-color" content="#00BFFF" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          <meta name="apple-mobile-web-app-title" content="Jarvis" />
          <meta name="application-name" content="Jarvis" />
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
