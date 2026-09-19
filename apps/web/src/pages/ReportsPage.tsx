import { plantLabels, type PlantId } from "@pbs-cmms/shared";
import { selectedPlant } from "../api/client";
import type { PmDashboardResponse, SpareInventoryResponse, WorkOrder } from "@pbs-cmms/shared";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  Download,
  FileBarChart,
  FileText,
  Gauge,
  Landmark,
  PackageCheck,
  Printer,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Wrench
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { api } from "../api/client";
import { useCurrentUser } from "../state/UserContext";
import { PlantSelector } from "../components/PlantSelector";

type PresetId = "daily" | "monthly" | "annual" | "work-orders" | "inventory" | "pm";
type RangeId = "7d" | "30d" | "ytd";

type ReportPreset = {
  id: PresetId;
  title: string;
  description: string;
  audience: string;
  icon: LucideIcon;
  range: RangeId;
  accent: string;
};

type Bucket = { label: string; start: Date; end: Date };

const presets: ReportPreset[] = [
  { id: "daily", title: "Daily Control Pack", description: "Shift execution, exceptions and immediate recovery.", audience: "Daily meeting", icon: CalendarDays, range: "7d", accent: "maroon" },
  { id: "monthly", title: "Monthly KPI Review", description: "Closure, PM discipline, material risk and trend.", audience: "Management", icon: CalendarRange, range: "30d", accent: "gold" },
  { id: "annual", title: "Annual Reliability Review", description: "Year-to-date performance and strategic priorities.", audience: "Leadership", icon: Landmark, range: "ytd", accent: "navy" },
  { id: "work-orders", title: "Work Order Register", description: "Maintenance and KAIZEN delivery with backlog detail.", audience: "Maintenance", icon: ClipboardList, range: "30d", accent: "teal" },
  { id: "inventory", title: "Inventory Risk Report", description: "Stock-outs, below-minimum items and working capital.", audience: "Store & buyer", icon: Boxes, range: "30d", accent: "green" },
  { id: "pm", title: "PM Audit Pack", description: "Schedule compliance, overdue work and checklist quality.", audience: "Audit ready", icon: ShieldCheck, range: "ytd", accent: "rose" }
];

const rangeLabels: Record<RangeId, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  ytd: "Year to date"
};

const chartColors = {
  maroon: "#851923",
  rose: "#bd4b55",
  gold: "#c99137",
  teal: "#167781",
  green: "#21845f",
  red: "#c54851",
  navy: "#3e465e",
  soft: "#ebe4e5"
};

function percent(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function money(value: number) {
  return new Intl.NumberFormat("en-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

function dateAtStart(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function dateAtEnd(value: Date) {
  const next = new Date(value);
  next.setHours(23, 59, 59, 999);
  return next;
}

function buildBuckets(range: RangeId, now: Date): Bucket[] {
  if (range === "7d") {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (6 - index));
      return { label: date.toLocaleDateString("en-MY", { weekday: "short" }), start: dateAtStart(date), end: dateAtEnd(date) };
    });
  }

  if (range === "30d") {
    return Array.from({ length: 6 }, (_, index) => {
      const start = new Date(now);
      start.setDate(now.getDate() - (29 - index * 5));
      const end = new Date(start);
      end.setDate(start.getDate() + 4);
      return {
        label: start.toLocaleDateString("en-MY", { day: "2-digit", month: "short" }),
        start: dateAtStart(start),
        end: dateAtEnd(end > now ? now : end)
      };
    });
  }

  return Array.from({ length: now.getMonth() + 1 }, (_, month) => {
    const start = new Date(now.getFullYear(), month, 1);
    const end = month === now.getMonth() ? now : new Date(now.getFullYear(), month + 1, 0);
    return { label: start.toLocaleDateString("en-MY", { month: "short" }), start: dateAtStart(start), end: dateAtEnd(end) };
  });
}

function inBucket(value: string, bucket: Bucket) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date >= bucket.start && date <= bucket.end;
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function tooltipStyle() {
  return { border: "1px solid #eadbdd", borderRadius: 10, boxShadow: "0 14px 34px rgba(63,7,16,.12)", fontSize: 11 };
}

export function ReportsPage() {
  const { currentUser } = useCurrentUser();
  const [activePreset, setActivePreset] = useState<PresetId>("monthly");
  const [range, setRange] = useState<RangeId>("30d");
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [inventory, setInventory] = useState<SpareInventoryResponse | null>(null);
  const [pm, setPm] = useState<PmDashboardResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [reportDate] = useState(() => new Date());

  const loadData = useCallback(async (soft = false) => {
    if (!currentUser) return;
    soft ? setRefreshing(true) : setLoading(true);
    try {
      const [nextWorkOrders, nextInventory, nextPm] = await Promise.all([
        api.workOrders(),
        api.spareInventory(),
        api.pmDashboard(currentUser.id, reportDate.getFullYear())
      ]);
      setWorkOrders(nextWorkOrders);
      setInventory(nextInventory);
      setPm(nextPm);
      setGeneratedAt(new Date());
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Couldn’t load this page.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUser, reportDate]);

  useEffect(() => {
    loadData().catch(console.error);
  }, [loadData]);

  useLiveRefresh(["work-orders", "spare-parts", "pm"], () => loadData(true), { enabled: Boolean(currentUser) });

  const selectPreset = (preset: ReportPreset) => {
    setActivePreset(preset.id);
    setRange(preset.range);
  };

  const preset = presets.find((item) => item.id === activePreset) ?? presets[1];
  const buckets = useMemo(() => buildBuckets(range, reportDate), [range, reportDate]);
  const rangeStart = buckets[0]?.start ?? new Date(reportDate.getFullYear(), 0, 1);
  const rangeEnd = buckets.at(-1)?.end ?? reportDate;

  const scopedWorkOrders = useMemo(() => workOrders.filter((item) => {
    const created = new Date(item.createdAt);
    const updated = new Date(item.updatedAt);
    return (created >= rangeStart && created <= rangeEnd) || (item.status === "closed" && updated >= rangeStart && updated <= rangeEnd);
  }), [workOrders, rangeStart.getTime(), rangeEnd.getTime()]);

  const scopedPm = useMemo(() => (pm?.schedules ?? []).filter((item) => {
    const date = new Date(`${item.scheduledDate}T00:00:00`);
    return date >= rangeStart && date <= rangeEnd;
  }), [pm, rangeStart.getTime(), rangeEnd.getTime()]);

  const validOrders = scopedWorkOrders.filter((item) => item.status !== "cancelled");
  const closedOrders = validOrders.filter((item) => item.status === "closed");
  const standardOrders = validOrders.filter((item) => item.type === "maintenance");
  const kaizenOrders = validOrders.filter((item) => item.type === "kaizen");
  const closure = percent(closedOrders.length, validOrders.length);
  const standardClosure = percent(standardOrders.filter((item) => item.status === "closed").length, standardOrders.length);
  const kaizenClosure = percent(kaizenOrders.filter((item) => item.status === "closed").length, kaizenOrders.length);
  const completedPm = scopedPm.filter((item) => ["submitted", "verified"].includes(item.status)).length;
  const pmCompliance = percent(completedPm, scopedPm.length);
  const partsAvailability = inventory ? percent(inventory.summary.totalParts - inventory.summary.outOfStock, inventory.summary.totalParts) : 0;
  const openBacklog = workOrders.filter((item) => !["closed", "cancelled"].includes(item.status)).length;

  const averageCloseHours = useMemo(() => {
    if (closedOrders.length === 0) return 0;
    const total = closedOrders.reduce((sum, item) => sum + Math.max(0, new Date(item.updatedAt).getTime() - new Date(item.createdAt).getTime()), 0);
    return Math.round(total / closedOrders.length / 3600000);
  }, [closedOrders]);

  const trendData = useMemo(() => buckets.map((bucket) => {
    const created = scopedWorkOrders.filter((item) => inBucket(item.createdAt, bucket));
    const closed = scopedWorkOrders.filter((item) => item.status === "closed" && inBucket(item.updatedAt, bucket));
    return { label: bucket.label, created: created.length, closed: closed.length, closeRate: percent(closed.length, created.length) };
  }), [buckets, scopedWorkOrders]);

  const pmTrendData = useMemo(() => buckets.map((bucket) => {
    const schedules = scopedPm.filter((item) => inBucket(`${item.scheduledDate}T00:00:00`, bucket));
    return {
      label: bucket.label,
      scheduled: schedules.length,
      completed: schedules.filter((item) => ["submitted", "verified"].includes(item.status)).length,
      overdue: schedules.filter((item) => item.overdue).length
    };
  }), [buckets, scopedPm]);

  const workTypeData = [
    { name: "Standard", value: standardOrders.length, fill: chartColors.maroon },
    { name: "KAIZEN", value: kaizenOrders.length, fill: chartColors.gold }
  ];

  const inventoryRisk = useMemo(() => {
    const groups = new Map<string, { category: string; healthy: number; low: number; out: number }>();
    for (const part of inventory?.parts ?? []) {
      const category = part.category || "Uncategorised";
      const group = groups.get(category) ?? { category, healthy: 0, low: 0, out: 0 };
      if (part.currentStock <= 0) group.out += 1;
      else if (part.minStock > 0 && part.currentStock <= part.minStock) group.low += 1;
      else group.healthy += 1;
      groups.set(category, group);
    }
    return [...groups.values()].sort((a, b) => b.out + b.low - (a.out + a.low)).slice(0, 6);
  }, [inventory]);

  const exceptions = useMemo(() => {
    const rows: Array<{ plant: string; area: string; reference: string; description: string; status: string; owner: string; action: string }> = [];
    workOrders
      .filter((item) => !["closed", "cancelled"].includes(item.status) && (item.priority === "critical" || item.status === "pending_material"))
      .slice(0, 4)
      .forEach((item) => rows.push({
        plant: plantLabels[item.plantId], area: "Work Order", reference: item.number, description: item.machineName || item.title,
        status: item.priority === "critical" ? "Critical" : "Waiting material", owner: item.assignedToId ? "Assigned technician" : "Planner",
        action: item.status === "pending_material" ? "Confirm material ETA" : "Escalate recovery"
      }));
    (inventory?.parts ?? [])
      .filter((item) => item.currentStock <= item.minStock)
      .sort((a, b) => a.currentStock - b.currentStock)
      .slice(0, 4)
      .forEach((item) => rows.push({
        plant: plantLabels[item.plantId || "port-klang"], area: "Spare Part", reference: item.itemNo, description: item.searchName || item.description,
        status: item.currentStock <= 0 ? "Stock-out" : "Below minimum", owner: "Store / Buyer",
        action: item.currentStock <= 0 ? "Expedite purchase" : "Raise replenishment"
      }));
    (pm?.schedules ?? []).filter((item) => item.overdue).slice(0, 4).forEach((item) => rows.push({
      plant: plantLabels[item.plantId || "port-klang"], area: "PM", reference: item.scheduledDate, description: item.machineName,
      status: "Overdue", owner: item.technicianName, action: "Recover and verify"
    }));
    return rows.slice(0, 10);
  }, [workOrders, inventory, pm]);

  const insights = [
    closure >= 90
      ? { tone: "good", icon: CheckCircle2, title: "Work order delivery is on target", detail: `${closure}% closure across ${validOrders.length} work orders in the selected period.` }
      : { tone: "risk", icon: Target, title: `${90 - closure}-point closure gap`, detail: `${openBacklog} work orders remain active; prioritise aged and material-blocked jobs.` },
    pmCompliance >= 95
      ? { tone: "good", icon: ShieldCheck, title: "PM discipline is protected", detail: `${pmCompliance}% of scheduled PM work is completed or verified.` }
      : { tone: "risk", icon: CalendarRange, title: "PM recovery requires ownership", detail: `${scopedPm.filter((item) => item.overdue).length} overdue schedules are visible in this reporting period.` },
    (inventory?.summary.outOfStock ?? 0) === 0
      ? { tone: "good", icon: PackageCheck, title: "No current stock-outs", detail: `${partsAvailability}% parts availability across the active inventory.` }
      : { tone: "risk", icon: Boxes, title: `${inventory?.summary.outOfStock ?? 0} stock-outs threaten response`, detail: `${inventory?.summary.lowStock ?? 0} additional items are at or below minimum stock.` },
    { tone: Math.abs(standardClosure - kaizenClosure) <= 10 ? "good" : "watch", icon: TrendingUp, title: "Maintenance vs KAIZEN balance", detail: `Standard closure is ${standardClosure}% and KAIZEN closure is ${kaizenClosure}%.` }
  ];

  const downloadCsv = () => {
    const header = ["Plant", "Area", "Reference", "Description", "Status", "Owner", "Next Action"];
    const rows = exceptions.length > 0 ? exceptions : [{ plant: selectedPlant() === "all" ? "Both plants" : plantLabels[selectedPlant() as PlantId], area: "Summary", reference: "-", description: "No active exceptions", status: "Clear", owner: "-", action: "Maintain control" }];
    const content = [header.map(csvCell).join(","), ...rows.map((row) => [row.plant, row.area, row.reference, row.description, row.status, row.owner, row.action].map(csvCell).join(","))].join("\r\n");
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sugi-${selectedPlant()}-${activePreset}-report-${reportDate.toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !generatedAt) return <div className="ux-recovery" role="status"><h1>Reports</h1><p>Preparing report data…</p></div>;

  return (
    <section className="reports-page page-stack">
      {loadError ? <div className="ux-load-error" role="alert"><span>Some information could not load. Displayed figures may be incomplete or out of date. {loadError}</span><button className="secondary-action" type="button" onClick={() => void loadData()}>Try again</button></div> : null}
      <div className="analytics-plant-filter"><span>Report plant</span><PlantSelector allowCombined compact /></div>
      <header className="reports-hero">
        <div>
          <span className="reports-eyebrow"><Sparkles size={14} /> Maintenance intelligence studio</span>
          <h1>Reports</h1>
          <p>Build a meeting-ready maintenance pack from live Work Order, Spare Part and PM records—then print it or take the exception register with you.</p>
          <div className="reports-hero-actions">
            <button type="button" onClick={() => window.print()}><Printer size={16} /> Print / Save PDF</button>
            <button type="button" onClick={downloadCsv}><Download size={16} /> Export exceptions</button>
          </div>
        </div>
        <div className="reports-hero-document" aria-hidden="true">
          <div><FileBarChart size={24} /><span>LIVE REPORT</span></div>
          <strong>{preset.title}</strong>
          <small>{rangeLabels[range]} · {reportDate.getFullYear()}</small>
          <i><b style={{ width: `${Math.max(12, closure)}%` }} /></i>
          <span>{closure}% work order closure</span>
        </div>
      </header>

      <section className="reports-library">
        <div className="reports-section-heading"><div><span>Report library</span><h2>Choose the conversation you need to lead</h2></div><small>Every pack uses the same live source of truth.</small></div>
        <div className="reports-preset-grid">
          {presets.map((item) => {
            const Icon = item.icon;
            return (
              <button type="button" key={item.id} className={`reports-preset-card tone-${item.accent} ${activePreset === item.id ? "active" : ""}`} onClick={() => selectPreset(item)}>
                <span><Icon size={18} /></span><small>{item.audience}</small><strong>{item.title}</strong><p>{item.description}</p><i><CheckCircle2 size={14} /></i>
              </button>
            );
          })}
        </div>
      </section>

      <div className="reports-control-bar">
        <div><FileText size={17} /><span><strong>{preset.title}</strong><small>Generated {generatedAt ? generatedAt.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" }) : "—"}</small></span></div>
        <div className="reports-range-tabs" role="group" aria-label="Report date range">
          {(["7d", "30d", "ytd"] as RangeId[]).map((item) => <button type="button" key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{rangeLabels[item]}</button>)}
        </div>
        <button className="reports-refresh" type="button" onClick={() => loadData(true)} disabled={refreshing} aria-label="Refresh report data"><RefreshCw size={16} className={refreshing ? "spin" : ""} /></button>
      </div>

      <article className="report-document" aria-busy={loading}>
        <p className="eyebrow">Plant: {selectedPlant() === "all" ? "Port Klang + Sendayan" : plantLabels[selectedPlant() as PlantId]}</p>
        <header className="report-document-header">
          <div><span>PBS CMMS · MANAGEMENT REPORT</span><h2>{preset.title}</h2><p>{rangeStart.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })} — {rangeEnd.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })}</p></div>
          <div><strong>{currentUser?.department || "Maintenance"}</strong><span>Prepared for {preset.audience}</span><small>Source: Live CMMS records</small></div>
        </header>

        <section className="report-kpi-grid">
          <ReportKpi icon={Gauge} label="WO closure" value={`${closure}%`} detail={`${closedOrders.length}/${validOrders.length} closed`} tone={closure >= 90 ? "good" : "risk"} />
          <ReportKpi icon={Wrench} label="Standard" value={`${standardClosure}%`} detail="maintenance closure" tone={standardClosure >= 90 ? "good" : "watch"} />
          <ReportKpi icon={Sparkles} label="KAIZEN" value={`${kaizenClosure}%`} detail="improvement closure" tone={kaizenClosure >= 85 ? "good" : "watch"} />
          <ReportKpi icon={ShieldCheck} label="PM compliance" value={`${pmCompliance}%`} detail={`${scopedPm.filter((item) => item.overdue).length} overdue`} tone={pmCompliance >= 95 ? "good" : "risk"} />
          <ReportKpi icon={PackageCheck} label="Parts ready" value={`${partsAvailability}%`} detail={inventory ? money(inventory.summary.totalValue) : "—"} tone={partsAvailability >= 98 ? "good" : "risk"} />
          <ReportKpi icon={TrendingUp} label="Avg. close time" value={`${averageCloseHours}h`} detail={`${openBacklog} active backlog`} tone="neutral" />
        </section>

        <section className="report-insight-band">
          <div className="report-section-title"><span>01</span><div><small>Executive readout</small><h3>What the numbers are saying</h3></div></div>
          <div className="report-insight-grid">
            {insights.map((insight) => {
              const Icon = insight.icon;
              return <article key={insight.title} className={insight.tone}><span><Icon size={17} /></span><div><strong>{insight.title}</strong><p>{insight.detail}</p></div></article>;
            })}
          </div>
        </section>

        <section className="report-analysis-section">
          <div className="report-section-title"><span>02</span><div><small>Performance analysis</small><h3>Delivery, care and supply</h3></div></div>
          <div className="report-chart-grid">
            <ReportChart title="Work order delivery" subtitle="Created versus closed by reporting bucket" className="report-chart-wide">
              <ResponsiveContainer width="100%" height="100%"><AreaChart data={trendData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                <defs><linearGradient id="reportCreated" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={chartColors.maroon} stopOpacity={0.28} /><stop offset="100%" stopColor={chartColors.maroon} stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid stroke="#eee7e8" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#786d74" }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#786d74" }} />
                <Tooltip contentStyle={tooltipStyle()} /><Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 10 }} />
                <Area type="monotone" dataKey="created" stroke={chartColors.maroon} fill="url(#reportCreated)" strokeWidth={2.3} animationDuration={900} />
                <Area type="monotone" dataKey="closed" stroke={chartColors.teal} fill="transparent" strokeWidth={2.3} animationDuration={1100} />
              </AreaChart></ResponsiveContainer>
            </ReportChart>
            <ReportChart title="Work mix" subtitle="Standard maintenance vs KAIZEN">
              <div className="report-donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={workTypeData} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={3} animationDuration={1000}>{workTypeData.map((item) => <Cell key={item.name} fill={item.fill} />)}</Pie><Tooltip contentStyle={tooltipStyle()} /></PieChart></ResponsiveContainer><div><strong>{validOrders.length}</strong><span>total WO</span></div></div>
              <div className="report-inline-legend"><span><i style={{ background: chartColors.maroon }} />Standard <b>{standardOrders.length}</b></span><span><i style={{ background: chartColors.gold }} />KAIZEN <b>{kaizenOrders.length}</b></span></div>
            </ReportChart>
            <ReportChart title="PM execution" subtitle="Scheduled, completed and overdue" className="report-chart-wide">
              <ResponsiveContainer width="100%" height="100%"><BarChart data={pmTrendData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}><CartesianGrid stroke="#eee7e8" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#786d74" }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#786d74" }} /><Tooltip contentStyle={tooltipStyle()} /><Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 10 }} /><Bar dataKey="scheduled" fill={chartColors.soft} radius={[4, 4, 0, 0]} /><Bar dataKey="completed" fill={chartColors.green} radius={[4, 4, 0, 0]} /><Bar dataKey="overdue" fill={chartColors.red} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
            </ReportChart>
            <ReportChart title="Inventory exposure" subtitle="Risk concentration by category">
              <ResponsiveContainer width="100%" height="100%"><BarChart data={inventoryRisk} layout="vertical" margin={{ top: 4, right: 8, left: 12, bottom: 0 }}><XAxis type="number" allowDecimals={false} hide /><YAxis type="category" dataKey="category" width={82} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#786d74" }} /><Tooltip contentStyle={tooltipStyle()} /><Bar dataKey="healthy" stackId="risk" fill={chartColors.green} /><Bar dataKey="low" stackId="risk" fill={chartColors.gold} /><Bar dataKey="out" stackId="risk" fill={chartColors.red} radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer>
            </ReportChart>
          </div>
        </section>

        <section className="report-exception-section">
          <div className="report-section-title"><span>03</span><div><small>Action appendix</small><h3>Exceptions requiring ownership</h3></div><strong>{exceptions.length} items</strong></div>
          <div className="report-table-wrap"><table><thead><tr><th>Plant</th><th>Area</th><th>Reference</th><th>Exception</th><th>Status</th><th>Owner</th><th>Required action</th></tr></thead><tbody>
            {exceptions.length > 0 ? exceptions.map((row, index) => <tr key={`${row.reference}-${index}`}><td>{row.plant}</td><td>{row.area}</td><td><strong>{row.reference}</strong></td><td>{row.description}</td><td><span className={row.status.toLowerCase().includes("critical") || row.status.toLowerCase().includes("overdue") || row.status.toLowerCase().includes("stock-out") ? "report-status-risk" : "report-status-watch"}>{row.status}</span></td><td>{row.owner}</td><td>{row.action}</td></tr>) : <tr><td colSpan={7}><div className="report-clear-state"><CheckCircle2 size={17} /> No active exceptions. Maintain current controls.</div></td></tr>}
          </tbody></table></div>
        </section>

        <footer className="report-document-footer"><div><span>Prepared by</span><strong>{currentUser?.name ?? "PBS CMMS"}</strong><i /></div><div><span>Reviewed by</span><strong>Maintenance Manager</strong><i /></div><div><span>Next review</span><strong>{range === "7d" ? "Next daily meeting" : range === "30d" ? "Next monthly review" : "Annual management review"}</strong><i /></div></footer>
      </article>
    </section>
  );
}

function ReportKpi({ icon: Icon, label, value, detail, tone }: { icon: LucideIcon; label: string; value: string; detail: string; tone: string }) {
  return <article className={`report-kpi tone-${tone}`}><span><Icon size={17} /></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function ReportChart({ title, subtitle, className = "", children }: { title: string; subtitle: string; className?: string; children: React.ReactNode }) {
  return <article className={`report-chart-card ${className}`}><div><span><BarChart3 size={15} /></span><div><strong>{title}</strong><small>{subtitle}</small></div></div><div className="report-chart-canvas">{children}</div></article>;
}

export default ReportsPage;
