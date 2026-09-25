// Which Collection sections (expansions, plus the PvP / Trading Post
// sections) are collapsed. Persisted to localStorage as an array of section
// titles and exposed as an external store (useSyncExternalStore), so the
// grid re-renders on change and other open tabs stay in step. Sections are
// expanded by default, so server rendering (no storage) shows everything.

const STORAGE_KEY = "wow-mount-tracker:collapsed";
const EMPTY = [];

let collapsed = EMPTY;
let loaded = false;
const listeners = new Set();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(raw) ? raw.filter((t) => typeof t === "string") : EMPTY;
  } catch {
    return EMPTY;
  }
}

function commit(next) {
  collapsed = next;
  loaded = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable - still works for this session.
  }
  listeners.forEach((l) => l());
}

// The snapshot must be referentially stable, so `collapsed` is only replaced
// on a real change.
export function getSnapshot() {
  if (!loaded && typeof window !== "undefined") {
    collapsed = load();
    loaded = true;
  }
  return collapsed;
}

export function getServerSnapshot() {
  return EMPTY;
}

export function subscribe(listener) {
  listeners.add(listener);
  const onStorage = (e) => {
    if (e.key !== STORAGE_KEY) return;
    collapsed = load();
    listeners.forEach((l) => l());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function toggleSection(title) {
  const current = getSnapshot();
  commit(current.includes(title) ? current.filter((t) => t !== title) : [...current, title]);
}

// Collapse exactly the given titles (the sections currently on screen), keeping
// any remembered titles for sections that aren't shown right now.
export function collapseSections(titles) {
  commit([...new Set([...getSnapshot(), ...titles])]);
}

export function expandSections(titles) {
  const drop = new Set(titles);
  commit(getSnapshot().filter((t) => !drop.has(t)));
}
