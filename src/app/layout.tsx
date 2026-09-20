import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HavenPath NY",
  description: "Compare NYC walking routes by estimated environmental exposure: air, traffic, shade, heat and tree pollen.",
  applicationName: "HavenPath NY",
  appleWebApp: { capable: true, title: "HavenPath NY", statusBarStyle: "black-translucent" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="web-layout neo-theme">{children}</body>
    </html>
  );
}
