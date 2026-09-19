import { Clock, MonitorCheck, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TvWorkOrder, WorkOrderStatus } from "@pbs-cmms/shared";
import { workOrderStatusLabels } from "@pbs-cmms/shared";
import { api } from "../api/client";
import { PriorityBadge } from "../components/Badges";
import { formatDateTime } from "../utils/format";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

const columns: Array<{ title: string; statuses: WorkOrderStatus[]; tone: string }> = [
  { title: "New", statuses: ["open"], tone: "danger" },
  { title: "In Progress", statuses: ["acknowledged", "in_progress", "returned"], tone: "active" },
  { title: "Pending Material", statuses: ["pending_material"], tone: "warning" },
  { title: "Verify", statuses: ["resolved"], tone: "success" }
];

const rotationIntervalMs = 10_000;
const workOrdersPerPage = 3;
const workOrderAlertSound = "/sounds/tv-work-order-alert.mp3";

export function TvDashboardPage() {
  const [loadError, setLoadError] = useState("");
  const [workOrders, setWorkOrders] = useState<TvWorkOrder[]>([]);
  const [now, setNow] = useState(new Date());
  const [rotationStep, setRotationStep] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [arrivalNotice, setArrivalNotice] = useState("");
  const knownWorkOrderIdsRef = useRef<Set<string> | null>(null);
  const alertAudioRef = useRef<HTMLAudioElement | null>(null);
  const soundEnabledRef = useRef(false);
  const arrivalTimerRef = useRef<number | null>(null);

  async function loadWorkOrders() {
    try {
      const nextWorkOrders = await api.tvWorkOrders();
      const knownIds = knownWorkOrderIdsRef.current;
      const arrivals = knownIds ? nextWorkOrders.filter((workOrder) => workOrder.status === "open" && !knownIds.has(workOrder.id)) : [];
      knownWorkOrderIdsRef.current = new Set(nextWorkOrders.map((workOrder) => workOrder.id));
      setWorkOrders(nextWorkOrders);
      setLoadError("");
      if (arrivals.length) {
        setArrivalNotice(arrivals.length === 1 ? `New work order: ${arrivals[0].number}` : `${arrivals.length} new work orders received`);
        if (arrivalTimerRef.current) window.clearTimeout(arrivalTimerRef.current);
        arrivalTimerRef.current = window.setTimeout(() => setArrivalNotice(""), 9000);
        if (soundEnabledRef.current) playAlertSound();
      }
    }
    catch { setLoadError("Live updates interrupted. Showing the last available work orders; reconnecting automatically."); }
  }

  function playAlertSound() {
    const audio = alertAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    void audio.play().catch(() => {
      soundEnabledRef.current = false;
      setSoundEnabled(false);
      setLoadError("The browser blocked alert audio. Select Enable sound alerts again.");
    });
  }

  async function toggleSound() {
    if (soundEnabledRef.current) {
      soundEnabledRef.current = false;
      setSoundEnabled(false);
      alertAudioRef.current?.pause();
      return;
    }
    const audio = alertAudioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    try {
      await audio.play();
      soundEnabledRef.current = true;
      setSoundEnabled(true);
      setLoadError("");
    } catch {
      setLoadError("The browser blocked alert audio. Check the TV volume and try again.");
    }
  }

  useEffect(() => {
    loadWorkOrders().catch(console.error);
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    const rotation = window.setInterval(() => setRotationStep((step) => step + 1), rotationIntervalMs);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(rotation);
      if (arrivalTimerRef.current) window.clearTimeout(arrivalTimerRef.current);
      alertAudioRef.current?.pause();
    };
  }, []);

  useLiveRefresh(["work-orders"], loadWorkOrders, { fallbackMs: 3000 });

  const activeCount = useMemo(
    () => workOrders.filter((workOrder) => !["closed", "cancelled"].includes(workOrder.status)).length,
    [workOrders]
  );

  return (
    <main className="tv-dashboard">
      <audio ref={alertAudioRef} src={workOrderAlertSound} preload="auto" />
      {loadError ? <div className="ux-load-error" role="status">{loadError}</div> : null}
      {arrivalNotice ? <div className="tv-arrival-notice" role="status" aria-live="assertive"><Volume2 size={22} />{arrivalNotice}</div> : null}
      <header className="tv-header">
        <div className="tv-brand-block">
          <img src="/brand/sugi_mark_white.png" alt="Pangan Berkah Sentosa" />
          <div>
            <p>Maintenance Department</p>
            <h1>Work Order Board</h1>
          </div>
        </div>
        <div className="tv-status">
          <button className={`tv-sound-toggle${soundEnabled ? " is-enabled" : ""}`} type="button" onClick={() => void toggleSound()} aria-pressed={soundEnabled}>
            {soundEnabled ? <Volume2 size={22} aria-hidden="true" /> : <VolumeX size={22} aria-hidden="true" />}
            {soundEnabled ? "Sound alerts on" : "Enable sound alerts"}
          </button>
          <span>
            <MonitorCheck size={22} aria-hidden="true" />
            {activeCount} active
          </span>
          <span>
            <Clock size={22} aria-hidden="true" />
            {now.toLocaleTimeString()}
          </span>
        </div>
      </header>

      <section className="tv-columns">
        {columns.map((column) => {
          const columnWorkOrders = workOrders.filter((workOrder) => column.statuses.includes(workOrder.status));
          const pageCount = Math.max(1, Math.ceil(columnWorkOrders.length / workOrdersPerPage));
          const currentPage = rotationStep % pageCount;
          const pageStart = currentPage * workOrdersPerPage;
          const visibleWorkOrders = columnWorkOrders.slice(pageStart, pageStart + workOrdersPerPage);
          const pageEnd = Math.min(pageStart + workOrdersPerPage, columnWorkOrders.length);

          return (
            <div key={column.title} className={`tv-column tv-${column.tone}`}>
              <div className="tv-column-header">
                <h2>{column.title}</h2>
                <strong>{columnWorkOrders.length}</strong>
              </div>
              <div
                className={`tv-card-list${pageCount > 1 ? " is-rotating" : ""}`}
                key={`${column.title}-${currentPage}`}
              >
                {visibleWorkOrders.map((workOrder) => (
                  <article className="tv-card" key={workOrder.id}>
                    <div>
                      <strong>{workOrder.number}</strong>
                      <span>{workOrderStatusLabels[workOrder.status]}</span>
                    </div>
                    <h3>{workOrder.title}</h3>
                    <p>{workOrder.location} / {workOrder.machineName || workOrder.assetName}</p>
                    <div>
                      <PriorityBadge priority={workOrder.priority} />
                      <time>{formatDateTime(workOrder.updatedAt)}</time>
                    </div>
                  </article>
                ))}
              </div>
              {pageCount > 1 && (
                <div
                  className="tv-rotation-status"
                  aria-label={`Showing work orders ${pageStart + 1} to ${pageEnd} of ${columnWorkOrders.length}. Page ${currentPage + 1} of ${pageCount}.`}
                >
                  <span>{pageStart + 1}&ndash;{pageEnd} of {columnWorkOrders.length}</span>
                  <span className="tv-rotation-progress" aria-hidden="true">
                    <i key={rotationStep} />
                  </span>
                  <span>Page {currentPage + 1}/{pageCount}</span>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </main>
  );
}
