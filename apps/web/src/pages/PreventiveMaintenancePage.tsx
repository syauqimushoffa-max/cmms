import {
  AlertCircle,
  ArrowLeft,
  CalendarCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  ClipboardCheck,
  Clock3,
  CopyPlus,
  FileCheck2,
  Filter,
  Gauge,
  ImagePlus,
  ListChecks,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  Wrench,
  X,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import type {
  PmChecklistTemplate,
  PmDashboardResponse,
  PmPlan,
  PmResultCode,
  PmScheduleDetail,
  PmScheduleItem,
  SavePmTemplateInput,
  UpdatePmPlanInput,
  User
} from "@pbs-cmms/shared";
import { api, mediaUrl } from "../api/client";
import { useCurrentUser } from "../state/UserContext";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const shortMonths = months.map((month) => month.slice(0, 3));
const resultOptions: Array<{ code: PmResultCode; label: string; icon: typeof Check }> = [
  { code: "pass", label: "Pass", icon: Check },
  { code: "adjusted", label: "Adjusted", icon: Wrench },
  { code: "fail", label: "Fail", icon: X },
  { code: "not_applicable", label: "N/A", icon: CircleDashed }
];

function formatPmDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function scheduleStatusLabel(schedule: PmScheduleItem) {
  if (schedule.status === "verified") return "Verified";
  if (schedule.status === "submitted") return "Awaiting verification";
  if (schedule.status === "in_progress") return "In progress";
  if (schedule.overdue) return "Overdue";
  return "Scheduled";
}

function scheduleTone(schedule: PmScheduleItem) {
  if (schedule.status === "verified") return "verified";
  if (schedule.status === "submitted") return "submitted";
  if (schedule.overdue) return "overdue";
  return schedule.status;
}

export function PreventiveMaintenancePage() {
  const location = useLocation();
  const { currentUser } = useCurrentUser();
  const routeTail = location.pathname.replace(/^\/preventive-maintenance\/?/, "");
  const scheduleId = routeTail && !["schedule", "checklists"].includes(routeTail) ? routeTail : "";

  if (currentUser?.role === "requester") {
    return <Navigate to="/work-orders" replace />;
  }
  if (scheduleId) {
    return <PmChecklistExecution scheduleId={scheduleId} />;
  }
  return <PmCommandCenter />;
}

function PmCommandCenter() {
  const { currentUser } = useCurrentUser();
  const navigate = useNavigate();
  const location = useLocation();
  const isManager = currentUser ? ["executive", "admin", "developer"].includes(currentUser.role) : false;
  const [data, setData] = useState<PmDashboardResponse | null>(null);
  const [maintenanceTechnicians, setMaintenanceTechnicians] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [technician, setTechnician] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [templateEditor, setTemplateEditor] = useState<PmChecklistTemplate | "new" | null>(null);
  const [planEditor, setPlanEditor] = useState<PmPlan | null>(null);
  const [assigningPlanId, setAssigningPlanId] = useState("");
  const year = new Date().getFullYear();
  const activeView: "overview" | "schedule" | "templates" = !isManager
    ? "schedule"
    : location.pathname.endsWith("/schedule")
      ? "schedule"
      : location.pathname.endsWith("/checklists")
        ? "templates"
        : "overview";

  async function load() {
    if (!currentUser) return;
    setLoading(true);
    setError("");
    try {
      const [dashboard, technicianUsers] = await Promise.all([
        api.pmDashboard(currentUser.id, year),
        isManager ? api.usersByRole("technician") : Promise.resolve([])
      ]);
      setData(dashboard);
      setMaintenanceTechnicians(technicianUsers);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load preventive maintenance.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, [currentUser?.id]);

  useLiveRefresh(["pm"], load, { enabled: Boolean(currentUser) });

  const technicians = useMemo(() => {
    return [...new Set((data?.plans || []).map((plan) => plan.technicianName))].sort();
  }, [data?.plans]);

  const filteredSchedules = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.schedules || []).filter((item) => {
      const matchesMonth = item.month === month;
      const matchesTech = technician === "all" || item.technicianName === technician;
      const derivedStatus = item.overdue && item.status === "scheduled" ? "overdue" : item.status;
      const matchesStatus = status === "all" || derivedStatus === status;
      const matchesSearch = !query || `${item.machineName} ${item.mainMachine} ${item.technicianName}`.toLowerCase().includes(query);
      return matchesMonth && matchesTech && matchesStatus && matchesSearch;
    });
  }, [data?.schedules, month, technician, status, search]);

  const nextAssignments = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return (data?.schedules || [])
      .filter((item) => !["submitted", "verified"].includes(item.status) && item.scheduledDate >= today)
      .slice(0, 6);
  }, [data?.schedules]);

  if (loading && !data) {
    return <PmLoading />;
  }

  if (!isManager) {
    if (!data) {
      return <div className="pm-page"><div className="pm-alert" role="alert"><AlertCircle size={18} />{error || "Unable to load your PM assignments."}</div></div>;
    }
    return <PmTechnicianHome data={data} technicianName={currentUser?.name || "Technician"} onOpen={(id) => navigate(`/preventive-maintenance/${id}`)} />;
  }

  return (
    <section className="pm-page page-stack">
      <header className="pm-hero">
        <div className="pm-hero-copy">
          <div className="pm-eyebrow"><Sparkles size={15} /> Preventive maintenance command center</div>
          <h1>{isManager ? "Preventive Maintenance" : `Good day, ${currentUser?.name}.`}</h1>
          <p>
            {isManager
              ? `A live ${year} plan built from PBS's master schedule, connected to technician-owned digital checklists.`
              : "Your assigned machines and the exact checklist you need are ready in one place."}
          </p>
          <div className="pm-hero-actions">
            {isManager && <button className="pm-button pm-button-light" type="button" onClick={() => setPlanEditor({ id: "", mainMachine: "", machineName: "", frequencyLabel: "Monthly", frequencyMonths: 1, occurrencesPerMonth: 1, technicianId: maintenanceTechnicians[0]?.id || "", technicianName: "", templateId: null, startMonth: new Date().getMonth() + 1, weekOfMonth: 1, secondaryWeek: null, active: true })}><Plus size={17} /> New PM plan</button>}
            <button className="pm-button pm-button-light" type="button" onClick={() => navigate("/preventive-maintenance/schedule")}>
              <CalendarCheck size={17} /> View {isManager ? "schedule" : "my assignments"}
            </button>
            {isManager ? (
              <button className="pm-button pm-button-ghost" type="button" onClick={() => { navigate("/preventive-maintenance/checklists"); setTemplateEditor("new"); }}>
                <Plus size={17} /> New checklist
              </button>
            ) : null}
          </div>
        </div>
        <div className="pm-compliance-orbit" style={{ "--pm-progress": `${data?.summary.compliancePercent || 0}%` } as React.CSSProperties}>
          <div>
            <strong>{data?.summary.compliancePercent ?? 0}%</strong>
            <span>Monthly compliance</span>
          </div>
        </div>
      </header>

      {error ? <div className="pm-alert" role="alert"><AlertCircle size={17} /> {error}</div> : null}

      <div className="pm-metric-grid">
        <PmMetric icon={CalendarDays} label="Scheduled this month" value={data?.summary.scheduledThisMonth || 0} detail={`${data?.summary.dueThisWeek || 0} due this week`} />
        <PmMetric icon={Clock3} label="Overdue" value={data?.summary.overdue || 0} detail="Needs attention" tone="danger" />
        <PmMetric icon={CheckCircle2} label="Completed" value={data?.summary.completedThisMonth || 0} detail="This month" tone="success" />
        <PmMetric icon={ListChecks} label="Checklist coverage" value={`${data?.summary.checklistCoveragePercent || 0}%`} detail={`${data?.templates.length || 0} digital template`} tone="gold" />
      </div>

      <div className={`pm-view-stage pm-view-${activeView}`} key={activeView}>
        {activeView === "overview" && isManager ? (
          <PmOverview data={data!} nextAssignments={nextAssignments} onOpen={(id) => navigate(`/preventive-maintenance/${id}`)} onOpenTemplates={() => navigate("/preventive-maintenance/checklists")} />
        ) : null}

        {activeView === "schedule" ? (
          <div className="pm-schedule-section">
          <div className="pm-section-heading">
            <div><span>{year} live plan</span><h2>{isManager ? "Maintenance schedule" : "My PM assignments"}</h2></div>
            <strong>{filteredSchedules.length} assignment{filteredSchedules.length === 1 ? "" : "s"}</strong>
          </div>

          <div className="pm-month-rail" role="tablist" aria-label="Schedule month">
            {shortMonths.map((label, index) => {
              const monthNumber = index + 1;
              const count = (data?.schedules || []).filter((item) => item.month === monthNumber).length;
              return <button type="button" role="tab" aria-selected={month === monthNumber} className={month === monthNumber ? "active" : ""} key={label} onClick={() => setMonth(monthNumber)}><span>{label}</span><small>{count}</small></button>;
            })}
          </div>

          <div className="pm-filter-bar">
            <label className="pm-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search machine or section" /></label>
            {isManager ? <label><UserRound size={16} /><select value={technician} onChange={(event) => setTechnician(event.target.value)}><option value="all">All technicians</option>{technicians.map((name) => <option key={name}>{name}</option>)}</select></label> : null}
            <label><Filter size={16} /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All status</option><option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="submitted">Submitted</option><option value="verified">Verified</option><option value="overdue">Overdue</option></select></label>
          </div>

          <div className="pm-assignment-list">
            {filteredSchedules.length ? filteredSchedules.map((item) => (
              <PmAssignmentCard
                key={item.id}
                item={item}
                manager={isManager}
                onOpen={() => navigate(`/preventive-maintenance/${item.id}`)}
                onEditPlan={() => setPlanEditor(data?.plans.find((plan) => plan.id === item.planId) || null)}
              />
            )) : <div className="pm-empty"><CalendarCheck size={28} /><h3>No assignments found</h3><p>Try another month or clear the current filters.</p></div>}
          </div>
          </div>
        ) : null}

        {activeView === "templates" && isManager ? (
          <PmTemplateLibrary
            templates={data?.templates || []}
            plans={data?.plans || []}
            assigningPlanId={assigningPlanId}
            setAssigningPlanId={setAssigningPlanId}
            onEdit={setTemplateEditor}
            onNew={() => setTemplateEditor("new")}
            onAssigned={load}
            actorId={currentUser!.id}
          />
        ) : null}
      </div>

      {templateEditor ? (
        <PmTemplateEditor
          template={templateEditor === "new" ? null : templateEditor}
          actorId={currentUser!.id}
          onClose={() => setTemplateEditor(null)}
          onSaved={async () => { setTemplateEditor(null); await load(); }}
        />
      ) : null}

      {planEditor ? (
        <PmPlanEditor
          plan={planEditor}
          technicians={maintenanceTechnicians}
          actorId={currentUser!.id}
          onClose={() => setPlanEditor(null)}
          onSaved={async () => { setPlanEditor(null); await load(); }}
        />
      ) : null}
    </section>
  );
}

function PmMetric({ icon: Icon, label, value, detail, tone = "default" }: { icon: typeof CalendarDays; label: string; value: number | string; detail: string; tone?: string }) {
  return <article className={`pm-metric pm-metric-${tone}`}><span><Icon size={19} /></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function pmDueLabel(schedule: PmScheduleItem) {
  if (schedule.status === "submitted") return "Sent for approval";
  if (schedule.status === "verified") return "Completed";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${schedule.scheduledDate}T00:00:00`);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days > 1) return `Due in ${days} days`;
  if (days === -1) return "1 day overdue";
  return `${Math.abs(days)} days overdue`;
}

function PmTechnicianHome({ data, technicianName, onOpen }: { data: PmDashboardResponse; technicianName: string; onOpen: (id: string) => void }) {
  const [queueView, setQueueView] = useState<"todo" | "completed">("todo");
  const [scheduleRange, setScheduleRange] = useState<"month" | "date">("month");
  const today = new Date();
  const todayKey = formatDateKey(today);
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();
  const currentMonthKey = `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [selectedYear, selectedMonthNumber] = selectedMonth.split("-").map(Number);
  const isCurrentMonth = selectedMonth === currentMonthKey;
  const selectedPeriodKey = scheduleRange === "month" ? selectedMonth : selectedDate;
  const periodLabel = scheduleRange === "month"
    ? new Date(selectedYear, selectedMonthNumber - 1, 1).toLocaleDateString("en-MY", { month: "long", year: "numeric" })
    : new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric" });

  function matchesSelectedPeriod(item: PmScheduleItem) {
    return scheduleRange === "month"
      ? item.year === selectedYear && item.month === selectedMonthNumber
      : item.scheduledDate === selectedDate;
  }

  function movePeriod(offset: number) {
    if (scheduleRange === "month") {
      const next = new Date(selectedYear, selectedMonthNumber - 1 + offset, 1);
      setSelectedMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
      return;
    }
    const next = new Date(`${selectedDate}T00:00:00`);
    next.setDate(next.getDate() + offset);
    setSelectedDate(formatDateKey(next));
  }

  function showToday() {
    setSelectedMonth(currentMonthKey);
    setSelectedDate(todayKey);
  }

  const openScheduleCandidates = data.schedules
    .filter((item) => item.templateId && ["scheduled", "in_progress"].includes(item.status))
    .filter((item) => scheduleRange === "month" && isCurrentMonth
      ? item.overdue || matchesSelectedPeriod(item)
      : matchesSelectedPeriod(item))
    .sort((left, right) => {
      if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
      return left.overdue
        ? right.scheduledDate.localeCompare(left.scheduledDate)
        : left.scheduledDate.localeCompare(right.scheduledDate);
    });
  const visiblePlanIds = new Set<string>();
  const openSchedules = openScheduleCandidates.filter((item) => {
    if (!(scheduleRange === "month" && isCurrentMonth)) return true;
    if (visiblePlanIds.has(item.planId)) return false;
    visiblePlanIds.add(item.planId);
    return true;
  });
  const completedSchedules = data.schedules
    .filter((item) => item.templateId && ["submitted", "verified"].includes(item.status) && matchesSelectedPeriod(item))
    .sort((left, right) => right.scheduledDate.localeCompare(left.scheduledDate));
  const preparingCount = data.schedules.filter((item) => !item.templateId && ["scheduled", "in_progress"].includes(item.status) && (
    scheduleRange === "month" && isCurrentMonth ? item.overdue || matchesSelectedPeriod(item) : matchesSelectedPeriod(item)
  )).length;
  const actionableOverdue = openSchedules.filter((item) => item.overdue).length;
  const awaitingCount = completedSchedules.filter((item) => item.status === "submitted").length;
  const visibleSchedules = queueView === "todo" ? openSchedules : completedSchedules;
  const firstName = technicianName.trim().split(/\s+/)[0] || "Technician";

  return (
    <section className="pm-tech-home">
      <header className="pm-tech-welcome">
        <div><span>My PM work</span><h1>Hello, {firstName}</h1><p>Choose a machine below. We’ll guide you through the inspection one step at a time.</p></div>
        <div className="pm-tech-date"><CalendarDays size={20} /><span>Today</span><strong>{today.toLocaleDateString("en-MY", { day: "numeric", month: "short" })}</strong></div>
      </header>

      <section className="pm-tech-guide" aria-label="How preventive maintenance works">
        <div className="pm-tech-guide-title"><Sparkles size={18} /><span><strong>New to PM?</strong><small>Just follow these three steps</small></span></div>
        <ol>
          <li><b>1</b><span><strong>Open a machine</strong><small>Tap Start PM below</small></span></li>
          <li><b>2</b><span><strong>Do each check</strong><small>Choose the result</small></span></li>
          <li><b>3</b><span><strong>Add photos</strong><small>Then submit</small></span></li>
        </ol>
      </section>

      <div className="pm-tech-focus-strip">
        <article><ListChecks size={19} /><span>Ready</span><strong>{openSchedules.length}</strong></article>
        <article className={actionableOverdue ? "attention" : ""}><Clock3 size={19} /><span>Overdue</span><strong>{actionableOverdue}</strong></article>
        <article><ShieldCheck size={19} /><span>Submitted</span><strong>{awaitingCount}</strong></article>
      </div>

      <section className="pm-tech-period-browser" aria-label="Choose PM schedule period">
        <div className="pm-tech-range-toggle" role="group" aria-label="View schedule by month or date">
          <button type="button" className={scheduleRange === "month" ? "active" : ""} aria-pressed={scheduleRange === "month"} onClick={() => setScheduleRange("month")}>Month</button>
          <button type="button" className={scheduleRange === "date" ? "active" : ""} aria-pressed={scheduleRange === "date"} onClick={() => setScheduleRange("date")}>Date</button>
        </div>
        <div className="pm-tech-period-controls">
          <button type="button" className="pm-tech-period-arrow" onClick={() => movePeriod(-1)} aria-label={scheduleRange === "month" ? "Previous month" : "Previous day"}><ChevronLeft size={20} /></button>
          {scheduleRange === "month" ? (
            <input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} aria-label="Choose schedule month" />
          ) : (
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} aria-label="Choose schedule date" />
          )}
          <button type="button" className="pm-tech-period-arrow" onClick={() => movePeriod(1)} aria-label={scheduleRange === "month" ? "Next month" : "Next day"}><ChevronRight size={20} /></button>
          <button type="button" className="pm-tech-today-button" onClick={showToday}>Today</button>
        </div>
      </section>

      <div className="pm-tech-queue-heading">
        <div><span>{periodLabel}</span><h2>{queueView === "todo" ? (scheduleRange === "month" && isCurrentMonth ? "What to do next" : "Scheduled PM") : "Completed PM"}</h2></div>
        <div className="pm-tech-queue-tabs" role="tablist" aria-label="PM assignment status">
          <button type="button" role="tab" aria-selected={queueView === "todo"} className={queueView === "todo" ? "active" : ""} onClick={() => setQueueView("todo")}>To do</button>
          <button type="button" role="tab" aria-selected={queueView === "completed"} className={queueView === "completed" ? "active" : ""} onClick={() => setQueueView("completed")}>Completed</button>
        </div>
      </div>

      {visibleSchedules.length ? (
        <div className="pm-tech-list" key={`${selectedPeriodKey}-${queueView}`}>
          {visibleSchedules.map((item) => {
            const progress = item.checklistItemCount ? Math.round((item.completedItemCount / item.checklistItemCount) * 100) : 0;
            const actionLabel = item.status === "scheduled" ? "Start PM" : item.status === "in_progress" ? "Continue PM" : "View PM";
            return (
              <article className={`pm-tech-card ${scheduleTone(item)}`} key={item.id}>
                <div className="pm-tech-card-top">
                  <span className={`pm-status-pill ${scheduleTone(item)}`}>{scheduleStatusLabel(item)}</span>
                  <time className={item.overdue ? "overdue" : ""}><CalendarDays size={14} />{pmDueLabel(item)}</time>
                </div>
                <div className="pm-tech-card-title"><span><Wrench size={19} /></span><div><h3>{item.machineName}</h3><p>{item.mainMachine} · {item.frequencyLabel}</p></div></div>
                {item.templateId ? <div className="pm-tech-card-progress"><div><span>Checklist progress</span><strong>{item.completedItemCount}/{item.checklistItemCount}</strong></div><span><i style={{ width: `${progress}%` }} /></span></div> : <div className="pm-tech-not-ready"><Clock3 size={17} /><span><strong>Checklist is being prepared</strong><small>No action needed from you yet.</small></span></div>}
                <button type="button" disabled={!item.templateId} onClick={() => onOpen(item.id)}>{item.templateId ? actionLabel : "Not ready yet"}<ChevronRight size={19} /></button>
              </article>
            );
          })}
        </div>
      ) : <div className="pm-tech-empty" key={`empty-${selectedPeriodKey}-${queueView}`}><CheckCircle2 size={31} /><h3>{queueView === "todo" ? (scheduleRange === "month" && isCurrentMonth ? "Nothing you need to do now" : "No PM scheduled") : "Nothing completed yet"}</h3><p>{queueView === "todo" ? preparingCount ? "Your supervisor is preparing the checklist for this period." : scheduleRange === "month" && isCurrentMonth ? "There are no PM jobs needing attention right now." : `No PM assignments were found for ${periodLabel}.` : `No completed PM was found for ${periodLabel}.`}</p></div>}
    </section>
  );
}

function PmCalendar({ schedules, onOpen }: { schedules: PmScheduleItem[]; onOpen: (id: string) => void }) {
  const today = new Date();
  const todayKey = formatDateKey(today);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, PmScheduleItem[]>();
    schedules.forEach((schedule) => grouped.set(schedule.scheduledDate, [...(grouped.get(schedule.scheduledDate) || []), schedule]));
    return grouped;
  }, [schedules]);
  const calendarDays = useMemo(() => {
    const first = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      return date;
    });
  }, [visibleMonth]);
  const selectedEvents = eventsByDate.get(selectedDate) || [];
  const nextPm = schedules
    .filter((schedule) => schedule.scheduledDate >= todayKey && !["submitted", "verified"].includes(schedule.status))
    .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate))[0];

  function moveMonth(offset: number) {
    const next = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1);
    setVisibleMonth(next);
    setSelectedDate(formatDateKey(next));
  }

  function showToday() {
    setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(todayKey);
  }

  return (
    <section className="pm-calendar-panel">
      <header className="pm-calendar-header">
        <div>
          <span>PM master calendar</span>
          <h2>{months[visibleMonth.getMonth()]} {visibleMonth.getFullYear()}</h2>
        </div>
        {nextPm ? (
          <div className="pm-next-event-chip">
            <span className={`pm-calendar-dot ${scheduleTone(nextPm)}`} />
            <div><small>Next PM</small><strong>{nextPm.machineName}</strong><span>{formatPmDate(nextPm.scheduledDate)} · {nextPm.technicianName}</span></div>
          </div>
        ) : null}
        <div className="pm-calendar-controls">
          <button type="button" onClick={showToday}>Today</button>
          <button type="button" onClick={() => moveMonth(-1)} aria-label="Previous month"><ChevronLeft size={18} /></button>
          <button type="button" onClick={() => moveMonth(1)} aria-label="Next month"><ChevronRight size={18} /></button>
        </div>
      </header>
      <div className="pm-calendar-layout">
        <div className="pm-calendar-month">
          <div className="pm-weekday-row">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="pm-calendar-grid">
            {calendarDays.map((date) => {
              const dateKey = formatDateKey(date);
              const events = eventsByDate.get(dateKey) || [];
              const inMonth = date.getMonth() === visibleMonth.getMonth();
              const selected = selectedDate === dateKey;
              const isToday = dateKey === todayKey;
              return (
                <button
                  type="button"
                  key={dateKey}
                  className={`${inMonth ? "" : "outside"} ${selected ? "selected" : ""} ${isToday ? "today" : ""}`}
                  onClick={() => setSelectedDate(dateKey)}
                  aria-label={`${date.getDate()} ${months[date.getMonth()]}, ${events.length} PM assignment${events.length === 1 ? "" : "s"}`}
                >
                  <time>{date.getDate()}</time>
                  <span className="pm-calendar-dots">
                    {events.slice(0, 4).map((event) => <i className={scheduleTone(event)} key={event.id} />)}
                    {events.length > 4 ? <small>+{events.length - 4}</small> : null}
                  </span>
                  {events.length ? <strong>{events.length} PM</strong> : null}
                </button>
              );
            })}
          </div>
        </div>
        <aside className="pm-calendar-agenda">
          <div className="pm-agenda-date">
            <span>{new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-MY", { weekday: "long" })}</span>
            <strong>{formatPmDate(selectedDate)}</strong>
            <small>{selectedEvents.length} assignment{selectedEvents.length === 1 ? "" : "s"}</small>
          </div>
          <div className="pm-agenda-list">
            {selectedEvents.length ? selectedEvents.map((event) => (
              <button type="button" key={event.id} onClick={() => onOpen(event.id)}>
                <span className={`pm-calendar-dot ${scheduleTone(event)}`} />
                <div><strong>{event.machineName}</strong><span>{event.mainMachine}</span><small><UserRound size={12} />{event.technicianName} · Week {event.weekOfMonth}</small></div>
                <ChevronRight size={17} />
              </button>
            )) : (
              <div className="pm-agenda-empty"><CalendarCheck size={25} /><strong>No PM planned</strong><span>Select a day with a dot to see its machines.</span></div>
            )}
          </div>
          <div className="pm-calendar-legend">
            <span><i className="scheduled" />Scheduled</span>
            <span><i className="overdue" />Overdue</span>
            <span><i className="in_progress" />In progress</span>
            <span><i className="verified" />Verified</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function PmOverview({ data, nextAssignments, onOpen, onOpenTemplates }: { data: PmDashboardResponse; nextAssignments: PmScheduleItem[]; onOpen: (id: string) => void; onOpenTemplates: () => void }) {
  const uncovered = data.plans.filter((plan) => !plan.templateId);
  const teamLoads = [...new Set(data.plans.map((plan) => plan.technicianName))].map((name) => ({
    name,
    count: data.schedules.filter((schedule) => schedule.technicianName === name && schedule.month === new Date().getMonth() + 1).length,
    complete: data.schedules.filter((schedule) => schedule.technicianName === name && schedule.month === new Date().getMonth() + 1 && ["submitted", "verified"].includes(schedule.status)).length
  }));
  const maxLoad = Math.max(...teamLoads.map((item) => item.count), 1);
  return (
    <div className="pm-overview-stack">
      <PmCalendar schedules={data.schedules} onOpen={onOpen} />
      <div className="pm-overview-grid">
      <section className="pm-panel pm-next-panel">
        <div className="pm-panel-heading"><div><span>Coming up</span><h2>Next assignments</h2></div></div>
        <div className="pm-timeline">
          {nextAssignments.map((item) => <button type="button" key={item.id} onClick={() => onOpen(item.id)}><span className={`pm-timeline-dot ${item.overdue ? "overdue" : ""}`} /><time>{formatPmDate(item.scheduledDate)}</time><div><strong>{item.machineName}</strong><small>{item.technicianName} · Week {item.weekOfMonth}</small></div><ChevronRight size={18} /></button>)}
        </div>
      </section>
      <section className="pm-panel pm-team-panel">
        <div className="pm-panel-heading"><div><span>Capacity</span><h2>Team workload</h2></div><small>This month</small></div>
        <div className="pm-load-list">
          {teamLoads.map((item) => <div key={item.name}><span className="pm-avatar">{item.name.slice(0, 2).toUpperCase()}</span><div><strong>{item.name}</strong><span><i style={{ width: `${(item.count / maxLoad) * 100}%` }} /></span></div><b>{item.complete}/{item.count}</b></div>)}
        </div>
      </section>
      <section className="pm-panel pm-coverage-panel">
        <div className="pm-panel-heading"><div><span>Digital readiness</span><h2>Checklist coverage</h2></div><button type="button" onClick={onOpenTemplates}>Manage</button></div>
        <div className="pm-coverage-stat"><strong>{data.summary.checklistCoveragePercent}%</strong><div><span><i style={{ width: `${data.summary.checklistCoveragePercent}%` }} /></span><p>{data.plans.length - uncovered.length} of {data.plans.length} machine plans connected</p></div></div>
        <div className="pm-coverage-callout"><AlertCircle size={18} /><div><strong>{uncovered.length} checklists still needed</strong><p>Your full schedule is active. Upload or build these checklists progressively without losing assignments.</p></div></div>
      </section>
      </div>
    </div>
  );
}

function PmAssignmentCard({ item, manager, onOpen, onEditPlan }: { item: PmScheduleItem; manager: boolean; onOpen: () => void; onEditPlan: () => void }) {
  const progress = item.checklistItemCount ? Math.round((item.completedItemCount / item.checklistItemCount) * 100) : 0;
  return (
    <article className={`pm-assignment-card ${scheduleTone(item)}`}>
      <div className="pm-date-block"><strong>{String(new Date(`${item.scheduledDate}T00:00:00`).getDate()).padStart(2, "0")}</strong><span>{shortMonths[item.month - 1]}</span><small>W{item.weekOfMonth}</small></div>
      <div className="pm-assignment-main">
        <div className="pm-assignment-top"><span className={`pm-status-pill ${scheduleTone(item)}`}>{scheduleStatusLabel(item)}</span><span>{item.mainMachine}</span></div>
        <h3>{item.machineName}</h3>
        <div className="pm-assignment-meta"><span><UserRound size={14} />{item.technicianName}</span><span><Clock3 size={14} />{item.frequencyLabel}</span></div>
      </div>
      <div className="pm-checklist-state">
        {item.templateId ? <><div><span>Checklist progress</span><strong>{item.completedItemCount}/{item.checklistItemCount}</strong></div><span className="pm-progress-track"><i style={{ width: `${progress}%` }} /></span>{item.failedItemCount ? <small className="failed"><AlertCircle size={13} />{item.failedItemCount} failed item</small> : <small><FileCheck2 size={13} />{item.templateTitle}</small>}</> : <div className="pm-missing-checklist"><AlertCircle size={18} /><span><strong>Checklist pending</strong><small>{manager ? "Connect a template in Checklists" : "Maintenance executive is preparing it"}</small></span></div>}
      </div>
      <div className="pm-card-actions">
        {manager ? <button className="pm-card-edit" type="button" onClick={onEditPlan}><Pencil size={15} />Edit schedule</button> : null}
        <button className="pm-card-open" type="button" onClick={onOpen} disabled={!item.templateId && !manager}>{item.templateId ? (item.status === "scheduled" ? "Open checklist" : "View checklist") : manager ? "View assignment" : "Not ready"}<ChevronRight size={17} /></button>
      </div>
    </article>
  );
}

function PmPlanEditor({ plan, technicians, actorId, onClose, onSaved }: { plan: PmPlan; technicians: User[]; actorId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [mainMachine, setMainMachine] = useState(plan.mainMachine);
  const [machineName, setMachineName] = useState(plan.machineName);
  const [frequencyMonths, setFrequencyMonths] = useState(plan.frequencyMonths);
  const [occurrencesPerMonth, setOccurrencesPerMonth] = useState(plan.occurrencesPerMonth);
  const [technicianId, setTechnicianId] = useState(plan.technicianId);
  const [startMonth, setStartMonth] = useState(plan.startMonth);
  const [weekOfMonth, setWeekOfMonth] = useState(plan.weekOfMonth);
  const [secondaryWeek, setSecondaryWeek] = useState(plan.secondaryWeek || 3);
  const [active, setActive] = useState(plan.active);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const input: UpdatePmPlanInput = {
      actorId,
      mainMachine,
      machineName,
      frequencyMonths,
      occurrencesPerMonth,
      technicianId,
      startMonth,
      weekOfMonth,
      secondaryWeek: occurrencesPerMonth === 2 ? secondaryWeek : null,
      active
    };
    try {
      if (plan.id) await api.updatePmPlan(plan.id, input);
      else await api.createPmPlan(input);
      await onSaved();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to update PM plan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pm-modal-backdrop" role="presentation">
      <form className="pm-template-editor pm-plan-editor" onSubmit={submit}>
        <header>
          <div><span>Recurring PM schedule</span><h2>{plan.id ? "Edit schedule" : "New PM plan"}</h2></div>
          <button type="button" onClick={onClose} aria-label="Close schedule editor"><X size={21} /></button>
        </header>
        <div className="pm-editor-scroll">
          {error ? <div className="pm-alert" role="alert"><AlertCircle size={16} />{error}</div> : null}
          <div className="pm-plan-editor-note"><CalendarCheck size={21} /><div><strong>Future assignments update automatically</strong><p>Completed and in-progress inspections remain unchanged. Only upcoming scheduled work is regenerated.</p></div></div>
          <section className="pm-editor-details pm-plan-fields">
            <label>Section / line<input required value={mainMachine} onChange={(event) => setMainMachine(event.target.value)} /></label>
            <label className="wide">PM schedule / machine name<input required value={machineName} onChange={(event) => setMachineName(event.target.value)} /></label>
            <label>Technician<select value={technicianId} onChange={(event) => setTechnicianId(event.target.value)}>{technicians.map((technician) => <option value={technician.id} key={technician.id}>{technician.name}</option>)}</select></label>
            <label>Interval<select value={frequencyMonths} onChange={(event) => { const value = Number(event.target.value); setFrequencyMonths(value); if (value !== 1) setOccurrencesPerMonth(1); }}><option value={1}>Every month</option><option value={2}>Every 2 months</option><option value={3}>Every 3 months</option><option value={4}>Every 4 months</option><option value={6}>Every 6 months</option><option value={12}>Every 12 months</option></select></label>
            <label>Occurrences<select value={occurrencesPerMonth} disabled={frequencyMonths !== 1} onChange={(event) => { const value = Number(event.target.value); setOccurrencesPerMonth(value); if (value === 2 && secondaryWeek === weekOfMonth) setSecondaryWeek(weekOfMonth === 3 ? 1 : 3); }}><option value={1}>Once per cycle</option><option value={2}>Twice per month</option></select></label>
            <label>Cycle starts<select value={startMonth} onChange={(event) => setStartMonth(Number(event.target.value))}>{months.map((label, index) => <option value={index + 1} key={label}>{label}</option>)}</select></label>
            <label>Primary week<select value={weekOfMonth} onChange={(event) => { const value = Number(event.target.value); setWeekOfMonth(value); if (secondaryWeek === value) setSecondaryWeek(value === 3 ? 1 : 3); }}>{[1, 2, 3, 4].map((week) => <option value={week} key={week}>Week {week}</option>)}</select></label>
            {occurrencesPerMonth === 2 ? <label>Secondary week<select value={secondaryWeek} onChange={(event) => setSecondaryWeek(Number(event.target.value))}>{[1, 2, 3, 4].filter((week) => week !== weekOfMonth).map((week) => <option value={week} key={week}>Week {week}</option>)}</select></label> : null}
          </section>
          <label className="pm-plan-active-toggle"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span><strong>{active ? "Schedule active" : "Schedule paused"}</strong><small>{active ? "Future PM assignments will continue to be generated." : "No new assignments will be generated until this is reactivated."}</small></span></label>
          <div className="pm-plan-preview"><span>New recurrence</span><strong>{occurrencesPerMonth === 2 ? `Twice per month | weeks ${weekOfMonth} and ${secondaryWeek}` : `${frequencyMonths === 1 ? "Monthly" : `Every ${frequencyMonths} months`} | week ${weekOfMonth}`}</strong><small>Starting {months[startMonth - 1]} | assigned to {technicians.find((item) => item.id === technicianId)?.name}</small></div>
        </div>
        <footer><button type="button" onClick={onClose}>Cancel</button><button className="pm-button pm-button-primary" disabled={saving} type="submit"><Check size={17} />{saving ? "Updating..." : "Update schedule"}</button></footer>
      </form>
    </div>
  );
}

function PmTemplateLibrary({ templates, plans, assigningPlanId, setAssigningPlanId, onEdit, onNew, onAssigned, actorId }: { templates: PmChecklistTemplate[]; plans: PmPlan[]; assigningPlanId: string; setAssigningPlanId: (id: string) => void; onEdit: (template: PmChecklistTemplate) => void; onNew: () => void; onAssigned: () => Promise<void>; actorId: string }) {
  const uncovered = plans.filter((plan) => !plan.templateId);
  const [busy, setBusy] = useState(false);
  async function assign(planId: string, templateId: string) {
    setBusy(true);
    try { await api.assignPmTemplate(planId, { actorId, templateId: templateId || null }); await onAssigned(); setAssigningPlanId(""); } finally { setBusy(false); }
  }
  return (
    <div className="pm-template-section">
      <div className="pm-section-heading"><div><span>Controlled documents</span><h2>Checklist library</h2><p>Edit any checklist as machines and standards evolve.</p></div><button className="pm-button pm-button-primary" type="button" onClick={onNew}><Plus size={17} />Create checklist</button></div>
      <div className="pm-template-layout">
        <div className="pm-template-grid">
          {templates.map((template) => <article className="pm-template-card" key={template.id}><div className="pm-template-icon"><ClipboardCheck size={22} /></div><span className="pm-template-active">Active · v{template.version}</span><h3>{template.machineName}</h3><p>{template.title}</p><div className="pm-template-meta"><span>{template.documentNumber || "No document no."}</span><span>{template.itemCount} items</span></div><div className="pm-template-actions"><button type="button" onClick={() => onEdit(template)}><Pencil size={15} />Edit</button><button type="button" onClick={() => setAssigningPlanId(assigningPlanId === template.id ? "" : template.id)}><CopyPlus size={15} />Assign</button></div>{assigningPlanId === template.id ? <div className="pm-assign-popover"><strong>Connect to a machine plan</strong><select disabled={busy} defaultValue="" onChange={(event) => event.target.value && assign(event.target.value, template.id)}><option value="">Select machine...</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.mainMachine} · {plan.machineName}</option>)}</select></div> : null}</article>)}
          <button className="pm-new-template-card" type="button" onClick={onNew}><span><Plus size={24} /></span><strong>Add machine checklist</strong><small>Build a reusable digital template</small></button>
        </div>
        <aside className="pm-coverage-queue"><div><span>Coverage queue</span><strong>{uncovered.length}</strong></div><p>Machine plans waiting for a digital checklist.</p><div>{uncovered.slice(0, 12).map((plan) => <span key={plan.id}><i />{plan.machineName}<small>{plan.technicianName}</small></span>)}</div>{uncovered.length > 12 ? <small>+ {uncovered.length - 12} more machines</small> : null}</aside>
      </div>
    </div>
  );
}

function blankTemplateItem(): SavePmTemplateInput["items"][number] {
  return { groupName: "General", description: "", specification: "", inspectionMethod: "Visual", frequency: "As scheduled", dataType: "marking", maintenanceType: "preventive", required: true };
}

function PmTemplateEditor({ template, actorId, onClose, onSaved }: { template: PmChecklistTemplate | null; actorId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [machineName, setMachineName] = useState(template?.machineName || "");
  const [title, setTitle] = useState(template?.title || "Preventive & Predictive Maintenance Checklist");
  const [documentNumber, setDocumentNumber] = useState(template?.documentNumber || "FR-MT-002");
  const [revisionNumber, setRevisionNumber] = useState(template?.revisionNumber || "1");
  const [effectiveDate, setEffectiveDate] = useState(template?.effectiveDate || new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<SavePmTemplateInput["items"]>(template?.items.map((item) => ({ ...item })) || [blankTemplateItem()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { const overflow = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = overflow; }; }, []);

  function updateItem(index: number, patch: Partial<SavePmTemplateInput["items"][number]>) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    const input: SavePmTemplateInput = { actorId, machineName, title, documentNumber, revisionNumber, effectiveDate, active: true, items };
    try { if (template) await api.updatePmTemplate(template.id, input); else await api.createPmTemplate(input); await onSaved(); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Unable to save checklist."); }
    finally { setSaving(false); }
  }
  return <div className="pm-modal-backdrop" role="presentation"><form className="pm-template-editor" onSubmit={submit}><header><div><span>{template ? `Version ${template.version + 1}` : "New controlled checklist"}</span><h2>{template ? `Edit ${template.machineName}` : "Build a machine checklist"}</h2></div><button type="button" onClick={onClose} aria-label="Close editor"><X size={21} /></button></header><div className="pm-editor-scroll">{error ? <div className="pm-alert" role="alert"><AlertCircle size={16} />{error}</div> : null}<section className="pm-editor-details"><label>Machine name<input required value={machineName} onChange={(event) => setMachineName(event.target.value)} placeholder="e.g. Hydraulic Forming 7" /></label><label className="wide">Checklist title<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Document number<input value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} /></label><label>Revision<input value={revisionNumber} onChange={(event) => setRevisionNumber(event.target.value)} /></label><label>Effective date<input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></label></section><section className="pm-editor-items"><div className="pm-editor-section-title"><div><span>Inspection points</span><h3>{items.length} checklist items</h3></div><button type="button" onClick={() => setItems((current) => [...current, blankTemplateItem()])}><Plus size={16} />Add item</button></div>{items.map((item, index) => <article key={index}><div className="pm-item-number">{String(index + 1).padStart(2, "0")}</div><div className="pm-editor-item-grid"><label>Machine / location<input required value={item.groupName} onChange={(event) => updateItem(index, { groupName: event.target.value })} /></label><label className="wide">Check / description<textarea required value={item.description} onChange={(event) => updateItem(index, { description: event.target.value })} /></label><label className="wide">Specification<textarea value={item.specification} onChange={(event) => updateItem(index, { specification: event.target.value })} /></label><label>Inspection method<input value={item.inspectionMethod} onChange={(event) => updateItem(index, { inspectionMethod: event.target.value })} /></label><label>Data type<select value={item.dataType} onChange={(event) => updateItem(index, { dataType: event.target.value as "marking" | "value" })}><option value="marking">Marking</option><option value="value">Reading value</option></select></label><label>Maintenance type<select value={item.maintenanceType} onChange={(event) => updateItem(index, { maintenanceType: event.target.value as "preventive" | "predictive" })}><option value="preventive">Preventive</option><option value="predictive">Predictive</option></select></label></div><button className="pm-remove-item" type="button" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></button></article>)}</section></div><footer><button type="button" onClick={onClose}>Cancel</button><button className="pm-button pm-button-primary" disabled={saving} type="submit"><Check size={17} />{saving ? "Saving..." : "Save checklist"}</button></footer></form></div>;
}

function PmChecklistExecutionLegacy({ scheduleId }: { scheduleId: string }) {
  const { currentUser } = useCurrentUser();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<PmScheduleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyItem, setBusyItem] = useState("");
  const [error, setError] = useState("");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isManager = currentUser ? ["executive", "admin", "developer"].includes(currentUser.role) : false;

  async function load() {
    if (!currentUser) return;
    setLoading(true);
    try { const next = await api.pmSchedule(scheduleId, currentUser.id); setDetail(next); setRemarks(next.remarks); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Unable to load checklist."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load().catch(console.error); }, [scheduleId, currentUser?.id]);

  const groups = useMemo(() => {
    if (!detail?.template) return [];
    const result = new Map<string, typeof detail.template.items>();
    detail.template.items.forEach((item) => result.set(item.groupName, [...(result.get(item.groupName) || []), item]));
    return [...result.entries()];
  }, [detail?.template]);
  const progress = detail?.checklistItemCount ? Math.round((detail.completedItemCount / detail.checklistItemCount) * 100) : 0;
  const editable = detail ? !["submitted", "verified"].includes(detail.status) : false;

  async function saveItem(itemId: string, patch: { resultCode?: PmResultCode | null; readingValue?: string; note?: string }) {
    if (!currentUser || !detail) return;
    const existing = detail.results.find((result) => result.itemId === itemId)!;
    setBusyItem(itemId); setError("");
    try { setDetail(await api.savePmResult(scheduleId, { actorId: currentUser.id, itemId, resultCode: patch.resultCode === undefined ? existing.resultCode : patch.resultCode, readingValue: patch.readingValue === undefined ? existing.readingValue : patch.readingValue, note: patch.note === undefined ? existing.note : patch.note })); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Unable to save result."); }
    finally { setBusyItem(""); }
  }
  async function start() { if (!currentUser) return; setSubmitting(true); try { setDetail(await api.startPmSchedule(scheduleId, currentUser.id)); } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Unable to start checklist."); } finally { setSubmitting(false); } }
  async function submit() { if (!currentUser) return; setSubmitting(true); setError(""); try { setDetail(await api.submitPmSchedule(scheduleId, { actorId: currentUser.id, remarks })); } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Unable to submit checklist."); } finally { setSubmitting(false); } }
  async function verify() { if (!currentUser) return; setSubmitting(true); try { setDetail(await api.verifyPmSchedule(scheduleId, currentUser.id)); } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Unable to verify checklist."); } finally { setSubmitting(false); } }

  if (loading && !detail) return <PmLoading />;
  if (!detail) return <div className="pm-page"><button className="pm-back-link" onClick={() => navigate("/preventive-maintenance")}><ArrowLeft size={17} />Back to PM</button><div className="pm-alert" role="alert"><AlertCircle size={17} />{error || "Assignment not found."}</div></div>;
  if (!detail.template) return <div className="pm-page"><button className="pm-back-link" onClick={() => navigate("/preventive-maintenance")}><ArrowLeft size={17} />Back to PM</button><div className="pm-empty pm-no-template"><ClipboardCheck size={32} /><h2>{detail.machineName}</h2><p>This schedule is active, but its machine checklist has not been added yet.</p></div></div>;

  return <section className="pm-page pm-execution-page"><button className="pm-back-link" type="button" onClick={() => navigate("/preventive-maintenance")}><ArrowLeft size={17} />Back to PM schedule</button><header className="pm-execution-header"><div><div className="pm-eyebrow"><ShieldCheck size={15} />{detail.template.documentNumber} · Rev {detail.template.revisionNumber}</div><h1>{detail.machineName}</h1><p>{detail.template.title}</p><div className="pm-execution-meta"><span><CalendarDays size={15} />{formatPmDate(detail.scheduledDate)}</span><span><UserRound size={15} />{detail.technicianName}</span><span><Clock3 size={15} />{detail.frequencyLabel}</span></div></div><div className="pm-execution-progress"><strong>{progress}%</strong><span><i style={{ width: `${progress}%` }} /></span><small>{detail.completedItemCount} of {detail.checklistItemCount} checks complete</small></div></header>{error ? <div className="pm-alert" role="alert"><AlertCircle size={17} />{error}</div> : null}<div className="pm-checklist-instructions"><div><ListChecks size={20} /><span><strong>Inspection guide</strong><small>Record every item. Use Pass, Adjusted, Fail, or N/A. Reading items also require the actual value.</small></span></div><div className="pm-legend"><span className="pass"><Check size={13} />Pass</span><span className="adjusted"><Wrench size={13} />Adjusted</span><span className="fail"><X size={13} />Fail</span></div></div>{detail.status === "scheduled" ? <div className="pm-start-banner"><div><Sparkles size={21} /><span><strong>Ready to begin?</strong><small>Starting records the technician and timestamp for traceability.</small></span></div><button className="pm-button pm-button-primary" disabled={submitting} type="button" onClick={start}>Start inspection<ChevronRight size={17} /></button></div> : null}<div className="pm-checklist-groups">{groups.map(([groupName, items], groupIndex) => <section className="pm-check-group" key={groupName}><header><span>{String(groupIndex + 1).padStart(2, "0")}</span><div><h2>{groupName}</h2><small>{items.length} inspection point{items.length === 1 ? "" : "s"}</small></div></header><div>{items.map((item) => { const result = detail.results.find((value) => value.itemId === item.id)!; return <article className={`pm-check-item ${result.resultCode || ""}`} key={item.id}><div className="pm-check-copy"><div className="pm-item-tags"><span>{item.maintenanceType}</span><span>{item.inspectionMethod}</span>{item.dataType === "value" ? <span className="reading"><Gauge size={12} />Reading</span> : null}</div><h3>{item.description}</h3><p><strong>Standard</strong>{item.specification || "Complete as described."}</p></div><div className="pm-result-controls"><div className="pm-result-buttons">{resultOptions.map((option) => <button key={option.code} type="button" disabled={!editable || busyItem === item.id} className={result.resultCode === option.code ? `active ${option.code}` : ""} onClick={() => saveItem(item.id, { resultCode: option.code })}><option.icon size={16} />{option.label}</button>)}</div>{item.dataType === "value" ? <label className="pm-reading-input"><span>Actual reading</span><input disabled={!editable} defaultValue={result.readingValue} onBlur={(event) => event.target.value !== result.readingValue && saveItem(item.id, { readingValue: event.target.value })} placeholder={item.specification || "Enter value"} /></label> : null}<label className="pm-item-note"><span>Note <small>optional</small></span><input disabled={!editable} defaultValue={result.note} onBlur={(event) => event.target.value !== result.note && saveItem(item.id, { note: event.target.value })} placeholder="Add observation or action taken" /></label>{busyItem === item.id ? <small className="pm-saving">Saving...</small> : result.completedAt ? <small className="pm-saved"><Check size={12} />Saved</small> : null}</div></article>; })}</div></section>)}</div><footer className="pm-submit-panel"><div><span>Technician remarks</span><textarea disabled={!editable} value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Add overall findings, follow-up needs, or parts required..." /></div><aside><div><span className={`pm-status-pill ${scheduleTone(detail)}`}>{scheduleStatusLabel(detail)}</span>{detail.failedItemCount ? <small className="failed"><AlertCircle size={14} />{detail.failedItemCount} failed inspection</small> : null}</div>{editable ? <button className="pm-button pm-button-primary" type="button" disabled={submitting || progress < 100} onClick={submit}><FileCheck2 size={17} />{submitting ? "Submitting..." : "Submit for verification"}</button> : null}{detail.status === "submitted" && isManager ? <button className="pm-button pm-button-primary" type="button" disabled={submitting} onClick={verify}><ShieldCheck size={17} />Verify checklist</button> : null}{detail.status === "verified" ? <div className="pm-verified-stamp"><ShieldCheck size={22} /><span><strong>Verified</strong><small>by {detail.verifiedByName}</small></span></div> : null}</aside></footer></section>;
}

function PmChecklistExecution({ scheduleId }: { scheduleId: string }) {
  const { currentUser } = useCurrentUser();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<PmScheduleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyItem, setBusyItem] = useState("");
  const [uploadingItem, setUploadingItem] = useState("");
  const [error, setError] = useState("");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isManager = currentUser ? ["executive", "admin", "developer"].includes(currentUser.role) : false;
  const isAdmin = currentUser ? ["executive", "admin", "developer"].includes(currentUser.role) : false;

  async function load() {
    if (!currentUser) return;
    setLoading(true);
    try {
      const next = await api.pmSchedule(scheduleId, currentUser.id);
      setDetail(next);
      setRemarks(next.remarks);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load checklist.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load().catch(console.error); }, [scheduleId, currentUser?.id]);
  useLiveRefresh(["pm"], load, { enabled: Boolean(currentUser) });
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }, [scheduleId]);

  const groups = useMemo(() => {
    if (!detail?.template) return [];
    const grouped = new Map<string, typeof detail.template.items>();
    detail.template.items.forEach((item) => grouped.set(item.groupName, [...(grouped.get(item.groupName) || []), item]));
    return [...grouped.entries()];
  }, [detail?.template]);
  const progress = detail?.checklistItemCount ? Math.round((detail.completedItemCount / detail.checklistItemCount) * 100) : 0;
  const editable = detail ? !["submitted", "verified"].includes(detail.status) : false;

  async function saveItem(itemId: string, patch: { resultCode?: PmResultCode | null; readingValue?: string; note?: string }) {
    if (!currentUser || !detail) return;
    const existing = detail.results.find((result) => result.itemId === itemId)!;
    setBusyItem(itemId); setError("");
    try {
      setDetail(await api.savePmResult(scheduleId, {
        actorId: currentUser.id,
        itemId,
        resultCode: patch.resultCode === undefined ? existing.resultCode : patch.resultCode,
        readingValue: patch.readingValue === undefined ? existing.readingValue : patch.readingValue,
        note: patch.note === undefined ? existing.note : patch.note
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to save result.");
    } finally {
      setBusyItem("");
    }
  }

  async function uploadProof(itemId: string, event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!currentUser || !file) return;
    setUploadingItem(itemId); setError("");
    try {
      setDetail(await api.uploadPmProof(scheduleId, itemId, currentUser.id, file));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to upload photo proof.");
    } finally {
      setUploadingItem("");
      input.value = "";
    }
  }

  async function deleteProof(photoId: string) {
    if (!currentUser || !window.confirm("Delete this PM proof photo? This cannot be undone.")) return;
    setUploadingItem(photoId); setError("");
    try {
      setDetail(await api.deletePmProof(photoId, currentUser.id));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to delete photo proof.");
    } finally {
      setUploadingItem("");
    }
  }

  async function start() {
    if (!currentUser) return;
    setSubmitting(true);
    try { setDetail(await api.startPmSchedule(scheduleId, currentUser.id)); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Unable to start checklist."); }
    finally { setSubmitting(false); }
  }

  async function submit() {
    if (!currentUser) return;
    setSubmitting(true); setError("");
    try { setDetail(await api.submitPmSchedule(scheduleId, { actorId: currentUser.id, remarks })); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Unable to submit checklist."); }
    finally { setSubmitting(false); }
  }

  async function verify() {
    if (!currentUser) return;
    setSubmitting(true);
    try { setDetail(await api.verifyPmSchedule(scheduleId, currentUser.id)); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Unable to verify checklist."); }
    finally { setSubmitting(false); }
  }

  if (loading && !detail) return <PmLoading />;
  if (!detail) return <div className="pm-page"><button className="pm-back-link" onClick={() => navigate("/preventive-maintenance")}><ArrowLeft size={18} />Back to PM</button><div className="pm-alert" role="alert"><AlertCircle size={18} />{error || "Assignment not found."}</div></div>;
  if (!detail.template) return <div className="pm-page"><button className="pm-back-link" onClick={() => navigate("/preventive-maintenance")}><ArrowLeft size={18} />Back to PM</button><div className="pm-empty pm-no-template"><ClipboardCheck size={34} /><h2>{detail.machineName}</h2><p>This schedule is active, but its machine checklist has not been added yet.</p></div></div>;

  return (
    <section className="pm-page pm-execution-page">
      <button className="pm-back-link" type="button" onClick={() => navigate("/preventive-maintenance")}><ArrowLeft size={18} />Back to my PM list</button>
      <header className="pm-execution-header">
        <div>
          <div className="pm-eyebrow"><ShieldCheck size={16} />{detail.template.documentNumber} · Rev {detail.template.revisionNumber}</div>
          <h1>{detail.machineName}</h1>
          <p>{detail.template.title}</p>
          <div className="pm-execution-meta"><span><CalendarDays size={17} />{formatPmDate(detail.scheduledDate)}</span><span><UserRound size={17} />{detail.technicianName}</span><span><Clock3 size={17} />{detail.frequencyLabel}</span></div>
        </div>
        <div className="pm-execution-progress"><strong>{progress}%</strong><span><i style={{ width: `${progress}%` }} /></span><small>{detail.completedItemCount} of {detail.checklistItemCount} fully complete</small></div>
      </header>

      {error ? <div className="pm-alert" role="alert"><AlertCircle size={18} />{error}</div> : null}
      <div className="pm-checklist-instructions">
        <div><ListChecks size={22} /><span><strong>Complete each inspection point</strong><small>1. Choose a result. 2. Enter a reading when requested. 3. Take at least one proof photo.</small></span></div>
        <div className="pm-proof-required"><ImagePlus size={17} /><span>Photo required for every item</span></div>
      </div>

      {detail.status === "scheduled" ? <div className="pm-start-banner"><div><Sparkles size={22} /><span><strong>Ready to inspect {detail.machineName}?</strong><small>Start when you are at the machine. Your progress saves after every action.</small></span></div><button className="pm-button pm-button-primary" disabled={submitting} type="button" onClick={start}>Start inspection<ChevronRight size={18} /></button></div> : null}

      <div className="pm-checklist-groups">
        {groups.map(([groupName, items], groupIndex) => (
          <section className="pm-check-group" key={groupName}>
            <header><span>{String(groupIndex + 1).padStart(2, "0")}</span><div><h2>{groupName}</h2><small>{items.length} inspection point{items.length === 1 ? "" : "s"}</small></div></header>
            <div>
              {items.map((item, itemIndex) => {
                const result = detail.results.find((value) => value.itemId === item.id)!;
                const resultReady = Boolean(result.resultCode) && (item.dataType !== "value" || Boolean(result.readingValue.trim()));
                const itemComplete = resultReady && result.photos.length > 0;
                return (
                  <article className={`pm-check-item ${result.resultCode || ""} ${itemComplete ? "complete" : ""}`} key={item.id}>
                    <div className="pm-check-copy">
                      <div className="pm-item-step">Item {itemIndex + 1} of {items.length}</div>
                      <div className="pm-item-tags"><span>{item.maintenanceType}</span><span>{item.inspectionMethod}</span>{item.dataType === "value" ? <span className="reading"><Gauge size={13} />Reading needed</span> : null}</div>
                      <h3>{item.description}</h3>
                      <p><strong>Expected standard</strong>{item.specification || "Complete as described."}</p>
                    </div>
                    <div className="pm-result-controls">
                      <div className="pm-control-step"><b>1</b><span>Inspection result</span></div>
                      <div className="pm-result-buttons">
                        {resultOptions.map((option) => <button key={option.code} type="button" disabled={!editable || busyItem === item.id} className={result.resultCode === option.code ? `active ${option.code}` : ""} onClick={() => saveItem(item.id, { resultCode: option.code })}><option.icon size={18} />{option.label}</button>)}
                      </div>
                      {item.dataType === "value" ? <label className="pm-reading-input"><span><b>2</b> Actual reading <em>required</em></span><input disabled={!editable} defaultValue={result.readingValue} onBlur={(event) => event.target.value !== result.readingValue && saveItem(item.id, { readingValue: event.target.value })} placeholder="Enter the measured value" /></label> : null}
                      <div className="pm-photo-proof">
                        <div className="pm-control-step"><b>{item.dataType === "value" ? "3" : "2"}</b><span>Photo proof <em>required</em></span></div>
                        {result.photos.length ? <div className="pm-photo-grid">{result.photos.map((photo) => <div className="pm-photo-tile" key={photo.id}><a href={mediaUrl(photo.url)} target="_blank" rel="noreferrer" aria-label={`Open ${photo.originalName}`}><img src={mediaUrl(photo.url)} alt={`Proof for ${item.description}`} /></a><span><strong>Proof saved</strong><small>{new Date(photo.createdAt).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}</small></span>{isAdmin ? <button type="button" disabled={uploadingItem === photo.id} onClick={() => deleteProof(photo.id)} aria-label="Delete proof photo"><Trash2 size={16} /></button> : null}</div>)}</div> : <div className="pm-photo-empty"><ImagePlus size={20} /><span>No proof photo yet</span></div>}
                        {editable && result.photos.length < 5 ? <label className={`pm-photo-upload ${uploadingItem === item.id ? "loading" : ""}`}><ImagePlus size={19} />{uploadingItem === item.id ? "Uploading photo..." : result.photos.length ? "Add another photo" : "Take or upload photo"}<input type="file" accept="image/*" capture="environment" disabled={uploadingItem === item.id} onChange={(event) => uploadProof(item.id, event)} /></label> : null}
                      </div>
                      <label className="pm-item-note"><span>Observation or action <small>optional</small></span><input disabled={!editable} defaultValue={result.note} onBlur={(event) => event.target.value !== result.note && saveItem(item.id, { note: event.target.value })} placeholder="Add a short note if useful" /></label>
                      <div className={`pm-item-completion ${itemComplete ? "done" : "pending"}`}>{itemComplete ? <><CheckCircle2 size={17} /><span>Item complete</span></> : <><CircleDashed size={17} /><span>{!resultReady ? "Choose a result" : "Add the required photo"}</span></>}{busyItem === item.id ? <small>Saving...</small> : null}</div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <footer className="pm-submit-panel">
        <div><span>Overall technician remarks</span><textarea disabled={!editable} value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Add overall findings, follow-up needs, or parts required..." /></div>
        <aside>
          <div><span className={`pm-status-pill ${scheduleTone(detail)}`}>{scheduleStatusLabel(detail)}</span>{progress < 100 && editable ? <small>{detail.checklistItemCount - detail.completedItemCount} item{detail.checklistItemCount - detail.completedItemCount === 1 ? "" : "s"} still need a result and photo</small> : null}{detail.failedItemCount ? <small className="failed"><AlertCircle size={15} />{detail.failedItemCount} failed inspection</small> : null}</div>
          {editable ? <button className="pm-button pm-button-primary" type="button" disabled={submitting || progress < 100} onClick={submit}><FileCheck2 size={18} />{submitting ? "Submitting..." : progress < 100 ? "Finish all items first" : "Submit for verification"}</button> : null}
          {detail.status === "submitted" && isManager ? <button className="pm-button pm-button-primary" type="button" disabled={submitting} onClick={verify}><ShieldCheck size={18} />Verify checklist</button> : null}
          {detail.status === "verified" ? <div className="pm-verified-stamp"><ShieldCheck size={23} /><span><strong>Verified</strong><small>by {detail.verifiedByName}</small></span></div> : null}
        </aside>
      </footer>
    </section>
  );
}

function PmLoading() {
  return <div className="pm-loading"><span /><strong>Preparing PM command center</strong><small>Connecting schedules, technicians and checklists...</small></div>;
}
