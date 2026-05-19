import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Room",
  description: "A collaborative room for human and AI participants.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}