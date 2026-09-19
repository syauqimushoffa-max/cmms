import type { AssetDashboardResponse, DashboardSummary, PmDashboardResponse, SpareInventoryResponse, WorkOrder } from "@pbs-cmms/shared";
import { workOrderDepartmentForUser } from "@pbs-cmms/shared";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Factory,
  LockKeyhole,
  Package,
  PackageCheck,
  Plus,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Wrench
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { PriorityBadge, StatusBadge } from "../components/Badges";
import { MetricTile } from "../components/MetricTile";
import { useCurrentUser } from "../state/UserContext";
import { formatDateTime, formatLongDisplayDate } from "../utils/format";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

function percent(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function money(value: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 0
  }).format(value);
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { currentUser } = useCurrentUser();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [inventory, setInventory] = useState<SpareInventoryResponse | null>(null);
  const [pm, setPm] = useState<PmDashboardResponse | null>(null);
  const [assets, setAssets] = useState<AssetDashboardResponse | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const technicianMode = currentUser?.role === "technician";
  const canUseInProgressModules = Boolean(currentUser && ["executive", "admin", "developer"].includes(currentUser.role));
  const accountDepartment = workOrderDepartmentForUser(currentUser?.department || "");

  async function loadDashboard(showLoading = false) {
    if (!currentUser) return;
    if (showLoading) setLoading(true);
    try {
      const [nextSummary, nextWorkOrders, nextInventory] = await Promise.all([
        api.dashboardSummary(),
        api.workOrders(),
        api.spareInventory()
      ]);
      setSummary(nextSummary);
      setWorkOrders(nextWorkOrders);
      setInventory(nextInventory);
      if (canUseInProgressModules) {
        const year = new Date().getFullYear();
        const [nextPm, nextAssets] = await Promise.all([api.pmDashboard(currentUser.id, year), api.assetDashboard()]);
        setPm(nextPm);
        setAssets(nextAssets);
      } else {
        setPm(null);
        setAssets(null);
      }
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Couldn’t load this page.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard(true).catch(console.error);
  }, [canUseInProgressModules, currentUser?.id]);

  useLiveRefresh(["dashboard"], () => loadDashboard(false), { enabled: Boolean(currentUser) });

  const dashboardWorkOrders = useMemo(
    () => technicianMode && currentUser
      ? workOrders.filter((workOrder) => workOrder.assignedToId === currentUser.id || (workOrder.status === "open" && !workOrder.assignedToId))
      : workOrders,
    [currentUser, technicianMode, workOrders]
  );
  const activeWorkOrders = useMemo(
    () => dashboardWorkOrders
      .filter((workOrder) => !["closed", "cancelled"].includes(workOrder.status))
      .sort((a, b) =>
        Number(b.responsibleDepartment === accountDepartment) - Number(a.responsibleDepartment === accountDepartment) ||
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [accountDepartment, dashboardWorkOrders]
  );
  const visibleWorkOrders = activeWorkOrders.slice(0, 6);
  const criticalOpen = activeWorkOrders.filter((item) => item.priority === "critical").length;
  const standardOrders = dashboardWorkOrders.filter((item) => item.type === "maintenance" && item.status !== "cancelled");
  const kaizenOrders = dashboardWorkOrders.filter((item) => item.type === "kaizen" && item.status !== "cancelled");
  const standardClosure = percent(standardOrders.filter((item) => item.status === "closed").length, standardOrders.length);
  const kaizenClosure = percent(kaizenOrders.filter((item) => item.status === "closed").length, kaizenOrders.length);
  const partsRisk = (inventory?.summary.lowStock ?? 0) + (inventory?.summary.outOfStock ?? 0);
  const pmCompliance = pm?.summary.compliancePercent ?? 0;
  const effectiveSummary = useMemo(() => {
    if (!technicianMode) return summary;
    const today = new Date().toISOString().slice(0, 10);
    return {
      totalOpen: dashboardWorkOrders.filter((item) => !["closed", "cancelled"].includes(item.status)).length,
      newWorkOrders: dashboardWorkOrders.filter((item) => item.status === "open" && !item.assignedToId).length,
      inProgress: dashboardWorkOrders.filter((item) => ["acknowledged", "in_progress", "returned"].includes(item.status)).length,
      pendingMaterial: dashboardWorkOrders.filter((item) => item.status === "pending_material").length,
      resolvedWaitingVerification: dashboardWorkOrders.filter((item) => item.status === "resolved").length,
      closedToday: dashboardWorkOrders.filter((item) => item.status === "closed" && item.updatedAt.startsWith(today)).length
    };
  }, [dashboardWorkOrders, summary, technicianMode]);

  const workflow = [
    { label: "New", value: dashboardWorkOrders.filter((item) => item.status === "open").length, tone: "new", filter: "open" },
    { label: "Acknowledged", value: dashboardWorkOrders.filter((item) => item.status === "acknowledged").length, tone: "acknowledged", filter: "acknowledged" },
    { label: "In progress", value: dashboardWorkOrders.filter((item) => item.status === "in_progress").length, tone: "progress", filter: "in_progress" },
    { label: "Waiting parts", value: dashboardWorkOrders.filter((item) => item.status === "pending_material").length, tone: "waiting", filter: "pending_material" },
    { label: "For verification", value: dashboardWorkOrders.filter((item) => item.status === "resolved").length, tone: "verify", filter: "resolved" }
  ];

  function openCard(event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>, to: string) {
    if (event.target instanceof HTMLElement && event.target.closest("a, button, input, select, textarea")) return;
    if ("key" in event && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    navigate(to);
  }

  const stockRisks = useMemo(
    () => (inventory?.parts ?? [])
      .filter((item) => item.currentStock <= item.minStock)
      .sort((a, b) => a.currentStock - b.currentStock)
      .slice(0, 4),
    [inventory]
  );

  const pmAttention = useMemo(
    () => (pm?.schedules ?? [])
      .filter((item) => item.overdue || ["scheduled", "in_progress"].includes(item.status))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.scheduledDate.localeCompare(b.scheduledDate))
      .slice(0, 4),
    [pm]
  );

  const assetAttention = useMemo(
    () => [...(assets?.assets ?? [])]
      .filter((asset) => asset.riskScore >= 75)
      .sort((a, b) => b.riskScore - a.riskScore || a.assetNo - b.assetNo)
      .slice(0, 4),
    [assets]
  );

  if (loading && !summary) return <div className="ux-recovery" role="status"><h1>Dashboard</h1><p>Loading maintenance activity…</p></div>;

  return (
    <section className={`page-stack dashboard-page dashboard-command-page ${currentUser?.role === "executive" ? "executive-dashboard" : ""}`}>
      {loadError ? <div className="ux-load-error" role="alert"><span>Some information could not load. Displayed figures may be incomplete or out of date. {loadError}</span><button className="secondary-action" type="button" onClick={() => void loadDashboard()}>Try again</button></div> : null}
      <div className="dashboard-hero dashboard-command-hero">
        <div className="dashboard-hero-main">
          <p className="hero-eyebrow"><span aria-hidden="true" /> Live maintenance command · {formatLongDisplayDate()}</p>
          <h1>Good day, {currentUser?.name.split(" ")[0] ?? "team"}.</h1>
          <p>{technicianMode ? "Your current work and new eligible jobs, kept in one clear working view." : "Everything that needs attention across work orders and spare parts—kept in one readable view."}</p>
          <div className="hero-actions">
            {technicianMode ? <Link className="primary-action" to="/technician"><ClipboardList size={17} /> Open My Jobs</Link> : <Link className="primary-action" to="/work-orders/new"><Plus size={17} /> New Work Order</Link>}
            {canUseInProgressModules ? <Link className="secondary-action" to="/performance"><BarChart3 size={17} /> Open Performance</Link> : <Link className="secondary-action" to="/spare-parts"><Package size={17} /> Open Spare Parts</Link>}
          </div>
        </div>
        <div className="dashboard-hero-signals">
          <Link to="/work-orders?status=active&scope=all" aria-label={`${criticalOpen} critical work orders. Open work orders.`}><Wrench size={17} /><span>Critical work</span><strong>{criticalOpen}</strong><small>Tap to review</small></Link>
          <Link to="/preventive-maintenance/schedule" aria-label={`${pm?.summary.dueThisWeek ?? 0} preventive maintenance schedules due. Open schedule.`}><CalendarClock size={17} /><span>PM due</span><strong>{canUseInProgressModules ? pm?.summary.dueThisWeek ?? 0 : "—"}</strong><small>{canUseInProgressModules ? "Tap to review" : "module locked"}</small></Link>
          <Link to="/spare-parts" aria-label={`${partsRisk} parts below minimum. Open spare parts.`}><Package size={17} /><span>Parts risk</span><strong>{partsRisk}</strong><small>Tap to review</small></Link>
        </div>
      </div>

      <div className="dashboard-kpi-grid metric-grid" aria-busy={loading}>
        <MetricTile icon={ClipboardList} label={technicianMode ? "My queue" : "Total active"} value={effectiveSummary?.totalOpen ?? 0} to={technicianMode ? "/technician" : "/work-orders?status=active&scope=all"} />
        <MetricTile icon={AlertTriangle} label={technicianMode ? "Available jobs" : "New requests"} value={effectiveSummary?.newWorkOrders ?? 0} tone="danger" to={technicianMode ? "/technician" : "/work-orders?status=open&scope=all"} />
        <MetricTile icon={Wrench} label="In progress" value={effectiveSummary?.inProgress ?? 0} to={technicianMode ? "/technician" : "/work-orders?status=moving&scope=all"} />
        <MetricTile icon={CheckCircle2} label="Closed today" value={effectiveSummary?.closedToday ?? 0} tone="success" to="/work-orders?status=closed&scope=all" />
        <MetricTile icon={ShieldCheck} label="PM compliance" value={canUseInProgressModules ? `${pmCompliance}%` : "Locked"} tone={canUseInProgressModules && pmCompliance >= 95 ? "success" : undefined} to={canUseInProgressModules ? "/preventive-maintenance" : undefined} />
        <MetricTile icon={PackageCheck} label="Parts available" value={`${inventory ? percent(inventory.summary.totalParts - inventory.summary.outOfStock, inventory.summary.totalParts) : 0}%`} tone="success" to="/spare-parts" />
      </div>

      <div className="dashboard-command-grid">
        <section className="dashboard-command-card dashboard-flow-card interactive-card" role="link" tabIndex={0} onClick={(event) => openCard(event, "/work-orders?status=active&scope=all")} onKeyDown={(event) => openCard(event, "/work-orders?status=active&scope=all")}>
          <div className="dashboard-card-heading">
            <div><span>Work order control</span><h2>Maintenance flow</h2><p>Live queue position from request to verification.</p></div>
            <Link to={technicianMode ? "/technician" : "/work-orders"}>View all <ArrowRight size={14} /></Link>
          </div>
          <div className="dashboard-flow-grid">
            {workflow.map((item) => <Link to={`/work-orders?status=${item.filter}&scope=all`} key={item.label} className={`tone-${item.tone}`} aria-label={`${item.label}: ${item.value}. Open filtered work orders.`}><span>{item.label}</span><strong>{item.value}</strong><i /></Link>)}
          </div>
          <div className="dashboard-closure-split">
            <div><span>Standard maintenance closure</span><strong>{standardClosure}%</strong><i><b style={{ width: `${standardClosure}%` }} /></i></div>
            <div><span>KAIZEN closure</span><strong>{kaizenClosure}%</strong><i><b style={{ width: `${kaizenClosure}%` }} /></i></div>
          </div>
        </section>

        <section className="dashboard-command-card dashboard-pm-card interactive-card" role={canUseInProgressModules ? "link" : undefined} tabIndex={canUseInProgressModules ? 0 : undefined} onClick={canUseInProgressModules ? (event) => openCard(event, "/preventive-maintenance") : undefined} onKeyDown={canUseInProgressModules ? (event) => openCard(event, "/preventive-maintenance") : undefined}>
          <div className="dashboard-card-heading"><div><span>Preventive maintenance</span><h2>PM discipline</h2></div>{canUseInProgressModules ? <Link to="/preventive-maintenance">Open PM <ArrowRight size={15} /></Link> : <span className="dashboard-feature-lock"><LockKeyhole size={14} />Locked</span>}</div>
          {canUseInProgressModules ? <div className="dashboard-pm-overview">
            <div className="dashboard-compliance-ring" style={{ "--dashboard-ring": `${pmCompliance}%` } as React.CSSProperties}><div><strong>{pmCompliance}%</strong><span>compliance</span></div></div>
            <div className="dashboard-pm-stats">
              <span><strong>{pm?.summary.completedThisMonth ?? 0}</strong> completed this month</span>
              <span className={(pm?.summary.overdue ?? 0) > 0 ? "risk" : ""}><strong>{pm?.summary.overdue ?? 0}</strong> overdue schedules</span>
              <span><strong>{pm?.summary.checklistCoveragePercent ?? 0}%</strong> checklist coverage</span>
            </div>
          </div> : <DashboardLockedMessage />}
        </section>

        <section className="dashboard-command-card dashboard-stock-card interactive-card" role="link" tabIndex={0} onClick={(event) => openCard(event, "/spare-parts")} onKeyDown={(event) => openCard(event, "/spare-parts")}>
          <div className="dashboard-card-heading"><div><span>Spare parts</span><h2>Inventory readiness</h2><p>{inventory ? money(inventory.summary.totalValue) : "—"} held in stock.</p></div><Link to="/spare-parts">Inventory <ArrowRight size={14} /></Link></div>
          <div className="dashboard-stock-summary">
            <span><strong>{inventory?.summary.totalParts ?? 0}</strong> active SKUs</span>
            <span className="warning"><strong>{inventory?.summary.lowStock ?? 0}</strong> low stock</span>
            <span className="danger"><strong>{inventory?.summary.outOfStock ?? 0}</strong> stock-outs</span>
          </div>
          <div className="dashboard-risk-list">
            {stockRisks.length > 0 ? stockRisks.map((part) => (
              <div key={part.itemNo}><span><strong>{part.searchName || part.description}</strong><small>{part.itemNo} · {part.category}</small></span><b className={part.currentStock <= 0 ? "danger" : "warning"}>{part.currentStock} {part.uom}</b></div>
            )) : <p className="dashboard-clear-line"><CheckCircle2 size={15} /> All stocked items are above minimum.</p>}
          </div>
        </section>

        <section className="dashboard-command-card dashboard-attention-card interactive-card" role={canUseInProgressModules ? "link" : undefined} tabIndex={canUseInProgressModules ? 0 : undefined} onClick={canUseInProgressModules ? (event) => openCard(event, "/preventive-maintenance/schedule") : undefined} onKeyDown={canUseInProgressModules ? (event) => openCard(event, "/preventive-maintenance/schedule") : undefined}>
          <div className="dashboard-card-heading"><div><span>Next actions</span><h2>PM attention queue</h2><p>Recover overdue work first, then protect this week’s plan.</p></div>{canUseInProgressModules ? <Link to="/preventive-maintenance/schedule">Open plan <ArrowRight size={15} /></Link> : <Sparkles size={18} />}</div>
          {canUseInProgressModules ? <div className="dashboard-attention-list">
            {pmAttention.length > 0 ? pmAttention.map((item) => (
              <Link to="/preventive-maintenance/schedule" key={item.id} className={item.overdue ? "overdue" : ""}>
                <i /><span><strong>{item.machineName}</strong><small>{item.technicianName} · {item.scheduledDate}</small></span><b>{item.overdue ? "Overdue" : item.status.replace("_", " ")}</b>
              </Link>
            )) : <p className="dashboard-clear-line"><CheckCircle2 size={15} /> No PM schedules need attention.</p>}
          </div> : <DashboardLockedMessage />}
        </section>

        <section className="dashboard-command-card dashboard-asset-card interactive-card" role={canUseInProgressModules ? "link" : undefined} tabIndex={canUseInProgressModules ? 0 : undefined} onClick={canUseInProgressModules ? (event) => openCard(event, "/assets") : undefined} onKeyDown={canUseInProgressModules ? (event) => openCard(event, "/assets") : undefined}>
          <div className="dashboard-card-heading"><div><span>Asset management</span><h2>Production fleet readiness</h2><p>Lifecycle intelligence from the controlled 2026 machine register.</p></div>{canUseInProgressModules ? <Link to="/assets">Open assets <ArrowRight size={14} /></Link> : <span className="dashboard-feature-lock"><LockKeyhole size={14} />Locked</span>}</div>
          {canUseInProgressModules ? <div className="dashboard-asset-layout">
            <div className="dashboard-asset-score">
              <div className="dashboard-compliance-ring dashboard-asset-ring" style={{ "--dashboard-ring": `${assets?.summary.totalAssets ? Math.round((assets.summary.operational / assets.summary.totalAssets) * 100) : 0}%` } as React.CSSProperties}><div><strong>{assets?.summary.totalAssets ?? 0}</strong><span>assets</span></div></div>
              <span><Factory size={15} /><strong>{assets?.summary.operational ?? 0}</strong> operational</span>
              <span className="risk"><ShieldAlert size={15} /><strong>{assets?.summary.highRisk ?? 0}</strong> high risk</span>
              <span><CalendarClock size={15} /><strong>{assets?.summary.averageAge ?? 0} yrs</strong> average age</span>
            </div>
            <div className="dashboard-asset-attention">
              {assetAttention.map((asset) => (
                <Link to="/assets" key={asset.id}><i>{String(asset.assetNo).padStart(2, "0")}</i><span><strong>{asset.name}</strong><small>{asset.ageYears ?? "?"} years · {asset.condition}</small></span><b>{asset.riskScore}</b></Link>
              ))}
              {assetAttention.length === 0 ? <p className="dashboard-clear-line"><CheckCircle2 size={15} /> No assets are in the high-risk band.</p> : null}
            </div>
          </div> : <DashboardLockedMessage />}
        </section>
      </div>

      <section className="section-panel dashboard-work-orders dashboard-current-work">
        <div className="section-header">
          <div><span className="dashboard-section-kicker">Current execution</span><h2>{technicianMode ? "My Active Work Orders" : "Active Work Orders"}</h2><span>{loading ? "Loading live data..." : `${activeWorkOrders.length} active · ${visibleWorkOrders.length} shown`}</span></div>
          <Link className="section-link" to={technicianMode ? "/technician" : "/work-orders"}>View all</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>W/O</th><th>Title</th><th>Status</th><th>Priority</th><th>Section / Machine</th><th>Updated</th></tr></thead>
            <tbody>
              {visibleWorkOrders.map((workOrder) => (
                <tr className="clickable-table-row" key={workOrder.id} role="link" tabIndex={0} onClick={() => navigate(`/work-orders/${workOrder.id}`)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); navigate(`/work-orders/${workOrder.id}`); } }}>
                  <td><Link to={`/work-orders/${workOrder.id}`} onClick={(event) => event.stopPropagation()}>{workOrder.number}</Link></td>
                  <td>{workOrder.title}</td><td><StatusBadge status={workOrder.status} /></td><td><PriorityBadge priority={workOrder.priority} /></td>
                  <td>{workOrder.location} / {workOrder.machineName || workOrder.assetName}</td><td>{formatDateTime(workOrder.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="dashboard-work-mobile-list">
          {visibleWorkOrders.map((workOrder) => (
            <Link to={`/work-orders/${workOrder.id}`} key={workOrder.id}>
              <span><strong>{workOrder.number}</strong><StatusBadge status={workOrder.status} /></span>
              <h3>{workOrder.title}</h3>
              <small>{workOrder.location} · {workOrder.machineName || workOrder.assetName}</small>
              <span><PriorityBadge priority={workOrder.priority} /><time>{formatDateTime(workOrder.updatedAt)}</time><ArrowRight size={16} aria-hidden="true" /></span>
            </Link>
          ))}
        </div>
        {visibleWorkOrders.length === 0 && !loading ? <p className="quiet-line">{technicianMode ? "No work orders are currently assigned to you." : "No active work orders right now."}</p> : null}
      </section>
    </section>
  );
}

function DashboardLockedMessage() {
  return <div className="dashboard-locked-message"><LockKeyhole size={20} /><div><strong>Module still in progress</strong><span>The overview stays visible, but this section remains locked for production users.</span></div></div>;
}
