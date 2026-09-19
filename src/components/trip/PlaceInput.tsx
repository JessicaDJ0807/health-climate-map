"use client";

import { useEffect, useId, useRef, useState } from "react";
import { searchPlaces, type Place, type SearchNear } from "@/lib/trip/geocode";

export type { Place };

type Props = {
  label: string;
  marker: string; // "A" / "B"
  value: Place | null;
  onChange: (place: Place | null) => void;
  placeholder: string;
  near?: SearchNear; // current map view, to rank nearby results first
};

export default function PlaceInput({ label, marker, value, onChange, placeholder, near }: Props) {
  const [text, setText] = useState(value?.label ?? "");
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const [typed, setTyped] = useState(false);
  const [shownValue, setShownValue] = useState(value);
  // Read at search time; panning the map shouldn't re-run a search.
  const nearRef = useRef(near);
  useEffect(() => {
    nearRef.current = near;
  });

  // Keep the box in sync when the place is set from outside (demo trips).
  if (value !== shownValue) {
    setShownValue(value);
    setText(value?.label ?? "");
    setTyped(false);
  }

  const searching = typed && text.trim().length >= 3;
  const suggestions = searching ? results : [];

  useEffect(() => {
    if (!searching) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setResults(await searchPlaces(text, ctrl.signal, nearRef.current));
        setActive(0);
        setOpen(true);
      } catch {
        /* aborted or offline — keep previous suggestions */
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [text, searching]);

  const choose = (p: Place) => {
    onChange(p);
    setOpen(false);
  };

  return (
    <div className="relative">
      <label className="flex items-center gap-2 rounded-lg bg-[#f0efec] px-3 py-2 focus-within:ring-2 focus-within:ring-[#2a78d6]">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#0b0b0b] text-[11px] font-semibold text-white">
          {marker}
        </span>
        <span className="sr-only">{label}</span>
        <input
          className="w-full min-w-0 bg-transparent text-sm text-[#0b0b0b] outline-none placeholder:text-[#898781]"
          value={text}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          onChange={(e) => {
            setTyped(true);
            setText(e.target.value);
          }}
          onFocus={() => suggestions.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!open || !suggestions.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + suggestions.length) % suggestions.length); }
            else if (e.key === "Enter") { e.preventDefault(); choose(suggestions[active]); }
            else if (e.key === "Escape") setOpen(false);
          }}
        />
      </label>
      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-black/10"
        >
          {suggestions.map((p, i) => (
            <li
              key={`${p.label}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3 py-2 text-sm text-[#0b0b0b] ${i === active ? "bg-[#f0efec]" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); choose(p); }}
              onMouseEnter={() => setActive(i)}
            >
              {p.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
