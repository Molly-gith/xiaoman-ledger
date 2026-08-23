import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { PwaRegister } from "./pwa-register";
import "./globals.css";
import "./interactions.css";

export const viewport: Viewport = { themeColor: "#176b4c", width: "device-width", initialScale: 1, viewportFit: "cover" };

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("host") ?? "localhost:3000";
  const base = `${host.includes("localhost") ? "http" : "https"}://${host}`;
  const title = "小满账本｜语音也能轻松记账";
  const description = "随口说一句就能记账，轻松掌握收支、预算和存款目标。";
  return {
    title,
    description,
    applicationName: "小满账本",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, statusBarStyle: "default", title: "小满账本" },
    icons: { icon: "/app-icon-192.png", apple: "/apple-touch-icon.png" },
    openGraph: { title, description, type: "website", images: [{ url: `${base}/og.png`, width: 1792, height: 928, alt: "小满账本" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${base}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><PwaRegister />{children}</body></html>;
}

