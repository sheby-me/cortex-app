import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CortexBrand } from "@/components/cortex-logo";

/** Shared shell for the Privacy and Terms pages. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <Link to="/" aria-label="Cortex home">
            <CortexBrand />
          </Link>
          <Link to="/auth" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="font-display text-4xl tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated {updated}</p>
        <div className="mt-8 space-y-5 text-[15px] leading-relaxed text-foreground/90 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
          {children}
        </div>
      </main>
    </div>
  );
}
