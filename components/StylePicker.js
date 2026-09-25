"use client";

import { useState, useSyncExternalStore } from "react";
import { STYLE_AXES } from "@/lib/styleOptions";
import { getTheme } from "@/lib/themes";
import {
  effectivePicks,
  getServerSnapshot,
  getSnapshot,
  resetOverrides,
  setOverride,
  subscribe,
} from "@/lib/themeStore";

function describe(themeLabel, picks) {
  return `theme=${themeLabel}; ` + STYLE_AXES.map((a) => `${a.key}=${picks[a.key]}`).join(", ");
}

// Design-time scaffolding: try individual axis options on top of the active
// theme, then copy the winning values into that theme's `picks` in
// lib/themes.js. Delete this (and the import in layout.js) once the theme
// bundles are settled.
export default function StylePicker() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const theme = getTheme(state.theme);
  const picks = effectivePicks(state);
  const customized = Object.keys(state.overrides).length > 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(describe(theme.label, picks));
      setCopied(true);
    } catch {
      // Clipboard blocked - the text is shown above so it can be selected by hand.
    }
  }

  return (
    <div className="style-picker">
      {open ? (
        <div className="style-picker-panel" role="dialog" aria-label="Customize theme">
          <div className="style-picker-head">
            <strong>Customize: {theme.label}</strong>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close customize panel">
              ×
            </button>
          </div>
          <p className="style-picker-hint">
            Tries options on top of the active theme (dashed = the theme&apos;s own choice). Picking a
            different theme in the header starts over.
          </p>

          {STYLE_AXES.map((axis) => (
            <div className="style-picker-group" key={axis.key}>
              <span className="style-picker-label">{axis.label}</span>
              <div className="style-picker-choices">
                {axis.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={picks[axis.key] === option.id}
                    className={theme.picks[axis.key] === option.id ? "is-theme-default" : ""}
                    onClick={() => {
                      setCopied(false);
                      setOverride(axis.key, option.id);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="style-picker-group">
            <span className="style-picker-label">Current mix</span>
            <code className="style-picker-mix">{describe(theme.label, picks)}</code>
            <div className="style-picker-choices">
              <button type="button" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </button>
              <button type="button" onClick={resetOverrides} disabled={!customized}>
                Reset to theme defaults
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <button type="button" className="style-picker-toggle" onClick={() => setOpen((o) => !o)}>
        Customize{customized ? " •" : ""}
      </button>
    </div>
  );
}
