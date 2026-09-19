import { CheckCircle2, Download, Share2, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { getInstallPromptSnapshot, promptInstall, subscribeInstallPrompt } from "../pwa/installPrompt";

type PwaInstallButtonProps = {
  className?: string;
};

function isAppleTouchDevice() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform = navigator.platform || "";
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function PwaInstallButton({ className = "" }: PwaInstallButtonProps) {
  const [installState, setInstallState] = useState(getInstallPromptSnapshot);
  const [manualIosInstall, setManualIosInstall] = useState(false);
  const [secureContext, setSecureContext] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setManualIosInstall(isAppleTouchDevice());
    setSecureContext(window.isSecureContext);
    return subscribeInstallPrompt(setInstallState);
  }, []);

  async function install() {
    if (!installState.canPrompt || busy) {
      return;
    }

    setBusy(true);
    try {
      await promptInstall();
    } finally {
      setBusy(false);
    }
  }

  if (installState.installed) {
    return (
      <button className={`secondary-action pwa-install-button ${className}`} type="button" disabled>
        <CheckCircle2 size={17} aria-hidden="true" />
        Installed
      </button>
    );
  }

  if (manualIosInstall) {
    return (
      <div className={`pwa-install-guidance ${secureContext ? "" : "warn"} ${className}`}>
        <Share2 size={18} aria-hidden="true" />
        <div>
          <strong>Add to Home Screen</strong>
          <span>Tap Share, then Add to Home Screen.</span>
          {!secureContext ? <em>Camera/offline features need HTTPS.</em> : null}
        </div>
      </div>
    );
  }

  if (!installState.canPrompt) {
    return (
      <div className={`pwa-install-guidance ${secureContext ? "" : "warn"} ${className}`}>
        <Smartphone size={18} aria-hidden="true" />
        <div>
          <strong>Install from browser menu</strong>
          <span>Use a supported browser install action.</span>
          {!secureContext ? <em>Use HTTPS for the full app install.</em> : null}
        </div>
      </div>
    );
  }

  return (
    <button className={`secondary-action pwa-install-button ${className}`} type="button" disabled={!installState.canPrompt || busy} onClick={install}>
      <Download size={17} aria-hidden="true" />
      {busy ? "Opening..." : "Install App"}
    </button>
  );
}
