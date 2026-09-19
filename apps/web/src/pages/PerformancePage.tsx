import type {
  PmDashboardResponse,
  SpareInventoryResponse,
  WorkOrder
} from "@pbs-cmms/shared";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  Clock3,
  Gauge,
  PackageCheck,
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
  ComposedChart,
  Legend,
  Line,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { api } from "../api/client";
import { useCurrentUser } from "../state/UserContext";
import { PlantSelector } from "../components/PlantSelector";

type Period = "daily" | "monthly" | "yearly";
type Focus = "all" | "work-orders" | "spares" | "pm";

const colors = {
  maroon: "#851923",
  rose: "#bd4b55",
  gold: "#c99137",
  teal: "#167781",
  green: "#21845f",
  red: "#c54851",
  navy: "#30384f",
  pale: "#efe7e8"
};

const periodCopy: Record<Period, { eyebrow: string; title: string; subtitle: string }> = {
  daily: {
    eyebrow: "Daily control meeting",
    title: "Today’s maintenance pulse",
    subtitle: "Live execution, blockers, stock risk and the next action for every exception."
  },
  monthly: {
    eyebrow: "Monthly performance review",
    title: "Trend, cost and reliability review",
    subtitle: "Compare weekly delivery, repeat loss, material consumption and PM discipline."
  },
  yearly: {
    eyebrow: "Annual management review",
    title: "Reliability strategy at a glance",
    subtitle: "See long-range closure, asset care, inventory exposure and improvement capacity."
  }
};

const focusOptions: Array<{ id: Focus; label: string }> = [
  { id: "all", label: "All performance" },
  { id: "work-orders", label: "Work orders" },
  { id: "spares", label: "Spare parts" },
  { id: "pm", label: "PM" }
];

function percent(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function money(value: number) {
  return new Intl.NumberFormat("en-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: value >= 10000 ? 0 : 2
  }).format(value);
}

function isSameDay(value: string, date: Date) {
  const item = new Date(value);
  return item.getFullYear() === date.getFullYear() && item.getMonth() === date.getMonth() && item.getDate() === date.getDate();
}

function inPeriod(value: string, period: Period, date: Date) {
  const item = new Date(value);
  if (Number.isNaN(item.getTime())) return false;
  if (period === "daily") return isSameDay(value, date);
  if (period === "monthly") return item.getFullYear() === date.getFullYear() && item.getMonth() === date.getMonth();
  return item.getFullYear() === date.getFullYear();
}

function bucketLabels(period: Period) {
  if (period === "daily") return ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"];
  if (period === "monthly") return ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"];
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
}

function bucketIndex(value: string, period: Period) {
  const item = new Date(value);
  if (Number.isNaN(item.getTime())) return -1;
  if (period === "daily") return Math.min(7, Math.floor(item.getHours() / 3));
  if (period === "monthly") return Math.min(4, Math.floor((item.getDate() - 1) / 7));
  return item.getMonth();
}

function closureRate(records: WorkOrder[], type: WorkOrder["type"]) {
  const matching = records.filter((item) => item.type === type && item.status !== "cancelled");
  return percent(matching.filter((item) => item.status === "closed").length, matching.length);
}

function chartTooltipStyle() {
  return {
    border: "1px solid #eadbdd",
    borderRadius: 10,
    boxShadow: "0 14px 34px rgba(63, 7, 16, .12)",
    fontSize: 12
  };
}

export function PerformancePage() {
  const { currentUser } = useCurrentUser();
  const [period, setPeriod] = useState<Period>("daily");
  const [focus, setFocus] = useState<Focus>("all");
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [inventory, setInventory] = useState<SpareInventoryResponse | null>(null);
  const [pm, setPm] = useState<PmDashboardResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [live, setLive] = useState(true);
  const [reportDate] = useState(() => new Date());

  const loadPerformance = useCallback(async (soft = false) => {
    if (!currentUser) return;
    soft ? setRefreshing(true) : setLoading(true);
    const year = new Date().getFullYear();
    const [workResult, inventoryResult, pmResult] = await Promise.allSettled([
      api.workOrders(),
      api.spareInventory(),
      api.pmDashboard(currentUser.id, year)
    ]);
    if (workResult.status === "fulfilled") setWorkOrders(workResult.value);
    if (inventoryResult.status === "fulfilled") setInventory(inventoryResult.value);
    if (pmResult.status === "fulfilled") setPm(pmResult.value);
    const failed = [workResult, inventoryResult, pmResult].some((result) => result.status === "rejected");
    setLoadError(failed ? "Some performance data could not load. Figures may be incomplete or out of date." : "");
    if (!failed) setLastUpdated(new Date());
    setLoading(false);
    setRefreshing(false);
  }, [currentUser]);

  useEffect(() => {
    loadPerformance().catch(console.error);
  }, [loadPerformance]);

  useLiveRefresh(["work-orders", "spare-parts", "pm"], () => loadPerformance(true), {
    enabled: live && Boolean(currentUser),
    fallbackMs: 30000
  });

  const now = reportDate;
  const scopedWorkOrders = useMemo(
    () => workOrders.filter((item) => inPeriod(item.createdAt, period, now) || (item.status === "closed" && inPeriod(item.updatedAt, period, now))),
    [workOrders, period, now.getDate(), now.getMonth(), now.getFullYear()]
  );
  const scopedPm = useMemo(
    () => (pm?.schedules ?? []).filter((item) => inPeriod(`${item.scheduledDate}T00:00:00`, period, now)),
    [pm, period, now.getDate(), now.getMonth(), now.getFullYear()]
  );
  const scopedMovements = useMemo(
    () => (inventory?.recentMovements ?? []).filter((item) => inPeriod(item.createdAt, period, now)),
    [inventory, period, now.getDate(), now.getMonth(), now.getFullYear()]
  );

  const woStats = useMemo(() => {
    const valid = scopedWorkOrders.filter((item) => item.status !== "cancelled");
    const closed = valid.filter((item) => item.status === "closed");
    const open = valid.filter((item) => !["closed", "resolved"].includes(item.status));
    return {
      total: valid.length,
      closed: closed.length,
      rate: percent(closed.length, valid.length),
      standardRate: closureRate(valid, "maintenance"),
      kaizenRate: closureRate(valid, "kaizen"),
      criticalOpen: open.filter((item) => item.priority === "critical").length,
      pendingMaterial: open.filter((item) => item.status === "pending_material").length,
      open
    };
  }, [scopedWorkOrders]);

  const pmStats = useMemo(() => {
    const completed = scopedPm.filter((item) => ["submitted", "verified"].includes(item.status)).length;
    const overdue = scopedPm.filter((item) => item.overdue).length;
    const failed = scopedPm.reduce((sum, item) => sum + item.failedItemCount, 0);
    const checks = scopedPm.reduce((sum, item) => sum + item.completedItemCount, 0);
    return {
      total: scopedPm.length,
      completed,
      overdue,
      compliance: percent(completed, scopedPm.length),
      failureRate: percent(failed, checks),
      failed
    };
  }, [scopedPm]);

  const partsAvailability = inventory ? percent(inventory.summary.totalParts - inventory.summary.outOfStock, inventory.summary.totalParts) : 0;

  const throughputData = useMemo(() => {
    const labels = bucketLabels(period);
    return labels.map((label, index) => {
      const created = scopedWorkOrders.filter((item) => bucketIndex(item.createdAt, period) === index);
      const closed = scopedWorkOrders.filter((item) => item.status === "closed" && bucketIndex(item.updatedAt, period) === index);
      return {
        label,
        standard: created.filter((item) => item.type === "maintenance").length,
        kaizen: created.filter((item) => item.type === "kaizen").length,
        closed: closed.length,
        closeRate: percent(closed.length, created.length)
      };
    });
  }, [scopedWorkOrders, period]);

  const pmTrendData = useMemo(() => {
    const labels = bucketLabels(period);
    return labels.map((label, index) => {
      const schedules = scopedPm.filter((item) => bucketIndex(`${item.scheduledDate}T00:00:00`, period) === index);
      return {
        label,
        scheduled: schedules.length,
        completed: schedules.filter((item) => ["submitted", "verified"].includes(item.status)).length,
        overdue: schedules.filter((item) => item.overdue).length
      };
    });
  }, [scopedPm, period]);

  const movementData = useMemo(() => {
    const labels = bucketLabels(period);
    return labels.map((label, index) => {
      const movements = scopedMovements.filter((item) => bucketIndex(item.createdAt, period) === index);
      return {
        label,
        issued: movements.filter((item) => item.type === "issue").reduce((sum, item) => sum + item.quantity, 0),
        received: movements.filter((item) => ["restock", "return"].includes(item.type)).reduce((sum, item) => sum + item.quantity, 0)
      };
    });
  }, [scopedMovements, period]);

  const categoryRisk = useMemo(() => {
    const groups = new Map<string, { category: string; healthy: number; low: number; out: number; value: number }>();
    for (const part of inventory?.parts ?? []) {
      const category = part.category || "Uncategorised";
      const group = groups.get(category) ?? { category, healthy: 0, low: 0, out: 0, value: 0 };
      if (part.currentStock <= 0) group.out += 1;
      else if (part.minStock > 0 && part.currentStock <= part.minStock) group.low += 1;
      else group.healthy += 1;
      group.value += part.currentStock * part.price;
      groups.set(category, group);
    }
    return [...groups.values()].sort((a, b) => b.low + b.out - (a.low + a.out)).slice(0, 6);
  }, [inventory]);

  const priorityData = useMemo(() => {
    const priorities: Array<WorkOrder["priority"]> = ["critical", "high", "medium", "low"];
    return priorities.map((priority) => ({
      priority: priority[0].toUpperCase() + priority.slice(1),
      standard: woStats.open.filter((item) => item.priority === priority && item.type === "maintenance").length,
      kaizen: woStats.open.filter((item) => item.priority === priority && item.type === "kaizen").length
    }));
  }, [woStats.open]);

  const technicianLoad = useMemo(() => {
    const groups = new Map<string, { name: string; scheduled: number; completed: number }>();
    for (const schedule of scopedPm) {
      const group = groups.get(schedule.technicianName) ?? { name: schedule.technicianName, scheduled: 0, completed: 0 };
      group.scheduled += 1;
      if (["submitted", "verified"].includes(schedule.status)) group.completed += 1;
      groups.set(schedule.technicianName, group);
    }
    return [...groups.values()].sort((a, b) => b.scheduled - a.scheduled).slice(0, 6);
  }, [scopedPm]);

  const closureRings = useMemo(() => [
    { name: "Standard maintenance", value: woStats.standardRate, fill: colors.maroon },
    { name: "KAIZEN", value: woStats.kaizenRate, fill: colors.gold }
  ], [woStats.standardRate, woStats.kaizenRate]);

  const radarData = useMemo(() => [
    { metric: "WO closure", score: woStats.rate },
    { metric: "PM compliance", score: pmStats.compliance },
    { metric: "Parts ready", score: partsAvailability },
    { metric: "No overdue PM", score: percent(Math.max(0, pmStats.total - pmStats.overdue), pmStats.total) },
    { metric: "Stock health", score: inventory ? percent(inventory.summary.totalParts - inventory.summary.lowStock, inventory.summary.totalParts) : 0 }
  ], [woStats.rate, pmStats.compliance, pmStats.total, pmStats.overdue, partsAvailability, inventory]);

  const exceptions = useMemo(() => {
    const rows: Array<{ area: string; item: string; severity: "Critical" | "Watch"; owner: string; action: string }> = [];
    woStats.open
      .filter((item) => item.priority === "critical" || item.status === "pending_material")
      .slice(0, 2)
      .forEach((item) => rows.push({
        area: "Work order",
        item: `${item.number} · ${item.machineName || item.title}`,
        severity: item.priority === "critical" ? "Critical" : "Watch",
        owner: item.assignedToId ? "Assigned technician" : "Planner",
        action: item.status === "pending_material" ? "Confirm material ETA" : "Escalate response"
      }));
    (inventory?.parts ?? [])
      .filter((item) => item.currentStock <= item.minStock)
      .sort((a, b) => a.currentStock - b.currentStock)
      .slice(0, 2)
      .forEach((item) => rows.push({
        area: "Spare part",
        item: `${item.itemNo} · ${item.searchName || item.description}`,
        severity: item.currentStock <= 0 ? "Critical" : "Watch",
        owner: "Store / Buyer",
        action: item.currentStock <= 0 ? "Expedite replenishment" : "Raise reorder"
      }));
    scopedPm.filter((item) => item.overdue).slice(0, 2).forEach((item) => rows.push({
      area: "PM",
      item: `${item.machineName} · ${item.scheduledDate}`,
      severity: "Critical",
      owner: item.technicianName,
      action: "Recover and verify today"
    }));
    return rows;
  }, [woStats.open, inventory, scopedPm]);

  const meetingRows = [
    {
      kpi: "Standard WO closure",
      actual: `${woStats.standardRate}%`,
      target: period === "daily" ? "≥ 80%" : "≥ 90%",
      good: woStats.standardRate >= (period === "daily" ? 80 : 90),
      message: woStats.standardRate >= 90 ? "Sustain close-out discipline" : "Review oldest open maintenance jobs"
    },
    {
      kpi: "KAIZEN closure",
      actual: `${woStats.kaizenRate}%`,
      target: "≥ 85%",
      good: woStats.kaizenRate >= 85,
      message: "Protect improvement capacity from breakdown work"
    },
    {
      kpi: "Parts availability",
      actual: `${partsAvailability}%`,
      target: "≥ 98%",
      good: partsAvailability >= 98,
      message: "Prioritise A-rank shortages and long lead items"
    },
    {
      kpi: "PM compliance",
      actual: `${pmStats.compliance}%`,
      target: "≥ 95%",
      good: pmStats.compliance >= 95,
      message: "Recover overdue schedule before adding new work"
    }
  ];

  const showWorkOrders = focus === "all" || focus === "work-orders";
  const showSpares = focus === "all" || focus === "spares";
  const showPm = focus === "all" || focus === "pm";
  const activePeriod = periodCopy[period];

  if (loading && !lastUpdated) return <div className="ux-recovery" role="status"><h1>Performance</h1><p>Loading performance data…</p></div>;

  return (
    <section className="performance-page page-stack">
      {loadError ? <div className="ux-load-error" role="alert"><span>{loadError}</span><button className="secondary-action" type="button" onClick={() => void loadPerformance(true)}>Try again</button></div> : null}
      <div className="analytics-plant-filter"><span>Viewing</span><PlantSelector allowCombined compact /></div>
      <header className="performance-hero">
        <div className="performance-hero-copy">
          <div className="performance-eyebrow"><Sparkles size={14} /> {activePeriod.eyebrow}</div>
          <h1>{activePeriod.title}</h1>
          <p>{activePeriod.subtitle}</p>
          <div className="performance-period-tabs" data-period={period} role="tablist" aria-label="Performance reporting period">
            {(["daily", "monthly", "yearly"] as Period[]).map((item) => (
              <button key={item} type="button" role="tab" aria-selected={period === item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="performance-live-card">
          <div>
            <span className={`live-dot ${live ? "active" : ""}`} />
            <strong>{live ? "Live operations" : "Live updates paused"}</strong>
          </div>
          <LiveClock />
          <small>Last synced {lastUpdated ? lastUpdated.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" }) : "—"}</small>
          <div className="performance-live-actions">
            <button type="button" onClick={() => setLive((value) => !value)}>{live ? "Pause" : "Go live"}</button>
            <button type="button" aria-label="Refresh performance data" onClick={() => loadPerformance(true)} disabled={refreshing}>
              <RefreshCw size={15} className={refreshing ? "spin" : ""} />
            </button>
          </div>
        </div>
      </header>

      <div className="performance-kpi-grid" aria-busy={loading}>
        <Kpi icon={Wrench} label="WO closure" value={`${woStats.rate}%`} note={`${woStats.closed} of ${woStats.total} closed`} tone="maroon" />
        <Kpi icon={TrendingUp} label="Standard maintenance" value={`${woStats.standardRate}%`} note="Close rate" tone="teal" />
        <Kpi icon={Sparkles} label="KAIZEN" value={`${woStats.kaizenRate}%`} note="Improvement close rate" tone="gold" />
        <Kpi icon={PackageCheck} label="Parts availability" value={`${partsAvailability}%`} note={`${inventory?.summary.outOfStock ?? 0} stock-outs`} tone="green" />
        <Kpi icon={ShieldCheck} label="PM compliance" value={`${pmStats.compliance}%`} note={`${pmStats.overdue} overdue`} tone="navy" />
        <Kpi icon={AlertTriangle} label="Active exceptions" value={String(exceptions.length)} note="Require meeting action" tone={exceptions.length > 0 ? "red" : "green"} />
      </div>

      <div className="performance-focus-bar">
        <div>
          <strong>Meeting lens</strong>
          <span>Focus the room without losing the overall picture.</span>
        </div>
        <div role="group" aria-label="Performance area filter">
          {focusOptions.map((option) => (
            <button type="button" key={option.id} className={focus === option.id ? "active" : ""} onClick={() => setFocus(option.id)}>{option.label}</button>
          ))}
        </div>
      </div>

      <div className="performance-view-stage">
        {showWorkOrders ? (
          <section className="performance-section">
            <SectionHeading icon={Wrench} eyebrow="Work order performance" title="Delivery, response and close-out" note={`${woStats.total} work orders in view`} />
            <div className="performance-chart-grid performance-chart-grid-wide">
              <ChartCard title="Created vs closed" subtitle="Standard and KAIZEN intake with close-out rate" className="chart-wide">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={throughputData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                    <CartesianGrid stroke="#eee6e7" strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#7d7078" }} />
                    <YAxis yAxisId="count" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#7d7078" }} />
                    <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} hide />
                    <Tooltip contentStyle={chartTooltipStyle()} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="count" dataKey="standard" name="Standard" stackId="created" fill={colors.maroon} radius={[4, 4, 0, 0]} animationDuration={850} />
                    <Bar yAxisId="count" dataKey="kaizen" name="KAIZEN" stackId="created" fill={colors.gold} radius={[4, 4, 0, 0]} animationDuration={950} />
                    <Bar yAxisId="count" dataKey="closed" name="Closed" fill={colors.teal} radius={[4, 4, 0, 0]} animationDuration={1050} />
                    <Line yAxisId="rate" type="monotone" dataKey="closeRate" name="Close rate %" stroke={colors.green} strokeWidth={2.5} dot={{ r: 3, fill: "#fff" }} animationDuration={1200} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Closure by work type" subtitle="A clear split for maintenance and improvement">
                <div className="performance-radial-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadialBarChart innerRadius="35%" outerRadius="95%" barSize={13} data={closureRings} startAngle={90} endAngle={-270}>
                      <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                      <RadialBar background dataKey="value" cornerRadius={8} animationDuration={1100} />
                      <Tooltip contentStyle={chartTooltipStyle()} formatter={(value) => `${value}%`} />
                    </RadialBarChart>
                  </ResponsiveContainer>
                  <div className="radial-center"><strong>{woStats.rate}%</strong><span>overall</span></div>
                </div>
                <div className="performance-legend-pills">
                  <span><i style={{ background: colors.maroon }} />Standard <strong>{woStats.standardRate}%</strong></span>
                  <span><i style={{ background: colors.gold }} />KAIZEN <strong>{woStats.kaizenRate}%</strong></span>
                </div>
              </ChartCard>
              <ChartCard title="Open backlog by priority" subtitle={`${woStats.pendingMaterial} jobs waiting for material`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={priorityData} layout="vertical" margin={{ top: 4, right: 12, left: 5, bottom: 0 }}>
                    <CartesianGrid stroke="#eee6e7" strokeDasharray="3 5" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} hide />
                    <YAxis type="category" dataKey="priority" width={58} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#7d7078" }} />
                    <Tooltip contentStyle={chartTooltipStyle()} />
                    <Bar dataKey="standard" name="Standard" stackId="a" fill={colors.maroon} radius={[0, 0, 0, 0]} animationDuration={800} />
                    <Bar dataKey="kaizen" name="KAIZEN" stackId="a" fill={colors.gold} radius={[0, 6, 6, 0]} animationDuration={1000} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </section>
        ) : null}

        {showSpares ? (
          <section className="performance-section">
            <SectionHeading icon={Boxes} eyebrow="Spare part performance" title="Availability, movement and working capital" note={inventory ? money(inventory.summary.totalValue) : "—"} />
            <div className="performance-chart-grid">
              <ChartCard title="Stock movement" subtitle="Issues compared with replenishment" className="chart-wide">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={movementData} margin={{ top: 8, right: 10, left: -22, bottom: 0 }}>
                    <defs>
                      <linearGradient id="issuedFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colors.maroon} stopOpacity={0.3} /><stop offset="100%" stopColor={colors.maroon} stopOpacity={0.02} /></linearGradient>
                      <linearGradient id="receivedFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colors.teal} stopOpacity={0.26} /><stop offset="100%" stopColor={colors.teal} stopOpacity={0.02} /></linearGradient>
                    </defs>
                    <CartesianGrid stroke="#eee6e7" strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#7d7078" }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#7d7078" }} />
                    <Tooltip contentStyle={chartTooltipStyle()} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="issued" stroke={colors.maroon} fill="url(#issuedFill)" strokeWidth={2.5} animationDuration={1000} />
                    <Area type="monotone" dataKey="received" stroke={colors.teal} fill="url(#receivedFill)" strokeWidth={2.5} animationDuration={1200} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Inventory risk by category" subtitle="Healthy, below-minimum and stocked-out SKUs" className="chart-wide">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryRisk} layout="vertical" margin={{ top: 4, right: 8, left: 22, bottom: 0 }}>
                    <CartesianGrid stroke="#eee6e7" strokeDasharray="3 5" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} hide />
                    <YAxis type="category" dataKey="category" width={90} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#7d7078" }} />
                    <Tooltip contentStyle={chartTooltipStyle()} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="healthy" stackId="risk" fill={colors.green} animationDuration={800} />
                    <Bar dataKey="low" name="Below minimum" stackId="risk" fill={colors.gold} animationDuration={1000} />
                    <Bar dataKey="out" name="Stock-out" stackId="risk" fill={colors.red} radius={[0, 6, 6, 0]} animationDuration={1200} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </section>
        ) : null}

        {showPm ? (
          <section className="performance-section">
            <SectionHeading icon={ShieldCheck} eyebrow="Preventive maintenance" title="Compliance, schedule recovery and load" note={`${pmStats.completed}/${pmStats.total} completed`} />
            <div className="performance-chart-grid performance-chart-grid-wide">
              <ChartCard title="PM execution trend" subtitle="Scheduled work, completion and overdue exposure" className="chart-wide">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={pmTrendData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                    <CartesianGrid stroke="#eee6e7" strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#7d7078" }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#7d7078" }} />
                    <Tooltip contentStyle={chartTooltipStyle()} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="scheduled" fill="#ebe5e6" stroke={colors.navy} fillOpacity={0.55} animationDuration={850} />
                    <Bar dataKey="completed" fill={colors.green} radius={[5, 5, 0, 0]} animationDuration={1050} />
                    <Line type="monotone" dataKey="overdue" stroke={colors.red} strokeWidth={2.5} dot={{ r: 3 }} animationDuration={1250} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Technician PM load" subtitle="Scheduled vs completed assignments">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={technicianLoad} layout="vertical" margin={{ top: 4, right: 8, left: 26, bottom: 0 }}>
                    <XAxis type="number" allowDecimals={false} hide />
                    <YAxis type="category" dataKey="name" width={80} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#7d7078" }} />
                    <Tooltip contentStyle={chartTooltipStyle()} />
                    <Bar dataKey="scheduled" fill="#ddd4d6" radius={[0, 6, 6, 0]} animationDuration={800} />
                    <Bar dataKey="completed" fill={colors.teal} radius={[0, 6, 6, 0]} animationDuration={1100} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <div className="performance-insight-card">
                <span><Target size={18} /></span>
                <small>PM quality signal</small>
                <strong>{pmStats.failureRate}%</strong>
                <p>Checklist failure rate from {pmStats.failed} failed checks.</p>
                <div><i style={{ width: `${Math.min(100, pmStats.failureRate)}%` }} /></div>
              </div>
            </div>
          </section>
        ) : null}

        {focus === "all" ? (
          <section className="performance-section">
            <SectionHeading icon={Gauge} eyebrow="Cross-functional control" title="One maintenance system, one meeting view" note="Targets normalised to 100" />
            <div className="performance-cross-grid">
              <ChartCard title="Maintenance health profile" subtitle="Balanced performance across delivery, care and supply">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} outerRadius="72%">
                    <PolarGrid stroke="#e6dfe0" />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 9, fill: "#6f636b" }} />
                    <Radar dataKey="score" stroke={colors.maroon} fill={colors.maroon} fillOpacity={0.18} strokeWidth={2.5} isAnimationActive={false} />
                    <Tooltip contentStyle={chartTooltipStyle()} formatter={(value) => `${value}%`} />
                  </RadarChart>
                </ResponsiveContainer>
              </ChartCard>
              <div className="performance-table-card meeting-table-card">
                <div className="performance-card-heading">
                  <div><strong>Meeting scorecard</strong><span>Actual vs target and the next useful conversation</span></div>
                  <Activity size={18} />
                </div>
                <div className="performance-table-scroll">
                  <table>
                    <thead><tr><th>KPI</th><th>Actual</th><th>Target</th><th>Direction</th><th>Meeting action</th></tr></thead>
                    <tbody>{meetingRows.map((row) => (
                      <tr key={row.kpi}>
                        <td><strong>{row.kpi}</strong></td>
                        <td>{row.actual}</td>
                        <td>{row.target}</td>
                        <td><span className={`direction-pill ${row.good ? "good" : "risk"}`}>{row.good ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{row.good ? "On track" : "Recovery"}</span></td>
                        <td>{row.message}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className="performance-section performance-exceptions-section">
          <SectionHeading icon={AlertTriangle} eyebrow="Exception management" title="Leave the meeting with owners and actions" note={`${exceptions.length} active items`} />
          <div className="performance-table-card">
            <div className="performance-table-scroll">
              <table>
                <thead><tr><th>Area</th><th>Exception</th><th>Priority</th><th>Owner</th><th>Next action</th></tr></thead>
                <tbody>
                  {exceptions.length > 0 ? exceptions.map((row, index) => (
                    <tr key={`${row.item}-${index}`}><td>{row.area}</td><td><strong>{row.item}</strong></td><td><span className={`severity-pill ${row.severity.toLowerCase()}`}>{row.severity}</span></td><td>{row.owner}</td><td>{row.action}</td></tr>
                  )) : <tr><td colSpan={5}><div className="performance-clear-state"><CheckCircle2 size={18} /> No active exceptions in this view.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function Kpi({ icon: Icon, label, value, note, tone }: { icon: typeof Clock3; label: string; value: string; note: string; tone: string }) {
  return <article className={`performance-kpi tone-${tone}`}><span><Icon size={19} /></span><div><small>{label}</small><strong>{value}</strong><p>{note}</p></div></article>;
}

function SectionHeading({ icon: Icon, eyebrow, title, note }: { icon: typeof Clock3; eyebrow: string; title: string; note: string }) {
  return <div className="performance-section-heading"><span><Icon size={17} /></span><div><small>{eyebrow}</small><h2>{title}</h2></div><strong>{note}</strong></div>;
}

function ChartCard({ title, subtitle, className = "", children }: { title: string; subtitle: string; className?: string; children: React.ReactNode }) {
  return <article className={`performance-chart-card ${className}`}><div className="performance-card-heading"><div><strong>{title}</strong><span>{subtitle}</span></div><TrendingUp size={18} /></div><div className="performance-chart-canvas">{children}</div></article>;
}

function LiveClock() {
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return <time>{clock.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>;
}

export default PerformancePage;
