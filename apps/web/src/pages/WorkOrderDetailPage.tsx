import { AlertCircle, ArrowLeft, Check, CheckCircle2, ClipboardCopy, Clock3, ExternalLink, ImagePlus, MessageSquare, PackageOpen, Pencil, RotateCcw, Save, ShieldCheck, TimerReset, Trash2, UsersRound, Wrench, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { MasterData, ShiftGroup, User, WorkOrder, WorkOrderAttachment, WorkOrderActivity, WorkOrderDepartment, WorkOrderDetail, WorkOrderPriority, WorkOrderStatus, WorkOrderType } from "@pbs-cmms/shared";
import { longProductionDowntimeMinutes, technicianCanAccessWorkOrder, workOrderDepartments, workOrderStatusLabels, workOrderTypeLabels } from "@pbs-cmms/shared";
import { api, mediaUrl } from "../api/client";
import { PriorityBadge, StatusBadge } from "../components/Badges";
import { ActionButton } from "../components/ActionButton";
import { useCurrentUser } from "../state/UserContext";
import { formatDate, formatDateTime, formatDuration, formatMinutes, userName } from "../utils/format";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

const workflowSteps: WorkOrderStatus[] = ["open", "acknowledged", "in_progress", "pending_material", "resolved", "closed"];
const workflowActionByStatus: Record<WorkOrderStatus, WorkOrderActivity["action"]> = {
  open: "created",
  acknowledged: "acknowledged",
  in_progress: "started",
  pending_material: "pending_material",
  resolved: "resolved",
  closed: "closed",
  returned: "returned",
  cancelled: "cancelled"
};
const actionSettleMs = 500;
const otherBriefOption = "__other__";
const priorityOptions: WorkOrderPriority[] = ["low", "medium", "high", "critical"];

type BriefDraft = {
  type: WorkOrderType;
  priority: WorkOrderPriority;
  dueDate: string;
  workDate: string;
  shiftGroup: ShiftGroup;
  sectionId: string;
  machineId: string;
  machineName: string;
  area: string;
  reportedByName: string;
  reportedByDepartment: string;
  responsibleDepartment: WorkOrderDepartment;
  issueCategoryId: string;
  issueCategoryName: string;
  issueDescription: string;
  completionNote: string;
  assignedToId: string;
  supportingTechnicianIds: string[];
  productionDowntimeReason: string;
};

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

function findActivityTime(activities: WorkOrderActivity[], action: WorkOrderActivity["action"]) {
  return [...activities].reverse().find((activity) => activity.action === action)?.createdAt || null;
}

export function WorkOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const autoOpenedBriefId = useRef("");
  const { currentUser, users } = useCurrentUser();
  const [loadError, setLoadError] = useState("");
  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [uploadKind, setUploadKind] = useState<WorkOrderAttachment["kind"]>("general");
  const [files, setFiles] = useState<FileList | null>(null);
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [resolveNote, setResolveNote] = useState("");
  const [resolveHours, setResolveHours] = useState("");
  const [resolveMinutes, setResolveMinutes] = useState("");
  const [resolveFiles, setResolveFiles] = useState<FileList | null>(null);
  const [resolveSupportingTechnicianIds, setResolveSupportingTechnicianIds] = useState<string[]>([]);
  const [resolveError, setResolveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [timerNow, setTimerNow] = useState(() => new Date().toISOString());
  const [guestTrackingPath, setGuestTrackingPath] = useState("");
  const [guestLinkCopied, setGuestLinkCopied] = useState(false);
  const [showTechnicianTools, setShowTechnicianTools] = useState(false);
  const [briefEditing, setBriefEditing] = useState(false);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefSaving, setBriefSaving] = useState(false);
  const [briefError, setBriefError] = useState("");
  const [briefMasterData, setBriefMasterData] = useState<MasterData>({ sections: [], machines: [], issueCategories: [] });
  const [briefDraft, setBriefDraft] = useState<BriefDraft | null>(null);

  async function loadDetail() {
    if (!id) {
      return;
    }

    setLoadError("");
    try {
      const nextDetail = await api.workOrder(id);
      setDetail(nextDetail);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Couldn’t load this work order."); }
  }

  useEffect(() => {
    loadDetail().catch(console.error);
  }, [id]);

  useEffect(() => {
    let active = true;
    if (!id || !currentUser || !["executive", "admin", "developer"].includes(currentUser.role)) {
      setGuestTrackingPath("");
      return () => { active = false; };
    }

    api.guestTrackingLink(id)
      .then((link) => { if (active) setGuestTrackingPath(link.path); })
      .catch(() => { if (active) setGuestTrackingPath(""); });
    return () => { active = false; };
  }, [id, currentUser?.role]);

  useEffect(() => {
    const interval = window.setInterval(() => setTimerNow(new Date().toISOString()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!resolveDialogOpen) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [resolveDialogOpen]);

  function updateDetailWithoutJump(update: (current: WorkOrderDetail) => WorkOrderDetail) {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    if (document.activeElement instanceof HTMLElement && document.activeElement.classList.contains("motion-button")) {
      document.activeElement.blur();
    }
    setDetail((current) => (current ? update(current) : current));
    restoreScroll(scrollX, scrollY);
  }

  function mergeWorkOrder(workOrder: WorkOrder, extraAttachments: WorkOrderAttachment[] = []) {
    updateDetailWithoutJump((current) => ({
      ...current,
      ...workOrder,
      requester: current.requester,
      assignedTo: users.find((user) => user.id === workOrder.assignedToId) || null,
      activities: current.activities,
      attachments: [...extraAttachments, ...current.attachments]
    }));
  }

  async function refreshDetailQuietly() {
    if (!id) {
      return;
    }

    const nextDetail = await api.workOrder(id);
    updateDetailWithoutJump(() => nextDetail);
  }

  useLiveRefresh(["work-orders"], refreshDetailQuietly, { enabled: Boolean(id) });

  const canMaintain = currentUser ? ["technician", "executive", "admin", "developer"].includes(currentUser.role) : false;
  const canManageWorkOrder = currentUser ? ["executive", "admin"].includes(currentUser.role) : false;
  const canVerify =
    currentUser && detail
      ? currentUser.id === detail.requesterId || ["executive", "admin", "developer"].includes(currentUser.role)
      : false;
  const isRequesterOwner = Boolean(currentUser && detail && currentUser.id === detail.requesterId && currentUser.role === "requester");

  useEffect(() => {
    if (!detail || !canManageWorkOrder || searchParams.get("edit") !== "brief" || autoOpenedBriefId.current === detail.id) {
      return;
    }

    autoOpenedBriefId.current = detail.id;
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("edit");
    setSearchParams(nextSearchParams, { replace: true });
    void openBriefEditor();
  }, [detail?.id, canManageWorkOrder, searchParams, setSearchParams]);

  async function updateStatus(status: WorkOrderStatus, fallbackNote: string) {
    if (!detail || !currentUser) {
      return;
    }

    setBusy(true);
    setBusyAction(status);
    try {
      const updatedWorkOrder =
        status === "acknowledged" && currentUser.role === "technician"
          ? await api.claimWorkOrder(detail.id, {
              actorId: currentUser.id,
              note: note || fallbackNote
            })
          : await api.updateWorkOrderStatus(detail.id, {
              status,
              actorId: currentUser.id,
              note: note || fallbackNote,
              assignedToId: detail.assignedToId,
              productionDowntimeReason: status === "closed" && detail.responsibleDepartment === "Production" ? note.trim() || null : null
            });
      if (status === "acknowledged" && currentUser.role === "technician") {
        navigator.vibrate?.([36, 18, 36]);
      }
      setNote("");
      setBusy(false);
      await waitForActionMotion();
      mergeWorkOrder(updatedWorkOrder);
      void refreshDetailQuietly().catch(console.error);
    } finally {
      setBusy(false);
      setBusyAction("");
    }
  }

  function openResolveDialog() {
    setResolveNote(note.trim());
    setResolveHours("");
    setResolveMinutes("");
    setResolveFiles(null);
    setResolveSupportingTechnicianIds(detail?.supportingTechnicianIds || []);
    setResolveError("");
    setResolveDialogOpen(true);
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
    if (!detail || !currentUser) {
      return;
    }

    const repairSummary = resolveNote.trim();
    const completionPhotos = resolveFiles ? Array.from(resolveFiles) : [];
    const maintenanceActualMinutes = (Number(resolveHours) || 0) * 60 + (Number(resolveMinutes) || 0);

    if (!repairSummary) {
      setResolveError("Please write what was repaired or replaced before resolving.");
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

    setBusy(true);
    setBusyAction("resolved");
    setResolveError("");
    try {
      const uploadedAttachments = await api.uploadAttachments(detail.id, currentUser.id, "after", completionPhotos);
      const updatedWorkOrder = await api.updateWorkOrderStatus(detail.id, {
        status: "resolved",
        actorId: currentUser.id,
        note: repairSummary,
        assignedToId: detail.assignedToId,
        maintenanceActualMinutes,
        supportingTechnicianIds: resolveSupportingTechnicianIds
      });
      setNote("");
      setResolveNote("");
      setResolveHours("");
      setResolveMinutes("");
      setResolveFiles(null);
      setResolveSupportingTechnicianIds([]);
      setResolveDialogOpen(false);
      setBusy(false);
      await waitForActionMotion();
      mergeWorkOrder(updatedWorkOrder, uploadedAttachments);
      void refreshDetailQuietly().catch(console.error);
    } catch (error) {
      setResolveError(error instanceof Error ? error.message : "Unable to resolve this work order.");
    } finally {
      setBusy(false);
      setBusyAction("");
    }
  }

  async function openBriefEditor() {
    if (!detail || !canManageWorkOrder) return;
    setBriefLoading(true);
    setBriefError("");
    try {
      const masterData = await api.masterData();
      setBriefMasterData(masterData);
      setBriefDraft({
        type: detail.type,
        priority: detail.priority,
        dueDate: detail.dueDate || "",
        workDate: detail.workDate,
        shiftGroup: detail.shiftGroup,
        sectionId: detail.sectionId || "",
        machineId: detail.machineId || "",
        machineName: detail.machineName,
        area: detail.area,
        reportedByName: detail.reportedByName,
        reportedByDepartment: detail.reportedByDepartment,
        responsibleDepartment: detail.responsibleDepartment,
        issueCategoryId: detail.issueCategoryId || otherBriefOption,
        issueCategoryName: detail.issueCategoryId ? "" : detail.issueCategoryName === "Other" ? "" : detail.issueCategoryName,
        issueDescription: detail.issueDescription,
        completionNote: detail.completionNote || "",
        assignedToId: detail.assignedToId || "",
        supportingTechnicianIds: detail.supportingTechnicianIds,
        productionDowntimeReason: detail.productionDowntimeReason || ""
      });
      setBriefEditing(true);
    } catch (error) {
      setBriefError(error instanceof Error ? error.message : "Unable to open the work-order editor.");
    } finally {
      setBriefLoading(false);
    }
  }

  function toggleBriefSupportingTechnician(userId: string) {
    setBriefDraft((current) => current ? {
      ...current,
      supportingTechnicianIds: current.supportingTechnicianIds.includes(userId)
        ? current.supportingTechnicianIds.filter((id) => id !== userId)
        : current.supportingTechnicianIds.length < 3
          ? [...current.supportingTechnicianIds, userId]
          : current.supportingTechnicianIds
    } : current);
  }

  async function saveBrief(event: FormEvent) {
    event.preventDefault();
    if (!detail || !currentUser || !briefDraft || !canManageWorkOrder) return;
    const selectedMachine = briefMasterData.machines.find((machine) => machine.id === briefDraft.machineId);
    const machineName = selectedMachine?.name || briefDraft.machineName.trim();
    if (!machineName) {
      setBriefError("Enter the machine, equipment, or place name.");
      return;
    }
    if (!briefDraft.assignedToId && briefDraft.supportingTechnicianIds.length) {
      setBriefError("Choose a lead technician before adding supporting technicians.");
      return;
    }
    if (["resolved", "closed"].includes(detail.status) && briefDraft.supportingTechnicianIds.length < 1) {
      setBriefError("Completed work orders must record at least 2 technicians: 1 lead and 1 supporting technician.");
      return;
    }

    setBriefSaving(true);
    setBriefError("");
    try {
      await api.updateWorkOrder(detail.id, {
        actorId: currentUser.id,
        type: briefDraft.type,
        priority: briefDraft.priority,
        dueDate: briefDraft.dueDate || null,
        workDate: briefDraft.workDate,
        shiftGroup: briefDraft.responsibleDepartment === "Production" ? briefDraft.shiftGroup : "N/A",
        sectionId: briefDraft.sectionId || null,
        machineId: selectedMachine?.id || null,
        area: selectedMachine?.area || briefDraft.area.trim() || "General",
        machineName,
        reportedByName: briefDraft.reportedByName,
        reportedByDepartment: briefDraft.reportedByDepartment,
        responsibleDepartment: briefDraft.responsibleDepartment,
        issueCategoryId: briefDraft.issueCategoryId === otherBriefOption ? null : briefDraft.issueCategoryId || null,
        issueCategoryName: briefDraft.issueCategoryId === otherBriefOption
          ? briefDraft.issueCategoryName.trim() || "Other"
          : briefMasterData.issueCategories.find((category) => category.id === briefDraft.issueCategoryId)?.name,
        issueDescription: briefDraft.issueDescription,
        completionNote: briefDraft.completionNote.trim() || null,
        assignedToId: briefDraft.assignedToId || null,
        supportingTechnicianIds: briefDraft.supportingTechnicianIds,
        productionDowntimeReason: briefDraft.productionDowntimeReason.trim() || null
      });
      await refreshDetailQuietly();
      setBriefEditing(false);
      setBriefDraft(null);
    } catch (error) {
      setBriefError(error instanceof Error ? error.message : "Unable to save the work-order brief.");
    } finally {
      setBriefSaving(false);
    }
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    if (!detail || !currentUser || !comment.trim()) {
      return;
    }

    const activity = await api.addComment(detail.id, currentUser.id, comment);
    setComment("");
    updateDetailWithoutJump((current) => ({
      ...current,
      activities: [activity, ...current.activities] as WorkOrderActivity[]
    }));
    void refreshDetailQuietly().catch(console.error);
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!detail || !currentUser || !files || files.length === 0) {
      return;
    }

    setBusy(true);
    setBusyAction("upload");
    try {
      const uploadedAttachments = await api.uploadAttachments(detail.id, currentUser.id, uploadKind, files);
      setFiles(null);
      setBusy(false);
      await waitForActionMotion();
      updateDetailWithoutJump((current) => ({
        ...current,
        attachments: [...uploadedAttachments, ...current.attachments]
      }));
      void refreshDetailQuietly().catch(console.error);
    } finally {
      setBusy(false);
      setBusyAction("");
    }
  }

  async function removeWorkOrder() {
    if (!detail || !currentUser || !canManageWorkOrder) return;
    if (!window.confirm(`Delete ${detail.number}? This permanently removes the work order and uploaded images.`)) return;

    setBusy(true);
    setBusyAction("delete");
    try {
      await api.deleteWorkOrder(detail.id, { actorId: currentUser.id });
      navigate("/work-orders", { replace: true });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to delete this work order.");
      setBusy(false);
      setBusyAction("");
    }
  }

  if (!detail) {
    return loadError ? <section className="ux-recovery" role="alert"><h1>Work order unavailable</h1><p>{loadError}</p><button className="primary-action" type="button" onClick={() => void loadDetail()}>Try again</button><Link to="/work-orders">Back to work orders</Link></section> : <p className="quiet-line" role="status">Loading work order...</p>;
  }

  const displayWorkflow =
    detail.status === "returned"
      ? (["open", "acknowledged", "in_progress", "returned", "resolved", "closed"] as WorkOrderStatus[])
      : detail.status === "cancelled"
        ? (["open", "cancelled"] as WorkOrderStatus[])
        : workflowSteps;
  const workflowIndex = displayWorkflow.indexOf(detail.status);
  const actionLocked = busy || Boolean(busyAction);
  const createdAt = findActivityTime(detail.activities, "created") || detail.createdAt;
  const startedAt = detail.maintenanceStartedAt || findActivityTime(detail.activities, "started");
  const resolvedAt = detail.resolvedAt || findActivityTime(detail.activities, "resolved");
  const closedAt = findActivityTime(detail.activities, "closed");
  const terminalAt = closedAt || (detail.status === "cancelled" ? detail.updatedAt : null);
  const totalTimeEnd = terminalAt || timerNow;
  const queueEnd = startedAt || terminalAt || timerNow;
  const totalOpenMinutes = Math.max(0, Math.round((Date.parse(totalTimeEnd) - Date.parse(createdAt)) / 60000));
  const requiresDowntimeExplanation = detail.responsibleDepartment === "Production" && !detail.productionDowntimeReason && totalOpenMinutes >= longProductionDowntimeMinutes;
  const isAssignedToCurrentUser = currentUser ? detail.assignedToId === currentUser.id : false;
  const isTechnician = currentUser?.role === "technician";
  const canClaimOpen = detail.status === "open" && !detail.assignedToId && detail.type !== "project";
  const canUseMaintenanceActions =
    canMaintain &&
    !["resolved", "closed", "cancelled"].includes(detail.status) &&
    (!isTechnician || isAssignedToCurrentUser || canClaimOpen);
  const canStartRepair =
    ["acknowledged", "returned", "pending_material"].includes(detail.status) ||
    (detail.status === "open" && (currentUser?.role !== "technician" || isAssignedToCurrentUser));
  const guestTrackingUrl = guestTrackingPath ? `${window.location.origin}${guestTrackingPath}` : "";
  const visualStatus = ["open", "acknowledged", "in_progress", "pending_material", "returned", "resolved", "closed", "cancelled"].includes(busyAction)
    ? busyAction as WorkOrderStatus
    : detail.status;
  const supportingCandidates = users.filter((user) =>
    user.role === "technician" &&
    user.id !== detail.assignedToId &&
    (user.plantAccess === "both" || user.plantAccess === detail.plantId)
  );
  const imageGroups = [
    {
      key: "before",
      title: "Before repair",
      copy: "Problem and condition before maintenance",
      attachments: detail.attachments.filter((attachment) => ["issue", "before"].includes(attachment.kind))
    },
    {
      key: "after",
      title: "After repair",
      copy: "Completed work and final condition",
      attachments: detail.attachments.filter((attachment) => attachment.kind === "after")
    },
    {
      key: "updates",
      title: "Progress & other",
      copy: "Progress, return evidence, and general photos",
      attachments: detail.attachments.filter((attachment) => !["issue", "before", "after"].includes(attachment.kind))
    }
  ];
  const briefSections = briefMasterData.sections.filter((section) => section.department === briefDraft?.responsibleDepartment && (section.active || section.id === briefDraft?.sectionId));
  const briefMachines = briefMasterData.machines.filter((machine) =>
    machine.department === briefDraft?.responsibleDepartment && (machine.active || machine.id === briefDraft?.machineId) && machine.sectionId === briefDraft?.sectionId
  );
  const briefIssueCategories = briefMasterData.issueCategories.filter((category) => category.department === briefDraft?.responsibleDepartment && (category.active || category.id === briefDraft?.issueCategoryId));
  const briefLeadCandidates = users.filter((user) =>
    user.role === "technician" &&
    (user.plantAccess === "both" || user.plantAccess === detail.plantId) &&
    technicianCanAccessWorkOrder(user, { type: briefDraft?.type || detail.type })
  );
  const briefSupportingCandidates = users.filter((user) =>
    user.role === "technician" &&
    user.id !== briefDraft?.assignedToId &&
    (user.plantAccess === "both" || user.plantAccess === detail.plantId)
  );

  const workOrderBriefPanel = briefEditing && briefDraft ? (
    <form className={`section-panel detail-summary-panel work-order-brief-top brief-editor`} onSubmit={saveBrief}>
      <div className="brief-editor-heading">
        <div><p className="eyebrow">Executive edit</p><h2>Edit Work Order Brief</h2><span>{detail.number}</span></div>
        <button type="button" className="brief-cancel-button" disabled={briefSaving} onClick={() => { setBriefEditing(false); setBriefDraft(null); setBriefError(""); }}><X size={16} />Cancel</button>
      </div>

      <div className="brief-editor-readonly">
        <span><small>Requester account</small><strong>{detail.requester.name}</strong></span>
        <span><small>Last updated</small><strong>{formatDateTime(detail.updatedAt)}</strong></span>
      </div>

      <label className="brief-editor-description">Issue description<textarea rows={3} required value={briefDraft.issueDescription} onChange={(event) => setBriefDraft({ ...briefDraft, issueDescription: event.target.value })} /></label>
      <label className="brief-editor-description">Maintenance repair notes<textarea rows={4} value={briefDraft.completionNote} onChange={(event) => setBriefDraft({ ...briefDraft, completionNote: event.target.value })} placeholder="What was repaired, replaced, adjusted, or tested?" /><small>The same completion note recorded when maintenance resolves the work order.</small></label>

      <div className="brief-editor-grid">
        <label>Work order type<select value={briefDraft.type} onChange={(event) => setBriefDraft({ ...briefDraft, type: event.target.value as WorkOrderType, assignedToId: "", supportingTechnicianIds: [] })}>{Object.entries(workOrderTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Priority<select value={briefDraft.priority} onChange={(event) => setBriefDraft({ ...briefDraft, priority: event.target.value as WorkOrderPriority })}>{priorityOptions.map((priority) => <option key={priority} value={priority}>{priority[0].toUpperCase() + priority.slice(1)}</option>)}</select></label>
        <label>Work date<input type="date" required value={briefDraft.workDate} onChange={(event) => setBriefDraft({ ...briefDraft, workDate: event.target.value })} /></label>
        <label>Due date<input type="date" value={briefDraft.dueDate} onChange={(event) => setBriefDraft({ ...briefDraft, dueDate: event.target.value })} /></label>
        <label>Responsible department<select value={briefDraft.responsibleDepartment} onChange={(event) => setBriefDraft({ ...briefDraft, responsibleDepartment: event.target.value as WorkOrderDepartment, shiftGroup: event.target.value === "Production" ? "A" : "N/A", sectionId: "", machineId: "", machineName: "", area: "", issueCategoryId: otherBriefOption, issueCategoryName: "" })}>{workOrderDepartments.map((department) => <option key={department} value={department}>{department}</option>)}</select></label>
        {briefDraft.responsibleDepartment === "Production" ? <label>Shift<select value={briefDraft.shiftGroup} onChange={(event) => setBriefDraft({ ...briefDraft, shiftGroup: event.target.value as ShiftGroup })}><option value="A">A</option><option value="B">B</option></select></label> : null}
        <label>Section<select value={briefDraft.sectionId} onChange={(event) => setBriefDraft({ ...briefDraft, sectionId: event.target.value, machineId: "", machineName: "", area: "" })}><option value="">No section / office</option>{briefSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label>
        <label>Machine / equipment<select value={briefDraft.machineId || otherBriefOption} onChange={(event) => { const machineId = event.target.value === otherBriefOption ? "" : event.target.value; const machine = briefMasterData.machines.find((item) => item.id === machineId); setBriefDraft({ ...briefDraft, machineId, machineName: machine?.name || "", area: machine?.area || "" }); }}><option value={otherBriefOption}>Other / unregistered</option>{briefMachines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}</select></label>
        {!briefDraft.machineId ? <><label>Machine, equipment, or place<input required value={briefDraft.machineName} onChange={(event) => setBriefDraft({ ...briefDraft, machineName: event.target.value })} /></label><label>Area<input value={briefDraft.area} onChange={(event) => setBriefDraft({ ...briefDraft, area: event.target.value })} placeholder="General" /></label></> : <label>Area<input value={briefDraft.area} readOnly /></label>}
        <label>Reported by<input required value={briefDraft.reportedByName} onChange={(event) => setBriefDraft({ ...briefDraft, reportedByName: event.target.value })} /></label>
        <label>Reported by department<select required value={briefDraft.reportedByDepartment} onChange={(event) => setBriefDraft({ ...briefDraft, reportedByDepartment: event.target.value })}><option value="">Choose department</option>{briefDraft.reportedByDepartment && !workOrderDepartments.includes(briefDraft.reportedByDepartment as WorkOrderDepartment) ? <option value={briefDraft.reportedByDepartment}>{briefDraft.reportedByDepartment}</option> : null}{workOrderDepartments.map((department) => <option key={department} value={department}>{department}</option>)}</select></label>
        <label>Issue category<select value={briefDraft.issueCategoryId} onChange={(event) => setBriefDraft({ ...briefDraft, issueCategoryId: event.target.value, issueCategoryName: "" })}>{briefIssueCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}<option value={otherBriefOption}>Others</option></select></label>
        {briefDraft.issueCategoryId === otherBriefOption ? <label>Specify issue category<input required value={briefDraft.issueCategoryName} onChange={(event) => setBriefDraft({ ...briefDraft, issueCategoryName: event.target.value })} /></label> : null}
        <label className="brief-editor-reason">Why it took longer<input value={briefDraft.productionDowntimeReason} onChange={(event) => setBriefDraft({ ...briefDraft, productionDowntimeReason: event.target.value })} placeholder="Leave blank if not applicable" /></label>
      </div>

      <fieldset className="brief-team-editor">
        <legend><UsersRound size={17} /> Technicians involved</legend>
        <div className="brief-team-lead-row">
          <label>Lead technician<select value={briefDraft.assignedToId} onChange={(event) => setBriefDraft({ ...briefDraft, assignedToId: event.target.value, supportingTechnicianIds: briefDraft.supportingTechnicianIds.filter((id) => id !== event.target.value) })}><option value="">Unassigned</option>{briefLeadCandidates.map((technician) => <option key={technician.id} value={technician.id}>{technician.name}</option>)}</select></label>
          <div className="brief-team-total"><strong>{(briefDraft.assignedToId ? 1 : 0) + briefDraft.supportingTechnicianIds.length}</strong><span>technicians involved</span><small>Maximum 4</small></div>
        </div>
        <p>Choose up to 3 supporting technicians. Completed jobs must have at least 1 supporting technician.</p>
        <div className="resolve-team-options brief-team-options">
          {briefSupportingCandidates.map((technician) => {
            const selected = briefDraft.supportingTechnicianIds.includes(technician.id);
            return <label key={technician.id} className={selected ? "selected" : ""}><input type="checkbox" checked={selected} disabled={!briefDraft.assignedToId || (!selected && briefDraft.supportingTechnicianIds.length >= 3)} onChange={() => toggleBriefSupportingTechnician(technician.id)} /><span><strong>{technician.name}</strong><small>{technician.title || "Technician"}</small></span>{selected ? <Check size={16} /> : null}</label>;
          })}
        </div>
      </fieldset>

      {briefError ? <p className="error-line brief-editor-error" role="alert"><AlertCircle size={16} />{briefError}</p> : null}
      <div className="brief-editor-actions"><button type="button" className="secondary-action" disabled={briefSaving} onClick={() => { setBriefEditing(false); setBriefDraft(null); setBriefError(""); }}>Cancel</button><button type="submit" className="primary-action" disabled={briefSaving}><Save size={17} />{briefSaving ? "Saving…" : "Save Brief"}</button></div>
    </form>
  ) : (
    <div className={`section-panel detail-summary-panel ${!isTechnician ? "work-order-brief-top" : ""}`}>
      <div className="detail-heading">
        <div>
          <h2>{isTechnician ? "Job Information" : "Work Order Brief"}</h2>
          <span>{detail.number}</span>
        </div>
        <div className="detail-heading-actions"><span>{formatDateTime(detail.createdAt)}</span>{canManageWorkOrder && !isTechnician ? <button type="button" disabled={briefLoading} onClick={() => void openBriefEditor()}><Pencil size={15} />{briefLoading ? "Loading…" : "Edit Brief"}</button> : null}</div>
      </div>
      <p className="detail-description">{detail.description}</p>
      <dl className="detail-grid">
        <div><dt>Machine</dt><dd>{detail.machineName || detail.assetName}</dd></div>
        <div><dt>Section</dt><dd>{detail.location}</dd></div>
        <div><dt>Area</dt><dd>{detail.area}</dd></div>
        <div><dt>Reported by</dt><dd>{detail.reportedByName}</dd></div>
        <div className="technician-secondary-detail"><dt>Reported by department</dt><dd>{detail.reportedByDepartment}</dd></div>
        <div className="technician-secondary-detail"><dt>Responsible department</dt><dd>{detail.responsibleDepartment}</dd></div>
        <div className="technician-secondary-detail"><dt>Work date</dt><dd>{formatDate(detail.workDate)}</dd></div>
        {detail.responsibleDepartment === "Production" && detail.shiftGroup !== "N/A" ? <div className="technician-secondary-detail"><dt>Shift</dt><dd>{detail.shiftGroup}</dd></div> : null}
        <div><dt>Issue category</dt><dd>{detail.issueCategoryName || detail.issueCategory?.name || "Other"}</dd></div>
        <div className="technician-secondary-detail"><dt>Lead technician</dt><dd>{detail.assignedTo?.name || "Unassigned"}</dd></div>
        <div className="technician-secondary-detail"><dt>Supporting team</dt><dd>{detail.supportingTechnicians.length ? detail.supportingTechnicians.map((technician) => technician.name).join(", ") : "Recorded when resolved"}</dd></div>
        <div className="technician-secondary-detail"><dt>Requester account</dt><dd>{detail.requester.name}</dd></div>
        <div className="technician-secondary-detail"><dt>Updated</dt><dd>{formatDateTime(detail.updatedAt)}</dd></div>
      </dl>
      <section className="brief-maintenance-summary" aria-labelledby="maintenance-summary-title">
        <div className="brief-maintenance-heading">
          <div><p className="eyebrow">Repair handoff</p><h3 id="maintenance-summary-title">Maintenance Completion</h3></div>
          <span className={detail.completionNote ? "is-recorded" : ""}>{detail.completionNote ? "Notes recorded" : "Awaiting notes"}</span>
        </div>
        <div className="brief-maintenance-note">
          <small>Maintenance repair notes</small>
          <p>{detail.completionNote || "No maintenance repair notes have been recorded yet."}</p>
        </div>
        <dl className="brief-maintenance-metrics">
          <div><dt>Maintenance actual</dt><dd>{formatMinutes(detail.maintenanceActualMinutes)}</dd></div>
          <div><dt>Repair started</dt><dd>{startedAt ? formatDateTime(startedAt) : "Not started"}</dd></div>
          <div><dt>Resolved</dt><dd>{resolvedAt ? formatDateTime(resolvedAt) : "Not resolved"}</dd></div>
          <div><dt>Closed</dt><dd>{closedAt ? formatDateTime(closedAt) : "Not closed"}</dd></div>
        </dl>
        {detail.productionDowntimeReason ? <div className="brief-maintenance-reason"><small>Why it took longer</small><p>{detail.productionDowntimeReason}</p></div> : null}
      </section>
    </div>
  );

  async function copyGuestTrackingLink() {
    if (!guestTrackingUrl) return;
    await navigator.clipboard.writeText(guestTrackingUrl);
    setGuestLinkCopied(true);
    window.setTimeout(() => setGuestLinkCopied(false), 1800);
  }

  return (
    <section className={`page-stack ${isTechnician ? "technician-detail-page" : ""}`}>
      <div className={`work-order-command ${isTechnician ? `technician-work-order-command technician-status-${visualStatus}` : ""}`}>
        <div className="work-order-command-copy">
          <p className="eyebrow">{detail.number}</p>
          <h1>{detail.title}</h1>
          <p>{detail.location} - {detail.area} - {detail.machineName || detail.assetName}</p>
          <div className="command-badges">
            <StatusBadge status={visualStatus} />
            <PriorityBadge priority={detail.priority} />
            <span>{workOrderTypeLabels[detail.type]}</span>
          </div>
          {isTechnician ? (
            <div className="technician-command-summary" aria-label="Current job summary">
              <div><small>Current status</small><strong>{workOrderStatusLabels[visualStatus]}</strong></div>
              <div><small>Assigned technician</small><strong>{detail.assignedTo?.name || "Waiting for acceptance"}</strong></div>
              <div><small>Total queue time</small><strong>{formatDuration(createdAt, queueEnd)}</strong></div>
              <div><small>System repair elapsed</small><strong>{startedAt ? formatDuration(startedAt, resolvedAt || terminalAt || timerNow) : "Not started"}</strong></div>
              <div><small>Maintenance actual</small><strong>{formatMinutes(detail.maintenanceActualMinutes)}</strong></div>
            </div>
          ) : null}
        </div>
        <div className="work-order-command-actions">
          <Link className="secondary-action" to={isTechnician ? "/technician" : "/work-orders"}>
            <ArrowLeft size={17} aria-hidden="true" />
            Back
          </Link>
          {canManageWorkOrder ? (
            <>
              <button className="secondary-action work-order-edit-link" type="button" disabled={briefLoading} onClick={() => void openBriefEditor()}>
                <Pencil size={17} aria-hidden="true" />
                {briefLoading ? "Loading..." : "Edit Brief"}
              </button>
              <button className="secondary-action work-order-delete-link" type="button" disabled={busy} onClick={removeWorkOrder}>
                <Trash2 size={17} aria-hidden="true" />
                {busyAction === "delete" ? "Deleting..." : "Delete"}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {!isTechnician ? (
        <section className="work-order-journey" aria-label="Work order journey">
          <div className="work-journey-heading">
            <div>
              <span>Work order journey</span>
              <strong>Step {Math.max(1, workflowIndex + 1)} of {displayWorkflow.length}</strong>
            </div>
            <b>{workOrderStatusLabels[detail.status]}</b>
          </div>
          <div className="work-journey-track">
            {displayWorkflow.map((step, index) => {
              const isCurrent = step === detail.status;
              const reachedAt = findActivityTime(detail.activities, workflowActionByStatus[step]);
              const isDone = Boolean(reachedAt) && !isCurrent;
              const isSkipped = index < workflowIndex && !reachedAt;
              return (
                <div key={step} className={`work-journey-step ${isDone ? "done" : ""} ${isSkipped ? "skipped" : ""} ${isCurrent ? "current" : ""}`}>
                  <span className="work-journey-node" aria-hidden="true">{isDone ? <Check size={15} /> : isSkipped ? "—" : index + 1}</span>
                  <div>
                    <strong>{workOrderStatusLabels[step]}</strong>
                    <small>{reachedAt ? formatDateTime(reachedAt) : isCurrent ? "Current stage" : isSkipped ? "Skipped" : "Upcoming"}</small>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {!isTechnician ? workOrderBriefPanel : null}

      {!isTechnician ? <section className="work-order-timing-strip" aria-label="Work order timing">
        <article className="timer-card primary">
          <TimerReset size={18} aria-hidden="true" />
          <span>Total time</span>
          <strong>{formatDuration(createdAt, totalTimeEnd)}</strong>
        </article>
        <article className="timer-card technician-secondary-timer">
          <Clock3 size={18} aria-hidden="true" />
          <span>Total queue time</span>
          <strong>{formatDuration(createdAt, queueEnd)}</strong>
        </article>
        <article className="timer-card">
          <Wrench size={18} aria-hidden="true" />
          <span>System repair elapsed</span>
          <strong>{startedAt ? formatDuration(startedAt, resolvedAt || terminalAt || timerNow) : "Not started"}</strong>
        </article>
        <article className="timer-card technician-secondary-timer">
          <TimerReset size={18} aria-hidden="true" />
          <span>Maintenance actual</span>
          <strong>{formatMinutes(detail.maintenanceActualMinutes)}</strong>
        </article>
        <article className="timer-card technician-secondary-timer">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>Verification wait</span>
          <strong>{resolvedAt ? formatDuration(resolvedAt, closedAt || timerNow) : "Not ready"}</strong>
        </article>
      </section> : null}

      <div className="detail-layout">
        <div className="detail-main">
          {isTechnician ? workOrderBriefPanel : null}

          <div className="section-panel detail-activity-panel">
            <div className="section-header">
              <div>
                <h2>{isTechnician ? "Recent Activity" : "Timeline"}</h2>
                <span>{isTechnician && detail.activities.length > 3 ? `Latest 3 of ${detail.activities.length}` : `${detail.activities.length} updates`}</span>
              </div>
            </div>
            <div className="timeline">
              {detail.activities.map((activity, index) => (
                <div key={activity.id} className={`timeline-item ${index === 0 ? "timeline-latest" : ""}`}>
                  <div className="timeline-dot" />
                  <div>
                    <strong>{activity.message}</strong>
                    <span>
                      {userName(users, activity.actorId)} - {formatDateTime(activity.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="section-panel detail-images-panel">
            <div className="section-header">
              <div>
                <h2>Repair photos</h2>
                <span>Compare the condition before and after maintenance · {detail.attachments.length} uploaded</span>
              </div>
            </div>
            <div className="repair-photo-groups">
              {imageGroups.filter((group) => group.key !== "updates" || group.attachments.length > 0).map((group) => (
                <section key={group.key} className={`repair-photo-group photo-group-${group.key}`}>
                  <header>
                    <span>{group.key === "after" ? <CheckCircle2 size={18} /> : <ImagePlus size={18} />}</span>
                    <div><strong>{group.title}</strong><small>{group.copy}</small></div>
                    <b>{group.attachments.length}</b>
                  </header>
                  {group.attachments.length ? (
                    <div className="attachment-grid">
                      {group.attachments.map((attachment) => (
                        <a key={attachment.id} className="attachment-tile" href={mediaUrl(attachment.url)} target="_blank" rel="noreferrer">
                          <img src={mediaUrl(attachment.url)} alt={`${group.title}: ${attachment.originalName}`} />
                          <span>{attachment.kind.replace("_", " ")}</span>
                          <small>{attachment.originalName}</small>
                        </a>
                      ))}
                    </div>
                  ) : <p className="detail-images-empty">No {group.title.toLowerCase()} photo yet.</p>}
                </section>
              ))}
            </div>
          </div>
        </div>

        <aside className="detail-side">
          {guestTrackingUrl ? (
            <div className="section-panel guest-admin-link-panel">
              <span><ShieldCheck size={22} /></span>
              <p className="eyebrow">Guest requester</p>
              <h2>Private tracking link</h2>
              <p>Share this link with the guest so they can follow progress and verify the completed work.</p>
              <div>
                <button type="button" onClick={copyGuestTrackingLink}>{guestLinkCopied ? <Check size={16} /> : <ClipboardCopy size={16} />}{guestLinkCopied ? "Copied" : "Copy link"}</button>
                <a href={guestTrackingUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />Open tracker</a>
              </div>
            </div>
          ) : null}

          {isRequesterOwner ? (
            <div className={`section-panel verification-panel ${detail.status === "resolved" ? "ready" : ""}`}>
              <h2>Requester Verification</h2>
              {detail.status === "resolved" ? (
                <>
                  <p>Maintenance marked this work order as resolved. Verify the result, then close it or return it for follow-up.</p>
                  <label className="verification-reason-field">
                    {requiresDowntimeExplanation ? "Why did this take longer? (required)" : "Verification note (optional)"}
                    <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder={requiresDowntimeExplanation ? "Ask maintenance, then enter the reason" : "Add a verification note"} />
                  </label>
                  <div className="button-stack">
                    <ActionButton
                      type="button"
                      icon={CheckCircle2}
                      tone="resolve"
                      busy={busy && busyAction === "closed"}
                      busyLabel="Closing..."
                      disabled={actionLocked || (requiresDowntimeExplanation && !note.trim())}
                      onClick={() => updateStatus("closed", "Requester verified and closed the work order.")}
                    >
                      Verify & Close
                    </ActionButton>
                    <ActionButton
                      type="button"
                      icon={RotateCcw}
                      tone="return"
                      busy={busy && busyAction === "returned"}
                      busyLabel="Returning..."
                      disabled={actionLocked}
                      onClick={() => updateStatus("returned", "Requester returned the work order for follow-up.")}
                    >
                      Return to Maintenance
                    </ActionButton>
                  </div>
                </>
              ) : (
                <p>Verification will appear here after maintenance resolves this work order. Current status: {workOrderStatusLabels[detail.status]}.</p>
              )}
            </div>
          ) : null}

          {canUseMaintenanceActions ? (
            <div className="section-panel action-panel">
              <h2>Maintenance Actions</h2>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} placeholder="Update note" />

              <div key={detail.status} className="button-stack status-action-stack">
                {detail.status === "open" && (!isTechnician || canClaimOpen) ? (
                  <ActionButton
                    type="button"
                    icon={ShieldCheck}
                    tone="acknowledge"
                    busy={busy && busyAction === "acknowledged"}
                    busyLabel="Acknowledging..."
                    disabled={actionLocked}
                    onClick={() => updateStatus("acknowledged", "Acknowledged by maintenance.")}
                  >
                    Acknowledge
                  </ActionButton>
                ) : null}
                {canStartRepair ? (
                  <ActionButton
                    type="button"
                    icon={Wrench}
                    tone="start"
                    busy={busy && busyAction === "in_progress"}
                    busyLabel="Starting..."
                    disabled={actionLocked}
                    onClick={() => updateStatus("in_progress", "Repair started.")}
                  >
                    {detail.type === "project" ? "Start Work" : "Start Repair"}
                  </ActionButton>
                ) : null}
                {["acknowledged", "in_progress", "returned"].includes(detail.status) ? (
                  <ActionButton
                    type="button"
                    icon={PackageOpen}
                    tone="material"
                    busy={busy && busyAction === "pending_material"}
                    busyLabel="Waiting..."
                    disabled={actionLocked}
                    onClick={() => updateStatus("pending_material", "Waiting for material.")}
                  >
                    Pending Material
                  </ActionButton>
                ) : null}
                {startedAt && ["acknowledged", "in_progress", "pending_material", "returned"].includes(detail.status) ? (
                  <ActionButton
                    type="button"
                    icon={CheckCircle2}
                    tone="resolve"
                    disabled={actionLocked}
                    onClick={openResolveDialog}
                  >
                    Resolve
                  </ActionButton>
                ) : null}
              </div>
            </div>
          ) : null}

          {canVerify && !isRequesterOwner && detail.status === "resolved" ? (
            <div className="section-panel verification-panel ready">
              <h2>Requester Verification</h2>
              <p>Review the completed work and close it, or return it to maintenance for follow-up.</p>
              <label className="verification-reason-field">
                {requiresDowntimeExplanation ? "Why did this take longer? (required)" : "Verification note (optional)"}
                <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder={requiresDowntimeExplanation ? "Ask maintenance, then enter the reason" : "Add a verification note"} />
              </label>
              <div className="button-stack">
                <ActionButton
                  type="button"
                  icon={CheckCircle2}
                  tone="resolve"
                  busy={busy && busyAction === "closed"}
                  busyLabel="Closing..."
                  disabled={actionLocked || (requiresDowntimeExplanation && !note.trim())}
                  onClick={() => updateStatus("closed", "Requester verified and closed the work order.")}
                >
                  Close
                </ActionButton>
                <ActionButton
                  type="button"
                  icon={RotateCcw}
                  tone="return"
                  busy={busy && busyAction === "returned"}
                  busyLabel="Returning..."
                  disabled={actionLocked}
                  onClick={() => updateStatus("returned", "Requester returned the work order for follow-up.")}
                >
                  Return
                </ActionButton>
              </div>
            </div>
          ) : null}

          {isTechnician ? (
            <button className="technician-detail-tools-toggle" type="button" aria-expanded={showTechnicianTools} onClick={() => setShowTechnicianTools((visible) => !visible)}>
              <MessageSquare size={18} />
              <span><strong>{showTechnicianTools ? "Hide extra tools" : "Add note or photo"}</strong><small>Optional updates and progress evidence</small></span>
            </button>
          ) : null}

          {!isTechnician || showTechnicianTools ? (
            <div className="technician-detail-tools-panel">
              <form className="section-panel action-panel" onSubmit={addComment}>
                <h2>Comment</h2>
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} placeholder="Add comment" />
                <button type="submit" disabled={!comment.trim()}>
                  <MessageSquare size={17} aria-hidden="true" />
                  Comment
                </button>
              </form>

              <form className="section-panel action-panel" onSubmit={upload}>
                <h2>Upload Images</h2>
                <select value={uploadKind} onChange={(event) => setUploadKind(event.target.value as WorkOrderAttachment["kind"])}>
                  <option value="general">General</option>
                  <option value="issue">Issue</option>
                  <option value="before">Before</option>
                  <option value="progress">Progress</option>
                  <option value="after">After</option>
                  <option value="return_evidence">Return evidence</option>
                </select>
                <input type="file" accept="image/*" multiple onChange={(event) => setFiles(event.target.files)} />
                <ActionButton type="submit" icon={ImagePlus} tone="upload" busy={busy && busyAction === "upload"} busyLabel="Uploading..." disabled={actionLocked || !files || files.length === 0}>
                  Upload
                </ActionButton>
              </form>
            </div>
          ) : null}
        </aside>
      </div>

      {resolveDialogOpen ? createPortal(
        <div className="modal-backdrop">
          <form className="resolve-modal" role="dialog" aria-modal="true" aria-labelledby="resolve-modal-title" onSubmit={submitResolve}>
            <div className="resolve-modal-header">
              <span className="resolve-modal-icon">
                <CheckCircle2 size={22} aria-hidden="true" />
              </span>
              <div>
                <p className="eyebrow">Completion evidence</p>
                <h2 id="resolve-modal-title">Resolve work order</h2>
              </div>
            </div>

            <p className="resolve-modal-copy">
              Confirm who worked on the machine, then add the repair summary, actual time, and completion photo.
            </p>

            <fieldset className="resolve-team-field">
              <legend><UsersRound size={17} /> Repair team</legend>
              <p><strong>{detail.assignedTo?.name || "Lead technician"}</strong> is the lead. Choose 1–3 other technicians who worked with them.</p>
              <div className="resolve-team-options">
                {supportingCandidates.map((technician) => {
                  const selected = resolveSupportingTechnicianIds.includes(technician.id);
                  return <label key={technician.id} className={selected ? "selected" : ""}>
                    <input type="checkbox" checked={selected} disabled={!selected && resolveSupportingTechnicianIds.length >= 3} onChange={() => toggleSupportingTechnician(technician.id)} />
                    <span><strong>{technician.name}</strong><small>{technician.title || "Technician"}</small></span>
                    {selected ? <Check size={16} /> : null}
                  </label>;
                })}
              </div>
              <small className="resolve-team-count">{resolveSupportingTechnicianIds.length ? `${1 + resolveSupportingTechnicianIds.length} of 4 team members recorded` : "Select at least 1 more · 1 of 4 recorded"}</small>
            </fieldset>

            <label className="resolve-field">
              Repair / replacement summary
              <textarea
                value={resolveNote}
                onChange={(event) => setResolveNote(event.target.value)}
                rows={5}
                placeholder="Example: Replaced leaking hydraulic hose and tested pressure. Machine running normally."
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
              <button type="button" className="modal-secondary" disabled={busy} onClick={() => setResolveDialogOpen(false)}>
                Cancel
              </button>
              <ActionButton
                type="submit"
                icon={CheckCircle2}
                tone="resolve"
                busy={busy && busyAction === "resolved"}
                busyLabel="Resolving..."
                disabled={busy || resolveSupportingTechnicianIds.length < 1 || !resolveNote.trim() || !resolveFiles || resolveFiles.length === 0 || (Number(resolveHours) || 0) * 60 + (Number(resolveMinutes) || 0) < 1}
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
