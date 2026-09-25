// Client-side theme state: which theme is active plus any per-axis overrides
// from the "Customize theme" panel. Persisted to localStorage, mirrored onto
// <html> as data-* attributes, and exposed as an external store so the
// switcher and the customize panel stay in sync (useSyncExternalStore).
//
// Stored shape: { theme: "<id>", overrides: { <axis>: "<option id>" } }
// Effective look = the theme's picks with overrides applied on top. Choosing a
// theme clears overrides, so a theme is always a clean bundle.
//
// app/layout.js has an inline script that does the same merge before first
// paint; keep the two in step.

import { CUSTOMIZER_ENABLED, THEMES, THEME_STORAGE_KEY, DEFAULT_THEME_ID, getTheme } from "@/lib/themes";
import { STYLE_AXES } from "@/lib/styleOptions";

const DEFAULT_STATE = { theme: DEFAULT_THEME_ID, overrides: {} };

let state = DEFAULT_STATE;
let loaded = false;
const listeners = new Set();

function sanitize(raw) {
  const theme = THEMES.some((t) => t.id === raw?.theme) ? raw.theme : DEFAULT_THEME_ID;
  const overrides = {};
  for (const axis of STYLE_AXES) {
    const value = raw?.overrides?.[axis.key];
    // Overrides only exist while the (normally hidden) Customize panel is on.
    if (CUSTOMIZER_ENABLED && axis.options.some((o) => o.id === value)) overrides[axis.key] = value;
  }
  return { theme, overrides };
}

function load() {
  try {
    return sanitize(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)));
  } catch {
    return DEFAULT_STATE;
  }
}

export function effectivePicks(s) {
  return { ...getTheme(s.theme).picks, ...s.overrides };
}

export function applyToDocument(s) {
  const root = document.documentElement;
  const picks = effectivePicks(s);
  for (const axis of STYLE_AXES) {
    const value = picks[axis.key];
    if (!value || value === "default") root.removeAttribute(`data-${axis.key}`);
    else root.setAttribute(`data-${axis.key}`, value);
  }
}

function notify() {
  listeners.forEach((l) => l());
}

function commit(next) {
  state = next;
  loaded = true;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable - the choice still applies for this session.
  }
  applyToDocument(next);
  notify();
}

// useSyncExternalStore hooks. The snapshot must be referentially stable, so
// `state` is only replaced on a real change.
export function getSnapshot() {
  if (!loaded && typeof window !== "undefined") {
    state = load();
    loaded = true;
  }
  return state;
}

export function getServerSnapshot() {
  return DEFAULT_STATE;
}

export function subscribe(listener) {
  listeners.add(listener);
  // Keep other open tabs in step.
  const onStorage = (e) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    state = load();
    applyToDocument(state);
    notify();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setTheme(id) {
  if (!THEMES.some((t) => t.id === id)) return;
  commit({ theme: id, overrides: {} });
}

export function setOverride(axisKey, optionId) {
  const current = getSnapshot();
  const overrides = { ...current.overrides };
  // Picking the theme's own value is the same as no override.
  if (getTheme(current.theme).picks[axisKey] === optionId) delete overrides[axisKey];
  else overrides[axisKey] = optionId;
  commit({ theme: current.theme, overrides });
}

export function resetOverrides() {
  commit({ theme: getSnapshot().theme, overrides: {} });
}
