import { ChevronRight, History, Package, ShieldCheck, UserRound } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { useCurrentUser } from "../state/UserContext";

const moreItems = [
  { to: "/technician/history", icon: History, title: "Work History", description: "Find completed repairs and review your team’s maintenance records.", tone: "history" },
  {
    to: "/preventive-maintenance",
    icon: ShieldCheck,
    title: "Preventive Maintenance",
    description: "View scheduled PM work and complete assigned checklists.",
    tone: "pm"
  },
  {
    to: "/profile",
    icon: UserRound,
    title: "My Profile",
    description: "Check your account, department, plant access, and profile photo.",
    tone: "profile"
  }
];

export function TechnicianMorePage() {
  const { currentUser } = useCurrentUser();
  if (currentUser?.role === "requester") return <Navigate to="/work-orders" replace />;

  return (
    <section className="page-stack technician-page technician-more-page">
      <div className="page-title-row">
        <div><p className="eyebrow">Maintenance workspace</p><h1>More</h1></div>
        <span className="technician-more-team"><Package size={16} />{currentUser?.department || "Technician"}</span>
      </div>

      <div className="technician-more-grid">
        {moreItems.map((item) => (
          <Link key={item.to} to={item.to} className={`technician-more-card tone-${item.tone}`}>
            <span className="technician-more-icon"><item.icon size={23} /></span>
            <span><strong>{item.title}</strong><small>{item.description}</small></span>
            <ChevronRight size={20} />
          </Link>
        ))}
      </div>
    </section>
  );
}
