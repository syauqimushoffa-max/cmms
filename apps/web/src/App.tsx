import { lazy, Suspense, useEffect } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { LockKeyhole } from "lucide-react";
import { Layout } from "./components/Layout";
import { AdminPage } from "./pages/AdminPage";
import { AssetsPage } from "./pages/AssetsPage";
import { CreateWorkOrderPage } from "./pages/CreateWorkOrderPage";
import { DashboardPage } from "./pages/DashboardPage";
import { EditWorkOrderPage } from "./pages/EditWorkOrderPage";
import { LoginPage } from "./pages/LoginPage";
import { PreventiveMaintenancePage } from "./pages/PreventiveMaintenancePage";
import { PublicRequesterPage } from "./pages/PublicRequesterPage";
import { GuestTrackingPage } from "./pages/GuestTrackingPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SparePartsPage } from "./pages/SparePartsPage";
import { TechnicianPage } from "./pages/TechnicianPage";
import { TechnicianHistoryPage } from "./pages/TechnicianHistoryPage";
import { TechnicianMorePage } from "./pages/TechnicianMorePage";
import { TechnicianProjectsPage } from "./pages/TechnicianProjectsPage";
import { TechnicianProfilePage } from "./pages/TechnicianProfilePage";
import { TvDashboardPage } from "./pages/TvDashboardPage";
import { WorkOrderDetailPage } from "./pages/WorkOrderDetailPage";
import { WorkOrdersPage } from "./pages/WorkOrdersPage";
import { useCurrentUser } from "./state/UserContext";

const PerformancePage = lazy(() => import("./pages/PerformancePage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));

export function App() {
  const location = useLocation();

  useEffect(() => {
    const publicTitle = location.pathname === "/login" ? "Sign in" : location.pathname.startsWith("/requester/track") ? "Track your request" : location.pathname === "/requester" ? "Report an issue" : "";
    if (publicTitle) document.title = `${publicTitle} · PBS CMMS`;
    const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (manifestLink) {
      manifestLink.href = location.pathname.startsWith("/requester") ? "/requester.webmanifest" : "/manifest.webmanifest";
    }
  }, [location.pathname]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/requester" element={<PublicRequesterPage />} />
      <Route path="/requester/track/:id" element={<GuestTrackingPage />} />
      <Route path="/tv" element={<AuthenticatedTv />} />
      <Route element={<Layout />}>
        <Route path="*" element={<section className="ux-recovery"><h1>Page not found</h1><p>This link may be outdated. Choose a page from the navigation or return home.</p><Link className="primary-action" to="/">Return home</Link></section>} />
        <Route index element={<HomePage />} />
        <Route path="/work-orders" element={<WorkOrdersPage />} />
        <Route path="/work-orders/new" element={<CreateWorkOrderPage />} />
        <Route path="/work-orders/:id/edit" element={<EditWorkOrderPage />} />
        <Route path="/work-orders/:id" element={<WorkOrderDetailPage />} />
        <Route path="/technician" element={<TechnicianPage />} />
        <Route path="/technician/projects" element={<TechnicianProjectsPage />} />
        <Route path="/technician/history" element={<TechnicianHistoryPage />} />
        <Route path="/technician/more" element={<TechnicianMorePage />} />
        <Route path="/assets" element={<RestrictedFeature name="Assets"><AssetsPage /></RestrictedFeature>} />
        <Route path="/spare-parts" element={<SparePartsPage />} />
        <Route path="/spare-parts/inventory" element={<SparePartsPage />} />
        <Route path="/spare-parts/scanner" element={<SparePartsPage />} />
        <Route path="/spare-parts/setup" element={<SparePartsPage />} />
        <Route path="/spare-parts/issue/:itemNo" element={<SparePartsPage />} />
        <Route path="/spare-parts/:itemNo" element={<SparePartsPage />} />
        <Route path="/preventive-maintenance/*" element={<RestrictedFeature name="Preventive Maintenance"><PreventiveMaintenancePage /></RestrictedFeature>} />
        <Route path="/performance" element={<RestrictedFeature name="Performance"><Suspense fallback={<div className="performance-loading">Preparing live performance view...</div>}><PerformancePage /></Suspense></RestrictedFeature>} />
        <Route path="/reports" element={<RestrictedFeature name="Reports"><Suspense fallback={<div className="performance-loading">Building live report...</div>}><ReportsPage /></Suspense></RestrictedFeature>} />
        <Route path="/users" element={<RestrictedFeature name="Users"><AdminPage /></RestrictedFeature>} />
        <Route path="/profile" element={<TechnicianProfilePage />} />
        <Route path="/settings" element={<RestrictedFeature name="Settings"><SettingsPage /></RestrictedFeature>} />
      </Route>
    </Routes>
  );
}

function HomePage() {
  return <DashboardPage />;
}

function RestrictedFeature({ name, children }: { name: string; children: React.ReactNode }) {
  const { currentUser } = useCurrentUser();
  if (currentUser && (["executive", "admin", "developer"].includes(currentUser.role) || (currentUser.role === "technician" && name === "Preventive Maintenance") || (name === "Settings" && currentUser.plantAccess === "both"))) return children;

  return (
    <section className="locked-feature-page">
      <span><LockKeyhole size={28} aria-hidden="true" /></span>
      <p className="eyebrow">Role permissions</p>
      <h1>{name} access is restricted</h1>
      <p>Your role does not have access to this page. Contact an administrator if your responsibilities require it.</p>
      <a href="/work-orders">Go to Work Orders</a>
    </section>
  );
}

function AuthenticatedTv() {
  const { currentUser, loadingUsers } = useCurrentUser();
  if (loadingUsers) return <div className="auth-loading">Loading...</div>;
  return currentUser ? <TvDashboardPage /> : <Navigate to="/login" replace />;
}
