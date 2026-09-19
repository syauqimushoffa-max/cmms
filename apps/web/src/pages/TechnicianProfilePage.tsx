import { BellRing, ClipboardCheck, LogOut, Smartphone, UserRound, Wifi } from "lucide-react";
import { PushNotificationControl } from "../components/PushNotificationControl";
import { mediaUrl } from "../api/client";
import { PwaInstallButton } from "../components/PwaInstallButton";
import { useCurrentUser } from "../state/UserContext";
import { PlantSelector } from "../components/PlantSelector";

function initialsFor(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function TechnicianProfilePage() {
  const { currentUser, logout } = useCurrentUser();

  if (!currentUser) {
    return null;
  }

  return (
    <section className="page-stack technician-profile-page">
      <div className="page-title-row page-title-clean">
        <div>
          <p className="eyebrow">Your account</p>
          <h1>Profile</h1>
        </div>
        <span className="role-chip">
          <UserRound size={17} aria-hidden="true" />
          {currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1)}
        </span>
      </div>

      <section className="section-panel technician-profile-panel">
        <span className="technician-profile-avatar">{currentUser.avatarUrl ? <img src={mediaUrl(currentUser.avatarUrl)} alt={currentUser.name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} /> : initialsFor(currentUser.name)}</span>
        <div>
          <h2>{currentUser.name}</h2>
          <p>{currentUser.title}</p>
          <span>{currentUser.department}</span>
        </div>
        <button className="secondary-action" type="button" onClick={logout}>
          <LogOut size={17} aria-hidden="true" />
          Sign out
        </button>
      </section>

      <div className="technician-profile-grid">
        {currentUser.plantAccess === "both" ? <section className="section-panel settings-card"><UserRound size={22} aria-hidden="true" /><h2>Plant view</h2><p>Choose the plant whose jobs, parts and PM assignments you want to use.</p><PlantSelector /></section> : null}
        <section className="section-panel settings-card">
          <ClipboardCheck size={22} aria-hidden="true" />
          <h2>Daily Focus</h2>
          <div className="settings-list">
            <div>
              <span>Main screen</span>
              <strong>{currentUser.role === "technician" ? "Technician queue" : "Maintenance dashboard"}</strong>
            </div>
            <div>
              <span>Required to resolve</span>
              <strong>Remark + photo</strong>
            </div>
          </div>
        </section>

        <section className="section-panel settings-card">
          <Smartphone size={22} aria-hidden="true" />
          <h2>Install on your device</h2>
          <p className="ux-form-help">Add PBS CMMS to your home screen for quick access. An internet connection is needed to save changes and receive updates.</p>
          <PwaInstallButton />
        </section>

        <section className="section-panel settings-card">
          <Wifi size={22} aria-hidden="true" />
          <h2>Connection</h2>
          <div className="settings-list">
            <div>
              <span>Work order updates</span>
              <strong>Online required</strong>
            </div>
            <div>
              <span>Photos</span>
              <strong>Camera or photo library</strong>
            </div>
          </div>
        </section>

        <section className="section-panel settings-card">
          <BellRing size={22} aria-hidden="true" />
          <h2>Notifications</h2>
          <PushNotificationControl />
          <div className="settings-list">
            <div>
              <span>Queue updates</span>
              <strong>In-app</strong>
            </div>
            <div>
              <span>Push alerts</span>
              <strong>Available on supported devices</strong>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
