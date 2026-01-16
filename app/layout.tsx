import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice AI Coach",
  description: "A voice-based AI coach for career and academic goals",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

