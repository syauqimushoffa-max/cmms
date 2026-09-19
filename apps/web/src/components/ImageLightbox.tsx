import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

interface ImageLightboxProps {
  src: string;
  alt: string;
  label?: string;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, label, onClose }: ImageLightboxProps) {
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") { event.preventDefault(); document.querySelector<HTMLButtonElement>(".image-lightbox-close")?.focus(); }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      previousFocus?.focus();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={label || alt} onClick={onClose}>
      <button type="button" className="image-lightbox-close" onClick={onClose} aria-label="Close photo viewer" autoFocus>
        <X size={24} />
      </button>
      <figure onClick={(event) => event.stopPropagation()}>
        <img src={src} alt={alt} />
        {label ? <figcaption>{label}</figcaption> : null}
      </figure>
    </div>,
    document.body
  );
}
