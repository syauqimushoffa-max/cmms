import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface SearchableSelectOption {
  value: string;
  label: string;
  meta?: string;
}

interface SearchableSelectProps {
  label: string;
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  icon?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  validationField?: string;
  invalid?: boolean;
}

export function SearchableSelect({
  label,
  value,
  options,
  onChange,
  icon,
  placeholder = "Search",
  disabled = false,
  validationField,
  invalid = false
}: SearchableSelectProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [query, setQuery] = useState("");
  const selectedOption = options.find((option) => option.value === value);
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const listboxId = `${id}-options`;

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return options;
    }

    return options.filter((option) => {
      const searchable = `${option.label} ${option.meta || ""}`.toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [options, query]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
        setQuery("");
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  useEffect(() => {
    if (open) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const focusTimer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 40);
      return () => {
        window.clearTimeout(focusTimer);
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [open]);

  useEffect(() => { setActiveIndex(0); }, [query]);
  useEffect(() => {
    if (open) document.getElementById(listboxId + "-" + activeIndex)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, listboxId]);

  function closeMenu() {
    setOpen(false); setQuery(""); triggerRef.current?.focus();
  }

  function selectValue(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
    setQuery("");
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  return (
    <div className={`search-select ${disabled ? "disabled" : ""} ${invalid ? "requester-invalid" : ""}`} ref={rootRef} data-requester-field={validationField}>
      <span className="search-select-label" id={labelId}>
        {icon}
        {label}
      </span>
      <button
        className={`search-select-control ${open ? "open" : ""}`}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-controls={listboxId}
        aria-labelledby={`${labelId} ${valueId}`}
        onClick={() => {
          setOpen((current) => !current);
          setQuery("");
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
            setQuery("");
          }
        }}
      >
        <span className={`search-select-value ${selectedOption ? "" : "placeholder"}`} id={valueId}>
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {open ? createPortal(
        <>
          <button
            className="search-select-backdrop"
            type="button"
            aria-label={`Close ${label}`}
            onClick={() => {
              closeMenu();
            }}
          />
          <div className="search-select-menu" ref={menuRef} role="dialog" aria-modal="true" aria-labelledby={labelId}
            onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); closeMenu(); }
              if (event.key === "Tab") {
                event.preventDefault();
                const done = menuRef.current?.querySelector<HTMLButtonElement>(".ux-select-heading button");
                if (document.activeElement === inputRef.current) done?.focus(); else inputRef.current?.focus();
              }
            }}>
            <div className="ux-select-heading"><strong>{label}</strong><button type="button" onClick={closeMenu}>Done</button></div>
            <label className="search-select-search" htmlFor={`${id}-search`}>
              <Search size={16} aria-hidden="true" />
              <input
                id={`${id}-search`}
                ref={inputRef}
                value={query}
                placeholder={`Search ${label.toLowerCase()}`}
                autoComplete="off"
                role="combobox"
                aria-label={`Search ${label.toLowerCase()}`}
                aria-expanded={open}
                aria-controls={listboxId}
                aria-activedescendant={filteredOptions[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                    setQuery("");
                    triggerRef.current?.focus();
                  }
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveIndex((index) => Math.max(0, Math.min(filteredOptions.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
                  }
                  if (event.key === "Enter" && filteredOptions[activeIndex]) {
                    event.preventDefault();
                    selectValue(filteredOptions[activeIndex].value);
                  }
                }}
              />
            </label>
            <div className="search-select-options" id={listboxId} role="listbox" aria-label={label}>
              {filteredOptions.length > 0 ? (
                filteredOptions.map((option, index) => (
                  <button
                    type="button"
                    key={`${option.value}-${option.label}`}
                    id={`${listboxId}-${index}`}
                    tabIndex={-1}
                    className={`${option.value === value ? "selected" : ""} ${index === activeIndex ? "keyboard-active" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectValue(option.value)}
                    role="option"
                    aria-selected={option.value === value}
                  >
                    <span>
                      <strong>{option.label}</strong>
                      {option.meta ? <small>{option.meta}</small> : null}
                    </span>
                    {option.value === value ? <Check size={16} aria-hidden="true" /> : null}
                  </button>
                ))
              ) : (
                <p role="status">No matches for “{query}”. Try a different name.</p>
              )}
            </div>
          </div>
        </>,
        document.body
      ) : null}
    </div>
  );
}
