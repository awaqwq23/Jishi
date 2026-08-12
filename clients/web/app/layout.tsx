import type { Metadata } from "next";
import { Noto_Sans_SC, ZCOOL_XiaoWei } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const notoSans = Noto_Sans_SC({
  variable: "--font-noto-sans",
  subsets: ["latin"],
});

const zcool = ZCOOL_XiaoWei({
  variable: "--font-zcool",
  weight: "400",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const description = "简洁、同步、跨设备的待办事项与提醒工具。";
  return {
    metadataBase: new URL(origin),
    title: "记时 · 把今天安放好",
    description,
    manifest: "/manifest.webmanifest",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    appleWebApp: { capable: true, title: "记时", statusBarStyle: "default" },
    openGraph: { title: "记时", description, type: "website", images: [{ url: `${origin}/og.png`, width: 1734, height: 909, alt: "记时 · 把今天安放得刚刚好" }] },
    twitter: { card: "summary_large_image", title: "记时", description, images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${notoSans.variable} ${zcool.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
