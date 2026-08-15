import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "画像一括リサイズ・圧縮ツール",
    template: "%s | 画像一括リサイズ・圧縮ツール",
  },
  description:
    "大量画像のリサイズ・圧縮・形式変換・クロップ・リネーム・メタデータ処理を、ローカルファーストのBatch Workflowで自動化します。",
  applicationName: "画像一括リサイズ・圧縮ツール",
  category: "business",
  keywords: [
    "画像リサイズ",
    "画像圧縮",
    "一括変換",
    "Batch Workflow",
    "WebP",
    "ローカル処理",
  ],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light",
  themeColor: "#F5F5F7",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        <a className="skip-link" href="#main-content">
          メインコンテンツへ移動
        </a>
        {children}
      </body>
    </html>
  );
}
