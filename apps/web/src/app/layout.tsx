import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "PayJarvis — Bot Payment Identity",
  description: "Trust and identity layer for payment bots",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="pt-BR" className="dark">
        <body className="bg-surface text-gray-100 antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
