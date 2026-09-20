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
  onUseCurrentLocation?: () => void;
  /** The handoff gives the origin field a shorter variant. */
  compact?: boolean;
};

export default function PlaceInput({ label, marker, value, onChange, placeholder, near, onUseCurrentLocation, compact }: Props) {
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
    <div className="search-field">
      <label className={`search-box${compact ? " compact-search" : ""}`}>
        <span className={`point-label${marker === "B" ? " destination-point" : ""}`}>{marker}</span>
        <span className="sr-only">{label}</span>
        <input
          value={text}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={label}
          onChange={(e) => {
            setText(e.target.value);
            setTyped(true);
            if (!e.target.value.trim()) onChange(null);
          }}
          onFocus={() => suggestions.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!open || !suggestions.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % suggestions.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + suggestions.length) % suggestions.length); }
            else if (e.key === "Enter") { e.preventDefault(); choose(suggestions[active]); }
            else if (e.key === "Escape") setOpen(false);
          }}
        />
        {onUseCurrentLocation && (
          <button
            type="button"
            onClick={onUseCurrentLocation}
            title="Use my current location"
            aria-label={`Use my current location for ${label.toLowerCase()}`}
            className="locate-button"
          >
            ◎
          </button>
        )}
      </label>
      {open && suggestions.length > 0 && (
        <ul id={listId} role="listbox" className="place-suggestions">
          {suggestions.map((p, i) => (
            <li
              key={`${p.label}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "is-active" : undefined}
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
