"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { findRealm, getRealms, searchRealms, suggestRealms } from "@/lib/realms";

// Type-ahead realm picker (ARIA 1.2 combobox, "list" autocomplete).
//
// The value is the realm's text; whether it is a *real* realm is decided by
// findRealm(region, value) - the parent uses the same function at submit time,
// so there is no separate "selected" state to drift out of sync.
//
// Keyboard: type to filter; Down/Up move through the list; Enter picks the
// highlighted realm (or, with nothing highlighted, submits when the text is
// already an exact realm / picks the top match when it isn't); Escape closes;
// Tab leaves (and snaps an exact match to its proper spelling).
// Mouse: click a realm. Options use mousedown-preventDefault so the input
// keeps focus while you click.
export default function RealmCombobox({ region, value, onChange, placeholder = "Realm" }) {
  const listId = useId();
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);

  const hasList = getRealms(region).length > 0;
  const exact = useMemo(() => findRealm(region, value), [region, value]);
  // Once the text is exactly a realm, show the whole list (with that realm
  // marked) rather than a list of one - so switching realms is one click.
  const query = exact ? "" : value;
  // The biggest region has ~270 realms, so no cap is needed: the whole list scrolls.
  const matches = useMemo(() => searchRealms(region, query, 1000), [region, query]);
  const suggestions = useMemo(
    () => (value.trim() && !exact && matches.length === 0 ? suggestRealms(region, value) : []),
    [region, value, exact, matches.length]
  );
  const options = matches.length ? matches : suggestions;
  const invalid = hasList && !focused && value.trim() !== "" && !exact;

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.children[active + (matches.length ? 0 : 1)]?.scrollIntoView?.({ block: "nearest" });
  }, [active, open, matches.length]);

  function choose(realm) {
    onChange(realm.name);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e) {
    if (!hasList) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (!options.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a < 0 ? (step === 1 ? 0 : options.length - 1) : (a + step + options.length) % options.length));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && options[active]) {
        e.preventDefault();
        choose(options[active]);
      } else if (!exact && open && matches.length > 0) {
        e.preventDefault();
        choose(matches[0]); // accept the top suggestion; a second Enter submits
      } else {
        setOpen(false); // exact match (or nothing to pick): let the form submit
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    }
  }

  const statusText = !hasList
    ? ""
    : matches.length
      ? `${matches.length} realm${matches.length === 1 ? "" : "s"} available`
      : suggestions.length
        ? `No match. Did you mean ${suggestions.map((s) => s.name).join(", ")}?`
        : "No matching realm";

  return (
    <div className="realm-combobox">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={placeholder}
        aria-autocomplete="list"
        aria-expanded={open && hasList}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        value={value}
        // Browsers restore or autofill text into inputs (Firefox re-applies the
        // previous visit's value on reload); this list is the only suggestion
        // source we want, and stray restoration must not fight React.
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        suppressHydrationWarning
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => {
          setFocused(true);
          setOpen(true);
        }}
        // After picking a realm the input keeps focus (options don't steal it), so
        // focus can't reopen the list; clicking the field does.
        onClick={() => setOpen(true)}
        onBlur={() => {
          setFocused(false);
          setOpen(false);
          setActive(-1);
          // Snap an exact match to its proper spelling ("kel thuzad" -> "Kel'Thuzad").
          if (exact && exact.name !== value) onChange(exact.name);
        }}
        onKeyDown={onKeyDown}
      />
      {open && hasList ? (
        <ul className="realm-listbox" id={listId} role="listbox" aria-label={`${placeholder} suggestions`} ref={listRef}>
          {matches.length === 0 ? (
            <li className="realm-empty" role="presentation">
              {suggestions.length ? "No exact match - did you mean:" : `No realm matches "${value.trim()}"`}
            </li>
          ) : null}
          {options.map((realm, i) => (
            <li
              key={realm.slug}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={exact?.slug === realm.slug}
              className={`realm-option${i === active ? " active" : ""}${exact?.slug === realm.slug ? " current" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(realm)}
            >
              {realm.name}
            </li>
          ))}
        </ul>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">
        {open ? statusText : ""}
      </span>
    </div>
  );
}
