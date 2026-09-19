import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardCopy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  History,
  Minus,
  Package,
  Plus,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  Settings2,
  SlidersHorizontal,
  Warehouse
} from "lucide-react";
import type { IScannerControls } from "@zxing/browser";
import QRCode from "qrcode";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { SparePart, SparePartDetail, SpareSyncSettings, StockMovementDetail, StockMovementType, WorkOrder } from "@pbs-cmms/shared";
import { api } from "../api/client";
import { useCurrentUser } from "../state/UserContext";
import { formatDateTime } from "../utils/format";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

type SpareView = "dashboard" | "inventory" | "scanner" | "setup" | "detail";
type StockFilter = "all" | "low" | "out";
type AdjustmentType = Exclude<StockMovementType, "issue">;
type IssueFeedback = {
  state: "loading" | "success" | "error";
  title: string;
  detail: string;
};
const spareStaticRoutes = new Set(["scanner", "inventory", "setup"]);

const money = new Intl.NumberFormat("en-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0
});

function numberText(value: number) {
  return new Intl.NumberFormat("en-MY", { maximumFractionDigits: 2 }).format(value || 0);
}

function stockState(part: SparePart) {
  if (part.currentStock <= 0) {
    return "out";
  }

  if (part.minStock > 0 && part.currentStock <= part.minStock) {
    return "low";
  }

  return "ok";
}

function stockLabel(part: SparePart) {
  const state = stockState(part);
  if (state === "out") {
    return "Out";
  }

  if (state === "low") {
    return "Low";
  }

  return "OK";
}

function canIssueAgainst(workOrder: WorkOrder) {
  return !["resolved", "closed", "cancelled"].includes(workOrder.status);
}

function normalizeQrLookupValue(value: string) {
  const query = value.trim();
  if (!query) {
    return query;
  }

  try {
    const url = new URL(query, window.location.origin);
    const segments = url.pathname.split("/").filter(Boolean);
    const spareIndex = segments.indexOf("spare-parts");
    if (spareIndex === -1) {
      return query;
    }

    if (segments[spareIndex + 1] === "issue" && segments[spareIndex + 2]) {
      return decodeURIComponent(segments[spareIndex + 2]);
    }

    const maybeItemNo = segments[spareIndex + 1];
    if (maybeItemNo && !spareStaticRoutes.has(maybeItemNo)) {
      return decodeURIComponent(maybeItemNo);
    }
  } catch {
    return query;
  }

  return query;
}

export function SparePartsPage() {
  const { currentUser } = useCurrentUser();
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const routeItemNo = params.itemNo || "";
  const issueRoute = location.pathname.startsWith("/spare-parts/issue/");
  const canManage = currentUser ? ["executive", "admin", "developer"].includes(currentUser.role) : false;
  const canIssue = currentUser ? currentUser.role !== "requester" : false;
  const technicianMode = currentUser?.role === "technician";
  const view: SpareView =
    technicianMode || issueRoute || location.pathname.startsWith("/spare-parts/scanner")
      ? "scanner"
      : location.pathname.startsWith("/spare-parts/setup")
        ? "setup"
        : location.pathname.startsWith("/spare-parts/inventory")
          ? "inventory"
          : routeItemNo
            ? "detail"
            : "dashboard";

  const [parts, setParts] = useState<SparePart[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [detail, setDetail] = useState<SparePartDetail | null>(null);
  const [suppliersCount, setSuppliersCount] = useState(0);
  const [summary, setSummary] = useState({
    totalParts: 0,
    lowStock: 0,
    outOfStock: 0,
    totalValue: 0,
    unsyncedMovements: 0
  });
  const [syncConfigured, setSyncConfigured] = useState(false);
  const [recentMovements, setRecentMovements] = useState<SparePartDetail["movements"]>([]);
  const [myMovements, setMyMovements] = useState<StockMovementDetail[]>([]);
  const [technicianPartView, setTechnicianPartView] = useState<"issue" | "history">("issue");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [qrText, setQrText] = useState("");
  const [qrMatches, setQrMatches] = useState<SparePart[]>([]);
  const [issuePart, setIssuePart] = useState<SparePart | null>(null);
  const [manualPartSearch, setManualPartSearch] = useState("");
  const [issueWorkOrderId, setIssueWorkOrderId] = useState("");
  const [issueQuantity, setIssueQuantity] = useState("1");
  const [issueNote, setIssueNote] = useState("");
  const [masterText, setMasterText] = useState("");
  const [supplierText, setSupplierText] = useState("");
  const [newSpareForm, setNewSpareForm] = useState({
    itemNo: "",
    name: "",
    category: "",
    uom: "pcs",
    currentStock: "0",
    minStock: "0",
    maxStock: "0",
    supplier: "",
    price: "0"
  });
  const [syncSettings, setSyncSettings] = useState<SpareSyncSettings>({
    scriptUrl: "",
    hasToken: false,
    masterSheetName: "Masterlist",
    supplierSheetName: "Supplier",
    movementSheetName: "Movement Log",
    configured: false
  });
  const [syncToken, setSyncToken] = useState("");
  const [adjustType, setAdjustType] = useState<AdjustmentType>("restock");
  const [adjustQuantity, setAdjustQuantity] = useState("1");
  const [adjustNote, setAdjustNote] = useState("");
  const [qrSvg, setQrSvg] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [issueFeedback, setIssueFeedback] = useState<IssueFeedback | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scanDetected, setScanDetected] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scanCloseTimerRef = useRef<number | null>(null);
  const issueFeedbackTimerRef = useRef<number | null>(null);

  function clearIssueFeedbackTimer() {
    if (issueFeedbackTimerRef.current) {
      window.clearTimeout(issueFeedbackTimerRef.current);
      issueFeedbackTimerRef.current = null;
    }
  }

  function showIssueFeedback(feedback: IssueFeedback, timeoutMs = 2800) {
    clearIssueFeedbackTimer();
    setIssueFeedback(feedback);

    if (feedback.state !== "loading") {
      issueFeedbackTimerRef.current = window.setTimeout(() => {
        setIssueFeedback(null);
        issueFeedbackTimerRef.current = null;
      }, timeoutMs);
    }
  }

  function vibratePhone(pattern: number | number[]) {
    const vibratingNavigator = navigator as Navigator & {
      vibrate?: (pattern: number | number[]) => boolean;
    };

    vibratingNavigator.vibrate?.(pattern);
  }

  async function loadInventory() {
    const inventory = await api.spareInventory();
    setParts(inventory.parts);
    setSuppliersCount(inventory.suppliers.length);
    setSummary(inventory.summary);
    setRecentMovements(inventory.recentMovements);
    setSyncConfigured(inventory.syncConfigured);
  }

  async function loadDetail(itemNo: string) {
    const nextDetail = await api.sparePart(itemNo);
    setDetail(nextDetail);
    if (issueRoute) {
      setIssuePart(nextDetail);
    }
  }

  async function loadMyMovements() {
    if (!currentUser || currentUser.role === "requester") return;
    setMyMovements(await api.spareMovementsForActor(currentUser.id));
  }

  useLiveRefresh(["spare-parts"], async () => {
    await loadInventory();
    if (routeItemNo && !["setup", "scanner", "inventory"].includes(routeItemNo)) await loadDetail(routeItemNo);
    if (technicianMode) await loadMyMovements();
  });
  useLiveRefresh(["work-orders"], async () => setWorkOrders(await api.workOrders()));

  useEffect(() => {
    loadInventory().catch((error) => setError(error instanceof Error ? error.message : "Couldn’t load inventory. Please reload this page."));
    api.workOrders().then(setWorkOrders).catch(console.error);
    api.spareSyncSettings().then(setSyncSettings).catch(console.error);
  }, []);

  useEffect(() => {
    if (technicianMode) loadMyMovements().catch(console.error);
  }, [currentUser?.id, technicianMode]);

  useEffect(() => {
    return () => clearIssueFeedbackTimer();
  }, []);

  useEffect(() => {
    if (!routeItemNo || ["setup", "scanner", "inventory"].includes(routeItemNo)) {
      setDetail(null);
      return;
    }

    loadDetail(routeItemNo).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Unable to load spare part.");
    });
  }, [routeItemNo, issueRoute]);

  useEffect(() => {
    if (!detail) {
      setQrSvg("");
      return;
    }

    const targetUrl = `${window.location.origin}/spare-parts/issue/${encodeURIComponent(detail.itemNo)}`;
    QRCode.toString(targetUrl, { type: "svg", margin: 1, width: 220 })
      .then(setQrSvg)
      .catch(console.error);
  }, [detail?.itemNo]);

  useEffect(() => {
    if (!cameraOpen || !videoRef.current) {
      return;
    }

    let disposed = false;
    let handled = false;
    setBusy("camera");

    import("@zxing/browser")
      .then(({ BrowserQRCodeReader }) => {
        if (disposed || !videoRef.current) {
          return null;
        }

        const codeReader = new BrowserQRCodeReader();
        return codeReader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: "environment" }
            }
          },
          videoRef.current,
          (result, _error, controls) => {
          scannerControlsRef.current = controls;
            const value = normalizeQrLookupValue(result?.getText() || "");
            if (disposed || handled || !value) {
              return;
            }

            handled = true;
            setScanDetected(true);
            setQrText(value);
            void lookupQr(value);
            scanCloseTimerRef.current = window.setTimeout(() => {
              controls.stop();
              scannerControlsRef.current = null;
              setCameraOpen(false);
              setScanDetected(false);
            }, 650);
          }
        );
      })
      .then((controls) => {
        if (!controls) {
          return;
        }

        if (disposed) {
          controls.stop();
          return;
        }

        scannerControlsRef.current = controls;
        setBusy("");
      })
      .catch((cameraError) => {
        if (disposed) {
          return;
        }

        setBusy("");
        setCameraOpen(false);
        setError(cameraError instanceof Error ? cameraError.message : "Unable to open camera.");
      });

    return () => {
      disposed = true;
      if (scanCloseTimerRef.current) {
        window.clearTimeout(scanCloseTimerRef.current);
        scanCloseTimerRef.current = null;
      }
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
    };
  }, [cameraOpen]);

  const categories = useMemo(() => [...new Set(parts.map((part) => part.category).filter(Boolean))].sort(), [parts]);
  const activeWorkOrders = useMemo(() => workOrders.filter(canIssueAgainst), [workOrders]);
  const lowStockParts = useMemo(() => parts.filter((part) => stockState(part) === "low").slice(0, 8), [parts]);
  const outOfStockParts = useMemo(() => parts.filter((part) => stockState(part) === "out").slice(0, 8), [parts]);
  const categoryStats = useMemo(() => {
    return categories.map((name) => {
      const categoryParts = parts.filter((part) => part.category === name);
      return {
        name,
        count: categoryParts.length,
        low: categoryParts.filter((part) => stockState(part) !== "ok").length
      };
    }).sort((first, second) => second.count - first.count || first.name.localeCompare(second.name));
  }, [categories, parts]);
  const categorySnapshot = useMemo(() => categoryStats.slice(0, 8), [categoryStats]);
  const categoryChartMax = useMemo(() => Math.max(1, ...categorySnapshot.map((item) => item.count)), [categorySnapshot]);

  const filteredParts = useMemo(() => {
    const needle = search.toLowerCase().trim();
    return parts.filter((part) => {
      const matchesCategory = category === "all" || part.category === category;
      const matchesStock =
        stockFilter === "all" ||
        (stockFilter === "low" && stockState(part) === "low") ||
        (stockFilter === "out" && stockState(part) === "out");
      const searchable = [
        part.itemNo,
        part.searchName,
        part.description,
        part.category,
        part.supplier,
        part.supplier1,
        part.supplier2,
        part.supplier3,
        part.partRank,
        part.stockRank,
        part.status
      ].join(" ").toLowerCase();
      return matchesCategory && matchesStock && searchable.includes(needle);
    });
  }, [parts, search, category, stockFilter]);

  const filteredPartGroups = useMemo(() => {
    const groups = new Map<string, SparePart[]>();
    filteredParts.forEach((part) => {
      const key = part.category || "Uncategorised";
      const current = groups.get(key) || [];
      current.push(part);
      groups.set(key, current);
    });

    return [...groups.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([name, items]) => ({
        name,
        items: [...items].sort((first, second) => {
          const firstLabel = first.searchName || first.description || first.itemNo;
          const secondLabel = second.searchName || second.description || second.itemNo;
          return firstLabel.localeCompare(secondLabel);
        }),
        low: items.filter((part) => stockState(part) === "low").length,
        out: items.filter((part) => stockState(part) === "out").length
      }));
  }, [filteredParts]);

  const manualPartOptions = useMemo(() => {
    const needle = manualPartSearch.toLowerCase().trim();
    const source = needle
      ? parts.filter((part) => {
          const searchable = [
            part.itemNo,
            part.searchName,
            part.description,
            part.category,
            part.supplier,
            part.supplier1,
            part.supplier2,
            part.supplier3
          ].join(" ").toLowerCase();
          return searchable.includes(needle);
        })
      : parts;

    return [...source]
      .sort((first, second) => {
        const firstState = stockState(first);
        const secondState = stockState(second);
        if (firstState === "out" && secondState !== "out") {
          return 1;
        }
        if (firstState !== "out" && secondState === "out") {
          return -1;
        }
        return (first.searchName || first.description || first.itemNo).localeCompare(second.searchName || second.description || second.itemNo);
      })
      .slice(0, 12);
  }, [manualPartSearch, parts]);

  function chooseIssuePart(part: SparePart) {
    if (part.currentStock <= 0) {
      setError(`${part.searchName || part.itemNo} is out of stock. Please choose another part or contact the store.`);
      return;
    }
    setError("");
    setIssuePart(part);
    setQrMatches([]);
    setManualPartSearch(`${part.itemNo} ${part.searchName || part.description || part.category || "Spare part"}`);
  }

  async function lookupQr(value = qrText) {
    const query = normalizeQrLookupValue(value);
    setError("");
    setMessage("");
    setQrText(query);
    setBusy("lookup");
    try {
      const result = await api.lookupSpareQr(query);
      setQrMatches(result.matches);
      if (result.matches.length === 1) {
        chooseIssuePart(result.matches[0]);
      }
      if (result.matches.length === 0) {
        setError("No spare part matched that QR value.");
      }
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : "Unable to lookup QR.");
    } finally {
      setBusy("");
    }
  }

  async function startCamera() {
    setError("");
    setMessage("");
    if (!window.isSecureContext) {
      setError("Camera needs HTTPS. Open the Cloudflare https:// URL, not the local IP or http:// URL.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access is not available in this browser. Open the HTTPS app in Safari or Chrome and allow camera permission.");
      return;
    }

    setCameraOpen(true);
  }

  function stopCamera() {
    if (scanCloseTimerRef.current) {
      window.clearTimeout(scanCloseTimerRef.current);
      scanCloseTimerRef.current = null;
    }
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream) {
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current!.srcObject = null;
    }
    setCameraOpen(false);
    setScanDetected(false);
    setBusy((currentBusy) => (currentBusy === "camera" ? "" : currentBusy));
  }

  async function submitIssue(event: FormEvent) {
    event.preventDefault();
    if (!currentUser || !issuePart) {
      return;
    }

    const selectedPart = issuePart;
    const quantity = Number(issueQuantity);
    const unit = selectedPart.uom || "unit";

    setBusy("issue");
    setError("");
    setMessage("");
    showIssueFeedback({
      state: "loading",
      title: "Issuing spare",
      detail: `Deducting ${numberText(quantity)} ${unit} from ${selectedPart.itemNo}.`
    });

    try {
      const movement = await api.issueSparePart(selectedPart.itemNo, {
        actorId: currentUser.id,
        workOrderId: issueWorkOrderId,
        quantity,
        note: issueNote
      });
      setIssueQuantity("1");
      setIssueNote("");
      setIssuePart((selectedPart) => selectedPart?.itemNo === movement.itemNo ? { ...selectedPart, currentStock: movement.afterStock } : selectedPart);
      setMessage(`Stock updated: ${movement.itemNo} is now ${numberText(movement.afterStock)}.`);
      vibratePhone([50, 35, 90]);
      showIssueFeedback({
        state: "success",
        title: "Stock deducted",
        detail: `${movement.itemNo} is now ${numberText(movement.afterStock)} ${unit}.`
      });
      await loadInventory();
      if (technicianMode) {
        await loadMyMovements();
        setIssuePart(null);
        setManualPartSearch("");
        setTechnicianPartView("history");
      }
      if (detail?.itemNo === selectedPart.itemNo) {
        await loadDetail(selectedPart.itemNo);
      }
    } catch (issueError) {
      const issueMessage = issueError instanceof Error ? issueError.message : "Unable to issue spare part.";
      setError(issueMessage);
      vibratePhone(130);
      showIssueFeedback({
        state: "error",
        title: "Issue failed",
        detail: issueMessage
      }, 4200);
    } finally {
      setBusy("");
    }
  }

  async function saveSyncSettings(event: FormEvent) {
    event.preventDefault();
    if (!currentUser) {
      return;
    }

    setBusy("settings");
    setError("");
    setMessage("");
    try {
      const nextSettings = await api.updateSpareSyncSettings({
        actorId: currentUser.id,
        scriptUrl: syncSettings.scriptUrl,
        token: syncToken || undefined,
        masterSheetName: syncSettings.masterSheetName,
        supplierSheetName: syncSettings.supplierSheetName,
        movementSheetName: syncSettings.movementSheetName
      });
      setSyncSettings(nextSettings);
      setSyncConfigured(nextSettings.configured);
      setSyncToken("");
      setMessage("Sheet sync settings saved.");
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : "Unable to save sheet sync settings.");
    } finally {
      setBusy("");
    }
  }

  async function createNewSparePart(event: FormEvent) {
    event.preventDefault();
    if (!currentUser) {
      return;
    }

    setBusy("create-spare");
    setError("");
    setMessage("");
    try {
      const created = await api.createSparePart({
        actorId: currentUser.id,
        itemNo: newSpareForm.itemNo.trim(),
        name: newSpareForm.name.trim(),
        category: newSpareForm.category.trim(),
        uom: newSpareForm.uom.trim() || "pcs",
        currentStock: Number(newSpareForm.currentStock || 0),
        minStock: Number(newSpareForm.minStock || 0),
        maxStock: Number(newSpareForm.maxStock || 0),
        supplier: newSpareForm.supplier.trim(),
        price: Number(newSpareForm.price || 0)
      });
      setNewSpareForm({
        itemNo: "",
        name: "",
        category: "",
        uom: "pcs",
        currentStock: "0",
        minStock: "0",
        maxStock: "0",
        supplier: "",
        price: "0"
      });
      setMessage(`Spare part ${created.itemNo} created successfully.`);
      await loadInventory();
      navigate(`/spare-parts/${encodeURIComponent(created.itemNo)}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create spare part.");
    } finally {
      setBusy("");
    }
  }

  async function importParts(event: FormEvent) {
    event.preventDefault();
    if (!currentUser) {
      return;
    }

    setBusy("import");
    setError("");
    setMessage("");
    try {
      const result = await api.importSpareParts({
        actorId: currentUser.id,
        masterText,
        supplierText
      });
      setMasterText("");
      setSupplierText("");
      setParts(result.inventory.parts);
      setSummary(result.inventory.summary);
      setRecentMovements(result.inventory.recentMovements);
      setSuppliersCount(result.inventory.suppliers.length);
      setSyncConfigured(result.inventory.syncConfigured);
      setMessage(`${result.importedParts} parts imported, ${result.updatedParts} updated, ${result.importedSuppliers} suppliers loaded.`);
      if (result.errors.length > 0) {
        setError(result.errors.slice(0, 4).join(" "));
      }
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Unable to import spare parts.");
    } finally {
      setBusy("");
    }
  }

  async function pullFromSheet() {
    if (!currentUser) {
      return;
    }

    setBusy("pull");
    setError("");
    setMessage("");
    try {
      const result = await api.pullSparePartsFromSheet(currentUser.id);
      if (result.inventory) {
        setParts(result.inventory.parts);
        setSummary(result.inventory.summary);
        setRecentMovements(result.inventory.recentMovements);
        setSuppliersCount(result.inventory.suppliers.length);
        setSyncConfigured(result.inventory.syncConfigured);
      }
      setMessage(result.message);
      if (!result.ok) {
        setError(result.errors.join(" "));
      }
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Unable to sync from Google Sheet.");
    } finally {
      setBusy("");
    }
  }

  async function retrySync() {
    if (!currentUser) {
      return;
    }

    setBusy("retry");
    setError("");
    setMessage("");
    try {
      const result = await api.retrySpareSync(currentUser.id);
      if (result.inventory) {
        setParts(result.inventory.parts);
        setSummary(result.inventory.summary);
        setRecentMovements(result.inventory.recentMovements);
      }
      setMessage(result.message);
      if (!result.ok) {
        setError(result.errors.join(" "));
      }
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Unable to retry sync.");
    } finally {
      setBusy("");
    }
  }

  async function submitAdjustment(event: FormEvent) {
    event.preventDefault();
    if (!currentUser || !detail) {
      return;
    }

    setBusy("adjust");
    setError("");
    setMessage("");
    try {
      const movement = await api.adjustSparePart(detail.itemNo, {
        actorId: currentUser.id,
        type: adjustType,
        quantity: Number(adjustQuantity),
        note: adjustNote
      });
      setAdjustQuantity("1");
      setAdjustNote("");
      setMessage(`Adjustment saved. ${movement.itemNo} is now ${numberText(movement.afterStock)}.`);
      await loadInventory();
      await loadDetail(detail.itemNo);
    } catch (adjustError) {
      setError(adjustError instanceof Error ? adjustError.message : "Unable to adjust stock.");
    } finally {
      setBusy("");
    }
  }

  async function copyQrUrl() {
    if (!detail) {
      return;
    }

    await navigator.clipboard.writeText(`${window.location.origin}/spare-parts/issue/${encodeURIComponent(detail.itemNo)}`);
    setMessage("QR link copied.");
  }

  function downloadQr() {
    if (!qrSvg || !detail) {
      return;
    }

    const blob = new Blob([qrSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `spare-${detail.itemNo.replace(/[^a-z0-9-]+/gi, "_")}-qr.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function renderMetrics() {
    return (
      <div className="spare-metrics">
        <article>
          <Package size={18} aria-hidden="true" />
          <span>SKUs</span>
          <strong>{numberText(summary.totalParts)}</strong>
        </article>
        <article className={summary.lowStock > 0 ? "warn" : ""}>
          <AlertTriangle size={18} aria-hidden="true" />
          <span>Low stock</span>
          <strong>{numberText(summary.lowStock)}</strong>
        </article>
        <article className={summary.outOfStock > 0 ? "danger" : ""}>
          <Boxes size={18} aria-hidden="true" />
          <span>Out</span>
          <strong>{numberText(summary.outOfStock)}</strong>
        </article>
        <article>
          <Warehouse size={18} aria-hidden="true" />
          <span>Value</span>
          <strong>{money.format(summary.totalValue)}</strong>
        </article>
        <article className={summary.unsyncedMovements > 0 ? "warn" : ""}>
          <RefreshCw size={18} aria-hidden="true" />
          <span>Unsynced</span>
          <strong>{numberText(summary.unsyncedMovements)}</strong>
        </article>
      </div>
    );
  }

  function renderTabs() {
    if (technicianMode) {
      return null;
    }

    const tabs = [
      { to: "/spare-parts", label: "Dashboard", tabView: "dashboard" as SpareView, Icon: Warehouse },
      { to: "/spare-parts/inventory", label: "Inventory", tabView: "inventory" as SpareView, Icon: Package },
      { to: "/spare-parts/scanner", label: "QR Scanner", tabView: "scanner" as SpareView, Icon: QrCode },
      ...(canManage ? [{ to: "/spare-parts/setup", label: "Sheet Setup", tabView: "setup" as SpareView, Icon: Settings2 }] : [])
    ];

    return (
      <div className="spare-module-tabs" role="tablist" aria-label="Spare part sections">
        {tabs.map(({ to, label, tabView, Icon }) => {
          const active = view === tabView || (view === "detail" && tabView === "inventory");
          return (
            <Link key={to} to={to} className={active ? "active" : ""}>
              <Icon size={16} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </div>
    );
  }

  function renderIssueFeedback() {
    if (!issueFeedback) {
      return null;
    }

    const FeedbackIcon = issueFeedback.state === "success" ? CheckCircle2 : issueFeedback.state === "error" ? AlertTriangle : RefreshCw;

    return (
      <div className={`issue-feedback-toast ${issueFeedback.state}`} role={issueFeedback.state === "error" ? "alert" : "status"} aria-live="polite">
        <span className="issue-feedback-icon">
          <FeedbackIcon size={20} aria-hidden="true" />
        </span>
        <div>
          <h3>{issueFeedback.title}</h3>
          <p>{issueFeedback.detail}</p>
        </div>
        {issueFeedback.state === "loading" ? (
          <span className="issue-feedback-bar" aria-hidden="true">
            <i />
          </span>
        ) : null}
      </div>
    );
  }

  function renderTechnicianTabs() {
    const issueCount = myMovements.filter((movement) => movement.type === "issue").length;
    return (
      <div className="tech-parts-tabs" role="tablist" aria-label="Parts sections">
        <button type="button" role="tab" aria-selected={technicianPartView === "issue"} className={technicianPartView === "issue" ? "active" : ""} onClick={() => setTechnicianPartView("issue")}>
          <ScanLine size={21} aria-hidden="true" />
          <span><strong>Use a part</strong><small>Scan or search</small></span>
        </button>
        <button type="button" role="tab" aria-selected={technicianPartView === "history"} className={technicianPartView === "history" ? "active" : ""} onClick={() => setTechnicianPartView("history")}>
          <History size={21} aria-hidden="true" />
          <span><strong>My history</strong><small>{issueCount} recorded</small></span>
        </button>
      </div>
    );
  }

  function renderTechnicianIssuePanel() {
    const quantity = Math.max(1, Number(issueQuantity) || 1);
    const maxQuantity = Math.max(1, Math.floor(issuePart?.currentStock || 1));
    const showResults = manualPartSearch.trim().length >= 2 && !issuePart;
    return (
      <section className="tech-parts-workflow" aria-label="Use a spare part">
        <header className="tech-parts-guide">
          <div><Package size={24} aria-hidden="true" /><span><strong>Taking a part from the store?</strong><small>Follow these three simple steps. Your history updates automatically.</small></span></div>
          <ol><li><b>1</b>Find part</li><li><b>2</b>Add job</li><li><b>3</b>Confirm</li></ol>
        </header>

        <section className={`tech-parts-step ${issuePart ? "complete" : "current"}`}>
          <div className="tech-parts-step-heading"><b>{issuePart ? <CheckCircle2 size={20} /> : "1"}</b><span><strong>Find the part</strong><small>Scan the QR label or type the part name.</small></span></div>
          {issuePart ? (
            <div className="tech-selected-part">
              <span className="tech-selected-icon"><Package size={25} /></span>
              <div><small>Selected part</small><strong>{issuePart.searchName || issuePart.description || issuePart.itemNo}</strong><span>{issuePart.itemNo}</span></div>
              <em><b>{numberText(issuePart.currentStock)}</b>{issuePart.uom || "unit"} available</em>
              <button type="button" onClick={() => { setIssuePart(null); setManualPartSearch(""); }}>Change part</button>
            </div>
          ) : (
            <div className="tech-parts-find-options">
              <button className="tech-scan-button" type="button" onClick={cameraOpen ? stopCamera : startCamera}>
                <QrCode size={25} aria-hidden="true" />
                <span><strong>{cameraOpen ? "Close camera" : "Scan QR code"}</strong><small>Point the camera at the part label</small></span>
              </button>
              <div className="tech-parts-or"><span>or</span></div>
              <label className="tech-part-search">
                <span>Search manually</span>
                <div><Search size={21} aria-hidden="true" /><input value={manualPartSearch} onChange={(event) => setManualPartSearch(event.target.value)} placeholder="Type part name or item number" /></div>
              </label>
            </div>
          )}
          {cameraOpen ? <div className={`spare-camera-box tech-camera-box ${scanDetected ? "detected" : ""}`}><video ref={videoRef} muted playsInline /><span className="camera-scan-overlay" aria-hidden="true" /></div> : null}
          {!issuePart && manualPartSearch.trim().length > 0 && manualPartSearch.trim().length < 2 ? <p className="tech-search-help">Type at least 2 characters to search.</p> : null}
          {showResults ? (
            <div className="tech-part-results" aria-label="Matching spare parts">
              <p><strong>{manualPartOptions.length} matches</strong><span>Tap the correct part</span></p>
              {manualPartOptions.slice(0, 8).map((part) => (
                <button key={part.itemNo} type="button" disabled={part.currentStock <= 0} onClick={() => chooseIssuePart(part)}>
                  <span><strong>{part.searchName || part.description || part.itemNo}</strong><small>{part.itemNo} · {part.category || "Spare part"}</small></span>
                  <em className={part.currentStock <= 0 ? "out" : ""}><b>{numberText(part.currentStock)}</b>{part.currentStock <= 0 ? "Out" : part.uom || "unit"}</em>
                </button>
              ))}
              {manualPartOptions.length === 0 ? <div className="tech-no-parts"><Search size={24} /><strong>No matching part</strong><span>Try the item number or a shorter name.</span></div> : null}
            </div>
          ) : null}
        </section>

        <form className={`tech-parts-step tech-parts-job-step ${issuePart ? "current" : "waiting"}`} onSubmit={submitIssue}>
          <div className="tech-parts-step-heading"><b>2</b><span><strong>Add job details</strong><small>{issuePart ? "Choose the job and how many you are taking." : "Select a part first to continue."}</small></span></div>
          {issuePart ? (
            <div className="tech-parts-fields">
              <label><span>Work order <em>Required</em></span><select value={issueWorkOrderId} onChange={(event) => setIssueWorkOrderId(event.target.value)}><option value="">Choose the work order</option>{activeWorkOrders.map((workOrder) => <option key={workOrder.id} value={workOrder.id}>{workOrder.number} - {workOrder.machineName || workOrder.title}</option>)}</select></label>
              <label className="tech-quantity-field"><span>Quantity <em>Required</em></span><div><button type="button" aria-label="Decrease quantity" disabled={quantity <= 1} onClick={() => setIssueQuantity(String(Math.max(1, quantity - 1)))}><Minus size={21} /></button><input type="number" min="1" max={maxQuantity} step="1" value={issueQuantity} onChange={(event) => setIssueQuantity(event.target.value)} aria-label="Issue quantity" /><button type="button" aria-label="Increase quantity" disabled={quantity >= maxQuantity} onClick={() => setIssueQuantity(String(Math.min(maxQuantity, quantity + 1)))}><Plus size={21} /></button></div><small>Maximum available: {numberText(issuePart.currentStock)} {issuePart.uom}</small></label>
              <label><span>Note <small>Optional</small></span><input value={issueNote} onChange={(event) => setIssueNote(event.target.value)} placeholder="Example: Used for bearing replacement" /></label>
            </div>
          ) : <div className="tech-step-waiting"><Package size={23} /><span>Your job details will appear here after you select a part.</span></div>}

          {issuePart ? (
            <section className="tech-parts-confirm">
              <div className="tech-parts-step-heading"><b>3</b><span><strong>Check and confirm</strong><small>This records the part in your personal history.</small></span></div>
              <div className="tech-confirm-summary"><span>You are taking</span><strong>{quantity} {issuePart.uom || "unit"} · {issuePart.searchName || issuePart.itemNo}</strong><small>{issueWorkOrderId ? activeWorkOrders.find((workOrder) => workOrder.id === issueWorkOrderId)?.number : "Choose a work order above"}</small></div>
              <button className={busy === "issue" ? "tech-confirm-button loading" : "tech-confirm-button"} type="submit" disabled={!issueWorkOrderId || quantity > issuePart.currentStock || busy === "issue"}>{busy === "issue" ? <span className="spare-button-spinner" aria-hidden="true" /> : <CheckCircle2 size={22} aria-hidden="true" />}{busy === "issue" ? "Recording part..." : "Confirm and record part"}</button>
            </section>
          ) : null}
        </form>
      </section>
    );
  }

  function renderTechnicianHistoryPanel() {
    const issues = myMovements.filter((movement) => movement.type === "issue");
    const todayKey = new Date().toDateString();
    const usedToday = issues.filter((movement) => new Date(movement.createdAt).toDateString() === todayKey).length;
    return (
      <section className="tech-parts-history-panel">
        <header><div><span>My parts record</span><h2>Parts I have used</h2><p>Use this list to check what you took, for which job, and when.</p></div><History size={28} /></header>
        <div className="tech-history-summary"><article><span>Used today</span><strong>{usedToday}</strong></article><article><span>Recent records</span><strong>{issues.length}</strong></article></div>
        <div className="tech-history-list">
          {issues.length ? issues.map((movement) => {
            const part = parts.find((item) => item.itemNo === movement.itemNo);
            return <article key={movement.id}><span className="tech-history-icon"><Package size={21} /></span><div><strong>{movement.itemSearchName || movement.itemNo}</strong><span>{movement.itemNo}</span><small>{movement.workOrderNumber ? `For ${movement.workOrderNumber}` : "No work order"}{movement.note ? ` · ${movement.note}` : ""}</small></div><em><b>-{numberText(movement.quantity)}</b>{part?.uom || "unit"}</em><time>{formatDateTime(movement.createdAt)}</time></article>;
          }) : <div className="tech-history-empty"><History size={34} /><h3>No parts recorded yet</h3><p>After you confirm a part, it will appear here automatically.</p><button type="button" onClick={() => setTechnicianPartView("issue")}>Use my first part</button></div>}
        </div>
      </section>
    );
  }

  function renderScannerPanel() {
    return (
      <section className="section-panel spare-issue-panel">
        <div className="section-header">
          <div>
            <h2>QR / Manual Issue</h2>
            <span>{canIssue ? "Issue spare parts to active work orders" : "Read only"}</span>
          </div>
          <QrCode size={20} aria-hidden="true" />
        </div>

        <div className="qr-lookup-row">
          <label className="search-input">
            <Search size={17} aria-hidden="true" />
            <input value={qrText} onChange={(event) => setQrText(event.target.value)} placeholder="Scan value, item no, search name" />
          </label>
          <button type="button" onClick={() => lookupQr()} disabled={busy === "lookup" || !qrText.trim()}>
            <QrCode size={16} aria-hidden="true" />
            {busy === "lookup" ? "Checking" : "Lookup"}
          </button>
          <button type="button" onClick={cameraOpen ? stopCamera : startCamera}>
            <ExternalLink size={16} aria-hidden="true" />
            {cameraOpen ? "Stop Camera" : "Camera"}
          </button>
        </div>

        {cameraOpen ? (
          <div className={`spare-camera-box ${scanDetected ? "detected" : ""}`}>
            <video ref={videoRef} muted playsInline />
            <span className="camera-scan-overlay" aria-hidden="true" />
          </div>
        ) : null}

        {qrMatches.length > 1 ? (
          <div className="qr-match-list">
            {qrMatches.map((part) => (
              <button key={part.itemNo} type="button" onClick={() => chooseIssuePart(part)}>
                <strong>{part.itemNo}</strong>
                <span>{part.searchName || part.description}</span>
                <em>{numberText(part.currentStock)} {part.uom}</em>
              </button>
            ))}
          </div>
        ) : null}

        <div className="manual-part-picker">
          <div className="manual-picker-header">
            <strong>Manual spare selection</strong>
            <span>{manualPartOptions.length} quick matches</span>
          </div>
          <label className="search-input">
            <Package size={17} aria-hidden="true" />
            <input
              value={manualPartSearch}
              onChange={(event) => setManualPartSearch(event.target.value)}
              placeholder="Choose by item no, name, category, supplier"
            />
          </label>
          <div className="manual-part-results">
            {manualPartOptions.length === 0 ? (
              <p>No spare parts found.</p>
            ) : (
              manualPartOptions.map((part) => (
                <button
                  key={part.itemNo}
                  type="button"
                  className={issuePart?.itemNo === part.itemNo ? "active" : ""}
                  onClick={() => chooseIssuePart(part)}
                >
                  <span>
                    <strong>{part.itemNo}</strong>
                    <em>{part.searchName || part.description}</em>
                  </span>
                  <small>{part.category || "Uncategorised"}</small>
                  <b>{numberText(part.currentStock)} {part.uom}</b>
                </button>
              ))
            )}
          </div>
        </div>

        <form className="spare-issue-form" onSubmit={submitIssue}>
          <div className="selected-spare">
            {issuePart ? (
              <>
                <strong>{issuePart.itemNo}</strong>
                <span>{issuePart.searchName || issuePart.description}</span>
                <em>{numberText(issuePart.currentStock)} {issuePart.uom} available</em>
              </>
            ) : (
              <span>No spare selected</span>
            )}
          </div>

          <select value={issueWorkOrderId} onChange={(event) => setIssueWorkOrderId(event.target.value)} disabled={!canIssue}>
            <option value="">Select active work order</option>
            {activeWorkOrders.map((workOrder) => (
              <option key={workOrder.id} value={workOrder.id}>
                {workOrder.number} - {workOrder.machineName || workOrder.title}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            step="1"
            value={issueQuantity}
            onChange={(event) => setIssueQuantity(event.target.value)}
            disabled={!canIssue}
            aria-label="Issue quantity"
          />
          <input value={issueNote} onChange={(event) => setIssueNote(event.target.value)} placeholder="Note" disabled={!canIssue} />
          <button className={busy === "issue" ? "loading" : ""} type="submit" disabled={!canIssue || !issuePart || !issueWorkOrderId || busy === "issue"}>
            {busy === "issue" ? <span className="spare-button-spinner" aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
            {busy === "issue" ? "Issuing" : "Deduct Stock"}
          </button>
        </form>

        {busy === "issue" ? (
          <div className="issue-inline-progress" role="status" aria-live="polite">
            <span className="issue-progress-ring" aria-hidden="true" />
            <div>
              <strong>Updating stock movement</strong>
              <span>Recording deduction, work order link, and sheet sync status.</span>
              <em aria-hidden="true"><i /></em>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  function renderInventoryPanel() {
    return (
      <section className="section-panel spare-inventory-panel">
        <div className="section-header">
          <div>
            <h2>Inventory Register</h2>
            <span>{filteredParts.length} visible across {filteredPartGroups.length} categories, {suppliersCount} supplier rows</span>
          </div>
          <SlidersHorizontal size={20} aria-hidden="true" />
        </div>

        <div className="filter-bar spare-filter-bar">
          <label className="search-input">
            <Search size={17} aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search spare parts" />
          </label>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {categories.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select value={stockFilter} onChange={(event) => setStockFilter(event.target.value as StockFilter)}>
            <option value="all">All stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>
        </div>

        <div className="inventory-category-list">
          {filteredParts.length === 0 ? (
            <p className="quiet-panel">No spare parts found.</p>
          ) : (
            filteredPartGroups.map((group) => (
              <section key={group.name} className="inventory-category-section">
                <div className="inventory-category-header">
                  <div>
                    <h3>{group.name}</h3>
                    <span>{group.items.length} spare parts</span>
                  </div>
                  <div className="inventory-category-summary">
                    <span>{group.low} low</span>
                    <span>{group.out} out</span>
                  </div>
                </div>
                <div className="spare-list">
                  {group.items.map((part) => (
                    <article key={part.itemNo} className={`spare-row stock-${stockState(part)}`}>
                      <Link to={`/spare-parts/${encodeURIComponent(part.itemNo)}`}>
                        <div>
                          <strong>{part.itemNo}</strong>
                          <span>{part.searchName || part.description}</span>
                        </div>
                        <em>{part.category || "Uncategorised"}</em>
                        <span>{part.supplier || part.supplier1 || "No supplier"}</span>
                        <span>{numberText(part.currentStock)} {part.uom}</span>
                        <span className="stock-pill">{stockLabel(part)}</span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          chooseIssuePart(part);
                          navigate("/spare-parts/scanner");
                        }}
                        disabled={!canIssue}
                      >
                        <QrCode size={15} aria-hidden="true" />
                        Issue
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </section>
    );
  }

  function renderSetupPanel() {
    if (!canManage) {
      return <p className="quiet-panel">Executive or admin access is required.</p>;
    }

    return (
      <div className="spare-setup-grid">
        <section className="section-panel spare-import-panel new-sparepart-panel">
          <div className="section-header">
            <div>
              <h2>New Spare Part</h2>
              <span>Add part manually</span>
            </div>
            <Package size={20} aria-hidden="true" />
          </div>
          <form onSubmit={createNewSparePart}>
            <label>
              Item number
              <input value={newSpareForm.itemNo} onChange={(event) => setNewSpareForm((current) => ({ ...current, itemNo: event.target.value }))} placeholder="SP-001" required />
            </label>
            <label>
              Nama sparepart <span className="required-field">Required</span>
              <input value={newSpareForm.name} onChange={(event) => setNewSpareForm((current) => ({ ...current, name: event.target.value }))} placeholder="Nama sparepart" required />
            </label>
            <div className="sheet-name-grid">
              <label>
                Category
                <input value={newSpareForm.category} onChange={(event) => setNewSpareForm((current) => ({ ...current, category: event.target.value }))} placeholder="Bearing" />
              </label>
              <label>
                UOM
                <input value={newSpareForm.uom} onChange={(event) => setNewSpareForm((current) => ({ ...current, uom: event.target.value }))} placeholder="pcs" />
              </label>
              <label>
                Current stock
                <input type="number" min="0" step="1" value={newSpareForm.currentStock} onChange={(event) => setNewSpareForm((current) => ({ ...current, currentStock: event.target.value }))} />
              </label>
              <label>
                Min stock
                <input type="number" min="0" step="1" value={newSpareForm.minStock} onChange={(event) => setNewSpareForm((current) => ({ ...current, minStock: event.target.value }))} />
              </label>
              <label>
                Max stock
                <input type="number" min="0" step="1" value={newSpareForm.maxStock} onChange={(event) => setNewSpareForm((current) => ({ ...current, maxStock: event.target.value }))} />
              </label>
              <label>
                Supplier
                <input value={newSpareForm.supplier} onChange={(event) => setNewSpareForm((current) => ({ ...current, supplier: event.target.value }))} placeholder="Supplier" />
              </label>
              <label>
                Price (IDR)
                <input type="number" min="0" step="0.01" value={newSpareForm.price} onChange={(event) => setNewSpareForm((current) => ({ ...current, price: event.target.value }))} />
              </label>
            </div>
            <div className="spare-sync-actions">
              <button type="submit" disabled={busy === "create-spare"}>
                <Package size={16} aria-hidden="true" />
                {busy === "create-spare" ? "Saving" : "New Sparepart"}
              </button>
            </div>
          </form>
        </section>

        <section className="section-panel spare-import-panel">
          <div className="section-header">
            <div>
              <h2>Apps Script Bridge</h2>
              <span>{syncSettings.configured ? "Configured" : "Not configured"}</span>
            </div>
            <Settings2 size={20} aria-hidden="true" />
          </div>
          <form onSubmit={saveSyncSettings}>
            <label>
              Apps Script URL
              <input
                value={syncSettings.scriptUrl}
                onChange={(event) => setSyncSettings({ ...syncSettings, scriptUrl: event.target.value })}
                placeholder="https://script.google.com/macros/s/..."
              />
            </label>
            <label>
              Sync token
              <input
                type="password"
                value={syncToken}
                onChange={(event) => setSyncToken(event.target.value)}
                placeholder={syncSettings.hasToken ? "Token saved; leave blank to keep" : "Sync token"}
              />
            </label>
            <div className="sheet-name-grid">
              <label>
                Master sheet
                <input value={syncSettings.masterSheetName} onChange={(event) => setSyncSettings({ ...syncSettings, masterSheetName: event.target.value })} />
              </label>
              <label>
                Supplier sheet
                <input value={syncSettings.supplierSheetName} onChange={(event) => setSyncSettings({ ...syncSettings, supplierSheetName: event.target.value })} />
              </label>
              <label>
                Movement sheet
                <input value={syncSettings.movementSheetName} onChange={(event) => setSyncSettings({ ...syncSettings, movementSheetName: event.target.value })} />
              </label>
            </div>
            <div className="spare-sync-actions">
              <button type="submit" disabled={busy === "settings"}>
                <CheckCircle2 size={16} aria-hidden="true" />
                {busy === "settings" ? "Saving" : "Save Settings"}
              </button>
              <button type="button" onClick={pullFromSheet} disabled={busy === "pull" || !syncSettings.configured}>
                <RefreshCw size={16} aria-hidden="true" />
                {busy === "pull" ? "Syncing" : "Pull Sheet"}
              </button>
              <button type="button" onClick={retrySync} disabled={busy === "retry" || summary.unsyncedMovements === 0}>
                <RefreshCw size={16} aria-hidden="true" />
                {busy === "retry" ? "Retrying" : "Retry Sync"}
              </button>
            </div>
          </form>
        </section>

        <section className="section-panel spare-import-panel">
          <div className="section-header">
            <div>
              <h2>Sheet Import</h2>
              <span>Masterlist and supplier data</span>
            </div>
            <FileSpreadsheet size={20} aria-hidden="true" />
          </div>
          <form onSubmit={importParts}>
            <label>
              Masterlist
              <textarea
                value={masterText}
                onChange={(event) => setMasterText(event.target.value)}
                rows={8}
                placeholder={"NO\tCATEGORY\tITEM NAME\tITEM NO.\tOUM\tPRICE(RM)\tPART RANK\tSTATUS\tSTOCK RANK\tMIN\tMAX\tSEARCH NAME\tOPENING"}
              />
            </label>
            <label>
              Supplier info
              <textarea
                value={supplierText}
                onChange={(event) => setSupplierText(event.target.value)}
                rows={6}
                placeholder={"SUPPLIER\nKANAI JUYO KOGYO CO., LTD\nYIK BEE TRADING SDN. BHD."}
              />
            </label>
            <div className="spare-sync-actions">
              <button type="submit" disabled={!masterText.trim() || busy === "import"}>
                <FileSpreadsheet size={16} aria-hidden="true" />
                {busy === "import" ? "Importing" : "Import"}
              </button>
              <button type="button" onClick={() => {
                setMasterText("");
                setSupplierText("");
              }}>
                Clear
              </button>
            </div>
          </form>
        </section>
      </div>
    );
  }

  function renderDetailPanel() {
    if (!detail) {
      return <p className="quiet-panel">Select a spare part from the inventory register.</p>;
    }

    return (
      <section className="section-panel spare-detail-panel">
        <div className="section-header">
          <div>
            <h2>{detail.itemNo}</h2>
            <span>{detail.searchName || detail.description}</span>
          </div>
          <Package size={20} aria-hidden="true" />
        </div>

        <dl className="spare-detail-grid">
          <div>
            <dt>Stock</dt>
            <dd>{numberText(detail.currentStock)} {detail.uom}</dd>
          </div>
          <div>
            <dt>Min / Max</dt>
            <dd>{numberText(detail.minStock)} / {numberText(detail.maxStock)}</dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd>{money.format(detail.price)}</dd>
          </div>
          <div>
            <dt>Lead time</dt>
            <dd>{detail.leadTime || "-"}</dd>
          </div>
          <div>
            <dt>Rank</dt>
            <dd>{detail.partRank || "-"} / {detail.stockRank || "-"}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{detail.status || "Active"}</dd>
          </div>
        </dl>

        <div className="spare-qr-card">
          <div className="spare-qr-code" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <div className="spare-qr-actions">
            <button type="button" onClick={copyQrUrl}>
              <ClipboardCopy size={15} aria-hidden="true" />
              Copy
            </button>
            <button type="button" onClick={downloadQr} disabled={!qrSvg}>
              <Download size={15} aria-hidden="true" />
              Download
            </button>
            <Link to={`/spare-parts/issue/${encodeURIComponent(detail.itemNo)}`}>
              <ExternalLink size={15} aria-hidden="true" />
              Open Issue
            </Link>
          </div>
        </div>

        {canManage ? (
          <form className="spare-adjust-form" onSubmit={submitAdjustment}>
            <h3>Adjustment</h3>
            <select value={adjustType} onChange={(event) => setAdjustType(event.target.value as AdjustmentType)}>
              <option value="restock">Restock</option>
              <option value="return">Return to store</option>
              <option value="write_off">Write-off</option>
              <option value="correction">Correction delta</option>
            </select>
            <input type="number" step="1" value={adjustQuantity} onChange={(event) => setAdjustQuantity(event.target.value)} />
            <input value={adjustNote} onChange={(event) => setAdjustNote(event.target.value)} placeholder="Reason" />
            <button type="submit" disabled={!adjustNote.trim() || busy === "adjust"}>
              <CheckCircle2 size={15} aria-hidden="true" />
              {busy === "adjust" ? "Saving" : "Save"}
            </button>
          </form>
        ) : null}

        <div className="supplier-list">
          <h3>Suppliers</h3>
          {detail.suppliers.length === 0 ? (
            <p>No supplier rows matched.</p>
          ) : (
            detail.suppliers.slice(0, 5).map((supplier) => (
              <article key={supplier.id}>
                <strong>{supplier.supplier}</strong>
                <span>{supplier.pic || supplier.contactNo || supplier.email || supplier.address}</span>
              </article>
            ))
          )}
        </div>

        <div className="movement-list">
          <h3>
            <History size={16} aria-hidden="true" />
            Movement History
          </h3>
          {detail.movements.length === 0 ? (
            <p>No movements yet.</p>
          ) : (
            detail.movements.slice(0, 20).map((movement) => (
              <article key={movement.id} className={`movement-row sync-${movement.syncStatus}`}>
                <div>
                  <strong>{movement.type.replace("_", " ")}</strong>
                  <span>{movement.workOrderNumber || "Manual"} - {movement.actorName}</span>
                </div>
                <em>{numberText(movement.beforeStock)} to {numberText(movement.afterStock)}</em>
                <time>{formatDateTime(movement.createdAt)}</time>
              </article>
            ))
          )}
        </div>
      </section>
    );
  }

  function renderRecentMovementPanel() {
    return (
      <section className="section-panel spare-detail-panel">
        <div className="section-header">
          <div>
            <h2>Recent Movement</h2>
            <span>{recentMovements.length} latest transactions</span>
          </div>
          <Activity size={20} aria-hidden="true" />
        </div>
        <div className="movement-list">
          {recentMovements.length === 0 ? (
            <p>No stock movements yet.</p>
          ) : (
            recentMovements.map((movement) => (
              <article key={movement.id} className={`movement-row sync-${movement.syncStatus}`}>
                <div>
                  <strong>{movement.itemNo}</strong>
                  <span>{movement.type.replace("_", " ")} - {movement.actorName}</span>
                </div>
                <em>{numberText(movement.beforeStock)} to {numberText(movement.afterStock)}</em>
              </article>
            ))
          )}
        </div>
      </section>
    );
  }

  function renderDashboard() {
    return (
      <>
        <section className="spare-dashboard-banner">
          <div>
            <span>Store control</span>
            <h2>Spare inventory health</h2>
            <p>{summary.lowStock + summary.outOfStock} parts need attention across {categories.length} categories.</p>
          </div>
          <div className="spare-banner-stats">
            <strong>{numberText(summary.totalParts)} SKUs</strong>
            <strong>{numberText(summary.lowStock)} low</strong>
            <strong>{numberText(summary.outOfStock)} out</strong>
            <strong>{syncConfigured ? "Sheet ready" : "Sheet off"}</strong>
          </div>
        </section>

        <div className="spare-dashboard-grid">
          <section className="section-panel spare-health-panel">
          <div className="section-header">
            <div>
              <h2>Stock Watch</h2>
              <span>{summary.lowStock + summary.outOfStock} parts need attention</span>
            </div>
            <AlertTriangle size={20} aria-hidden="true" />
          </div>
          <div className="stock-watch-columns">
            <div>
              <h3>Low Stock</h3>
              {lowStockParts.length === 0 ? <p>Clear</p> : lowStockParts.map((part) => (
                <Link key={part.itemNo} to={`/spare-parts/${encodeURIComponent(part.itemNo)}`}>
                  <strong>{part.itemNo}</strong>
                  <span>{part.searchName || part.description}</span>
                  <em>{numberText(part.currentStock)} {part.uom}</em>
                </Link>
              ))}
            </div>
            <div>
              <h3>Out of Stock</h3>
              {outOfStockParts.length === 0 ? <p>Clear</p> : outOfStockParts.map((part) => (
                <Link key={part.itemNo} to={`/spare-parts/${encodeURIComponent(part.itemNo)}`}>
                  <strong>{part.itemNo}</strong>
                  <span>{part.searchName || part.description}</span>
                  <em>{numberText(part.currentStock)} {part.uom}</em>
                </Link>
              ))}
            </div>
          </div>
          </section>

          <section className="section-panel spare-category-panel">
          <div className="section-header">
            <div>
              <h2>Category Snapshot</h2>
              <span>{categories.length} categories</span>
            </div>
            <Boxes size={20} aria-hidden="true" />
          </div>
          <div className="category-chart-list">
            {categorySnapshot.length === 0 ? (
              <p>No category data yet.</p>
            ) : (
              categorySnapshot.map((item) => (
                <Link
                  key={item.name}
                  to="/spare-parts/inventory"
                  onClick={() => {
                    setCategory(item.name);
                    setStockFilter("all");
                    setSearch("");
                  }}
                  className="category-bar-row"
                >
                  <strong>{item.name}</strong>
                  <span className="category-bar-track">
                    <i style={{ width: `${Math.max(8, (item.count / categoryChartMax) * 100)}%` }} />
                  </span>
                  <em>{item.count} items / {item.low} attention</em>
                </Link>
              ))
            )}
          </div>
          </section>

          {renderRecentMovementPanel()}

          <section className="section-panel spare-command-panel">
          <div className="section-header">
            <div>
              <h2>Command</h2>
              <span>{syncConfigured ? "Sheet sync ready" : "Sheet sync off"}</span>
            </div>
            <SlidersHorizontal size={20} aria-hidden="true" />
          </div>
          <div className="spare-command-links">
            <Link to="/spare-parts/inventory">
              <Package size={17} aria-hidden="true" />
              Inventory
            </Link>
            <Link to="/spare-parts/scanner">
              <QrCode size={17} aria-hidden="true" />
              QR Scanner
            </Link>
            {canManage ? (
              <Link to="/spare-parts/setup">
                <Settings2 size={17} aria-hidden="true" />
                Sheet Setup
              </Link>
            ) : null}
          </div>
          </section>
        </div>
      </>
    );
  }

  const title = technicianMode ? "Parts" : view === "setup" ? "Spare Sheet Setup" : view === "scanner" ? "Spare Part Issue" : view === "inventory" || view === "detail" ? "Spare Inventory" : "Spare Parts";

  return (
    <section className={`page-stack spare-page spare-view-${view} ${technicianMode ? "technician-spare-page" : ""}`}>
      <div className="page-title-row page-title-clean">
        <div>
          <p className="eyebrow">{technicianMode ? "Store helper" : "Store inventory"}</p>
          <h1>{title}</h1>
          {technicianMode ? <p className="tech-parts-page-intro">Find a part, link it to your job, and keep a clear record.</p> : null}
        </div>
        {!technicianMode ? (
          <span className={`sync-chip ${syncConfigured ? "ready" : "offline"}`}>
            <RefreshCw size={16} aria-hidden="true" />
            {syncConfigured ? "Sheet sync ready" : "Sheet sync off"}
          </span>
        ) : null}
      </div>

      {renderTabs()}
      {technicianMode ? renderTechnicianTabs() : null}
      {renderIssueFeedback()}
      {message ? <p className="success-line">{message}</p> : null}
      {error ? <p className="error-line" role="alert">{error}</p> : null}

      {!["dashboard", "scanner", "setup"].includes(view) ? renderMetrics() : null}
      {view === "dashboard" ? renderDashboard() : null}
      {view === "inventory" ? (
        <div className="spare-inventory-shell">{renderInventoryPanel()}</div>
      ) : null}
      {view === "detail" ? (
        <div className="spare-layout">
          <div className="spare-main">{renderDetailPanel()}</div>
          <aside className="spare-side">{renderRecentMovementPanel()}</aside>
        </div>
      ) : null}
      {view === "scanner" ? (
        <div className="spare-scanner-shell">
          <div className="spare-scanner-only">{technicianMode ? <div className={`tech-parts-view tech-parts-view-${technicianPartView}`} role="tabpanel" key={technicianPartView}>{technicianPartView === "issue" ? renderTechnicianIssuePanel() : renderTechnicianHistoryPanel()}</div> : renderScannerPanel()}</div>
          {!technicianMode ? <div className="spare-scanner-recent">{renderRecentMovementPanel()}</div> : null}
        </div>
      ) : null}
      {view === "setup" ? renderSetupPanel() : null}
    </section>
  );
}
