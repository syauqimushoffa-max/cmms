import type { AssetCondition, AssetCriticality, AssetDashboardResponse, AssetLifecycleBand, AssetRecord } from "@pbs-cmms/shared";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Database,
  Factory,
  FileWarning,
  MapPin,
  Phone,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Wrench,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useCurrentUser } from "../state/UserContext";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

const conditionLabels: Record<AssetCondition, string> = {
  operational: "Operational",
  watch: "Watch",
  obsolete: "Obsolete",
  decommissioned: "Decommissioned"
};

const lifecycleLabels: Record<AssetLifecycleBand, string> = {
  modern: "0-7 years",
  midlife: "8-15 years",
  aging: "16-24 years",
  legacy: "25+ years",
  unknown: "Unknown"
};

function AssetConditionBadge({ condition }: { condition: AssetCondition }) {
  return <span className={`asset-condition asset-condition-${condition}`}><i />{conditionLabels[condition]}</span>;
}

function RiskBadge({ score }: { score: number }) {
  const tone = score >= 75 ? "high" : score >= 55 ? "medium" : "low";
  return <span className={`asset-risk asset-risk-${tone}`}>{score}<small>/100</small></span>;
}

export function AssetsPage() {
  const { currentUser } = useCurrentUser();
  const [dashboard, setDashboard] = useState<AssetDashboardResponse | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<AssetRecord | null>(null);
  const [search, setSearch] = useState("");
  const [condition, setCondition] = useState<"all" | AssetCondition>("all");
  const [lifecycle, setLifecycle] = useState<"all" | AssetLifecycleBand>("all");
  const [sort, setSort] = useState<"number" | "risk" | "age">("number");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadAssets(showLoading = false) {
    if (showLoading) setLoading(true);
    try {
      const next = await api.assetDashboard();
      setDashboard(next);
      if (selectedAsset) {
        setSelectedAsset(next.assets.find((asset) => asset.id === selectedAsset.id) || null);
      }
      setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t load assets. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAssets(true).catch(console.error);
  }, []);

  useLiveRefresh(["assets"], () => loadAssets(false));

  const filteredAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...(dashboard?.assets ?? [])]
      .filter((asset) => {
        const searchMatch = !query || [asset.name, asset.serialNo, asset.manufacturer, asset.supplier, String(asset.assetNo)]
          .some((value) => value.toLowerCase().includes(query));
        return searchMatch && (condition === "all" || asset.condition === condition) && (lifecycle === "all" || asset.lifecycleBand === lifecycle);
      })
      .sort((a, b) => sort === "risk" ? b.riskScore - a.riskScore : sort === "age" ? (b.ageYears ?? -1) - (a.ageYears ?? -1) : a.assetNo - b.assetNo);
  }, [condition, dashboard?.assets, lifecycle, search, sort]);

  const lifecycleCounts = useMemo(() => {
    const assets = dashboard?.assets ?? [];
    return (["modern", "midlife", "aging", "legacy", "unknown"] as AssetLifecycleBand[]).map((band) => ({
      band,
      count: assets.filter((asset) => asset.lifecycleBand === band).length
    }));
  }, [dashboard?.assets]);

  const canManage = currentUser ? ["executive", "admin", "developer"].includes(currentUser.role) : false;
  const summary = dashboard?.summary;
  const highRiskAssets = useMemo(
    () => [...(dashboard?.assets ?? [])].filter((asset) => asset.riskScore >= 75).sort((a, b) => b.riskScore - a.riskScore || b.assetNo - a.assetNo).slice(0, 5),
    [dashboard?.assets]
  );

  async function saveAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAsset || !currentUser) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await api.updateAsset(selectedAsset.id, {
        actorId: currentUser.id,
        condition: form.get("condition") as AssetCondition,
        criticality: form.get("criticality") as AssetCriticality,
        location: String(form.get("location") || "Production"),
        notes: String(form.get("notes") || "")
      });
      await loadAssets();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to update asset.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-stack assets-page">
      <div className="asset-hero">
        <div className="asset-hero-copy">
          <p><span /> Equipment register</p>
          <h1>Assets</h1>
          <p>Find machines, review their condition and plan maintenance.</p>
          <div className="asset-hero-actions">
            <a href="#asset-register" className="primary-action"><Database size={16} /> Explore register</a>
            <Link to="/work-orders/new" className="secondary-action"><Plus size={16} /> Raise work order</Link>
          </div>
        </div>
        <div className="asset-health-orbit" style={{ "--asset-health": `${summary ? Math.round((summary.operational / summary.totalAssets) * 100) : 0}%` } as React.CSSProperties}>
          <div><strong>{summary ? Math.round((summary.operational / summary.totalAssets) * 100) : 0}%</strong><span>portfolio active</span></div>
          <small><BadgeCheck size={14} /> {summary?.operational ?? 0} operational</small>
        </div>
      </div>

      <div className="asset-metric-grid" aria-busy={loading}>
        <article><span><Factory size={19} /></span><div><small>Total registered</small><strong>{summary?.totalAssets ?? 0}</strong><p>Production machines</p></div></article>
        <article className="risk"><span><ShieldAlert size={19} /></span><div><small>High-risk assets</small><strong>{summary?.highRisk ?? 0}</strong><p>Lifecycle review priority</p></div></article>
        <article className="legacy"><span><CalendarClock size={19} /></span><div><small>Legacy fleet</small><strong>{summary?.legacy ?? 0}</strong><p>25 years and older</p></div></article>
        <article className="quality"><span><BadgeCheck size={19} /></span><div><small>Data confidence</small><strong>{summary?.dataCompleteness ?? 0}%</strong><p>{summary?.missingSerials ?? 0} serials still missing</p></div></article>
      </div>

      <div className="asset-intelligence-grid">
        <section className="asset-panel asset-lifecycle-card">
          <div className="asset-panel-heading"><div><span>Fleet age</span><h2>Lifecycle exposure</h2><p>Average machine age is <strong>{summary?.averageAge ?? 0} years</strong>.</p></div><CircleGauge size={20} /></div>
          <div className="asset-lifecycle-track" aria-label="Asset lifecycle distribution">
            {lifecycleCounts.map((item) => <i key={item.band} className={`band-${item.band}`} style={{ width: `${summary?.totalAssets ? (item.count / summary.totalAssets) * 100 : 0}%` }} />)}
          </div>
          <div className="asset-lifecycle-legend">
            {lifecycleCounts.filter((item) => item.count > 0).map((item) => <button type="button" key={item.band} onClick={() => setLifecycle(item.band)}><i className={`band-${item.band}`} /><span>{lifecycleLabels[item.band]}</span><strong>{item.count}</strong></button>)}
          </div>
        </section>

        <section className="asset-panel asset-risk-card">
          <div className="asset-panel-heading"><div><span>Decision queue</span><h2>Highest lifecycle risk</h2></div><Sparkles size={19} /></div>
          <div className="asset-priority-list">
            {highRiskAssets.map((asset) => (
              <button type="button" key={asset.id} onClick={() => setSelectedAsset(asset)}>
                <i>{String(asset.assetNo).padStart(2, "0")}</i><span><strong>{asset.name}</strong><small>{asset.ageYears ?? "?"} yrs · {asset.criticality} criticality</small></span><RiskBadge score={asset.riskScore} /><ChevronRight size={15} />
              </button>
            ))}
          </div>
        </section>

        <section className="asset-panel asset-source-card">
          <div className="asset-panel-heading"><div><span>Register integrity</span><h2>Source control</h2></div><Database size={19} /></div>
          <div className="asset-source-meta">
            <div><span>Controlled document</span><strong>FR-MT-008</strong></div>
            <div><span>Source revision</span><strong>Rev. {dashboard?.sourceRevision ?? 11}</strong></div>
            <div><span>Last source update</span><strong>{dashboard?.sourceUpdatedAt ?? "2025-11-20"}</strong></div>
          </div>
          <p className="asset-source-note"><FileWarning size={15} /> Source numbering skips No. {dashboard?.missingAssetNumbers.join(", ") || "—"}; this is flagged, not auto-filled.</p>
        </section>

        <section className="asset-panel asset-maker-card">
          <div className="asset-panel-heading"><div><span>Supply exposure</span><h2>Manufacturer concentration</h2></div><Wrench size={19} /></div>
          <div className="asset-maker-list">
            {(dashboard?.manufacturers ?? []).slice(0, 5).map((maker) => (
              <div key={maker.name}><span><strong>{maker.name}</strong><i><b style={{ width: `${summary?.totalAssets ? (maker.count / summary.totalAssets) * 100 : 0}%` }} /></i></span><em>{maker.count}</em></div>
            ))}
          </div>
        </section>
      </div>

      <section className="asset-register-panel" id="asset-register">
        <div className="asset-register-heading">
          <div><span>Master asset register</span><h2>Production machinery</h2><p>{filteredAssets.length} of {summary?.totalAssets ?? 0} assets shown</p></div>
          <div className="asset-register-tools">
            <label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search asset, serial, maker…" /></label>
            <select value={condition} onChange={(event) => setCondition(event.target.value as "all" | AssetCondition)} aria-label="Filter by condition">
              <option value="all">All conditions</option>{Object.entries(conditionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
            <select value={lifecycle} onChange={(event) => setLifecycle(event.target.value as "all" | AssetLifecycleBand)} aria-label="Filter by lifecycle">
              <option value="all">All lifecycle bands</option>{Object.entries(lifecycleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value as "number" | "risk" | "age")} aria-label="Sort assets">
              <option value="number">Sort: Asset no.</option><option value="risk">Sort: Highest risk</option><option value="age">Sort: Oldest</option>
            </select>
          </div>
        </div>
        <div className="asset-table-wrap">
          <table>
            <thead><tr><th>Asset</th><th>Machine identity</th><th>Lifecycle</th><th>Condition</th><th>Manufacturer / Supplier</th><th>Risk</th><th /></tr></thead>
            <tbody>
              {filteredAssets.map((asset) => (
                <tr key={asset.id} tabIndex={0} onClick={() => setSelectedAsset(asset)} onKeyDown={(event) => { if (event.key === "Enter") setSelectedAsset(asset); }}>
                  <td><span className="asset-number">{String(asset.assetNo).padStart(2, "0")}</span></td>
                  <td><strong>{asset.name}</strong><small>{asset.serialNo ? `S/N ${asset.serialNo}` : "Serial not recorded"}</small></td>
                  <td><strong>{asset.ageYears ?? "—"} {asset.ageYears === null ? "" : "yrs"}</strong><small>{lifecycleLabels[asset.lifecycleBand]} · {asset.yearText}</small></td>
                  <td><AssetConditionBadge condition={asset.condition} /></td>
                  <td><strong>{asset.manufacturer || "Not recorded"}</strong><small>{asset.supplier || "Supplier not recorded"}</small></td>
                  <td><RiskBadge score={asset.riskScore} /></td>
                  <td><ChevronRight size={16} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filteredAssets.length === 0 ? <div className="asset-empty"><Search size={21} /><strong>No assets match those filters.</strong><button type="button" onClick={() => { setSearch(""); setCondition("all"); setLifecycle("all"); }}>Clear filters</button></div> : null}
        </div>
      </section>

      {selectedAsset ? createPortal((
        <div className="asset-drawer-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedAsset(null); }}>
          <aside className="asset-drawer" role="dialog" aria-modal="true" aria-label={`${selectedAsset.name} details`}>
            <div className="asset-drawer-header">
              <div><span>Asset {String(selectedAsset.assetNo).padStart(3, "0")}</span><h2>{selectedAsset.name}</h2><AssetConditionBadge condition={selectedAsset.condition} /></div>
              <button type="button" onClick={() => setSelectedAsset(null)} aria-label="Close asset details"><X size={18} /></button>
            </div>
            <div className="asset-drawer-score"><div><span>Lifecycle risk</span><strong>{selectedAsset.riskScore}<small>/100</small></strong></div><i><b style={{ width: `${selectedAsset.riskScore}%` }} /></i><p>{selectedAsset.riskScore >= 75 ? "Prioritise lifecycle review and contingency planning." : "Risk is within the normal managed range."}</p></div>
            <div className="asset-detail-grid">
              <div><span>Serial number</span><strong>{selectedAsset.serialNo || "Not recorded"}</strong></div>
              <div><span>Machine year</span><strong>{selectedAsset.yearText || "Not recorded"}</strong></div>
              <div><span>Installed</span><strong>{selectedAsset.installDateText || "Not recorded"}</strong></div>
              <div><span>Warranty</span><strong>{selectedAsset.warranty || "Not recorded"}</strong></div>
            </div>
            <section className="asset-contact-card"><span>Supply chain contact</span><h3>{selectedAsset.supplier || selectedAsset.manufacturer || "Supplier not recorded"}</h3><p>{selectedAsset.manufacturer || "Manufacturer not recorded"}</p><div><strong>{selectedAsset.contactPerson || "PIC not recorded"}</strong>{selectedAsset.telephone ? <a href={`tel:${selectedAsset.telephone.replace(/\s/g, "")}`}><Phone size={14} />{selectedAsset.telephone}</a> : null}</div></section>
            <form className="asset-manage-form" onSubmit={saveAsset} key={`${selectedAsset.id}-${selectedAsset.updatedAt}`}>
              <div className="asset-panel-heading"><div><span>Asset control</span><h2>Lifecycle decision</h2></div>{canManage ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}</div>
              <div className="asset-form-grid">
                <label>Condition<select name="condition" defaultValue={selectedAsset.condition} disabled={!canManage}>{Object.entries(conditionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                <label>Criticality<select name="criticality" defaultValue={selectedAsset.criticality} disabled={!canManage}>{["critical", "high", "medium", "low"].map((value) => <option value={value} key={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
              </div>
              <label><MapPin size={14} /> Location<input name="location" defaultValue={selectedAsset.location} disabled={!canManage} /></label>
              <label>Lifecycle notes<textarea name="notes" rows={3} defaultValue={selectedAsset.notes} placeholder="Decision, disposition or condition note…" disabled={!canManage} /></label>
              {error ? <p className="error-line" role="alert">{error}</p> : null}
              {canManage ? <button className="primary-action" type="submit" disabled={saving}>{saving ? "Saving…" : "Save asset decision"}</button> : <p className="asset-readonly-note">Executive or admin access is required to update lifecycle decisions.</p>}
            </form>
            <Link className="asset-work-order-link" to={`/work-orders/new?asset=${encodeURIComponent(selectedAsset.name)}`}><Wrench size={16} /><span><strong>Raise work order</strong><small>Carry this machine into a new request</small></span><ArrowRight size={16} /></Link>
          </aside>
        </div>
      ), document.body) : null}
    </section>
  );
}
