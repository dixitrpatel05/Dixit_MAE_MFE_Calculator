import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "MAE/MFE Trade Dashboard",
  description: "Personal MAE/MFE analysis workspace for Indian stock market swing and positional trades.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
