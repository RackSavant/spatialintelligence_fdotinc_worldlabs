import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Marble Hack",
  description: "Photo to edited render to 3D world to furnished scene.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="m-0 h-full bg-black text-white antialiased">{children}</body>
    </html>
  );
}
