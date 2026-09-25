"use client";

import { useLayoutEffect, useRef } from "react";

// Pill-style choice of one option out of a few. Real radio inputs under the
// styling, so arrow keys and screen readers work; the look is in themes.css.
// options: [{ value, label, disabled? }]
//
// Hydration hardening: the server always renders these inputs in their "no
// scan yet" state (Collected / Uncollected disabled). Some browsers restore a
// form control's previous-visit state onto freshly parsed HTML on reload (e.g.
// Firefox re-applies "enabled" from the last page view), and extensions can
// edit inputs too - either makes the DOM differ from the server HTML before
// React hydrates, which React reports as a hydration mismatch.
//  - autoComplete="off" tells the browser not to restore state onto them.
//  - suppressHydrationWarning tolerates any remaining external change to the
//    input attributes, and the layout effect below then re-applies the real
//    `disabled` state so the DOM never stays wrong.
export default function SegmentedControl({ name, label, options, value, onChange }) {
  const groupRef = useRef(null);

  useLayoutEffect(() => {
    const inputs = groupRef.current?.querySelectorAll("input") ?? [];
    inputs.forEach((input, i) => {
      input.disabled = !!options[i]?.disabled;
    });
  });

  return (
    <div className="segmented" role="radiogroup" aria-label={label} ref={groupRef}>
      {options.map((option) => (
        <label key={option.value} className="segment">
          <input
            type="radio"
            className="segment-input"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={option.disabled}
            autoComplete="off"
            suppressHydrationWarning
            onChange={() => onChange(option.value)}
          />
          <span className="segment-text">{option.label}</span>
        </label>
      ))}
    </div>
  );
}
