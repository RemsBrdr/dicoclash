import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DicoClash - 60 secondes. 4 indices. 1 champion.",
  description: "Affrontez des adversaires en temps réel dans des duels de vocabulaire",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}