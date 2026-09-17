import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { PwaRegister } from "./pwa-register";
import "./globals.css";
import "./interactions.css";
import "./storybook.css";
import "./conversation.css";
import "./v3-navigation.css";

export const viewport: Viewport = { themeColor: "#176b4c", width: "device-width", initialScale: 1, viewportFit: "cover" };

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("host") ?? "localhost:3000";
  const base = `${host.includes("localhost") ? "http" : "https"}://${host}`;
  const title = "小满｜你的个人财务助手";
  const description = "用对话理解收入、消费、投资与资产变化，并保留简单可靠的记账和财务看板。";
  return {
    title,
    description,
    applicationName: "小满",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, statusBarStyle: "default", title: "小满" },
    icons: { icon: "/app-icon-192.png", apple: "/apple-touch-icon.png" },
    openGraph: { title, description, type: "website", images: [{ url: `${base}/og.png`, width: 1792, height: 928, alt: "小满｜你的个人财务助手" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${base}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><PwaRegister />{children}</body></html>;
}
