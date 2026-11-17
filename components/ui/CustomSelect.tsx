"use client";

import React, {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type ParsedOption = {
  value: string;
  label: ReactNode;
  text: string;
  disabled: boolean;
};

function nodeToText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeToText(node.props.children);
  }
  return "";
}

function collectOptions(children: ReactNode, out: ParsedOption[] = []): ParsedOption[] {
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(child)) {
      return;
    }
    if (child.type === "option") {
      const text = nodeToText(child.props.children).trim();
      const rawValue = child.props.value;
      const value = rawValue !== undefined ? String(rawValue) : text;
      out.push({
        value,
        label: child.props.children,
        text,
        disabled: Boolean(child.props.disabled),
      });
      return;
    }
    if (child.props?.children) {
      collectOptions(child.props.children, out);
    }
  });
  return out;
}

export type CustomSelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  /** Hiện ô tìm kiếm trong danh sách (dùng cho danh sách dài). Option giá trị rỗng luôn được giữ. */
  searchable?: boolean;
  searchPlaceholder?: string;
};

export function CustomSelect({
  value,
  defaultValue,
  onChange,
  disabled,
  className = "",
  children,
  id,
  name,
  title,
  "aria-label": ariaLabel,
  searchable = false,
  searchPlaceholder = "Tìm kiếm...",
}: CustomSelectProps) {
  const options = useMemo(() => collectOptions(children), [children]);
  const [search, setSearch] = useState("");
  const [internalValue, setInternalValue] = useState<string>(() =>
    defaultValue !== undefined ? String(defaultValue) : (options[0]?.value ?? ""),
  );
  const currentValue = value !== undefined ? String(value) : internalValue;

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === currentValue) ?? options[0],
    [options, currentValue],
  );

  const [open, setOpen] = useState(false);
  const visibleOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!searchable || !q) return options;
    return options.filter((opt) => opt.value === "" || opt.text.toLowerCase().includes(q));
  }, [options, search, searchable]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    minWidth: number;
    maxWidth: number;
    placeAbove: boolean;
  } | null>(null);

  const hasExternalChevron = className.includes("appearance-none");
  const isFullWidth =
    className.includes("input") || className.includes("w-full") || hasExternalChevron;
  const isInlineBorderless = className.includes("border-0") && className.includes("bg-transparent");

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const minWidth = Math.min(vw - 16, Math.max(rect.width, 150));
    const desiredMax = Math.min(vw - 16, Math.max(rect.width, 320));
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = spaceBelow < 220 && rect.top > 220;
    const left = Math.max(8, Math.min(rect.left, vw - minWidth - 8));
    const maxWidth = Math.max(minWidth, Math.min(desiredMax, vw - left - 8));
    setCoords({
      top: placeAbove ? rect.top - 6 : rect.bottom + 6,
      left,
      minWidth,
      maxWidth,
      placeAbove,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const handleScrollOrResize = (event: Event) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) {
        return;
      }
      updatePosition();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open, updatePosition]);

  function selectValue(nextValue: string) {
    if (value === undefined) {
      setInternalValue(nextValue);
    }
    if (onChange) {
      const syntheticEvent = {
        target: { value: nextValue, name: name ?? "", id: id ?? "" },
        currentTarget: { value: nextValue, name: name ?? "", id: id ?? "" },
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as React.ChangeEvent<HTMLSelectElement>;
      onChange(syntheticEvent);
    }
    setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setSearch("");
          setOpen((prev) => !prev);
        }}
        className={`inline-flex items-center justify-between gap-1.5 text-left transition-colors ${
          isFullWidth ? "w-full" : ""
        } ${
          isInlineBorderless
            ? "rounded-md px-1.5 py-0.5 hover:bg-slate-100/80"
            : ""
        } ${
          open && !isInlineBorderless
            ? "border-emerald-500 ring-2 ring-emerald-500/15"
            : ""
        } ${className}`}
      >
        <span className="truncate">{selectedOption ? selectedOption.label : ""}</span>
        {!hasExternalChevron ? (
          <svg
            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-150 ${
              open ? "rotate-180 text-emerald-600" : ""
            }`}
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m5.5 7.5 4.5 4.5 4.5-4.5" />
          </svg>
        ) : null}
      </button>

      {open && coords && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={{
                position: "fixed",
                top: coords.top,
                left: coords.left,
                minWidth: coords.minWidth,
                maxWidth: coords.maxWidth,
                transform: coords.placeAbove ? "translateY(-100%)" : undefined,
              }}
              className="z-[9999] max-h-64 overflow-y-auto rounded-xl border border-slate-200/90 bg-white p-1 font-sans shadow-[0_12px_32px_-6px_rgba(15,23,42,0.16),0_2px_6px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/5"
            >
              {searchable ? (
                <div className="sticky top-0 z-10 -mx-1 -mt-1 mb-1 border-b border-slate-100 bg-white p-1.5">
                  <input
                    autoFocus
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={searchPlaceholder}
                    className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[12.5px] outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white"
                  />
                </div>
              ) : null}
              {searchable && search.trim() && visibleOptions.every((opt) => opt.value === "") ? (
                <p className="px-2.5 py-2 text-[12.5px] text-slate-400">Không tìm thấy kết quả</p>
              ) : null}
              {visibleOptions.map((opt, idx) => {
                const active = opt.value === currentValue;
                return (
                  <button
                    key={`${opt.value}-${idx}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={opt.disabled}
                    onClick={() => {
                      if (opt.disabled) return;
                      selectValue(opt.value);
                    }}
                    className={`flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${
                      opt.disabled
                        ? "cursor-not-allowed text-slate-300"
                        : active
                          ? "bg-emerald-50 font-semibold text-emerald-700"
                          : "font-medium text-slate-700 hover:bg-slate-100/90 hover:text-slate-900"
                    }`}
                  >
                    <span className="truncate">{opt.label}</span>
                    {active ? (
                      <svg
                        className="h-3.5 w-3.5 shrink-0 text-emerald-600"
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4.5 10.5 8.2 14.2 15.5 6.5" />
                      </svg>
                    ) : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

