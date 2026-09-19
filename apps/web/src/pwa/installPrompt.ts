type InstallChoiceOutcome = "accepted" | "dismissed" | "unavailable";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: InstallChoiceOutcome; platform: string }>;
};

export type InstallPromptSnapshot = {
  canPrompt: boolean;
  installed: boolean;
};

const listeners = new Set<(snapshot: InstallPromptSnapshot) => void>();
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let initialized = false;
let installed = isStandalone();

function isStandalone() {
  if (typeof window === "undefined") {
    return false;
  }

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

function snapshot(): InstallPromptSnapshot {
  return {
    canPrompt: Boolean(deferredPrompt) && !installed,
    installed
  };
}

function notify() {
  const nextSnapshot = snapshot();
  listeners.forEach((listener) => listener(nextSnapshot));
}

export function initInstallPromptListener() {
  if (initialized || typeof window === "undefined") {
    return;
  }

  initialized = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    installed = isStandalone();
    notify();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });

  const standaloneQuery = window.matchMedia("(display-mode: standalone)");
  const handleDisplayModeChange = () => {
    installed = isStandalone();
    if (installed) {
      deferredPrompt = null;
    }
    notify();
  };

  if (typeof standaloneQuery.addEventListener === "function") {
    standaloneQuery.addEventListener("change", handleDisplayModeChange);
  } else {
    (standaloneQuery as MediaQueryList & { addListener: (listener: () => void) => void }).addListener(handleDisplayModeChange);
  }
}

export function getInstallPromptSnapshot() {
  initInstallPromptListener();
  return snapshot();
}

export function subscribeInstallPrompt(listener: (snapshot: InstallPromptSnapshot) => void) {
  initInstallPromptListener();
  listeners.add(listener);
  listener(snapshot());

  return () => {
    listeners.delete(listener);
  };
}

export async function promptInstall(): Promise<InstallChoiceOutcome> {
  if (!deferredPrompt || installed) {
    return "unavailable";
  }

  const prompt = deferredPrompt;
  await prompt.prompt();
  const choice = await prompt.userChoice.catch(() => ({ outcome: "dismissed" as const, platform: "" }));

  deferredPrompt = null;
  installed = choice.outcome === "accepted" || isStandalone();
  notify();

  return choice.outcome;
}
