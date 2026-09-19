import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  busyLabel?: string;
  icon?: LucideIcon;
  tone?: "primary" | "acknowledge" | "start" | "material" | "resolve" | "return" | "assign" | "upload";
  children: ReactNode;
};

type ButtonPhase = "idle" | "loading" | "settling";

export function ActionButton({
  busy = false,
  busyLabel = "Working...",
  icon: Icon,
  tone = "primary",
  children,
  className,
  disabled,
  ...props
}: ActionButtonProps) {
  const [phase, setPhase] = useState<ButtonPhase>(busy ? "loading" : "idle");

  useEffect(() => {
    if (busy) {
      setPhase("loading");
      return;
    }

    setPhase((currentPhase) => (currentPhase === "loading" ? "settling" : currentPhase));
  }, [busy]);

  useEffect(() => {
    if (phase !== "settling") {
      return undefined;
    }

    const timeout = window.setTimeout(() => setPhase("idle"), 460);
    return () => window.clearTimeout(timeout);
  }, [phase]);

  const classes = [
    "motion-button",
    `tone-${tone}`,
    phase === "loading" ? "is-loading" : "",
    phase === "settling" ? "is-settling" : "",
    className || ""
  ]
    .filter(Boolean)
    .join(" ");
  const unavailable = disabled || phase !== "idle";

  return (
    <button {...props} className={classes} disabled={unavailable} aria-busy={phase === "loading"} data-motion-phase={phase}>
      <span className="button-face">
        {Icon ? (
          <span className="button-face-icon">
            <Icon size={17} aria-hidden="true" />
          </span>
        ) : null}
        <span className="button-face-label">{children}</span>
      </span>
      <span className="button-progress" aria-hidden={phase !== "loading"}>
        <LoaderCircle className="button-spinner" size={17} aria-hidden="true" />
        <span>{busyLabel}</span>
      </span>
    </button>
  );
}
