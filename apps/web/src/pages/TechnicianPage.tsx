import { BellRing, CheckCircle2, ChevronRight, History, ImagePlus, PackageOpen, Search, ShieldCheck, UsersRound, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { technicianTeamForUser, workOrderTypeLabels } from "@pbs-cmms/shared";
import type { User, WorkOrder, WorkOrderStatus } from "@pbs-cmms/shared";
import { api } from "../api/client";
import { PriorityBadge, StatusBadge } from "../components/Badges";
import { ActionButton } from "../components/ActionButton";
import { EmptyState } from "../components/EmptyState";
import { useCurrentUser } from "../state/UserContext";
import { formatDateTime } from "../utils/format";

const actionSettleMs = 500;

function waitForActionMotion() {
  return new Promise((resolve) => window.setTimeout(resolve, actionSettleMs));
}

function restoreScroll(x: number, y: number) {
  window.requestAnimationFrame(() => {
    window.scrollTo(x, y);
    window.requestAnimationFrame(() => window.scrollTo(x, y));
  });
  window.setTimeout(() => window.scrollTo(x, y), 120);
}

function promoteWorkOrder(current: WorkOrder[], updatedWorkOrder: WorkOrder) {
  return [updatedWorkOrder, ...current.filter((workOrder) => workOrder.id !== updatedWorkOrder.id)];
}

function vibrateAccepted() {
  navigator.vibrate?.([36, 18, 36]);
}

function appearsInTechnicianQueue(workOrder: WorkOrder, currentUser: User | null) {
  return workOrder.type !== "project" && !["resolved", "closed", "cancelled"].includes(workOrder.status);
}

const priorityRank: Record<WorkOrder["priority"], number> = { critical: 0, high: 1, medium: 2, low: 3 };

function sortAvailableJobs(a: WorkOrder, b: WorkOrder) {
  return priorityRank[a.priority] - priorityRank[b.priority] || a.createdAt.localeCompare(b.createdAt);
}

export function TechnicianPage() {
  const navigate = useNavigate();
  const { users, currentUser, workOrders: liveWorkOrders, workOrdersReady, refreshWorkOrders } = useCurrentUser();
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [busyId, setBusyId] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recentlyUpdatedId, setRecentlyUpdatedId] = useState("");
  const [recentlyClaimedId, setRecentlyClaimedId] = useState("");
  const [queueError, setQueueError] = useState("");
  const [resolveTarget, setResolveTarget] = useState<WorkOrder | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [resolveHours, setResolveHours] = useState("");
  const [resolveMinutes, setResolveMinutes] = useState("");
  const [resolveFiles, setResolveFiles] = useState<FileList | null>(null);
  const [resolveSupportingTechnicianIds, setResolveSupportingTechnicianIds] = useState<string[]>([]);
  const [resolveError, setResolveError] = useState("");
  const [liveArrival, setLiveArrival] = useState<{ id: string; number: string; title: string } | null>(null);
  const [activeQueueTab, setActiveQueueTab] = useState<"new" | "mine" | "team" | "history">("new");
  const [historySearch, setHistorySearch] = useState("");
  const [historyType, setHistoryType] = useState<"all" | "maintenance" | "office" | "kaizen" | "project">("all");
  const workOrdersRef = useRef<WorkOrder[]>([]);
  const hasLoadedWorkOrdersRef = useRef(false);
  const hasSelectedInitialQueueTabRef = useRef(false);
  const liveArrivalTimerRef = useRef<number | null>(null);

  function showLiveArrival(workOrder: WorkOrder) {
    setLiveArrival({ id: workOrder.id, number: workOrder.number, title: workOrder.title });
    setRecentlyUpdatedId(workOrder.id);
    navigator.vibrate?.([28, 35, 28]);
    if (liveArrivalTimerRef.current) window.clearTimeout(liveArrivalTimerRef.current);
    liveArrivalTimerRef.current = window.setTimeout(() => {
      setLiveArrival(null);
      setRecentlyUpdatedId((current) => (current === workOrder.id ? "" : current));
      liveArrivalTimerRef.current = null;
    }, 8000);
  }

  function applyLiveWorkOrders(nextWorkOrders: WorkOrder[]) {
    if (hasLoadedWorkOrdersRef.current) {
      const knownIds = new Set(workOrdersRef.current.map((workOrder) => workOrder.id));
      const newArrival = nextWorkOrders.find(
        (workOrder) => !knownIds.has(workOrder.id) && appearsInTechnicianQueue(workOrder, currentUser)
      );
      if (newArrival) showLiveArrival(newArrival);
    }

    workOrdersRef.current = nextWorkOrders;
    hasLoadedWorkOrdersRef.current = true;
    setWorkOrders(nextWorkOrders);
  }

  useEffect(() => {
    if (!workOrdersReady) return;
    applyLiveWorkOrders(liveWorkOrders);
  }, [liveWorkOrders, workOrdersReady, currentUser?.id]);

  useEffect(() => {
    const refreshFromNotification = () => void refreshWorkOrders().catch(console.error);
    window.addEventListener("sugi:work-orders-changed", refreshFromNotification);

    return () => {
      window.removeEventListener("sugi:work-orders-changed", refreshFromNotification);
      if (liveArrivalTimerRef.current) window.clearTimeout(liveArrivalTimerRef.current);
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!resolveTarget) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [resolveTarget]);

  const jobs = useMemo(() => workOrders.filter((workOrder) => workOrder.type !== "project"), [workOrders]);
  const availableJobs = useMemo(
    () => jobs.filter((workOrder) => workOrder.status === "open" && !workOrder.assignedToId).sort(sortAvailableJobs),
    [jobs]
  );
  const myActiveJobs = useMemo(
    () => jobs.filter((workOrder) => workOrder.assignedToId === currentUser?.id && !["resolved", "closed", "cancelled"].includes(workOrder.status)),
    [currentUser?.id, jobs]
  );
  const teamActiveJobs = useMemo(
    () => jobs.filter((workOrder) => Boolean(workOrder.assignedToId) && workOrder.assignedToId !== currentUser?.id && !["resolved", "closed", "cancelled"].includes(workOrder.status)),
    [currentUser?.id, jobs]
  );
  const completedJobs = useMemo(
    () => workOrders.filter((workOrder) => ["resolved", "closed"].includes(workOrder.status)),
    [workOrders]
  );
  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    return completedJobs.filter((workOrder) => {
      if (historyType !== "all" && workOrder.type !== historyType) return false;
      const haystack = `${workOrder.number} ${workOrder.title} ${workOrder.issueDescription} ${workOrder.location} ${workOrder.machineName}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [completedJobs, historySearch, historyType]);
  const resolveTeamCandidates = useMemo(
    () => resolveTarget
      ? users.filter((user) => user.role === "technician" && user.id !== resolveTarget.assignedToId && (user.plantAccess === "both" || user.plantAccess === resolveTarget.plantId))
      : [],
    [resolveTarget, users]
  );
  useEffect(() => {
    if (!workOrdersReady || hasSelectedInitialQueueTabRef.current) return;
    const hasAssignedWork = liveWorkOrders.some((workOrder) =>
      workOrder.type !== "project" &&
      workOrder.assignedToId === currentUser?.id &&
      !["resolved", "closed", "cancelled"].includes(workOrder.status)
    );
    setActiveQueueTab(hasAssignedWork ? "mine" : "new");
    hasSelectedInitialQueueTabRef.current = true;
  }, [currentUser?.id, liveWorkOrders, workOrdersReady]);

  useEffect(() => {
    const selectDefaultQueue = () => setActiveQueueTab(myActiveJobs.length > 0 ? "mine" : "new");
    window.addEventListener("sugi:open-technician-jobs", selectDefaultQueue);
    return () => window.removeEventListener("sugi:open-technician-jobs", selectDefaultQueue);
  }, [myActiveJobs.length]);

  if (currentUser?.role === "requester") {
    return <Navigate to="/work-orders" replace />;
  }

  function mergeWorkOrdersPreservingOrder(current: WorkOrder[], incoming: WorkOrder[]) {
    const incomingById = new Map(incoming.map((workOrder) => [workOrder.id, workOrder]));
    const seen = new Set<string>();
    const merged = current.map((workOrder) => {
      seen.add(workOrder.id);
      return incomingById.get(workOrder.id) || workOrder;
    });
    const newWorkOrders = incoming.filter((workOrder) => !seen.has(workOrder.id));
    return [...merged, ...newWorkOrders];
  }

  function markRecentlyUpdated(id: string) {
    setRecentlyUpdatedId(id);
    window.setTimeout(() => {
      setRecentlyUpdatedId((current) => (current === id ? "" : current));
    }, 900);
  }

  function markRecentlyClaimed(id: string) {
    setRecentlyClaimedId(id);
    window.setTimeout(() => {
      setRecentlyClaimedId((current) => (current === id ? "" : current));
    }, 2600);
  }

  async function claimWorkOrder(workOrder: WorkOrder) {
    if (!currentUser) {
      return;
    }

    setBusyId(workOrder.id);
    setBusyAction("claim");
    setSubmitting(true);
    setQueueError("");
    try {
      const updatedWorkOrder = await api.claimWorkOrder(workOrder.id, {
        actorId: currentUser.id,
        note: "Accepted from technician queue."
      });
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      vibrateAccepted();
      setWorkOrders((current) => promoteWorkOrder(current, updatedWorkOrder));
      setActiveQueueTab("mine");
      markRecentlyUpdated(updatedWorkOrder.id);
      markRecentlyClaimed(updatedWorkOrder.id);
      restoreScroll(scrollX, scrollY);
      api.workOrders()
        .then((nextWorkOrders) => {
          const nextScrollX = window.scrollX;
          const nextScrollY = window.scrollY;
          setWorkOrders((current) => mergeWorkOrdersPreservingOrder(current, nextWorkOrders));
          restoreScroll(nextScrollX, nextScrollY);
        })
        .catch(console.error);
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : "Unable to accept this work order.");
      void refreshWorkOrders().catch(console.error);
    } finally {
      setSubmitting(false);
      setBusyId("");
      setBusyAction("");
    }
  }

  async function quickAction(workOrder: WorkOrder, status: WorkOrderStatus, note: string) {
    if (!currentUser) {
      return;
    }

    setBusyId(workOrder.id);
    setBusyAction(status);
    setSubmitting(true);
    setQueueError("");
    try {
      const assignedToId = currentUser.role === "technician" ? workOrder.assignedToId || currentUser.id : workOrder.assignedToId;
      const updatedWorkOrder = await api.updateWorkOrderStatus(workOrder.id, {
        status,
        actorId: currentUser.id,
        note,
        assignedToId
      });
      setSubmitting(false);
      await waitForActionMotion();
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      if (document.activeElement instanceof HTMLElement && document.activeElement.classList.contains("motion-button")) {
        document.activeElement.blur();
      }
      setWorkOrders((current) => current.map((item) => (item.id === updatedWorkOrder.id ? updatedWorkOrder : item)));
      markRecentlyUpdated(updatedWorkOrder.id);
      restoreScroll(scrollX, scrollY);
      api.workOrders()
        .then((nextWorkOrders) => {
          const nextScrollX = window.scrollX;
          const nextScrollY = window.scrollY;
          if (document.activeElement instanceof HTMLElement && document.activeElement.classList.contains("motion-button")) {
            document.activeElement.blur();
          }
          setWorkOrders((current) => mergeWorkOrdersPreservingOrder(current, nextWorkOrders));
          restoreScroll(nextScrollX, nextScrollY);
        })
        .catch(console.error);
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : "Unable to update this work order.");
    } finally {
      setSubmitting(false);
      setBusyId("");
      setBusyAction("");
    }
  }

  function openResolveDialog(workOrder: WorkOrder) {
    setResolveTarget(workOrder);
    setResolveNote("");
    setResolveHours("");
    setResolveMinutes("");
    setResolveFiles(null);
    setResolveSupportingTechnicianIds(workOrder.supportingTechnicianIds || []);
    setResolveError("");
  }

  function toggleSupportingTechnician(userId: string) {
    setResolveSupportingTechnicianIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : current.length < 3
          ? [...current, userId]
          : current
    );
  }

  async function submitResolve(event: FormEvent) {
    event.preventDefault();
    if (!currentUser || !resolveTarget) {
      return;
    }

    const repairSummary = resolveNote.trim();
    const completionPhotos = resolveFiles ? Array.from(resolveFiles) : [];
    const maintenanceActualMinutes = (Number(resolveHours) || 0) * 60 + (Number(resolveMinutes) || 0);

    if (!repairSummary) {
      setResolveError("Please add a short repair remark before resolving.");
      return;
    }

    if (completionPhotos.length === 0) {
      setResolveError("Please upload at least one completion photo before resolving.");
      return;
    }

    if (!Number.isInteger(maintenanceActualMinutes) || maintenanceActualMinutes < 1 || maintenanceActualMinutes > 10080) {
      setResolveError("Enter maintenance actual time between 1 minute and 7 days.");
      return;
    }

    if (resolveSupportingTechnicianIds.length < 1 || resolveSupportingTechnicianIds.length > 3) {
      setResolveError("Select 1 to 3 supporting technicians who worked on this repair.");
      return;
    }

    setBusyId(resolveTarget.id);
    setBusyAction("resolved");
    setSubmitting(true);
    setResolveError("");
    try {
      await api.uploadAttachments(resolveTarget.id, currentUser.id, "after", completionPhotos);
      const updatedWorkOrder = await api.updateWorkOrderStatus(resolveTarget.id, {
        status: "resolved",
        actorId: currentUser.id,
        note: repairSummary,
        assignedToId: resolveTarget.assignedToId,
        maintenanceActualMinutes,
        supportingTechnicianIds: resolveSupportingTechnicianIds
      });
      setResolveTarget(null);
      setResolveNote("");
      setResolveHours("");
      setResolveMinutes("");
      setResolveFiles(null);
      setResolveSupportingTechnicianIds([]);
      setSubmitting(false);
      await waitForActionMotion();
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      if (document.activeElement instanceof HTMLElement && document.activeElement.classList.contains("motion-button")) {
        document.activeElement.blur();
      }
      setWorkOrders((current) => current.map((item) => (item.id === updatedWorkOrder.id ? updatedWorkOrder : item)));
      markRecentlyUpdated(updatedWorkOrder.id);
      restoreScroll(scrollX, scrollY);
      api.workOrders()
        .then((nextWorkOrders) => {
          const nextScrollX = window.scrollX;
          const nextScrollY = window.scrollY;
          setWorkOrders((current) => mergeWorkOrdersPreservingOrder(current, nextWorkOrders));
          restoreScroll(nextScrollX, nextScrollY);
        })
        .catch(console.error);
    } catch (error) {
      setResolveError(error instanceof Error ? error.message : "Unable to resolve this work order.");
    } finally {
      setSubmitting(false);
      setBusyId("");
      setBusyAction("");
    }
  }

  function technicianName(id: string | null) {
    return users.find((user) => user.id === id)?.name || "Technician";
  }

  function renderJobCard(workOrder: WorkOrder, mode: "mine" | "available" | "team") {
    const isMine = mode === "mine";
    const isClaimable = mode === "available" && currentUser?.role === "technician";
    const canStart = isMine && (["acknowledged", "returned", "pending_material"].includes(workOrder.status) || workOrder.status === "open");
    const pendingVisualStatus = busyId === workOrder.id
      ? busyAction === "claim"
        ? "acknowledged"
        : ["acknowledged", "in_progress", "pending_material", "returned", "resolved", "closed", "cancelled"].includes(busyAction)
          ? busyAction as WorkOrderStatus
          : null
      : null;
    const visualStatus = pendingVisualStatus || workOrder.status;
    const cardClasses = [
      "technician-card",
      `technician-status-${visualStatus}`,
      isClaimable ? "is-claimable" : "",
      mode === "team" ? "is-team-readonly" : "",
      recentlyUpdatedId === workOrder.id ? "is-updated" : "",
      liveArrival?.id === workOrder.id ? "is-new-live" : "",
      recentlyClaimedId === workOrder.id ? "is-claimed" : "",
      pendingVisualStatus ? "is-status-changing" : "",
      pendingVisualStatus && !submitting && ["resolved", "closed", "cancelled"].includes(pendingVisualStatus) ? "is-status-leaving" : ""
    ].filter(Boolean).join(" ");

    const openFromCard = (event: ReactMouseEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest("a, button, input, textarea, select, label, [role='button']")) return;
      navigate(`/work-orders/${workOrder.id}`);
    };

    return (
      <article
        className={cardClasses}
        key={workOrder.id}
        role="link"
        tabIndex={0}
        aria-busy={Boolean(pendingVisualStatus)}
        aria-label={`Open ${workOrder.number} details`}
        onClick={openFromCard}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            navigate(`/work-orders/${workOrder.id}`);
          }
        }}
      >
        <div className="card-topline">
          <strong>{workOrder.number}</strong>
          <span className="technician-card-badges">
            {isMine ? <span className="technician-owner-chip">Mine</span> : null}
        <StatusBadge status={visualStatus} />
          </span>
        </div>
        <h2>{workOrder.title}</h2>
        <p>{workOrder.location} - {workOrder.machineName || workOrder.assetName}</p>
        <div className="technician-card-context">
          <span>{workOrderTypeLabels[workOrder.type]}</span>
          {workOrder.assignedToId ? <strong>{visualStatus === "in_progress" ? "In progress by" : "Accepted by"} {technicianName(workOrder.assignedToId)}</strong> : <strong>Waiting for technician</strong>}
        </div>
        <div className="card-footer">
          <PriorityBadge priority={workOrder.priority} />
          <time>{formatDateTime(workOrder.updatedAt)}</time>
        </div>
        {isClaimable ? (
          <SwipeToAccept
            busy={submitting && busyId === workOrder.id && busyAction === "claim"}
            disabled={Boolean(busyId) && busyId !== workOrder.id}
            onAccept={() => claimWorkOrder(workOrder)}
          />
        ) : isMine ? (
          <div key={workOrder.status} className="quick-actions">
            {canStart ? (
              <ActionButton type="button" icon={Wrench} tone="start" busy={submitting && busyId === workOrder.id && busyAction === "in_progress"} busyLabel="Starting..." disabled={Boolean(busyId)} onClick={() => quickAction(workOrder, "in_progress", "Work started from technician queue.")}>Start</ActionButton>
            ) : null}
            {["acknowledged", "in_progress", "returned"].includes(workOrder.status) ? (
              <ActionButton type="button" icon={PackageOpen} tone="material" busy={submitting && busyId === workOrder.id && busyAction === "pending_material"} busyLabel="Waiting..." disabled={Boolean(busyId)} onClick={() => quickAction(workOrder, "pending_material", "Waiting for parts or material.")}>Pending</ActionButton>
            ) : null}
            {workOrder.maintenanceStartedAt && ["acknowledged", "in_progress", "pending_material", "returned"].includes(workOrder.status) ? (
              <ActionButton type="button" icon={CheckCircle2} tone="resolve" busy={submitting && busyId === workOrder.id && busyAction === "resolved"} busyLabel="Resolving..." disabled={Boolean(busyId)} onClick={() => openResolveDialog(workOrder)}>Resolve</ActionButton>
            ) : null}
          </div>
        ) : (
          <p className="technician-readonly-note"><UsersRound size={15} /> Live team status · view only</p>
        )}
        <Link to={`/work-orders/${workOrder.id}`}>Open details</Link>
      </article>
    );
  }

  return (
    <section className="page-stack technician-page">
      {liveArrival ? (
        <Link className="technician-live-arrival" to={`/work-orders/${liveArrival.id}`} aria-live="polite">
          <span><BellRing size={20} aria-hidden="true" /></span>
          <span>
            <strong>New work order · {liveArrival.number}</strong>
            <small>{liveArrival.title}</small>
          </span>
          <ChevronRight size={19} aria-hidden="true" />
        </Link>
      ) : null}
      <div className="page-title-row">
        <div>
          <p className="eyebrow">Technician Workspace</p>
          <h1>{technicianTeamForUser(currentUser || { role: "technician", department: "Maintenance" }) === "kaizen" ? "Kaizen Jobs" : "Maintenance Jobs"}</h1>
        </div>
      </div>

      {queueError ? <p className="error-line" role="alert">{queueError}</p> : null}

      <div className={`technician-queue-tabs active-${activeQueueTab}`} role="tablist" aria-label="Job queues">
        <button type="button" role="tab" aria-selected={activeQueueTab === "new"} className={activeQueueTab === "new" ? "active" : ""} onClick={() => setActiveQueueTab("new")}><span>New Jobs</span><strong>{availableJobs.length}</strong></button>
        <button type="button" role="tab" aria-selected={activeQueueTab === "mine"} className={activeQueueTab === "mine" ? "active" : ""} onClick={() => setActiveQueueTab("mine")}><span>My Jobs</span><strong>{myActiveJobs.length}</strong></button>
        <button type="button" role="tab" aria-selected={activeQueueTab === "team"} className={activeQueueTab === "team" ? "active" : ""} onClick={() => setActiveQueueTab("team")}><span>Team Status</span><strong>{teamActiveJobs.length}</strong></button>
        <button type="button" role="tab" aria-selected={activeQueueTab === "history"} className={activeQueueTab === "history" ? "active" : ""} onClick={() => setActiveQueueTab("history")}><span>Work History</span><strong>{completedJobs.length}</strong></button>
      </div>

      <section key={activeQueueTab} className="technician-job-section technician-tabbed-queue" role="tabpanel">
        <div className="technician-section-heading">
          <div>
            {activeQueueTab !== "mine" ? <p className="eyebrow">{activeQueueTab === "new" ? "Priority queue" : activeQueueTab === "team" ? "Live visibility" : "Shared team record"}</p> : null}
            <h2>{activeQueueTab === "new" ? "New Work Orders" : activeQueueTab === "mine" ? "My Active Job" : activeQueueTab === "team" ? "Team Activity" : "Work History"}</h2>
          </div>
        </div>
        {activeQueueTab === "new" ? (
          availableJobs.length > 0 ? <div className="technician-list">{availableJobs.map((workOrder) => renderJobCard(workOrder, "available"))}</div> : <EmptyState icon={Wrench} title="No new jobs" text="New eligible work orders will appear here." />
        ) : activeQueueTab === "mine" ? (
          myActiveJobs.length > 0 ? <div className="technician-list">{myActiveJobs.map((workOrder) => renderJobCard(workOrder, "mine"))}</div> : <EmptyState icon={Wrench} title="No jobs assigned to you" text="Open New Jobs when you are ready to accept work." />
        ) : activeQueueTab === "team" && teamActiveJobs.length > 0 ? (
          <div className="technician-list">{teamActiveJobs.map((workOrder) => renderJobCard(workOrder, "team"))}</div>
        ) : activeQueueTab === "team" ? (
          <EmptyState icon={UsersRound} title="No team activity" text="No other technician is working on an active job." />
        ) : (
          <div className="technician-history-tab-content">
            <div className="technician-history-filters">
              <label><Search size={17} /><input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search completed work" /></label>
              <select value={historyType} onChange={(event) => setHistoryType(event.target.value as typeof historyType)}>
                <option value="all">All visible work</option>
                <option value="maintenance">Maintenance</option>
                <option value="office">Office</option>
                <option value="kaizen">Kaizen</option>
                <option value="project">Projects</option>
              </select>
            </div>
            {!workOrdersReady ? <p className="quiet-panel">Loading team history…</p> : filteredHistory.length > 0 ? (
              <div className="technician-history-table">
                {filteredHistory.map((workOrder) => {
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
          </div>
        )}
      </section>

      {resolveTarget ? createPortal(
        <div className="modal-backdrop">
          <form className="resolve-modal" role="dialog" aria-modal="true" aria-labelledby="technician-resolve-title" onSubmit={submitResolve}>
            <div className="resolve-modal-header">
              <span className="resolve-modal-icon">
                <CheckCircle2 size={22} aria-hidden="true" />
              </span>
              <div>
                <p className="eyebrow">{resolveTarget.number}</p>
                <h2 id="technician-resolve-title">Resolve from queue</h2>
              </div>
            </div>

            <p className="resolve-modal-copy">
              Confirm your repair team, then add the actual time, completion photo, and short repair remark.
            </p>

            <fieldset className="resolve-team-field">
              <legend><UsersRound size={17} /> Repair team</legend>
              <p><strong>{technicianName(resolveTarget.assignedToId)}</strong> is the lead. Choose 1–3 technicians who worked with you.</p>
              <div className="resolve-team-options">
                {resolveTeamCandidates.map((technician) => {
                  const selected = resolveSupportingTechnicianIds.includes(technician.id);
                  return <label key={technician.id} className={selected ? "selected" : ""}>
                    <input type="checkbox" checked={selected} disabled={!selected && resolveSupportingTechnicianIds.length >= 3} onChange={() => toggleSupportingTechnician(technician.id)} />
                    <span><strong>{technician.name}</strong><small>{technician.title || "Technician"}</small></span>
                    {selected ? <CheckCircle2 size={16} /> : null}
                  </label>;
                })}
              </div>
              <small className="resolve-team-count">{resolveSupportingTechnicianIds.length ? `${1 + resolveSupportingTechnicianIds.length} of 4 team members recorded` : "Select at least 1 more · 1 of 4 recorded"}</small>
            </fieldset>

            <label className="resolve-field">
              Short repair remarks
              <textarea
                value={resolveNote}
                onChange={(event) => setResolveNote(event.target.value)}
                rows={4}
                placeholder="Example: Replaced leaking hose and tested normal operation."
                required
              />
            </label>

            <fieldset className="resolve-duration-field">
              <legend>Maintenance actual time</legend>
              <p>Enter hands-on time counted by maintenance. This stays separate from system elapsed time.</p>
              <div>
                <label>Hours<input type="number" min="0" max="168" step="1" inputMode="numeric" value={resolveHours} onChange={(event) => setResolveHours(event.target.value)} /></label>
                <label>Minutes<input type="number" min="0" max="59" step="1" inputMode="numeric" value={resolveMinutes} onChange={(event) => setResolveMinutes(event.target.value)} /></label>
              </div>
            </fieldset>

            <label className="resolve-field resolve-upload-box">
              Completion photo
              <input type="file" accept="image/*" multiple required onChange={(event) => setResolveFiles(event.target.files)} />
              <span>{resolveFiles && resolveFiles.length > 0 ? `${resolveFiles.length} photo selected` : "Upload at least one after-repair photo"}</span>
            </label>

            {resolveError ? <p className="error-line" role="alert">{resolveError}</p> : null}

            <div className="modal-actions">
              <button type="button" className="modal-secondary" disabled={submitting} onClick={() => setResolveTarget(null)}>
                Cancel
              </button>
              <ActionButton
                type="submit"
                icon={ImagePlus}
                tone="resolve"
                busy={submitting && busyAction === "resolved"}
                busyLabel="Resolving..."
                disabled={submitting || resolveSupportingTechnicianIds.length < 1 || !resolveNote.trim() || !resolveFiles || resolveFiles.length === 0 || (Number(resolveHours) || 0) * 60 + (Number(resolveMinutes) || 0) < 1}
              >
                Confirm Resolve
              </ActionButton>
            </div>
          </form>
        </div>,
        document.body
      ) : null}
    </section>
  );
}

type SwipeToAcceptProps = {
  busy: boolean;
  disabled: boolean;
  onAccept: () => void;
};

function SwipeToAccept({ busy, disabled, onAccept }: SwipeToAcceptProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    pointerId: -1,
    startX: 0,
    startDragX: 0,
    currentX: 0,
    maxDrag: 0,
    accepted: false
  });
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const unavailable = disabled || busy;

  function getMaxDrag() {
    const width = trackRef.current?.clientWidth || 0;
    return Math.max(0, width - 62);
  }

  function setSwipeX(nextX: number) {
    dragRef.current.currentX = nextX;
    setDragX(nextX);
  }

  function resetSwipe() {
    dragRef.current.pointerId = -1;
    dragRef.current.startX = 0;
    dragRef.current.startDragX = 0;
    dragRef.current.currentX = 0;
    dragRef.current.maxDrag = getMaxDrag();
    dragRef.current.accepted = false;
    setDragX(0);
    setIsDragging(false);
  }

  function accept() {
    if (unavailable || dragRef.current.accepted) {
      return;
    }

    dragRef.current.accepted = true;
    setSwipeX(dragRef.current.maxDrag || getMaxDrag());
    setIsDragging(false);
    onAccept();
  }

  useEffect(() => {
    if (!busy) {
      resetSwipe();
    }
  }, [busy]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (unavailable) {
      return;
    }

    dragRef.current.pointerId = event.pointerId;
    dragRef.current.startX = event.clientX;
    dragRef.current.startDragX = dragRef.current.currentX;
    dragRef.current.maxDrag = getMaxDrag();
    dragRef.current.accepted = false;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (unavailable || drag.pointerId !== event.pointerId || drag.accepted) {
      return;
    }

    const nextX = Math.min(drag.maxDrag, Math.max(0, drag.startDragX + event.clientX - drag.startX));
    setSwipeX(nextX);

    if (drag.maxDrag > 0 && nextX >= drag.maxDrag * 0.74) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      accept();
    }
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId || drag.accepted) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.currentX >= drag.maxDrag * 0.62) {
      accept();
      return;
    }

    resetSwipe();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (unavailable || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }

    event.preventDefault();
    dragRef.current.maxDrag = getMaxDrag();
    dragRef.current.accepted = false;
    accept();
  }

  return (
    <div
      ref={trackRef}
      className={`swipe-accept ${isDragging ? "is-dragging" : ""} ${busy ? "is-busy" : ""} ${disabled ? "is-disabled" : ""}`}
      role="button"
      tabIndex={unavailable ? -1 : 0}
      aria-disabled={unavailable}
      aria-label="Swipe to accept work order"
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <span className="swipe-accept-fill" style={{ width: `${dragX + 58}px` }} />
      <span className="swipe-accept-label">
        <ShieldCheck size={17} aria-hidden="true" />
        {busy ? "Accepting..." : "Swipe to accept"}
      </span>
      <span className="swipe-accept-handle" style={{ transform: `translateX(${dragX}px)` }}>
        <ChevronRight size={22} aria-hidden="true" />
      </span>
    </div>
  );
}
