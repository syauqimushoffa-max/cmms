import {
  Bell,
  Boxes,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Factory,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  LockKeyhole,
  Menu,
  Package,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import type { NotificationRecord } from "@pbs-cmms/shared";
import { api, mediaUrl, selectedPlant } from "../api/client";
import { PushNotificationControl } from "./PushNotificationControl";
import { useCurrentUser } from "../state/UserContext";
import { formatShortDate } from "../utils/format";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

const navItems = [
  { to: "/performance", label: "Performance", icon: ChartNoAxesCombined },
  { to: "/reports", label: "Reports", icon: Boxes },
  { to: "/users", label: "Users", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings }
];

const technicianTabs: Array<{ to: string; label: string; icon: typeof LayoutDashboard; locked?: boolean }> = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/technician", label: "Jobs", icon: ClipboardCheck },
  { to: "/technician/projects", label: "Projects", icon: FolderKanban },
  { to: "/spare-parts/scanner", label: "Parts", icon: Package },
  { to: "/technician/more", label: "More", icon: Menu }
];

const executiveTabs: Array<{ to: string; label: string; icon: typeof LayoutDashboard }> = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/work-orders", label: "Work", icon: ClipboardCheck },
  { to: "/preventive-maintenance", label: "PM", icon: ShieldCheck },
  { to: "/spare-parts", label: "Parts", icon: Package }
];

function isTechnicianTabActive(tabPath: string, pathname: string) {
  if (tabPath === "/") {
    return pathname === "/";
  }
  if (tabPath === "/technician") {
    return pathname === "/technician" || pathname.startsWith("/work-orders");
  }
  if (tabPath === "/technician/more") {
    return pathname === "/technician/more" || pathname.startsWith("/technician/history") || pathname.startsWith("/preventive-maintenance") || pathname.startsWith("/profile");
  }

  return pathname.startsWith(tabPath);
}

function isExecutiveTabActive(tabPath: string, pathname: string) {
  if (tabPath === "/") return pathname === "/";
  return pathname.startsWith(tabPath);
}

export function Layout() {
  const { currentUser, loadingUsers, logout, refreshWorkOrders } = useCurrentUser();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const knownNotificationIdsRef = useRef<Set<string> | null>(null);
  const technicianMainRef = useRef<HTMLElement>(null);
  const executiveMainRef = useRef<HTMLElement>(null);
  const [notificationError, setNotificationError] = useState("");
  const [markingRead, setMarkingRead] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const isRequester = currentUser?.role === "requester";
  const hasDeveloperAccess = Boolean(currentUser && ["executive", "admin", "developer"].includes(currentUser.role));
  const canUseTechnicianViews = currentUser ? currentUser.role !== "requester" : true;
  const canOpenTechnicianQueue = currentUser ? ["technician", "executive", "admin", "developer"].includes(currentUser.role) : true;
  const workOrdersActive = location.pathname.startsWith("/work-orders") || (!isRequester && location.pathname.startsWith("/technician"));
  const sparePartsActive = location.pathname.startsWith("/spare-parts");
  const preventiveActive = location.pathname.startsWith("/preventive-maintenance");
  const [workOrdersOpen, setWorkOrdersOpen] = useState(workOrdersActive);
  const [sparePartsOpen, setSparePartsOpen] = useState(sparePartsActive);
  const [preventiveOpen, setPreventiveOpen] = useState(preventiveActive);

  async function loadNotifications() {
    if (!currentUser) {
      return;
    }

    const nextNotifications = await api.notifications(currentUser.id).catch((error) => {
      setNotificationError("Couldn’t refresh notifications. Please reopen this panel to try again.");
      throw error;
    });
    setNotificationError("");
    const knownNotificationIds = knownNotificationIdsRef.current;
    if (knownNotificationIds) {
      const incomingWorkOrderNotification = nextNotifications.find(
        (notification) => notification.workOrderId && !knownNotificationIds.has(notification.id)
      );
      if (incomingWorkOrderNotification) {
        void refreshWorkOrders().catch(console.error);
        window.dispatchEvent(new CustomEvent("sugi:work-orders-changed", {
          detail: { workOrderId: incomingWorkOrderNotification.workOrderId }
        }));
      }
    }
    knownNotificationIdsRef.current = new Set(nextNotifications.map((notification) => notification.id));
    setNotifications(nextNotifications);
  }

  useEffect(() => {
    knownNotificationIdsRef.current = null;
    loadNotifications().catch(console.error);
  }, [currentUser?.id]);

  useLiveRefresh(["notifications"], loadNotifications, { enabled: Boolean(currentUser), fallbackMs: 15000 });

  const unreadCount = useMemo(() => notifications.filter((notification) => !notification.readAt).length, [notifications]);
  const breadcrumb = useMemo(() => {
    if (currentUser?.role === "technician" && sparePartsActive) {
      return "Parts";
    }
    const current = [
      { match: "/work-orders", label: "Work Orders" },
      { match: "/technician/projects", label: "Projects" },
      { match: "/technician/history", label: "History" },
      { match: "/technician/more", label: "More" },
      { match: "/technician", label: "Technician" },
      { match: "/assets", label: "Assets" },
      { match: "/spare-parts/setup", label: "Integration setup" },
      { match: "/spare-parts/scanner", label: "Spare Scanner" },
      { match: "/spare-parts/inventory", label: "Spare Inventory" },
      { match: "/spare-parts/issue", label: "Spare Scanner" },
      { match: "/spare-parts", label: "Spare Parts" },
      { match: "/preventive-maintenance", label: "Preventive Maintenance" },
      { match: "/performance", label: "Performance" },
      { match: "/reports", label: "Reports" },
      { match: "/users", label: "Users" },
      { match: "/profile", label: "Profile" },
      { match: "/settings", label: "Settings" }
    ].find((item) => location.pathname.startsWith(item.match));

    return current?.label || "Dashboard";
  }, [currentUser?.role, location.pathname, sparePartsActive]);

  const initials = useMemo(() => {
    if (!currentUser) {
      return "DTU";
    }

    return currentUser.name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [currentUser]);
  const avatarSrc = currentUser?.avatarUrl ? mediaUrl(currentUser.avatarUrl) : "";

  useEffect(() => {
    if (workOrdersActive) {
      setWorkOrdersOpen(true);
      return;
    }

    setWorkOrdersOpen(false);
  }, [workOrdersActive]);

  useEffect(() => {
    if (sparePartsActive) {
      setSparePartsOpen(true);
      return;
    }

    setSparePartsOpen(false);
  }, [sparePartsActive]);

  useEffect(() => {
    if (preventiveActive) {
      setPreventiveOpen(true);
      return;
    }

    setPreventiveOpen(false);
  }, [preventiveActive]);

  useEffect(() => {
    setMobileNavOpen(false);
    setPanelOpen(false);
  }, [location.pathname]);

  useLayoutEffect(() => {
    if (currentUser?.role === "technician") {
      technicianMainRef.current?.scrollTo({ top: 0, behavior: "auto" });
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [currentUser?.role, location.pathname]);

  useLayoutEffect(() => {
    if (currentUser?.role === "executive") {
      executiveMainRef.current?.scrollTo({ top: 0, behavior: "auto" });
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [currentUser?.role, location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    const navigation = document.getElementById("mobile-main-navigation");
    const focusable = () => Array.from(navigation?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), [tabindex="0"]') || []).filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", trapFocus);
      previousFocus?.focus();
    };
  }, [mobileNavOpen]);

  useEffect(() => { if (panelOpen) void loadNotifications().catch(console.error); }, [panelOpen]);

  useEffect(() => {
    document.title = breadcrumb + " · PBS CMMS";
  }, [breadcrumb]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPanelOpen(false); setMobileNavOpen(false); }
    };
    const outside = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".notification-wrap")) setPanelOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("mousedown", outside);
    return () => { document.removeEventListener("keydown", close); document.removeEventListener("mousedown", outside); };
  }, []);

  async function markAllRead() {
    if (!currentUser) {
      return;
    }

    setMarkingRead(true);
    setNotificationError("");
    try {
      await api.markAllNotificationsRead(currentUser.id);
      await loadNotifications();
    } catch { setNotificationError("Couldn’t mark notifications as read. Please try again."); }
    finally { setMarkingRead(false); }
  }

  if (loadingUsers) {
    return <div className="auth-loading">Loading PBS CMMS...</div>;
  }

  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (currentUser.role === "requester") {
    return <Navigate to="/requester" replace />;
  }

  if (currentUser.role === "technician") {
    return (
      <div className="technician-app-shell">
        <a className="ux-skip-link" href="#main-content">Skip to content</a>
        <header className="technician-app-topbar">
          <div className="technician-brand-lockup">
            <span className="technician-brand-mark">
              <img src="/brand/sugi_symbol.png" alt="PBS Grand" />
            </span>
            <div>
              <span>Sugi Tech</span>
              <strong className="technician-breadcrumb-label" key={breadcrumb}>{breadcrumb}</strong>
            </div>
          </div>

          <div className="technician-topbar-actions">
            <NavLink className="profile-chip" to="/profile" aria-label="Open technician profile">
              {avatarSrc ? <img src={avatarSrc} alt={currentUser.name} /> : initials}
            </NavLink>
            <div className="notification-wrap">
              <button className="icon-button" type="button" onClick={() => setPanelOpen((open) => !open)} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={panelOpen}>
                <Bell size={19} aria-hidden="true" />
                {unreadCount > 0 ? <span className="notification-count">{unreadCount}</span> : null}
              </button>
              {panelOpen ? (
                <div className="notification-panel technician-notification-panel">
                  <div className="panel-header">
                    <strong>Notifications</strong>
                    <button type="button" onClick={markAllRead} disabled={markingRead || unreadCount === 0}>
                      Mark all read
                    </button>
                  </div>
                  {notificationError ? <p className="error-line" role="alert">{notificationError}</p> : null}
                  <div className="notification-list">
                    {notifications.length === 0 ? (
                      <p>No notifications yet.</p>
                    ) : (
                      notifications.slice(0, 8).map((notification) => (
                        <div key={notification.id} className={`notification-item ${notification.readAt ? "" : "unread"}`}>
                          {notification.workOrderId ? <NavLink to={`/work-orders/${notification.workOrderId}`}><strong>{notification.title}</strong></NavLink> : <strong>{notification.title}</strong>}
                          <span>{notification.body}</span>
                        </div>
                      ))
                    )}
                  </div>
                  <PushNotificationControl compact />
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="technician-app-main" ref={technicianMainRef}>
          <div className="technician-route-stage" key={location.pathname}>
            <Outlet />
          </div>
        </main>

        <nav className="technician-tabbar" aria-label="Technician navigation">
          {technicianTabs.map((item) => {
            const active = isTechnicianTabActive(item.to, location.pathname);
            if (item.locked) {
              return (
                <span key={item.to} className="technician-tab locked" aria-disabled="true" title="Feature in development">
                  <item.icon size={20} aria-hidden="true" />
                  <span>{item.label}</span>
                  <LockKeyhole className="nav-lock" size={11} aria-hidden="true" />
                </span>
              );
            }
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`technician-tab ${active ? "active" : ""}`}
                onClick={() => {
                  if (item.to === "/technician") window.dispatchEvent(new CustomEvent("sugi:open-technician-jobs"));
                }}
              >
                <item.icon size={20} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>
    );
  }

  return (
    <div className={`app-shell ${currentUser.role === "executive" ? "executive-app-shell" : ""} ${mobileNavOpen ? "mobile-nav-is-open" : ""}`}>
      <aside className={`sidebar ${mobileNavOpen ? "mobile-open" : ""}`} id="mobile-main-navigation">
        <div className="brand">
          <span className="brand-mark">
            <img src="/brand/sugi_symbol.png" alt="PBS Grand" />
          </span>
          <div>
            <strong>PBS CMMS</strong>
            <small>Maintenance command</small>
          </div>
          <button className="mobile-close-button" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation">
            <X size={19} aria-hidden="true" />
          </button>
        </div>

        <div className="mobile-account-panel">
          <div>
            <span>{formatShortDate()}</span>
            <span className="profile-chip mobile-profile-chip">
              {avatarSrc ? <img src={avatarSrc} alt={currentUser.name} /> : initials}
            </span>
          </div>
          <div className="mobile-account-user">
            <strong>{currentUser.name}</strong>
            <span>{currentUser.title} - {currentUser.role}</span>
          </div>
          <button className="mobile-signout-button" type="button" onClick={logout}>
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </button>
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} onClick={() => setMobileNavOpen(false)}>
            <LayoutDashboard size={18} aria-hidden="true" />
            <span>Dashboard</span>
          </NavLink>

          <div className={`nav-group ${workOrdersOpen ? "open" : ""}`}>
            <NavLink
              to="/work-orders"
              className={`nav-item nav-parent ${workOrdersActive ? "active" : ""}`}
              aria-expanded={workOrdersOpen}
              onClick={(event) => {
                if (workOrdersActive) {
                  event.preventDefault();
                  setWorkOrdersOpen((open) => !open);
                  return;
                }

                setWorkOrdersOpen(true);
              }}
            >
              <ClipboardCheck size={18} aria-hidden="true" />
              <span>Work Orders</span>
              {workOrdersOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
            </NavLink>

            <div className="nav-subitems" aria-hidden={!workOrdersOpen}>
              <NavLink to="/work-orders" tabIndex={workOrdersOpen ? 0 : -1} className={({ isActive }) => (isActive ? "active" : "")} onClick={() => setMobileNavOpen(false)}>
                Main
              </NavLink>
              {canOpenTechnicianQueue ? (
                <NavLink to="/technician" tabIndex={workOrdersOpen ? 0 : -1} className={({ isActive }) => (isActive ? "active" : "")} onClick={() => setMobileNavOpen(false)}>
                  Technician
                </NavLink>
              ) : null}
              {canUseTechnicianViews ? (
                <a href="/tv" target="_blank" rel="noreferrer" tabIndex={workOrdersOpen ? 0 : -1} onClick={() => setMobileNavOpen(false)}>
                  TV Board
                </a>
              ) : null}
            </div>
          </div>

          <div className={`nav-group ${sparePartsOpen ? "open" : ""}`}>
            <NavLink
              to="/spare-parts"
              className={`nav-item nav-parent ${sparePartsActive ? "active" : ""}`}
              aria-expanded={sparePartsOpen}
              onClick={(event) => {
                if (sparePartsActive) {
                  event.preventDefault();
                  setSparePartsOpen((open) => !open);
                  return;
                }

                setSparePartsOpen(true);
              }}
            >
              <Package size={18} aria-hidden="true" />
              <span>Spare Parts</span>
              {sparePartsOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
            </NavLink>

            <div className="nav-subitems" aria-hidden={!sparePartsOpen}>
              <NavLink to="/spare-parts" tabIndex={sparePartsOpen ? 0 : -1} end className={({ isActive }) => (isActive ? "active" : "")} onClick={() => setMobileNavOpen(false)}>
                Main
              </NavLink>
              <NavLink to="/spare-parts/inventory" tabIndex={sparePartsOpen ? 0 : -1} className={({ isActive }) => (isActive ? "active" : "")} onClick={() => setMobileNavOpen(false)}>
                Inventory
              </NavLink>
              {canUseTechnicianViews ? (
                <NavLink to="/spare-parts/scanner" tabIndex={sparePartsOpen ? 0 : -1} className={({ isActive }) => (isActive ? "active" : "")} onClick={() => setMobileNavOpen(false)}>
                  QR Scanner
                </NavLink>
              ) : null}
              {["executive", "admin", "developer"].includes(currentUser.role) ? (
                <NavLink to="/spare-parts/setup" tabIndex={sparePartsOpen ? 0 : -1} className={({ isActive }) => (isActive ? "active" : "")} onClick={() => setMobileNavOpen(false)}>
                  Sheet Setup
                </NavLink>
              ) : null}
            </div>
          </div>

          {(hasDeveloperAccess || currentUser.role === "executive") ? <div className={`nav-group ${preventiveOpen ? "open" : ""}`}>
            <NavLink
              to="/preventive-maintenance"
              className={`nav-item nav-parent ${preventiveActive ? "active" : ""}`}
              aria-expanded={preventiveOpen}
              onClick={(event) => {
                if (preventiveActive) {
                  event.preventDefault();
                  setPreventiveOpen((open) => !open);
                  return;
                }

                setPreventiveOpen(true);
              }}
            >
              <ShieldCheck size={18} aria-hidden="true" />
              <span>Preventive</span>
              {preventiveOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
            </NavLink>

            <div className="nav-subitems" aria-hidden={!preventiveOpen}>
              <NavLink
                to="/preventive-maintenance"
                end
                tabIndex={preventiveOpen ? 0 : -1}
                className={({ isActive }) => (isActive ? "active" : "")}
                onClick={() => setMobileNavOpen(false)}
              >
                Overview
              </NavLink>
              <NavLink
                to="/preventive-maintenance/schedule"
                tabIndex={preventiveOpen ? 0 : -1}
                className={({ isActive }) => (isActive ? "active" : "")}
                onClick={() => setMobileNavOpen(false)}
              >
                Schedule
              </NavLink>
              {['executive', 'admin'].includes(currentUser.role) ? (
                <NavLink
                  to="/preventive-maintenance/checklists"
                  tabIndex={preventiveOpen ? 0 : -1}
                  className={({ isActive }) => (isActive ? "active" : "")}
                  onClick={() => setMobileNavOpen(false)}
                >
                  Checklists
                </NavLink>
              ) : null}
            </div>
          </div> : <span className="nav-item locked" aria-disabled="true"><ShieldCheck size={18} aria-hidden="true" /><span>Preventive</span><LockKeyhole className="nav-lock" size={14} aria-hidden="true" /></span>}

          {(hasDeveloperAccess || currentUser.role === "executive") ? <NavLink to="/assets" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} onClick={() => setMobileNavOpen(false)}>
            <Factory size={18} aria-hidden="true" />
            <span>Assets</span>
          </NavLink> : <span className="nav-item locked" aria-disabled="true"><Factory size={18} aria-hidden="true" /><span>Assets</span><LockKeyhole className="nav-lock" size={14} aria-hidden="true" /></span>}

          {navItems.map((item) => (
            (hasDeveloperAccess || (currentUser.role === "executive" && ["/performance", "/reports"].includes(item.to)) || (item.to === "/settings" && currentUser.plantAccess === "both")) ? (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} onClick={() => setMobileNavOpen(false)}>
                <item.icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            ) : (
              <span key={item.to} className="nav-item locked" aria-disabled="true">
                <item.icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
                <LockKeyhole className="nav-lock" size={14} aria-hidden="true" />
              </span>
            )
          ))}
        </nav>

        <div className="sidebar-credit">
          <span aria-hidden="true">&copy;</span>
          <strong>Digital Transformation Unit</strong>
        </div>
      </aside>
      <button
        className="mobile-nav-scrim"
        type="button"
        aria-label="Close navigation"
        aria-hidden={!mobileNavOpen}
        tabIndex={mobileNavOpen ? 0 : -1}
        onClick={() => setMobileNavOpen(false)}
      />

      <div className={`content-shell ${currentUser.role === "executive" ? "executive-content-shell" : ""}`}>
        <a className="ux-skip-link" href="#main-content">Skip to content</a>
        <header className={`topbar ${currentUser.role === "executive" ? "executive-topbar" : ""}`}>
          <div className="topbar-main">
            <button
              className="mobile-menu-button"
              type="button"
              aria-label="Open navigation"
              aria-controls="mobile-main-navigation"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu size={21} aria-hidden="true" />
            </button>
            <div className="topbar-breadcrumb" aria-label="Breadcrumb">
              <span>Operations</span>
              <ChevronRight size={16} aria-hidden="true" />
              <strong>{breadcrumb}</strong>
            </div>
          </div>

          <div className="topbar-actions">
            <span className="ux-plant-badge"><Factory size={14} aria-hidden="true" />{selectedPlant() === "all" ? "Both plants" : selectedPlant() === "sendayan" ? "Sendayan" : "Port Klang"}</span>
            <span className="topbar-date">{formatShortDate()}</span>
            <NavLink className="profile-chip" to="/profile" aria-label="Open your profile">
              {avatarSrc ? <img src={avatarSrc} alt={currentUser.name} /> : initials}
            </NavLink>
            <button className="logout-button" type="button" onClick={logout}>
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
            <div className="notification-wrap">
              <button className="icon-button" type="button" onClick={() => setPanelOpen((open) => !open)} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={panelOpen}>
                <Bell size={19} aria-hidden="true" />
                {unreadCount > 0 ? <span className="notification-count">{unreadCount}</span> : null}
              </button>
              {panelOpen ? (
                <div className="notification-panel">
                  <div className="panel-header">
                    <strong>Notifications</strong>
                    <button type="button" onClick={markAllRead} disabled={markingRead || unreadCount === 0}>
                      Mark all read
                    </button>
                  </div>
                  {notificationError ? <p className="error-line" role="alert">{notificationError}</p> : null}
                  <div className="notification-list">
                    {notifications.length === 0 ? (
                      <p>No notifications yet.</p>
                    ) : (
                      notifications.slice(0, 8).map((notification) => (
                        <div key={notification.id} className={`notification-item ${notification.readAt ? "" : "unread"}`}>
                          {notification.workOrderId ? <NavLink to={`/work-orders/${notification.workOrderId}`}><strong>{notification.title}</strong></NavLink> : <strong>{notification.title}</strong>}
                          <span>{notification.body}</span>
                        </div>
                      ))
                    )}
                  </div>
                  <PushNotificationControl compact />
                </div>
              ) : null}
            </div>

          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="page-frame" ref={currentUser.role === "executive" ? executiveMainRef : undefined}>
          {currentUser.role === "executive" ? (
            <div className="executive-route-stage" key={location.pathname}>
              <Outlet />
            </div>
          ) : <Outlet />}
        </main>

        {currentUser.role === "executive" ? (
          <nav className="executive-tabbar" aria-label="Executive navigation">
            {executiveTabs.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={`executive-tab ${isExecutiveTabActive(item.to, location.pathname) ? "active" : ""}`}
              >
                <item.icon size={20} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            ))}
            <button
              className={`executive-tab executive-more-tab ${mobileNavOpen ? "active" : ""}`}
              type="button"
              aria-label="Open all executive navigation"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu size={20} aria-hidden="true" />
              <span>More</span>
            </button>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
