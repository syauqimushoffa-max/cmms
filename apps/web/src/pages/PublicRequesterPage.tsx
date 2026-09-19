import {
  Activity, AlertTriangle, ArrowLeft, Bell, Building2, CalendarDays, CheckCircle2, ClipboardList, Clock3, Eye, Factory,
  Hammer, History, Home, Lightbulb, LogIn, LogOut, MapPin, RefreshCcw, Search, Send, ShieldCheck,
  Trash2, UserCircle2, UserRound, Wrench, X, type LucideIcon
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { MasterData, NotificationRecord, ShiftGroup, User, WorkOrder, WorkOrderDepartment, WorkOrderDetail, WorkOrderStatus, WorkOrderType } from "@pbs-cmms/shared";
import { longProductionDowntimeMinutes, workOrderDepartmentForUser, workOrderDepartments, workOrderFormRulesForDepartment, workOrderTypeLabels } from "@pbs-cmms/shared";
import { api, mediaUrl } from "../api/client";
import { MultiPhotoPicker } from "../components/MultiPhotoPicker";
import { ImageLightbox } from "../components/ImageLightbox";
import { PwaInstallButton } from "../components/PwaInstallButton";
import { PushNotificationControl } from "../components/PushNotificationControl";
import { SearchableSelect } from "../components/SearchableSelect";
import { StatusBadge } from "../components/Badges";
import { formatDateTime, formatLiveDuration, formatMinutes } from "../utils/format";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

function needsProductionDowntimeExplanation(workOrder: WorkOrder) {
  return workOrder.responsibleDepartment === "Production" &&
    !["closed", "cancelled"].includes(workOrder.status) &&
    !workOrder.productionDowntimeReason?.trim() &&
    Math.max(0, Date.now() - Date.parse(workOrder.createdAt)) >= longProductionDowntimeMinutes * 60000;
}
import { useCurrentUser } from "../state/UserContext";

function todayDate() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; }

const otherOptionValue = "__other__";
const initialRequesterForm = {
  type: "maintenance" as WorkOrderType, workDate: todayDate(), shiftGroup: "A" as ShiftGroup,
  sectionId: "", customSection: "", area: "", customArea: "", machineId: "", placeOrEquipment: "", reportedByName: "",
  reportedByDepartment: "", customReportedByDepartment: "", issueCategoryId: "", customIssueCategory: "", issueDescription: ""
};

const requestTypes: Array<{ type: WorkOrderType; Icon: LucideIcon; title: string; description: string }> = [
  { type: "maintenance", Icon: Wrench, title: "Maintenance", description: "Machine breakdown or corrective maintenance" },
  { type: "project", Icon: Hammer, title: "Project", description: "Planned fabrication, installation, or project work" },
  { type: "kaizen", Icon: Lightbulb, title: "Kaizen", description: "Small continuous-improvement request" }
];

const otherDepartments = workOrderDepartments.filter((department) => !["Production", "SHE"].includes(department));

function reporterDepartmentOptions(current: string) {
  return current && current !== otherOptionValue && !workOrderDepartments.some((department) => department === current)
    ? [current, ...workOrderDepartments]
    : workOrderDepartments;
}

type RequesterView = "dashboard" | "new" | "tracking" | "verify" | "account";
type RequesterStatusFilter = "all" | "open" | "in_progress" | "waiting" | "closed";
type RequesterTrackingScope = "department" | "all";

const statusesByFilter: Record<Exclude<RequesterStatusFilter, "all">, WorkOrderStatus[]> = {
  open: ["open", "acknowledged"], in_progress: ["in_progress", "returned"],
  waiting: ["pending_material", "resolved"], closed: ["closed", "cancelled"]
};
const filterLabels: Record<RequesterStatusFilter, string> = {
  all: "All", open: "Open", in_progress: "In Progress", waiting: "Waiting", closed: "Closed"
};

export function PublicRequesterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentUser, loadingUsers, login, logout } = useCurrentUser();
  const signedRequester = currentUser?.role === "requester";
  const [masterData, setMasterData] = useState<MasterData>({ sections: [], machines: [], issueCategories: [] });
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [view, setView] = useState<RequesterView>("new");
  const [selectedDepartment, setSelectedDepartment] = useState<WorkOrderDepartment | null>(null);
  const [choosingOtherDepartment, setChoosingOtherDepartment] = useState(false);
  const [selectedType, setSelectedType] = useState<WorkOrderType | null>(null);
  const [categoryClosing, setCategoryClosing] = useState(false);
  const [form, setForm] = useState(initialRequesterForm);
  const [issueFiles, setIssueFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [invalidField, setInvalidField] = useState("");
  const [success, setSuccess] = useState("");
  const [statusFilter, setStatusFilter] = useState<RequesterStatusFilter>("all");
  const [trackingScope, setTrackingScope] = useState<RequesterTrackingScope>("department");
  const [search, setSearch] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [verificationNotes, setVerificationNotes] = useState<Record<string, string>>({});
  const [actionId, setActionId] = useState("");
  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [timerNow, setTimerNow] = useState(() => new Date().toISOString());

  async function loadMasterData() {
    const next = await api.masterData();
    setMasterData(next);
    setForm((current) => ({ ...current, sectionId: current.sectionId || next.sections.find((section) => section.active)?.id || "" }));
  }

  async function loadAccountWorkOrders() {
    if (!signedRequester) { setWorkOrders([]); return; }
    const next = await api.workOrders();
    setWorkOrders(next);
  }

  async function loadRequesterNotifications() {
    if (!signedRequester || !currentUser) { setNotifications([]); return; }
    setNotifications(await api.notifications(currentUser.id));
  }

  useEffect(() => { loadMasterData().catch(console.error); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setTimerNow(new Date().toISOString()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (signedRequester) {
      setView("dashboard");
      setTrackingScope("department");
      setSelectedDepartment(null); setSelectedType(null); setChoosingOtherDepartment(false);
      setForm((current) => ({ ...current, reportedByName: "", reportedByDepartment: currentUser.department }));
      loadAccountWorkOrders().catch(console.error);
      loadRequesterNotifications().catch(console.error);
    } else {
      setWorkOrders([]); setNotifications([]); setNotificationsOpen(false); setView("new"); setSelectedDepartment(null); setSelectedType(null);
    }
  }, [currentUser?.id]);
  const requestedView = searchParams.get("view");
  useEffect(() => {
    if (signedRequester && requestedView === "verify") setView("verify");
  }, [requestedView, signedRequester]);
  useLiveRefresh(["work-orders", "master-data", "notifications"], async () => {
    await loadMasterData();
    if (signedRequester) await Promise.all([loadAccountWorkOrders(), loadRequesterNotifications()]);
  }, { fallbackMs: 10000 });

  const isOffice = selectedType === "office";
  const activeSections = useMemo(() => masterData.sections.filter((section) => section.active && section.department === selectedDepartment), [masterData.sections, selectedDepartment]);
  const activeIssues = useMemo(() => masterData.issueCategories.filter((category) => category.active && category.department === selectedDepartment), [masterData.issueCategories, selectedDepartment]);
  const rules = selectedDepartment ? workOrderFormRulesForDepartment(selectedDepartment) : null;
  const sectionOptions = useMemo(() => [...activeSections.map((section) => ({ value: section.id, label: section.name })), { value: otherOptionValue, label: "Others", meta: "Specify a section" }], [activeSections]);
  const areaOptions = useMemo(() => {
    const areas = [...new Set(masterData.machines
      .filter((machine) => machine.active && machine.department === selectedDepartment && (!form.sectionId || form.sectionId === otherOptionValue || machine.sectionId === form.sectionId))
      .map((machine) => machine.area).filter(Boolean))];
    return [...areas.map((area) => ({ value: area, label: area })), { value: otherOptionValue, label: "Others", meta: "Specify an area" }];
  }, [form.sectionId, masterData.machines, selectedDepartment]);
  const filteredMachines = useMemo(() => masterData.machines.filter((machine) => machine.active && machine.department === selectedDepartment && machine.sectionId === form.sectionId && (!form.area || form.area === otherOptionValue || machine.area === form.area)), [form.area, masterData.machines, form.sectionId, selectedDepartment]);
  const machineOptions = useMemo(() => [...filteredMachines.map((machine) => ({ value: machine.id, label: machine.name, meta: machine.area })), { value: otherOptionValue, label: "Others", meta: "Specify a machine or equipment" }], [filteredMachines]);
  const issueOptions = useMemo(() => [...activeIssues.map((category) => ({ value: category.id, label: category.name })), { value: otherOptionValue, label: "Others", meta: "Specify an issue category" }], [activeIssues]);
  const accountDepartment = workOrderDepartmentForUser(currentUser?.department || "");
  const prioritizedWorkOrders = useMemo(() => accountDepartment
    ? [...workOrders].sort((a, b) => Number(b.responsibleDepartment === accountDepartment) - Number(a.responsibleDepartment === accountDepartment))
    : workOrders, [accountDepartment, workOrders]);
  const departmentWorkOrders = useMemo(() => accountDepartment
    ? workOrders.filter((item) => item.responsibleDepartment === accountDepartment)
    : workOrders.filter((item) => item.requesterId === currentUser?.id), [accountDepartment, currentUser?.id, workOrders]);
  const stats = useMemo(() => ({
    open: departmentWorkOrders.filter((item) => statusesByFilter.open.includes(item.status)).length,
    in_progress: departmentWorkOrders.filter((item) => statusesByFilter.in_progress.includes(item.status)).length,
    waiting: departmentWorkOrders.filter((item) => statusesByFilter.waiting.includes(item.status)).length,
    closed: departmentWorkOrders.filter((item) => statusesByFilter.closed.includes(item.status)).length
  }), [departmentWorkOrders]);
  const pendingVerification = useMemo(() => workOrders.filter((item) => item.status === "resolved" && item.requesterId === currentUser?.id), [currentUser?.id, workOrders]);
  const unreadNotifications = useMemo(() => notifications.filter((notification) => !notification.readAt).length, [notifications]);
  const visibleWorkOrders = useMemo(() => {
    const scopedWorkOrders = trackingScope === "department" ? departmentWorkOrders : prioritizedWorkOrders;
    const byStatus = statusFilter === "all" ? scopedWorkOrders : scopedWorkOrders.filter((item) => statusesByFilter[statusFilter].includes(item.status));
    const query = search.trim().toLowerCase();
    return query ? byStatus.filter((item) => `${item.number} ${item.issueDescription} ${item.machineName} ${item.area}`.toLowerCase().includes(query)) : byStatus;
  }, [departmentWorkOrders, prioritizedWorkOrders, search, statusFilter, trackingScope]);

  function chooseDepartment(department: WorkOrderDepartment) {
    setSelectedDepartment(department);
    setForm((current) => ({ ...current, sectionId: "", customSection: "", area: "", customArea: "", machineId: "", placeOrEquipment: "", issueCategoryId: "", customIssueCategory: "" }));
    setChoosingOtherDepartment(false);
    setError("");
  }

  function chooseType(type: WorkOrderType) {
    if (categoryClosing || !selectedDepartment) return;
    setCategoryClosing(true); setError(""); setSuccess("");
    setForm((current) => ({ ...current, type, machineId: type === "office" ? "" : current.machineId, placeOrEquipment: "", issueCategoryId: type === "office" ? "" : current.issueCategoryId, reportedByName: "", reportedByDepartment: signedRequester ? currentUser.department : current.reportedByDepartment }));
    window.setTimeout(() => { setSelectedType(type); setCategoryClosing(false); }, 260);
  }

  function openView(next: RequesterView) {
    setView(next); setError("");
    if (next === "tracking") setTrackingScope("department");
    if (next !== "new") { setSelectedDepartment(null); setSelectedType(null); setChoosingOtherDepartment(false); }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function showStatus(filter: Exclude<RequesterStatusFilter, "all">) { setTrackingScope("department"); setStatusFilter(filter); openView("tracking"); }

  async function openRequesterNotification(notification: NotificationRecord) {
    if (!currentUser) return;
    if (!notification.readAt) {
      await api.markNotificationRead(notification.id);
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item));
    }
    setNotificationsOpen(false);
    const workOrder = workOrders.find((item) => item.id === notification.workOrderId);
    if (workOrder?.status === "resolved" && workOrder.requesterId === currentUser.id) {
      openView("verify");
      return;
    }
    openView("tracking");
  }

  async function markAllRequesterNotificationsRead() {
    if (!currentUser) return;
    await api.markAllNotificationsRead(currentUser.id);
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((notification) => notification.readAt ? notification : { ...notification, readAt }));
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    if (!loginUsername.trim() || !loginPassword) return;
    setLoginBusy(true); setLoginError("");
    try {
      const user = await login(loginUsername, loginPassword);
      if (user.role !== "requester") {
        logout(); setLoginError("This sign-in is for requester accounts. Staff can use the main CMMS sign-in."); return;
      }
      setLoginOpen(false); setLoginPassword(""); setSuccess(""); setView("dashboard");
    } catch (nextError) { setLoginError(nextError instanceof Error ? nextError.message : "Unable to sign in."); }
    finally { setLoginBusy(false); }
  }

  function showMissingField(message: string, field: string) {
    setError(message);
    setInvalidField(field);
    window.requestAnimationFrame(() => {
      const marker = document.querySelector<HTMLElement>(`[data-requester-field="${field}"]`);
      if (!marker) return;
      marker.scrollIntoView({ behavior: "smooth", block: "center" });
      const control = marker.matches("input, select, textarea, button")
        ? marker
        : marker.querySelector<HTMLElement>("input, select, textarea, button");
      window.setTimeout(() => control?.focus({ preventScroll: true }), 280);
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedType || !selectedDepartment || submitting) return;
    const selectedMachine = filteredMachines.find((machine) => machine.id === form.machineId);
    const place = form.placeOrEquipment.trim();
    const activeRules = workOrderFormRulesForDepartment(selectedDepartment);
    if (!form.workDate) { showMissingField("Choose the work order date.", "work-date"); return; }
    if (isOffice && !place) { showMissingField("Enter the place or location.", "place"); return; }
    if (activeRules.section === "required" && !form.sectionId) { showMissingField("Choose a section or select Others.", "section"); return; }
    if (activeRules.section !== "hidden" && form.sectionId === otherOptionValue && !form.customSection.trim()) { showMissingField("Specify the section.", "custom-section"); return; }
    if (activeRules.area === "required" && !form.area) { showMissingField("Choose an area or select Others.", "area"); return; }
    if (activeRules.area !== "hidden" && form.area === otherOptionValue && !form.customArea.trim()) { showMissingField("Specify the area.", "custom-area"); return; }
    if (activeRules.machine === "required" && !form.machineId) { showMissingField("Choose a machine or select Others.", "machine"); return; }
    if (activeRules.machine !== "hidden" && form.machineId === otherOptionValue && !place) { showMissingField("Specify the machine or equipment.", "custom-machine"); return; }
    if (activeRules.issueCategory === "required" && !form.issueCategoryId) { showMissingField("Choose an issue category or select Others.", "issue-category"); return; }
    if (activeRules.issueCategory !== "hidden" && form.issueCategoryId === otherOptionValue && !form.customIssueCategory.trim()) { showMissingField("Specify the issue category.", "custom-issue-category"); return; }
    if (!form.reportedByName.trim()) { showMissingField("Enter your name so maintenance knows who reported this.", "reporter-name"); return; }
    if (!isOffice && !form.reportedByDepartment) { showMissingField("Choose your department.", "reporter-department"); return; }
    if (!isOffice && form.reportedByDepartment === otherOptionValue && !form.customReportedByDepartment.trim()) { showMissingField("Specify your department.", "custom-reporter-department"); return; }
    if (!form.issueDescription.trim()) { showMissingField("Describe what happened.", "issue-description"); return; }
    setSubmitting(true); setError(""); setSuccess("");
    setInvalidField("");
    try {
      const payload = {
        type: selectedType, workDate: form.workDate || todayDate(), shiftGroup: selectedDepartment === "Production" ? form.shiftGroup : "N/A",
        sectionId: isOffice || activeRules.section === "hidden" || form.sectionId === otherOptionValue ? null : form.sectionId || null,
        machineId: isOffice || activeRules.machine === "hidden" || form.machineId === otherOptionValue ? null : selectedMachine?.id || null,
        location: isOffice ? place : form.sectionId === otherOptionValue ? form.customSection.trim() : activeSections.find((section) => section.id === form.sectionId)?.name || `${selectedDepartment} request`,
        area: isOffice ? "Office" : activeRules.area === "hidden" ? "Not applicable" : form.area === otherOptionValue ? form.customArea.trim() : form.area || selectedMachine?.area || "General",
        machineName: isOffice ? place : activeRules.machine === "hidden" ? "Not applicable" : selectedMachine?.name || place || "Not specified",
        reportedByName: form.reportedByName.trim(),
        reportedByDepartment: signedRequester ? currentUser.department : form.reportedByDepartment === otherOptionValue ? form.customReportedByDepartment.trim() : form.reportedByDepartment.trim() || "Not specified",
        responsibleDepartment: selectedDepartment,
        issueCategoryId: isOffice || activeRules.issueCategory === "hidden" || form.issueCategoryId === otherOptionValue ? null : form.issueCategoryId,
        issueCategoryName: isOffice || activeRules.issueCategory === "hidden" ? "General" : form.issueCategoryId === otherOptionValue ? form.customIssueCategory.trim() : activeIssues.find((category) => category.id === form.issueCategoryId)?.name,
        issueDescription: form.issueDescription
      };
      if (!signedRequester) {
        const submission = await api.createRequesterWorkOrder(payload);
        let photosFailed = false;
        try { if (issueFiles.length) await api.uploadRequesterAttachments(submission.workOrder.id, issueFiles); }
        catch { photosFailed = true; }
        navigate(`${submission.tracking.path}&created=1${photosFailed ? "&photos=failed" : ""}`);
        return;
      }

      const workOrder = await api.createWorkOrder({ ...payload, requesterId: currentUser.id });
      let photosFailed = false;
      try { if (issueFiles.length) await api.uploadAttachments(workOrder.id, currentUser.id, "issue", issueFiles); }
      catch { photosFailed = true; }
      setSuccess(`${workOrder.number} submitted successfully.${photosFailed ? " Photos could not be uploaded. Contact maintenance with this work order number; do not submit another request." : ""}`); setSelectedDepartment(null); setSelectedType(null);
      setForm({ ...initialRequesterForm, workDate: todayDate(), sectionId: form.sectionId, reportedByName: "", reportedByDepartment: signedRequester ? currentUser.department : "" });
      setIssueFiles([]);
      await loadAccountWorkOrders(); setStatusFilter("open"); setView("tracking");
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Unable to submit work order."); }
    finally { setSubmitting(false); }
  }

  async function verifyWorkOrder(workOrder: WorkOrder, status: "closed" | "returned") {
    if (!signedRequester) return;
    const note = verificationNotes[workOrder.id]?.trim() || "";
    if (status === "returned" && !note) { setError("Add a short reason before returning the work order to maintenance."); return; }
    if (status === "closed" && needsProductionDowntimeExplanation(workOrder) && !note) { setError("Choose why this job is taking longer before closing it."); return; }
    setActionId(workOrder.id); setError("");
    try {
      await api.updateWorkOrderStatus(workOrder.id, { status, actorId: currentUser.id, note: note || "Requester verified the completed work.", productionDowntimeReason: status === "closed" && workOrder.responsibleDepartment === "Production" ? note || null : null });
      setSuccess(status === "closed" ? `${workOrder.number} verified and closed.` : `${workOrder.number} returned to maintenance.`);
      setVerificationNotes((current) => ({ ...current, [workOrder.id]: "" })); setDetail(null); await loadAccountWorkOrders();
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Unable to update the work order."); }
    finally { setActionId(""); }
  }

  async function saveDowntimeReason(workOrder: WorkOrder) {
    if (!signedRequester) return;
    const reason = verificationNotes[workOrder.id]?.trim() || "";
    if (!reason) { setError("Choose one reason first."); return; }
    setActionId(workOrder.id); setError("");
    try {
      const updated = await api.updateWorkOrderDowntimeReason(workOrder.id, reason);
      setWorkOrders((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDetail((current) => current?.id === updated.id ? { ...current, ...updated } : current);
      setSuccess(`${workOrder.number}: reason saved.`);
      setVerificationNotes((current) => ({ ...current, [workOrder.id]: "" }));
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Unable to save the reason."); }
    finally { setActionId(""); }
  }

  async function cancelRequesterWorkOrder(workOrder: WorkOrder) {
    if (!signedRequester || workOrder.requesterId !== currentUser.id) return;
    if (!window.confirm(`Cancel ${workOrder.number}? Maintenance will see that this request is no longer required.`)) return;
    setActionId(workOrder.id); setError("");
    try {
      await api.updateWorkOrderStatus(workOrder.id, { status: "cancelled", actorId: currentUser.id, note: "Cancelled by requester." });
      setSuccess(`${workOrder.number} cancelled.`); setDetail(null); await loadAccountWorkOrders();
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Unable to cancel the work order."); }
    finally { setActionId(""); }
  }

  async function deleteRequesterWorkOrder(workOrder: WorkOrder) {
    if (!signedRequester || workOrder.requesterId !== currentUser.id) return;
    if (!window.confirm(`Permanently delete ${workOrder.number}? Use this only for a test or accidental request. This cannot be undone.`)) return;
    setActionId(workOrder.id); setError("");
    try {
      await api.deleteWorkOrder(workOrder.id, { actorId: currentUser.id });
      setSuccess(`${workOrder.number} deleted.`); setDetail(null); await loadAccountWorkOrders();
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Unable to delete the work order."); }
    finally { setActionId(""); }
  }

  async function openDetail(workOrder: WorkOrder) {
    if (!signedRequester) return;
    setDetailLoading(true);
    try { setDetail(await api.workOrder(workOrder.id)); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Unable to load work order details."); }
    finally { setDetailLoading(false); }
  }

  if (loadingUsers) return <div className="requester-app-loading">Preparing requester app...</div>;

  return <div className={`requester-app-shell ${signedRequester ? "is-account" : "is-guest"}`}>
    <header className="requester-app-topbar">
      <div className="requester-app-brand"><span><img src="/brand/pbs_symbol.png" alt="PBS Grand" /></span><div><small>PBS CMMS</small><strong>{signedRequester ? `${currentUser.department} Requester` : "Guest Request"}</strong></div></div>
      <div className="requester-app-account-action">{signedRequester ? <><div className="notification-wrap requester-notification-wrap"><button className="requester-notification-button" type="button" onClick={() => setNotificationsOpen((open) => !open)} aria-label="Requester notifications" aria-expanded={notificationsOpen}><Bell size={18} />{unreadNotifications ? <b className="notification-count">{unreadNotifications}</b> : null}</button>{notificationsOpen ? <div className="notification-panel requester-notification-panel"><div className="panel-header"><strong>Notifications</strong><button type="button" onClick={markAllRequesterNotificationsRead}>Mark all read</button></div><div className="notification-list">{notifications.length ? notifications.slice(0, 10).map((notification) => <button type="button" key={notification.id} className={`notification-item ${notification.readAt ? "" : "unread"}`} onClick={() => void openRequesterNotification(notification)}><strong>{notification.title}</strong><span>{notification.body}</span><time>{formatDateTime(notification.createdAt)}</time></button>) : <p className="requester-notification-empty">No notifications yet.</p>}</div><PushNotificationControl compact /></div> : null}</div><button type="button" onClick={() => openView("account")}><UserCircle2 size={18} /><span>{currentUser.name}</span></button></> : currentUser ? <a href="/"><Home size={17} />Return to CMMS</a> : <button type="button" onClick={() => setLoginOpen(true)}><LogIn size={17} />Department sign in</button>}</div>
    </header>

    <main className="requester-app-main">
      {success ? <div className="requester-app-toast success"><CheckCircle2 size={18} />{success}<button type="button" onClick={() => setSuccess("")} aria-label="Dismiss"><X size={15} /></button></div> : null}
      {error ? <div className="requester-app-toast error"><RefreshCcw size={18} />{error}<button type="button" onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button></div> : null}
      {signedRequester && view === "dashboard" ? <RequesterDashboard user={currentUser} workOrders={departmentWorkOrders} stats={stats} pendingVerification={pendingVerification} timerNow={timerNow} onStatus={showStatus} onView={openView} onDetail={openDetail} /> : null}
      {view === "new" ? <section className={`requester-new-view ${selectedType ? "" : "requester-new-view-locked"}`} aria-hidden={!selectedType}>
        <div className="requester-new-heading"><div><p>{signedRequester ? "Account request" : "Guest request"}</p><h1>New Work Order</h1><span>{signedRequester ? "This request will be saved under your account." : "No account needed. Submit an issue in a few simple steps."}</span></div>{!signedRequester ? <button type="button" onClick={() => setLoginOpen(true)}><ShieldCheck size={16} />Sign in to track</button> : null}</div>
        {selectedType && selectedDepartment && rules ? <RequesterForm selectedType={selectedType} selectedDepartment={selectedDepartment} rules={rules} form={form} setForm={setForm} isOffice={isOffice} sectionOptions={sectionOptions} areaOptions={areaOptions} machineOptions={machineOptions} issueCategoryOptions={issueOptions} issueFiles={issueFiles} setIssueFiles={setIssueFiles} submitting={submitting} signedRequester={signedRequester} invalidField={invalidField} clearInvalidField={() => setInvalidField("")} onChangeType={() => setSelectedType(null)} onSubmit={submit} /> : <section className="requester-form-panel requester-form-locked"><div className="requester-panel-heading"><span className="requester-panel-icon"><ShieldCheck size={18} /></span><div><h2>Choose a department and category</h2><span>The request form opens after your selections.</span></div></div></section>}
      </section> : null}
      {signedRequester && view === "tracking" ? <RequesterTracking workOrders={visibleWorkOrders} departmentLabel={accountDepartment || "My requests"} scope={trackingScope} statusFilter={statusFilter} search={search} detailLoading={detailLoading} timerNow={timerNow} onScope={setTrackingScope} onFilter={setStatusFilter} onSearch={setSearch} onDetail={openDetail} onNew={() => openView("new")} /> : null}
      {signedRequester && view === "verify" ? <RequesterVerification workOrders={pendingVerification} notes={verificationNotes} actionId={actionId} detailLoading={detailLoading} timerNow={timerNow} onNote={(id, note) => setVerificationNotes((current) => ({ ...current, [id]: note }))} onVerify={verifyWorkOrder} onDetail={openDetail} /> : null}
      {signedRequester && view === "account" ? <section className="requester-account-view"><div className="requester-account-avatar">{initialsFor(currentUser.name)}</div><p>Department requester</p><h1>{currentUser.name}</h1><span>{currentUser.title}</span><dl><div><dt>Department</dt><dd>{currentUser.department}</dd></div><div><dt>Username</dt><dd>{currentUser.username}</dd></div><div><dt>Tracked requests</dt><dd>{departmentWorkOrders.length}</dd></div></dl><PwaInstallButton /><PushNotificationControl /><button className="requester-signout" type="button" onClick={() => { logout(); setSuccess("Signed out. You can continue as a guest."); }}><LogOut size={17} />Sign out and continue as guest</button></section> : null}
    </main>

    <nav className="requester-app-tabbar" aria-label="Requester navigation">{signedRequester ? <><RequesterTab active={view === "dashboard"} label="Home" Icon={Home} onClick={() => openView("dashboard")} /><RequesterTab active={view === "new"} label="New" Icon={Send} onClick={() => openView("new")} /><RequesterTab active={view === "tracking"} label="Track" Icon={History} onClick={() => openView("tracking")} /><RequesterTab active={view === "verify"} label="Verify" Icon={ShieldCheck} badge={pendingVerification.length} onClick={() => openView("verify")} /><RequesterTab active={view === "account"} label="Account" Icon={UserCircle2} onClick={() => openView("account")} /></> : <><RequesterTab active label="New Request" Icon={Send} onClick={() => openView("new")} /><RequesterTab active={false} label="Sign in to track" Icon={LogIn} onClick={() => setLoginOpen(true)} /></>}</nav>

    {view === "new" && !selectedType ? <div className={`requester-category-gate ${categoryClosing ? "is-exiting" : ""}`} role="dialog" aria-modal="true" aria-labelledby="requester-category-title" aria-busy={categoryClosing} onClick={(event) => { if (signedRequester && event.target === event.currentTarget) openView("dashboard"); }}><section className="requester-category-card" key={selectedDepartment ? "request-type" : choosingOtherDepartment ? "other-department" : "primary-department"}>{signedRequester ? <button className="requester-category-close" type="button" disabled={categoryClosing} onClick={() => openView("dashboard")} aria-label="Cancel new work order and return home"><X size={20} /></button> : null}<div className="requester-category-heading"><span><img src="/brand/pbs_symbol.png" alt="" /></span><div><p>{selectedDepartment ? `FOR ${selectedDepartment.toUpperCase()}` : signedRequester ? "ACCOUNT REQUEST" : "CONTINUE AS GUEST"}</p><h1 id="requester-category-title">{selectedDepartment ? "What type of work is needed?" : choosingOtherDepartment ? "Which department is responsible?" : "Which department is this for?"}</h1></div></div><p className="requester-category-copy">{selectedDepartment ? "Choose Maintenance, Project, or Kaizen." : choosingOtherDepartment ? "Select the department PIC who should prioritize this work order." : "Production and SHE are listed first. Use Others for the remaining departments."}</p>{selectedDepartment ? <div className="requester-type-grid">{requestTypes.map(({ type, Icon, title, description }) => <button className={`requester-type-card type-${type}`} type="button" key={type} disabled={categoryClosing} onClick={() => chooseType(type)}><span><Icon size={24} /></span><strong>{title}</strong><small>{description}</small></button>)}</div> : choosingOtherDepartment ? <div className="requester-department-grid">{otherDepartments.map((department) => <button type="button" key={department} onClick={() => chooseDepartment(department)}><Building2 size={20} /><strong>{department}</strong></button>)}</div> : <div className="requester-type-grid requester-department-primary"><button className="requester-type-card type-production" type="button" onClick={() => chooseDepartment("Production")}><span><Factory size={24} /></span><strong>Production</strong><small>Production-owned issue</small></button><button className="requester-type-card type-she" type="button" onClick={() => chooseDepartment("SHE")}><span><ShieldCheck size={24} /></span><strong>SHE</strong><small>Safety, Health & Environment</small></button><button className="requester-type-card type-others" type="button" onClick={() => setChoosingOtherDepartment(true)}><span><Building2 size={24} /></span><strong>Others</strong><small>Logistic, DTU, R&amp;D, Account, Management, or Business Development</small></button></div>}{selectedDepartment || choosingOtherDepartment ? <button className="requester-category-back" type="button" onClick={() => { setSelectedDepartment(null); setChoosingOtherDepartment(false); }}><ArrowLeft size={15} />Change department</button> : null}<small className="requester-category-note"><ShieldCheck size={14} />{signedRequester ? `Signed in as ${currentUser.name}` : "Guest access · new requests only"}</small>{!signedRequester ? currentUser ? <a className="requester-category-signin" href="/"><Home size={15} />Return to staff CMMS</a> : <button className="requester-category-signin" type="button" onClick={() => setLoginOpen(true)}><LogIn size={15} />Department user? Sign in to track</button> : null}</section></div> : null}

    {loginOpen ? <div className="requester-login-backdrop"><form className="requester-login-card" role="dialog" aria-modal="true" aria-labelledby="requester-login-title" onSubmit={submitLogin}><button className="requester-dialog-close" type="button" onClick={() => setLoginOpen(false)} aria-label="Close sign in"><X size={18} /></button><span className="requester-login-icon"><ShieldCheck size={24} /></span><p>Department access</p><h2 id="requester-login-title">Sign in to your requester account</h2><small>Track department work orders, review maintenance updates, and verify work that you requested.</small><label>Username<input value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} autoComplete="username" required /></label><label>Password<input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="current-password" required /></label>{loginError ? <p className="error-line" role="alert">{loginError}</p> : null}<button className="primary-action" type="submit" disabled={loginBusy}>{loginBusy ? "Signing in..." : "Open my requester app"}<LogIn size={17} /></button><button className="requester-guest-continue" type="button" onClick={() => setLoginOpen(false)}>Continue as guest</button></form></div> : null}
    {detail ? <RequesterDetailDialog detail={detail} canVerify={detail.requesterId === currentUser?.id} timerNow={timerNow} onClose={() => setDetail(null)} onVerify={verifyWorkOrder} onSaveReason={saveDowntimeReason} onCancel={cancelRequesterWorkOrder} onDelete={deleteRequesterWorkOrder} actionId={actionId} note={verificationNotes[detail.id] || ""} onNote={(note) => setVerificationNotes((current) => ({ ...current, [detail.id]: note }))} /> : null}
  </div>;
}

function RequesterForm({ selectedType, selectedDepartment, rules, form, setForm, isOffice, sectionOptions, areaOptions, machineOptions, issueCategoryOptions, issueFiles, setIssueFiles, submitting, signedRequester, invalidField, clearInvalidField, onChangeType, onSubmit }: {
  selectedType: WorkOrderType; selectedDepartment: WorkOrderDepartment; rules: ReturnType<typeof workOrderFormRulesForDepartment>; form: typeof initialRequesterForm; setForm: React.Dispatch<React.SetStateAction<typeof initialRequesterForm>>; isOffice: boolean;
  sectionOptions: Array<{ value: string; label: string; meta?: string }>; areaOptions: Array<{ value: string; label: string; meta?: string }>; machineOptions: Array<{ value: string; label: string; meta?: string }>; issueCategoryOptions: Array<{ value: string; label: string; meta?: string }>;
  issueFiles: File[]; setIssueFiles: (files: File[]) => void; submitting: boolean; signedRequester: boolean; invalidField: string; clearInvalidField: () => void; onChangeType: () => void; onSubmit: (event: FormEvent) => void;
}) {
  const fieldClass = (field: string) => invalidField === field ? "requester-invalid" : "";
  return (
    <form className="requester-form-panel requester-account-form requester-form-enter" noValidate onChange={clearInvalidField} onSubmit={onSubmit}>
      <div className="requester-panel-heading requester-form-heading">
        <span className="requester-panel-icon"><Send size={18} /></span>
        <div><h2>{workOrderTypeLabels[selectedType]} Request</h2><span>For {selectedDepartment} · tell us which machine and what happened</span></div>
        <button className="change-request-type" type="button" onClick={onChangeType}><ArrowLeft size={15} />Change</button>
      </div>

      <div className="requester-step-label"><span>1</span>Request details</div>
      <div className={`form-grid ${selectedDepartment === "Production" ? "two-columns" : ""}`}>
        <label className={fieldClass("work-date")} data-requester-field="work-date"><CalendarDays size={15} />Date<input type="date" value={form.workDate} onChange={(event) => setForm({ ...form, workDate: event.target.value })} required /></label>
        {rules.shiftGroup !== "hidden" ? (
          <label>Shift group<select value={form.shiftGroup} onChange={(event) => setForm({ ...form, shiftGroup: event.target.value as ShiftGroup })}><option value="A">A</option><option value="B">B</option></select></label>
        ) : null}
      </div>

      {isOffice ? (
        <label className={fieldClass("place")} data-requester-field="place"><MapPin size={15} />Place / location<input value={form.placeOrEquipment} onChange={(event) => setForm({ ...form, placeOrEquipment: event.target.value })} placeholder="Example: Finance office, meeting room, pantry" required /></label>
      ) : (
        <>
          {rules.section !== "hidden" ? <><SearchableSelect label={`Section${rules.section === "optional" ? " (optional)" : ""}`} icon={<Factory size={15} />} value={form.sectionId} options={sectionOptions} placeholder="Choose section" validationField="section" invalid={invalidField === "section"} onChange={(sectionId) => { clearInvalidField(); setForm({ ...form, sectionId, customSection: "", area: "", customArea: "", machineId: "", placeOrEquipment: "" }); }} />{form.sectionId === otherOptionValue ? <label className={fieldClass("custom-section")} data-requester-field="custom-section"><Factory size={15} />Specify section<input value={form.customSection} onChange={(event) => setForm({ ...form, customSection: event.target.value })} placeholder="Enter the section name" required /></label> : null}</> : null}
          {rules.area !== "hidden" ? <><SearchableSelect label={`Area${rules.area === "optional" ? " (optional)" : ""}`} value={form.area} options={areaOptions} placeholder="Choose area" validationField="area" invalid={invalidField === "area"} onChange={(area) => { clearInvalidField(); setForm({ ...form, area, customArea: "", machineId: "", placeOrEquipment: "" }); }} />{form.area === otherOptionValue ? <label className={fieldClass("custom-area")} data-requester-field="custom-area"><MapPin size={15} />Specify area<input value={form.customArea} onChange={(event) => setForm({ ...form, customArea: event.target.value })} placeholder="Enter the exact area" required /></label> : null}</> : null}
          {rules.machine !== "hidden" ? <><SearchableSelect label={`Machine / equipment${rules.machine === "optional" ? " (optional)" : ""}`} value={form.machineId} options={machineOptions} placeholder="Choose or search machine" validationField="machine" invalid={invalidField === "machine"} onChange={(machineId) => { clearInvalidField(); setForm({ ...form, machineId, placeOrEquipment: "" }); }} />{form.machineId === otherOptionValue ? <label className={fieldClass("custom-machine")} data-requester-field="custom-machine"><MapPin size={15} />Specify machine or equipment<input value={form.placeOrEquipment} onChange={(event) => setForm({ ...form, placeOrEquipment: event.target.value })} placeholder="Enter the exact machine or equipment" required /></label> : null}</> : null}
          {rules.issueCategory !== "hidden" ? <><SearchableSelect label={`Issue category${rules.issueCategory === "optional" ? " (optional)" : ""}`} value={form.issueCategoryId} options={issueCategoryOptions} placeholder="Choose or search issue" validationField="issue-category" invalid={invalidField === "issue-category"} onChange={(issueCategoryId) => { clearInvalidField(); setForm({ ...form, issueCategoryId, customIssueCategory: "" }); }} />{form.issueCategoryId === otherOptionValue ? <label className={fieldClass("custom-issue-category")} data-requester-field="custom-issue-category">Specify issue category<input value={form.customIssueCategory} onChange={(event) => setForm({ ...form, customIssueCategory: event.target.value })} placeholder="Enter the issue category" required /></label> : null}</> : null}
        </>
      )}

      <div className="requester-step-label"><span>2</span>Your details</div>
      <div className={`form-grid ${isOffice ? "requester-single-field" : "two-columns"}`}>
        <label className={fieldClass("reporter-name")} data-requester-field="reporter-name"><UserRound size={15} />Your name <small>{signedRequester ? "Required for this request" : "Required"}</small><input value={form.reportedByName} onChange={(event) => setForm({ ...form, reportedByName: event.target.value })} placeholder="Enter your full name" autoComplete="name" required /></label>
        {!isOffice ? <label className={fieldClass("reporter-department")} data-requester-field="reporter-department">Department <small>{signedRequester ? "From account" : "Required"}</small><select value={form.reportedByDepartment} onChange={(event) => setForm({ ...form, reportedByDepartment: event.target.value, customReportedByDepartment: "" })} disabled={signedRequester} required><option value="">Choose department</option>{reporterDepartmentOptions(form.reportedByDepartment).map((department) => <option key={department} value={department}>{department}</option>)}{!signedRequester ? <option value={otherOptionValue}>Others</option> : null}</select></label> : null}
      </div>
      {!signedRequester && form.reportedByDepartment === otherOptionValue ? <label className={fieldClass("custom-reporter-department")} data-requester-field="custom-reporter-department">Specify your department<input value={form.customReportedByDepartment} onChange={(event) => setForm({ ...form, customReportedByDepartment: event.target.value })} placeholder="Enter your department" required /></label> : null}

      <div className="requester-step-label"><span>3</span>Describe the issue</div>
      <label className={fieldClass("issue-description")} data-requester-field="issue-description">What happened?<textarea value={form.issueDescription} onChange={(event) => setForm({ ...form, issueDescription: event.target.value })} rows={5} placeholder="Describe what is wrong, when it started, and anything maintenance should know" required /></label>
      <MultiPhotoPicker files={issueFiles} onChange={setIssueFiles} disabled={submitting} />
      <button className="primary-action" type="submit" disabled={submitting}><Send size={17} />{submitting ? "Submitting..." : "Submit Work Order"}</button>
    </form>
  );
}

function RequesterDashboard({ user, workOrders, stats, pendingVerification, timerNow, onStatus, onView, onDetail }: { user: User; workOrders: WorkOrder[]; stats: Record<Exclude<RequesterStatusFilter, "all">, number>; pendingVerification: WorkOrder[]; timerNow: string; onStatus: (filter: Exclude<RequesterStatusFilter, "all">) => void; onView: (view: RequesterView) => void; onDetail: (workOrder: WorkOrder) => void; }) {
  const reasonPending = workOrders.filter(needsProductionDowntimeExplanation);
  return <section className="requester-dashboard-view">
    <header className="requester-dashboard-hero"><div><p>Welcome back, {user.name.split(" ")[0]}</p><h1>Your Requester Dashboard</h1><span>Track your department's work orders and check completed work.</span></div><button type="button" onClick={() => onView("new")}><Send size={18} />New Work Order</button></header>
    <div className="requester-account-stats"><button type="button" onClick={() => onStatus("open")}><Activity size={18} /><span>Open</span><strong>{stats.open}</strong></button><button type="button" onClick={() => onStatus("in_progress")}><Wrench size={18} /><span>In Progress</span><strong>{stats.in_progress}</strong></button><button type="button" onClick={() => onStatus("waiting")}><Clock3 size={18} /><span>Waiting</span><strong>{stats.waiting}</strong></button><button type="button" onClick={() => onStatus("closed")}><CheckCircle2 size={18} /><span>Closed</span><strong>{stats.closed}</strong></button></div>
    {reasonPending.length ? <button className="requester-reason-banner" type="button" onClick={() => onDetail(reasonPending[0])}><span><AlertTriangle size={23} /></span><div><strong>Reason Pending — {reasonPending.length} job{reasonPending.length === 1 ? "" : "s"}</strong><small>Follow up with maintenance and choose why it is taking longer.</small></div><Eye size={20} /></button> : null}
    {pendingVerification.length ? <button className="requester-verification-banner" type="button" onClick={() => onView("verify")}><span><ShieldCheck size={23} /></span><div><strong>{pendingVerification.length} work order{pendingVerification.length === 1 ? "" : "s"} ready to check</strong><small>Check the repair. Then close it or send it back.</small></div><Eye size={20} /></button> : <div className="requester-clear-banner"><CheckCircle2 size={19} /><span><strong>No completed work waiting</strong><small>Completed repairs needing your decision will appear here.</small></span></div>}
    <section className="requester-dashboard-list"><div className="requester-view-heading"><div><p>Department updates</p><h2>Recent Work Orders</h2></div><button type="button" onClick={() => onView("tracking")}>View all</button></div>{workOrders.length ? workOrders.slice(0, 5).map((workOrder) => <RequesterWorkOrderCard key={workOrder.id} workOrder={workOrder} timerNow={timerNow} onDetail={onDetail} />) : <RequesterEmpty title="No department requests yet" copy="New work orders for your department will appear here." />}</section>
  </section>;
}

function RequesterTracking({ workOrders, departmentLabel, scope, statusFilter, search, detailLoading, timerNow, onScope, onFilter, onSearch, onDetail, onNew }: { workOrders: WorkOrder[]; departmentLabel: string; scope: RequesterTrackingScope; statusFilter: RequesterStatusFilter; search: string; detailLoading: boolean; timerNow: string; onScope: (scope: RequesterTrackingScope) => void; onFilter: (filter: RequesterStatusFilter) => void; onSearch: (value: string) => void; onDetail: (workOrder: WorkOrder) => void; onNew: () => void; }) {
  return <section className="requester-tracking-view"><div className="requester-view-heading"><div><p>Department tracking</p><h1>Track Work Orders</h1><span>Your department is shown by default. Switch to All departments whenever needed.</span></div><button type="button" onClick={onNew}><Send size={16} />New Request</button></div><label className="requester-tracking-search"><Search size={17} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search WO number, machine, or issue" /></label><div className="requester-filter-tabs"><button type="button" className={scope === "department" ? "active" : ""} onClick={() => onScope("department")}>{departmentLabel}</button><button type="button" className={scope === "all" ? "active" : ""} onClick={() => onScope("all")}>All departments</button></div><div className="requester-filter-tabs">{(Object.keys(filterLabels) as RequesterStatusFilter[]).map((filter) => <button type="button" className={statusFilter === filter ? "active" : ""} key={filter} onClick={() => onFilter(filter)}>{filterLabels[filter]}</button>)}</div><div className="requester-account-list">{workOrders.length ? workOrders.map((workOrder) => <RequesterWorkOrderCard key={workOrder.id} workOrder={workOrder} timerNow={timerNow} onDetail={onDetail} busy={detailLoading} />) : <RequesterEmpty title="No matching work orders" copy="Try another status, scope, or search phrase." />}</div></section>;
}

function RequesterVerification({ workOrders, notes, actionId, detailLoading, timerNow, onNote, onVerify, onDetail }: { workOrders: WorkOrder[]; notes: Record<string, string>; actionId: string; detailLoading: boolean; timerNow: string; onNote: (id: string, note: string) => void; onVerify: (workOrder: WorkOrder, status: "closed" | "returned") => void; onDetail: (workOrder: WorkOrder) => void; }) {
  return <section className="requester-verify-view">
    <div className="requester-view-heading"><div><p>Action needed</p><h1>Check Completed Work</h1><span>Check the repair. Then close it or send it back.</span></div><ShieldCheck size={28} /></div>
    {workOrders.length ? <div className="requester-verification-list">{workOrders.map((workOrder) => {
      const needsReason = needsProductionDowntimeExplanation(workOrder);
      return <article className={`requester-verification-card ${needsReason ? "reason-pending" : ""}`} key={workOrder.id} role="button" tabIndex={0} aria-label={`Open ${workOrder.number} to review and close`} onClick={(event) => { if (!(event.target as HTMLElement).closest("button, textarea, input, label")) onDetail(workOrder); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onDetail(workOrder); } }}>
        <div className="card-topline"><strong>{workOrder.number}</strong><StatusBadge status={workOrder.status} /></div>
        {needsReason ? <div className="requester-reason-pending"><AlertTriangle size={18} /><span><strong>Reason Pending</strong><small>Follow up with maintenance now</small></span></div> : null}
        <RequesterElapsedTimer workOrder={workOrder} timerNow={timerNow} />
        {workOrder.maintenanceActualMinutes !== null ? <div className="requester-maintenance-actual"><Wrench size={17} /><span><small>Maintenance Actual</small><strong>{formatMinutes(workOrder.maintenanceActualMinutes)}</strong></span></div> : null}
        <h2>{workOrder.machineName || workOrder.location}</h2>
        <p>{workOrder.issueDescription}</p>
        {workOrder.completionNote ? <blockquote><strong>What maintenance did</strong>{workOrder.completionNote}</blockquote> : null}
        <button className="requester-view-evidence" type="button" disabled={detailLoading} onClick={() => onDetail(workOrder)}><Eye size={16} />View photos and updates</button>
        {needsReason ? <ReasonPrompt value={notes[workOrder.id] || ""} onChange={(value) => onNote(workOrder.id, value)} /> : <label>Note <small>Only required when sending back</small><textarea rows={2} value={notes[workOrder.id] || ""} onChange={(event) => onNote(workOrder.id, event.target.value)} placeholder="Optional note" /></label>}
        <div className="requester-verification-actions"><button type="button" className="verify" disabled={Boolean(actionId) || (needsReason && !notes[workOrder.id]?.trim())} onClick={() => onVerify(workOrder, "closed")}><CheckCircle2 size={17} />{actionId === workOrder.id ? "Saving..." : "Work is OK — Close"}</button><button type="button" className="return" disabled={Boolean(actionId)} onClick={() => onVerify(workOrder, "returned")}><RefreshCcw size={17} />Still Problem — Send Back</button></div>
      </article>;
    })}</div> : <RequesterEmpty title="Nothing to check" copy="Completed repairs that need your decision will appear here." />}
  </section>;
}

const downtimeReasonChoices = ["Waiting for technician", "Waiting for spare part", "Repair or testing still in progress", "Machine not released by production"];

function ReasonPrompt({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className="requester-reason-prompt">
    <div><AlertTriangle size={20} /><span><strong>Why is this taking longer?</strong><small>Ask maintenance, then tap one answer.</small></span></div>
    <div className="requester-reason-options">{downtimeReasonChoices.map((reason) => <button className={value === reason ? "selected" : ""} type="button" key={reason} onClick={() => onChange(reason)}>{reason}</button>)}</div>
    <label>Other reason<textarea rows={2} value={downtimeReasonChoices.includes(value) ? "" : value} onChange={(event) => onChange(event.target.value)} placeholder="Type only if none of the answers fit" /></label>
  </div>;
}

function RequesterWorkOrderCard({ workOrder, timerNow, onDetail, busy = false }: { workOrder: WorkOrder; timerNow: string; onDetail: (workOrder: WorkOrder) => void; busy?: boolean }) {
  const needsReason = needsProductionDowntimeExplanation(workOrder);
  function openCard() {
    if (!busy) onDetail(workOrder);
  }

  return <article className={`requester-account-card status-${workOrder.status} ${needsReason ? "reason-pending" : ""}`} role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy} aria-label={`Open details for ${workOrder.number}`} onClick={openCard} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openCard(); } }}>
    <div className="card-topline"><strong>{workOrder.number}</strong><StatusBadge status={workOrder.status} /></div>
    {needsReason ? <div className="requester-reason-pending"><AlertTriangle size={18} /><span><strong>Reason Pending</strong><small>Tap here and follow up with maintenance</small></span></div> : null}
    <div className="requester-card-times"><RequesterElapsedTimer workOrder={workOrder} timerNow={timerNow} />{workOrder.maintenanceActualMinutes !== null ? <div className="requester-maintenance-actual"><Wrench size={17} /><span><small>Maintenance Actual</small><strong>{formatMinutes(workOrder.maintenanceActualMinutes)}</strong></span></div> : null}</div>
    <span className="requester-department-chip">{workOrder.responsibleDepartment}</span><h3>{workOrder.machineName || workOrder.location}</h3><p>{workOrder.issueDescription}</p><div className="card-meta"><span>{workOrderTypeLabels[workOrder.type]}</span><span>{workOrder.area}</span>{workOrder.responsibleDepartment === "Production" && workOrder.shiftGroup !== "N/A" ? <span>Shift {workOrder.shiftGroup}</span> : null}</div><footer><time>{formatDateTime(workOrder.updatedAt)}</time><span className="requester-card-open-hint"><Eye size={15} />Tap to open</span></footer>
  </article>;
}

function RequesterDetailDialog({ detail, canVerify, timerNow, onClose, onVerify, onSaveReason, onCancel, onDelete, actionId, note, onNote }: { detail: WorkOrderDetail; canVerify: boolean; timerNow: string; onClose: () => void; onVerify: (workOrder: WorkOrder, status: "closed" | "returned") => void; onSaveReason: (workOrder: WorkOrder) => void; onCancel: (workOrder: WorkOrder) => void; onDelete: (workOrder: WorkOrder) => void; actionId: string; note: string; onNote: (note: string) => void; }) {
  const [previewPhoto, setPreviewPhoto] = useState<{ src: string; alt: string; label: string } | null>(null);
  const needsReason = needsProductionDowntimeExplanation(detail);
  const canCancel = canVerify && ["open", "acknowledged"].includes(detail.status) && !detail.maintenanceStartedAt;
  const canDelete = canVerify && ["open", "cancelled"].includes(detail.status) && !detail.assignedToId && !detail.maintenanceStartedAt;

  return <><div className="requester-detail-backdrop"><section className={`requester-detail-dialog ${needsReason ? "reason-pending" : ""}`} role="dialog" aria-modal="true" aria-labelledby="requester-detail-title">
    <button className="requester-dialog-close" type="button" onClick={onClose} aria-label="Close details"><X size={18} /></button>
    <div className="requester-detail-title"><p>{detail.number}</p><h2 id="requester-detail-title">{detail.machineName || detail.location}</h2><StatusBadge status={detail.status} /></div>
    {needsReason ? <div className="requester-reason-pending"><AlertTriangle size={18} /><span><strong>Reason Pending</strong><small>Follow up with maintenance now</small></span></div> : null}
    <p className="requester-detail-issue">{detail.issueDescription}</p>
    <div className="requester-card-times"><RequesterElapsedTimer workOrder={detail} timerNow={timerNow} detailed />{detail.maintenanceActualMinutes !== null ? <div className="requester-maintenance-actual"><Wrench size={17} /><span><small>Maintenance Actual</small><strong>{formatMinutes(detail.maintenanceActualMinutes)}</strong></span></div> : null}</div>
    <dl><div><dt>Department</dt><dd>{detail.responsibleDepartment}</dd></div><div><dt>Area</dt><dd>{detail.area}</dd></div><div><dt>Problem type</dt><dd>{detail.issueCategoryName || detail.issueCategory?.name || "General"}</dd></div><div><dt>Technician</dt><dd>{detail.assignedTo?.name || "Waiting for technician"}</dd></div><div><dt>Opened</dt><dd>{formatDateTime(detail.createdAt)}</dd></div><div><dt>Last update</dt><dd>{formatDateTime(detail.updatedAt)}</dd></div></dl>
    {detail.completionNote ? <div className="requester-completion-note"><strong>What maintenance did</strong><p>{detail.completionNote}</p></div> : null}
    {detail.productionDowntimeReason ? <div className="requester-completion-note"><strong>Why it took longer</strong><p>{detail.productionDowntimeReason}</p></div> : null}
    {needsReason ? <div className="requester-detail-reason"><ReasonPrompt value={note} onChange={onNote} /><button type="button" className="requester-save-reason" disabled={Boolean(actionId) || !note.trim()} onClick={() => onSaveReason(detail)}>{actionId === detail.id ? "Saving..." : "Save Reason"}</button></div> : null}
    <div className="requester-detail-photos"><h3>Photos</h3>{detail.attachments.length ? <div>{detail.attachments.map((attachment) => { const label = attachment.kind.replace("_", " "); return <button type="button" key={attachment.id} onClick={() => setPreviewPhoto({ src: mediaUrl(attachment.url), alt: attachment.originalName, label })}><img src={mediaUrl(attachment.url)} alt={attachment.originalName} /><span>{label}</span></button>; })}</div> : <p>No photos uploaded.</p>}</div>
    <div className="requester-detail-timeline"><h3>Updates</h3>{detail.activities.map((activity) => <article key={activity.id}><span /><div><strong>{activity.message}</strong><time>{formatDateTime(activity.createdAt)}</time></div></article>)}</div>
    {detail.status === "resolved" && canVerify ? <div className="requester-detail-verification">{!needsReason ? <label>Note<textarea rows={2} value={note} onChange={(event) => onNote(event.target.value)} placeholder="Only required when sending back" /></label> : null}<div className="requester-verification-actions"><button type="button" className="verify" disabled={Boolean(actionId) || (needsReason && !note.trim())} onClick={() => onVerify(detail, "closed")}><CheckCircle2 size={17} />Work is OK — Close</button><button type="button" className="return" disabled={Boolean(actionId)} onClick={() => onVerify(detail, "returned")}><RefreshCcw size={17} />Still Problem — Send Back</button></div></div> : null}
    {canCancel || canDelete ? <div className="requester-owner-actions">
      {canCancel ? <button type="button" className="requester-cancel-work-order" disabled={Boolean(actionId)} onClick={() => onCancel(detail)}><X size={17} />{actionId === detail.id ? "Saving..." : "Cancel request"}</button> : null}
      {canDelete ? <button type="button" className="requester-delete-work-order" disabled={Boolean(actionId)} onClick={() => onDelete(detail)}><Trash2 size={17} />{actionId === detail.id ? "Deleting..." : "Delete test request"}</button> : null}
    </div> : null}
  </section></div>{previewPhoto ? <ImageLightbox {...previewPhoto} onClose={() => setPreviewPhoto(null)} /> : null}</>;
}

function RequesterElapsedTimer({ workOrder, timerNow, detailed = false }: { workOrder: WorkOrder; timerNow: string; detailed?: boolean }) {
  const running = !["closed", "cancelled"].includes(workOrder.status);
  const end = running ? timerNow : workOrder.closedAt || workOrder.updatedAt;
  return <div className={`requester-elapsed-timer ${running ? "is-live" : "is-stopped"} ${detailed ? "is-detailed" : ""}`}><Clock3 size={detailed ? 21 : 17} aria-hidden="true" /><span><small>Total Time</small><strong>{formatLiveDuration(workOrder.createdAt, end)}</strong></span>{detailed ? <time>{running ? "Still open" : workOrder.status === "closed" ? `Closed ${formatDateTime(end)}` : `Cancelled ${formatDateTime(end)}`}</time> : null}</div>;
}

function RequesterEmpty({ title, copy }: { title: string; copy: string }) { return <div className="requester-empty"><ClipboardList size={30} /><h2>{title}</h2><p>{copy}</p></div>; }
function RequesterTab({ active, label, Icon, badge = 0, onClick }: { active: boolean; label: string; Icon: LucideIcon; badge?: number; onClick: () => void; }) { return <button type="button" className={active ? "active" : ""} onClick={onClick}><span><Icon size={20} />{badge ? <b>{badge}</b> : null}</span><small>{label}</small></button>; }
function initialsFor(name: string) { return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
