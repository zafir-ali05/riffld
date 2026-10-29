import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Riffld",
  description: "Audio guessing game across genres and subgenres.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
