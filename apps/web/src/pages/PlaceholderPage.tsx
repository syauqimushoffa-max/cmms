import { Construction } from "lucide-react";

export function PlaceholderPage({ title, module }: { title: string; module: string }) {
  return (
    <section className="page-stack">
      <div className="page-title-row">
        <div>
          <p className="eyebrow">Foundation placeholder</p>
          <h1>{title}</h1>
        </div>
      </div>

      <div className="placeholder-panel">
        <Construction size={36} aria-hidden="true" />
        <div>
          <h2>{module}</h2>
          <p>This module is parked here so the CMMS has the right structure before we build it properly.</p>
        </div>
      </div>
    </section>
  );
}
