import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Coco Clinics | Dashboard",
  description: "Dashboard interno para clínica estética",
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
