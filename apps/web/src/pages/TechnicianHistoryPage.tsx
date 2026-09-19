import { CheckCircle2, History, Search, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { workOrderTypeLabels } from "@pbs-cmms/shared";
import { PriorityBadge, StatusBadge } from "../components/Badges";
import { EmptyState } from "../components/EmptyState";
import { useCurrentUser } from "../state/UserContext";
import { formatDateTime } from "../utils/format";

export function TechnicianHistoryPage() {
  const { users, currentUser, workOrders, workOrdersReady } = useCurrentUser();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | "maintenance" | "office" | "kaizen" | "project">("all");

  const history = useMemo(() => workOrders.filter((workOrder) => {
    if (!["resolved", "closed"].includes(workOrder.status)) return false;
    if (type !== "all" && workOrder.type !== type) return false;
    const haystack = `${workOrder.number} ${workOrder.title} ${workOrder.issueDescription} ${workOrder.location} ${workOrder.machineName}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  }), [search, type, workOrders]);

  if (currentUser?.role === "requester") return <Navigate to="/work-orders" replace />;

  return (
    <section className="page-stack technician-page technician-history-page">
      <div className="page-title-row">
        <div><p className="eyebrow">Shared team record</p><h1>Work History</h1></div>
        <span className="technician-history-total"><UsersRound size={16} />{history.length} completed</span>
      </div>

      <div className="technician-history-filters">
        <label><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search completed work" /></label>
        <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
          <option value="all">All visible work</option>
          <option value="maintenance">Maintenance</option>
          <option value="office">Office</option>
          <option value="kaizen">Kaizen</option>
          <option value="project">Projects</option>
        </select>
      </div>

      {!workOrdersReady ? <p className="quiet-panel">Loading team history…</p> : history.length > 0 ? (
        <div className="technician-history-table">
          {history.map((workOrder) => {
            const owner = users.find((user) => user.id === workOrder.assignedToId)?.name || "Unassigned";
            return (
              <Link key={workOrder.id} to={`/work-orders/${workOrder.id}`}>
                <span className="technician-history-icon"><CheckCircle2 size={18} /></span>
                <span className="technician-history-main"><strong>{workOrder.number} · {workOrder.title}</strong><small>{workOrder.machineName || workOrder.assetName} · {workOrder.location}</small></span>
                <span className="technician-history-owner"><small>Completed by</small><strong>{owner}</strong></span>
                <span className="technician-history-meta"><StatusBadge status={workOrder.status} /><PriorityBadge priority={workOrder.priority} /><small>{workOrderTypeLabels[workOrder.type]} · {formatDateTime(workOrder.updatedAt)}</small></span>
              </Link>
            );
          })}
        </div>
      ) : <EmptyState icon={History} title="No completed work found" text="Try another search or work-order type." />}
    </section>
  );
}
