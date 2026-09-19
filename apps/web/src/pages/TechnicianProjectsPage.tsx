import { CalendarClock, CheckCircle2, FolderKanban, UserRoundCheck, UsersRound } from "lucide-react";
import { useMemo } from "react";
import { Link, Navigate } from "react-router-dom";
import type { WorkOrder } from "@pbs-cmms/shared";
import { workOrderStatusLabels } from "@pbs-cmms/shared";
import { PriorityBadge, StatusBadge } from "../components/Badges";
import { EmptyState } from "../components/EmptyState";
import { useCurrentUser } from "../state/UserContext";
import { formatDateTime } from "../utils/format";

function isComplete(workOrder: WorkOrder) {
  return ["resolved", "closed", "cancelled"].includes(workOrder.status);
}

export function TechnicianProjectsPage() {
  const { users, currentUser, workOrders, workOrdersReady } = useCurrentUser();
  const projects = useMemo(() => workOrders.filter((workOrder) => workOrder.type === "project"), [workOrders]);
  const activeProjects = useMemo(() => projects.filter((workOrder) => !isComplete(workOrder)), [projects]);
  const completedProjects = useMemo(() => projects.filter((workOrder) => isComplete(workOrder)), [projects]);

  if (currentUser?.role === "requester") return <Navigate to="/work-orders" replace />;

  function ownerName(id: string | null) {
    return users.find((user) => user.id === id)?.name || "Not assigned";
  }

  function projectCard(project: WorkOrder) {
    const isMine = project.assignedToId === currentUser?.id;
    return (
      <article className={`technician-project-card technician-status-${project.status}`} key={project.id}>
        <div className="card-topline">
          <strong>{project.number}</strong>
          <StatusBadge status={project.status} />
        </div>
        <div className="technician-project-title">
          <span><FolderKanban size={20} /></span>
          <div><h2>{project.title}</h2><p>{project.location} · {project.machineName || project.assetName}</p></div>
        </div>
        <div className="technician-project-owner">
          {project.assignedToId ? <UserRoundCheck size={17} /> : <UsersRound size={17} />}
          <span><small>{project.assignedToId ? "Project lead" : "Coordinator action"}</small><strong>{ownerName(project.assignedToId)}{isMine ? " · You" : ""}</strong></span>
        </div>
        <div className="technician-project-meta">
          <PriorityBadge priority={project.priority} />
          <span><CalendarClock size={14} />{project.dueDate ? `Due ${project.dueDate}` : "Schedule not set"}</span>
          <span>{workOrderStatusLabels[project.status]}</span>
        </div>
        {!project.assignedToId && !isComplete(project) ? <p className="technician-project-note">Projects are assigned by a coordinator. Accepting is not used and working time starts only when the assigned lead selects Start Work.</p> : null}
        <Link to={`/work-orders/${project.id}`}>{isMine ? "Open my project" : "View project"}</Link>
      </article>
    );
  }

  return (
    <section className="page-stack technician-page technician-projects-page">
      <div className="page-title-row">
        <div><p className="eyebrow">Planned collaboration</p><h1>Projects</h1></div>
        <span className="technician-live-version"><i />Live Sync</span>
      </div>

      <div className="technician-project-summary">
        <article><FolderKanban size={19} /><span>Active projects</span><strong>{activeProjects.length}</strong></article>
        <article><UserRoundCheck size={19} /><span>Assigned to me</span><strong>{activeProjects.filter((project) => project.assignedToId === currentUser?.id).length}</strong></article>
        <article><CheckCircle2 size={19} /><span>Completed</span><strong>{completedProjects.length}</strong></article>
      </div>

      {!workOrdersReady ? <p className="quiet-panel">Loading projects…</p> : activeProjects.length > 0 ? <div className="technician-project-grid">{activeProjects.map(projectCard)}</div> : <EmptyState icon={FolderKanban} title="No active projects" text="Projects visible to Maintenance and Kaizen will appear here after they are issued." />}

      {completedProjects.length > 0 ? (
        <section className="technician-job-section">
          <div className="technician-section-heading"><div><p className="eyebrow">Project archive</p><h2>Completed Projects</h2></div><span>{completedProjects.length}</span></div>
          <div className="technician-project-grid">{completedProjects.slice(0, 6).map(projectCard)}</div>
        </section>
      ) : null}
    </section>
  );
}
