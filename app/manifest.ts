import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "小满账本",
    short_name: "小满账本",
    description: "用语音或文字快速记账，管理收支、预算和存款目标。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fbfcf9",
    theme_color: "#176b4c",
    orientation: "portrait",
    icons: [
      { src: "/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

