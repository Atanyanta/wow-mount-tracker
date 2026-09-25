// Which collapsible sections are collapsed. Persisted to localStorage as an
// array of section keys and exposed as an external store
// (useSyncExternalStore), so views re-render on change and other open tabs stay
// in step. Sections are expanded by default, so server rendering (no storage)
// shows everything.
//
// One store per view: the Collection grid (expansion / PvP / Trading Post
// titles - the default exports below) and the Quest Log categories
// (`questLogCollapse`).

const EMPTY = [];

export function createCollapseStore(storageKey) {
  let collapsed = EMPTY;
  let loaded = false;
  const listeners = new Set();

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey));
      return Array.isArray(raw) ? raw.filter((t) => typeof t === "string") : EMPTY;
    } catch {
      return EMPTY;
    }
  }

  function commit(next) {
    collapsed = next;
    loaded = true;
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Storage unavailable - still works for this session.
    }
    listeners.forEach((l) => l());
  }

  // The snapshot must be referentially stable, so `collapsed` is only replaced
  // on a real change.
  function getSnapshot() {
    if (!loaded && typeof window !== "undefined") {
      collapsed = load();
      loaded = true;
    }
    return collapsed;
  }

  function getServerSnapshot() {
    return EMPTY;
  }

  function subscribe(listener) {
    listeners.add(listener);
    const onStorage = (e) => {
      if (e.key !== storageKey) return;
      collapsed = load();
      listeners.forEach((l) => l());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  function toggleSection(key) {
    const current = getSnapshot();
    commit(current.includes(key) ? current.filter((t) => t !== key) : [...current, key]);
  }

  // Collapse exactly the given keys (the sections currently on screen), keeping
  // any remembered keys for sections that aren't shown right now.
  function collapseSections(keys) {
    commit([...new Set([...getSnapshot(), ...keys])]);
  }

  function expandSections(keys) {
    const drop = new Set(keys);
    commit(getSnapshot().filter((t) => !drop.has(t)));
  }

  return { getSnapshot, getServerSnapshot, subscribe, toggleSection, collapseSections, expandSections };
}

const collectionCollapse = createCollapseStore("wow-mount-tracker:collapsed");
export const {
  getSnapshot,
  getServerSnapshot,
  subscribe,
  toggleSection,
  collapseSections,
  expandSections,
} = collectionCollapse;

export const questLogCollapse = createCollapseStore("wow-mount-tracker:quest-log-collapsed");
