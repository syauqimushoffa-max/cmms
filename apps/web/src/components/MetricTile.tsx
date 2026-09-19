import { ChevronRight, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

export function MetricTile({
  icon: Icon,
  label,
  value,
  tone = "default",
  to
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  tone?: "default" | "warning" | "danger" | "success";
  to?: string;
}) {
  const content = (
    <>
      <div className="metric-icon">
        <Icon size={20} aria-hidden="true" />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      {to ? <ChevronRight className="metric-tile-chevron" size={18} aria-hidden="true" /> : null}
    </>
  );

  return to
    ? <Link className={`metric-tile metric-${tone} metric-tile-link`} to={to} aria-label={`${label}: ${value}. Open details.`}>{content}</Link>
    : <div className={`metric-tile metric-${tone}`}>{content}</div>;
}
