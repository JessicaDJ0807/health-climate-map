"use client";

// The walking profile from the design handoff, kept on this device only.
//
// There is no account and no server: everything below is written to
// localStorage and never leaves the phone. That is why there is no password
// field — one that authenticates nothing would teach people to type a real
// password into something that cannot protect it. See ProfileDrawer in
// HavenPlanner for the disclosure shown to the user.
import { useCallback, useSyncExternalStore } from "react";
import type { ProfileId } from "@/lib/trip/score";
import { SHOW_POLLEN } from "@/lib/trip/features";

const KEY = "havenpath-device-profile";

export type Mobility = "independent" | "moderate" | "limited";
export type Shade = "high" | "medium" | "low";
export type Rest = "frequent" | "sometimes" | "minimal";

export type DeviceProfile = {
  saved: boolean;
  name: string;
  email: string;
  age: number;
  mobility: Mobility;
  shadePreference: Shade;
  restPreference: Rest;
  asthma: boolean;
  heatSensitive: boolean;
  pollenSensitive: boolean;
};

export const EMPTY_PROFILE: DeviceProfile = {
  saved: false,
  name: "",
  email: "",
  age: 65,
  mobility: "independent",
  shadePreference: "high",
  restPreference: "sometimes",
  asthma: false,
  heatSensitive: true,
  pollenSensitive: false,
};

/**
 * Which scoring profile the saved preferences imply. Asthma outranks the rest
 * because its weighting is the most distinct; pollen only applies in season,
 * so it sits above heat but below asthma.
 */
export function profileIdFor(p: DeviceProfile): ProfileId {
  if (!p.saved) return "general";
  if (p.asthma) return "asthma";
  if (SHOW_POLLEN && p.pollenSensitive) return "allergy";
  if (p.heatSensitive || p.shadePreference === "high") return "heat";
  return "general";
}

/** One line naming what the saved preferences change about the ranking. */
export function profileInsight(p: DeviceProfile): string {
  if (!p.saved) return "Save a profile and HavenPath will rank every route against it.";
  const bits: string[] = [];
  if (p.asthma) bits.push("cleaner air and fewer truck routes");
  if (SHOW_POLLEN && p.pollenSensitive) bits.push("fewer wind-pollinated trees in season");
  if (p.heatSensitive || p.shadePreference === "high") bits.push("more shade and less direct sun");
  if (p.mobility === "limited" || p.restPreference === "frequent") bits.push("shorter walks");
  return bits.length
    ? `HavenPath will prioritize ${bits.join(", ")}.`
    : "Your preferences are used to rank and explain every route.";
}

// localStorage is an external store, so it is read through
// useSyncExternalStore rather than an effect: no cascading render, and the
// server snapshot is simply "no profile yet".
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedValue: DeviceProfile = EMPTY_PROFILE;

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // private window, or site data blocked
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Another tab editing the same profile should update this one.
  window.addEventListener("storage", cb);
  return () => { listeners.delete(cb); window.removeEventListener("storage", cb); };
}

/** Must return a stable reference while the stored string is unchanged. */
function getSnapshot(): DeviceProfile {
  const raw = read();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedValue = raw ? { ...EMPTY_PROFILE, ...JSON.parse(raw) } : EMPTY_PROFILE;
    } catch {
      cachedValue = EMPTY_PROFILE; // unreadable is the same as absent
    }
  }
  return cachedValue;
}

const getServerSnapshot = () => EMPTY_PROFILE;

function write(next: DeviceProfile | null) {
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // Preferences still apply for this session even if they can't persist.
  }
  // Keep the snapshot in step even when storage is unavailable.
  cachedRaw = next ? JSON.stringify(next) : null;
  cachedValue = next ?? EMPTY_PROFILE;
  for (const cb of listeners) cb();
}

export function useDeviceProfile() {
  const profile = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const save = useCallback((next: DeviceProfile) => write(next), []);
  const clear = useCallback(() => write(null), []);
  return { profile, save, clear };
}
