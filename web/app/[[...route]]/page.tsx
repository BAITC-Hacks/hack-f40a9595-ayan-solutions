import { Suspense } from "react";
import AppShell from "@/components/app-shell";
export default function Page() {
  return (
    <Suspense fallback={<main className="loading">Загрузка Graph Money…</main>}>
      <AppShell />
    </Suspense>
  );
}
