"use client";

import { useSyncExternalStore } from "react";
import { THEMES, getTheme } from "@/lib/themes";
import { getServerSnapshot, getSnapshot, setTheme, subscribe } from "@/lib/themeStore";

// Round colour chips (background / accent split) in the header. The theme
// bundles themselves live in lib/themes.js.
export default function ThemeSwitcher() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const current = getTheme(state.theme);

  return (
    <div className="theme-switcher" role="radiogroup" aria-label="Theme">
      <span className="theme-switcher-name" aria-live="polite">
        {current.label}
        {Object.keys(state.overrides).length > 0 ? " (customized)" : ""}
      </span>
      {THEMES.map((theme) => (
        <button
          key={theme.id}
          type="button"
          role="radio"
          aria-checked={theme.id === state.theme}
          aria-label={theme.label}
          title={theme.label}
          className="theme-chip"
          style={{ "--chip-bg": theme.swatch[0], "--chip-accent": theme.swatch[1] }}
          onClick={() => setTheme(theme.id)}
        />
      ))}
    </div>
  );
}
