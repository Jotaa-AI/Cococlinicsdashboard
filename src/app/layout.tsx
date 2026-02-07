import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Coco Clinics | Dashboard",
  description: "Dashboard interno para clínica estética",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
