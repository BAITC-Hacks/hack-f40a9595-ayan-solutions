import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Graph Money | Аналитика финансовой сети",
  description: "Рабочее пространство анализа обезличенной транзакционной сети",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
