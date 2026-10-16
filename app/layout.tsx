import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BottomNav } from "./nav";
import { RegisterSW } from "./register-sw";

export const metadata: Metadata = {
  title: "OP Master Collector",
  description: "Escanea tus cartas de One Piece TCG y lleva el control de tu colección.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "OP Collector", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0d1b2a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <main className="main">{children}</main>
        <BottomNav />
        <RegisterSW />
      </body>
    </html>
  );
}
