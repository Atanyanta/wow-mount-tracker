"use client";

// On/off switch. A real checkbox (role="switch") under the styling, so
// keyboard, focus and screen readers work; the look is in themes.css.
export default function Toggle({ checked, onChange, disabled = false, children }) {
  return (
    <label className={`toggle${disabled ? " disabled" : ""}`}>
      <input
        type="checkbox"
        role="switch"
        className="toggle-input"
        checked={checked}
        disabled={disabled}
        // Keep browsers from restoring a previous visit's state onto the
        // server HTML before hydration (see SegmentedControl).
        autoComplete="off"
        suppressHydrationWarning
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-knob" />
      </span>
      <span className="toggle-label">{children}</span>
    </label>
  );
}
