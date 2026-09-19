import { AlertTriangle, CheckCircle2, Clock3, Eye, Layers3, Pencil, Plus, Search, Trash2, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { MasterData, User, WorkOrder, WorkOrderStatus } from "@pbs-cmms/shared";
import { workOrderDepartmentForUser, workOrderStatusLabels, workOrderTypeLabels } from "@pbs-cmms/shared";
import { api } from "../api/client";
import { PriorityBadge, StatusBadge } from "../components/Badges";
import { formatDateTime, formatLiveDuration, formatMinutes, userName } from "../utils/format";
import { useCurrentUser } from "../state/UserContext";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

type WorkOrderStatusFilter = WorkOrderStatus | "all" | "active" | "moving" | "waiting";

const statusOptions: WorkOrderStatusFilter[] = [
  "all",
  "active",
  "open",
  "moving",
  "waiting",
  "acknowledged",
  "in_progress",
  "pending_material",
  "resolved",
  "returned",
  "closed",
  "cancelled"
];

const groupedStatusLabels: Record<"active" | "moving" | "waiting", string> = {
  active: "Active work orders",
  moving: "In progress",
  waiting: "Waiting"
};

function matchesStatusFilter(workOrder: WorkOrder, filter: WorkOrderStatusFilter) {
  if (filter === "all") return true;
  if (filter === "active") return !["closed", "cancelled"].includes(workOrder.status);
  if (filter === "moving") return ["acknowledged", "in_progress", "returned"].includes(workOrder.status);
  if (filter === "waiting") return ["pending_material", "resolved"].includes(workOrder.status);
  return workOrder.status === filter;
}

export function WorkOrdersPage() {
  const { users, currentUser } = useCurrentUser();
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [masterData, setMasterData] = useState<MasterData>({ sections: [], machines: [], issueCategories: [] });
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [search, setSearch] = useState(params.get("q") || "");
  const [status, setStatus] = useState<WorkOrderStatusFilter>(statusOptions.includes(params.get("status") as WorkOrderStatusFilter) ? params.get("status") as WorkOrderStatusFilter : "all");
  const [scope, setScope] = useState<"all" | "department" | "mine">(params.get("scope") === "mine" ? "mine" : params.get("scope") === "all" ? "all" : workOrderDepartmentForUser(currentUser?.department || "") ? "department" : "all");
  const [month, setMonth] = useState(params.get("month") || "");
  const [sectionId, setSectionId] = useState(params.get("section") || "all");
  const [machineId, setMachineId] = useState(params.get("machine") || "all");
  const [timerNow, setTimerNow] = useState(() => new Date().toISOString());

  async function loadWorkOrders() {
    try {
      const [orders, master] = await Promise.all([api.workOrders(), api.masterData()]);
      setWorkOrders(orders); setMasterData(master); setLoadError("");
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Couldn’t load work orders."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    loadWorkOrders().catch(console.error);

  }, []);

  useLiveRefresh(["work-orders"], loadWorkOrders);

  useEffect(() => {
    const interval = window.setInterval(() => setTimerNow(new Date().toISOString()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const next = new URLSearchParams();
    if (search) next.set("q", search);
    if (status !== "all") next.set("status", status);
    next.set("scope", scope);
    if (month) next.set("month", month);
    if (sectionId !== "all") next.set("section", sectionId);
    if (machineId !== "all") next.set("machine", machineId);
    setParams(next, { replace: true });
  }, [search, status, scope, month, sectionId, machineId, setParams]);

  const accountDepartment = workOrderDepartmentForUser(currentUser?.department || "");

  const filtered = useMemo(() => {
    return workOrders.filter((workOrder) => {
      const matchesStatus = matchesStatusFilter(workOrder, status);
      const matchesMonth = !month || workOrder.workDate.startsWith(month);
      const matchesSection = sectionId === "all" || workOrder.sectionId === sectionId;
      const matchesMachine =
        machineId === "all" ||
        (machineId === "__others" ? !workOrder.machineId : workOrder.machineId === machineId);
      const matchesScope = scope === "all" ||
        (scope === "department" && (!accountDepartment || workOrder.responsibleDepartment === accountDepartment)) ||
        (scope === "mine" && (workOrder.requesterId === currentUser?.id || workOrder.assignedToId === currentUser?.id));
      const searchable = `${workOrder.number} ${workOrder.title} ${workOrder.description} ${workOrder.location} ${workOrder.area} ${workOrder.assetName} ${workOrder.machineName} ${workOrder.reportedByName} ${workOrder.reportedByDepartment} ${workOrder.responsibleDepartment} ${workOrder.issueDescription}`.toLowerCase();
      return matchesStatus && matchesMonth && matchesSection && matchesMachine && matchesScope && searchable.includes(search.trim().toLowerCase());
    });
  }, [accountDepartment, workOrders, status, month, sectionId, machineId, scope, search, currentUser?.id]);

  const filteredMachines = useMemo(() => {
    return masterData.machines.filter((machine) => sectionId === "all" || machine.sectionId === sectionId);
  }, [masterData.machines, sectionId]);

  const counts = useMemo(() => {
    return {
      active: workOrders.filter((workOrder) => !["closed", "cancelled"].includes(workOrder.status)).length,
      new: workOrders.filter((workOrder) => workOrder.status === "open").length,
      moving: workOrders.filter((workOrder) => ["acknowledged", "in_progress", "returned"].includes(workOrder.status)).length,
      waiting: workOrders.filter((workOrder) => ["pending_material", "resolved"].includes(workOrder.status)).length,
      closed: workOrders.filter((workOrder) => workOrder.status === "closed").length
    };
  }, [workOrders]);
  const requesterMode = currentUser?.role === "requester";
  const canManageWorkOrders = Boolean(currentUser && ["executive", "admin"].includes(currentUser.role));
  const pendingVerification = requesterMode ? filtered.filter((workOrder) => workOrder.status === "resolved") : [];
  const visibleWorkOrders = requesterMode ? filtered.filter((workOrder) => workOrder.status !== "resolved") : filtered;
  const currentWorkOrders = visibleWorkOrders.filter((workOrder) => !["closed", "cancelled"].includes(workOrder.status));
  const closedWorkOrders = visibleWorkOrders.filter((workOrder) => ["closed", "cancelled"].includes(workOrder.status));

  async function removeWorkOrder(workOrder: WorkOrder) {
    if (!currentUser || !["executive", "admin"].includes(currentUser.role)) {
      return;
    }

    const confirmed = window.confirm(`Delete ${workOrder.number}? This permanently removes the work order and uploaded images.`);
    if (!confirmed) {
      return;
    }

    setActionError("");
    try {
      await api.deleteWorkOrder(workOrder.id, { actorId: currentUser.id });
      setWorkOrders((current) => current.filter((item) => item.id !== workOrder.id));
    } catch (error) { setActionError(error instanceof Error ? error.message : "Couldn’t delete this work order."); }
  }

  function selectSummaryStatus(nextStatus: Exclude<WorkOrderStatusFilter, "all">) {
    setStatus((current) => current === nextStatus ? "all" : nextStatus);
  }

  return (
    <section className="page-stack">
      <div className="page-title-row page-title-clean">
        <div>
          <p className="eyebrow">Maintenance queue</p>
          <h1>Work Orders</h1>
        </div>
        {currentUser?.role !== "technician" ? (
          <Link className="primary-action" to="/work-orders/new">
            <Plus size={17} aria-hidden="true" />
            New Work Order
          </Link>
        ) : null}
      </div>

      <div className="queue-ribbon">
        <button type="button" className={status === "active" ? "is-active" : ""} aria-pressed={status === "active"} onClick={() => selectSummaryStatus("active")}>
          <Layers3 size={18} aria-hidden="true" />
          <span>Active</span>
          <strong>{loading ? "—" : counts.active}</strong>
        </button>
        <button type="button" className={status === "open" ? "is-active" : ""} aria-pressed={status === "open"} onClick={() => selectSummaryStatus("open")}>
          <AlertTriangle size={18} aria-hidden="true" />
          <span>New</span>
          <strong>{counts.new}</strong>
        </button>
        <button type="button" className={status === "moving" ? "is-active" : ""} aria-pressed={status === "moving"} onClick={() => selectSummaryStatus("moving")}>
          <Wrench size={18} aria-hidden="true" />
          <span>In progress</span>
          <strong>{counts.moving}</strong>
        </button>
        <button type="button" className={status === "waiting" ? "is-active" : ""} aria-pressed={status === "waiting"} onClick={() => selectSummaryStatus("waiting")}>
          <Clock3 size={18} aria-hidden="true" />
          <span>Waiting</span>
          <strong>{counts.waiting}</strong>
        </button>
        <button type="button" className={status === "closed" ? "is-active" : ""} aria-pressed={status === "closed"} onClick={() => selectSummaryStatus("closed")}>
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>Closed</span>
          <strong>{counts.closed}</strong>
        </button>
      </div>

      <div className="filter-bar">
        <label className="search-input">
          <Search size={17} aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search number, machine or issue…" aria-label="Search work orders" />
        </label>

        <button className="ux-filter-toggle secondary-action" type="button" aria-expanded={filtersOpen} aria-controls="work-order-filters" onClick={() => setFiltersOpen(!filtersOpen)}>{filtersOpen ? "Hide filters" : "Filter work orders"}{[status !== "all", Boolean(month), sectionId !== "all", machineId !== "all", scope !== "all"].filter(Boolean).length ? ` (${[status !== "all", Boolean(month), sectionId !== "all", machineId !== "all", scope !== "all"].filter(Boolean).length})` : ""}</button>
        <div id="work-order-filters" className={`ux-extra-filters ${filtersOpen ? "is-open" : ""}`}>
        <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value as WorkOrderStatusFilter)}>
          {statusOptions.map((option) => (
            <option key={option} value={option}>
              {option === "all" ? "All statuses" : option in groupedStatusLabels ? groupedStatusLabels[option as keyof typeof groupedStatusLabels] : workOrderStatusLabels[option as WorkOrderStatus]}
            </option>
          ))}
        </select>

        <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} aria-label="Filter by month" />

        <select aria-label="Filter by section" value={sectionId} onChange={(event) => {
          setSectionId(event.target.value);
          setMachineId("all");
        }}>
          <option value="all">All sections</option>
          {masterData.sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.name}
            </option>
          ))}
        </select>

        <select aria-label="Filter by machine" value={machineId} onChange={(event) => setMachineId(event.target.value)}>
          <option value="all">All machines</option>
          <option value="__others">Others</option>
          {filteredMachines.map((machine) => (
            <option key={machine.id} value={machine.id}>
              {machine.name}
            </option>
          ))}
        </select>

        <div className="segmented-control">
          {accountDepartment ? (
            <button type="button" className={scope === "department" ? "active" : ""} onClick={() => setScope("department")}>
              {accountDepartment}
            </button>
          ) : null}
            <button type="button" className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>
              All
            </button>
            <button type="button" className={scope === "mine" ? "active" : ""} onClick={() => setScope("mine")}>
              Mine
            </button>
        </div>
        </div>
      </div>

      <div className="ux-results-bar">
        <span role="status">{loading ? "Loading work orders…" : filtered.length + " of " + workOrders.length + " work orders"}</span>
        <button className="secondary-action" type="button" onClick={() => { setSearch(""); setStatus("all"); setMonth(""); setSectionId("all"); setMachineId("all"); setScope("all"); }}>Reset filters</button>
      </div>
      {loadError ? <div className="ux-load-error" role="alert"><span>Couldn’t refresh work orders. {loadError} {workOrders.length ? "Showing the last loaded information." : ""}</span><button type="button" className="secondary-action" onClick={() => void loadWorkOrders()}>Try again</button></div> : null}
      {actionError ? <p className="error-line" role="alert">{actionError}</p> : null}
      {requesterMode ? (
        <section className="requester-subsection">
          <div className="subsection-heading">
            <div>
              <h2>Pending Verification</h2>
              <span>{pendingVerification.length} waiting for requester decision</span>
            </div>
          </div>
          {pendingVerification.length > 0 ? (
            <div className="work-order-grid">
              {pendingVerification.map((workOrder) => (
                <WorkOrderCard
                  key={workOrder.id}
                  workOrder={workOrder}
                  users={users}
                  currentUserId={currentUser?.id}
                  timerNow={timerNow}
                  canManage={canManageWorkOrders}
                  onDelete={removeWorkOrder}
                />
              ))}
            </div>
          ) : (
            <p className="quiet-panel">No resolved work orders waiting for verification.</p>
          )}
        </section>
      ) : null}

      <section className="requester-subsection">
        {requesterMode ? (
          <div className="subsection-heading">
            <div>
              <h2>Other Issued Work Orders</h2>
              <span>{currentWorkOrders.length} active · {closedWorkOrders.length} completed</span>
            </div>
          </div>
        ) : null}
        {currentWorkOrders.length ? <div className="work-order-grid">
          {currentWorkOrders.map((workOrder) => (
            <WorkOrderCard
              key={workOrder.id}
              workOrder={workOrder}
              users={users}
              currentUserId={currentUser?.id}
              timerNow={timerNow}
              canManage={canManageWorkOrders}
              onDelete={removeWorkOrder}
            />
          ))}
        </div> : closedWorkOrders.length === 0 ? <p className="quiet-panel">{loading ? "Loading work orders…" : loadError && workOrders.length === 0 ? "Work orders are unavailable. Try loading them again." : workOrders.length ? "No matching work orders. Try a different search or reset the filters above." : "No work orders yet. Create a work order to report your first issue."}</p> : null}
      </section>

      {closedWorkOrders.length ? (
        <ClosedWorkOrderHistory
          workOrders={closedWorkOrders}
          users={users}
          canManage={canManageWorkOrders}
          onDelete={removeWorkOrder}
        />
      ) : null}
    </section>
  );
}

function WorkOrderCard({
  workOrder,
  users,
  currentUserId,
  timerNow,
  canManage,
  onDelete
}: {
  workOrder: WorkOrder;
  users: User[];
  currentUserId?: string;
  timerNow: string;
  canManage: boolean;
  onDelete: (workOrder: WorkOrder) => void;
}) {
  const needsVerification = workOrder.status === "resolved" && workOrder.requesterId === currentUserId;
  const timerRunning = !["closed", "cancelled"].includes(workOrder.status);
  const timerEnd = timerRunning ? timerNow : workOrder.closedAt || workOrder.updatedAt;
  const timerLabel = workOrder.status === "cancelled" ? "Cancelled" : "Total time";

  return (
    <article className={`work-order-card card-status-${workOrder.status} ${needsVerification ? "needs-verification" : ""}`}>
      <Link to={`/work-orders/${workOrder.id}`}>
        <div className="card-topline">
          <strong>{workOrder.number}</strong>
          <div className="card-status-stack">
            <StatusBadge status={workOrder.status} />
            <span className={`card-live-timer ${timerRunning ? "is-live" : "is-stopped"}`}>
              <Clock3 size={13} aria-hidden="true" />
              {timerLabel} {formatLiveDuration(workOrder.createdAt, timerEnd)}
            </span>
          </div>
        </div>
        {needsVerification ? <span className="verification-chip">Needs verification</span> : null}
        <h2>{workOrder.title}</h2>
        <p>{workOrder.issueDescription || workOrder.description}</p>
        {workOrder.maintenanceActualMinutes !== null ? <p className="card-maintenance-actual"><Wrench size={14} />Maintenance actual: <strong>{formatMinutes(workOrder.maintenanceActualMinutes)}</strong></p> : null}
        <div className="card-meta">
          <span className="department-chip">{workOrder.responsibleDepartment}</span>
          <span>{workOrderTypeLabels[workOrder.type]}</span>
          <span>{workOrder.location}</span>
          <span>{workOrder.area}</span>
          <span>{workOrder.machineName || workOrder.assetName}</span>
          {workOrder.responsibleDepartment === "Production" && workOrder.shiftGroup !== "N/A" ? <span>Shift {workOrder.shiftGroup}</span> : null}
        </div>
        <div className="card-footer">
          <PriorityBadge priority={workOrder.priority} />
          <span>{userName(users, workOrder.assignedToId)}</span>
          <time>{formatDateTime(workOrder.updatedAt)}</time>
        </div>
      </Link>
      {canManage ? (
        <div className="work-order-card-actions">
          <Link className="edit-work-order-button" to={`/work-orders/${workOrder.id}?edit=brief`}>
            <Pencil size={15} aria-hidden="true" />
            Edit
          </Link>
          <button className="delete-work-order-button" type="button" onClick={() => onDelete(workOrder)}>
            <Trash2 size={15} aria-hidden="true" />
            Delete
          </button>
        </div>
      ) : null}
    </article>
  );
}

function ClosedWorkOrderHistory({
  workOrders,
  users,
  canManage,
  onDelete
}: {
  workOrders: WorkOrder[];
  users: User[];
  canManage: boolean;
  onDelete: (workOrder: WorkOrder) => void;
}) {
  const navigate = useNavigate();
  function openClosedWorkOrder(event: MouseEvent | KeyboardEvent, workOrder: WorkOrder) {
    if (event.target instanceof HTMLElement && event.target.closest("a, button")) return;
    if ("key" in event && event.key !== "Enter" && event.key !== " ") return;
    if ("key" in event) event.preventDefault();
    navigate(`/work-orders/${workOrder.id}`);
  }

  return (
    <section className="requester-subsection closed-work-order-history">
      <div className="subsection-heading">
        <div>
          <p className="eyebrow">Completed history</p>
          <h2>Closed Work Orders</h2>
          <span>{workOrders.length} result{workOrders.length === 1 ? "" : "s"} · tap a work order to review its full record</span>
        </div>
      </div>
      <div className="closed-history-table-wrap">
        <table className="closed-history-table">
          <thead>
            <tr>
              <th>Work order</th>
              <th>Completed</th>
              <th>Machine / issue</th>
              <th>Reported by</th>
              <th>Maintenance</th>
              <th>Priority</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {workOrders.map((workOrder) => (
              <tr key={workOrder.id} className="closed-history-row-interactive" role="link" tabIndex={0} aria-label={`Open closed work order ${workOrder.number}`} onClick={(event) => openClosedWorkOrder(event, workOrder)} onKeyDown={(event) => openClosedWorkOrder(event, workOrder)}>
                <td data-label="Work order">
                  <Link className="closed-history-number" to={`/work-orders/${workOrder.id}`}>
                    <strong>{workOrder.number}</strong>
                    <StatusBadge status={workOrder.status} />
                  </Link>
                </td>
                <td data-label="Completed"><time>{formatDateTime(workOrder.updatedAt)}</time></td>
                <td data-label="Machine / issue">
                  <span className="closed-history-issue">
                    <strong>{workOrder.machineName || workOrder.assetName}</strong>
                    <small>{workOrder.issueDescription || workOrder.description}</small>
                  </span>
                </td>
                <td data-label="Reported by">{workOrder.reportedByName}</td>
                <td data-label="Maintenance">{userName(users, workOrder.assignedToId)}</td>
                <td data-label="Priority"><PriorityBadge priority={workOrder.priority} /></td>
                <td className="closed-history-actions">
                  <Link to={`/work-orders/${workOrder.id}`} aria-label={`Open ${workOrder.number}`}><Eye size={16} /></Link>
                  {canManage ? (
                    <>
                      <Link to={`/work-orders/${workOrder.id}?edit=brief`} aria-label={`Edit brief for ${workOrder.number}`}><Pencil size={16} /></Link>
                      <button type="button" onClick={() => onDelete(workOrder)} aria-label={`Delete ${workOrder.number}`}><Trash2 size={16} /></button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
