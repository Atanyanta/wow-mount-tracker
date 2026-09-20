"use client";

const OPTIONS = [
  { value: "all", label: "All" },
  { value: "collected", label: "Collected" },
  { value: "uncollected", label: "Uncollected" },
];

export default function FilterBar({ filter, onFilterChange, disabled }) {
  return (
    <div className="filter-bar">
      {OPTIONS.map(({ value, label }) => (
        <label key={value} className={disabled && value !== "all" ? "disabled" : ""}>
          <input
            type="radio"
            name="collection-filter"
            value={value}
            checked={filter === value}
            disabled={disabled && value !== "all"}
            onChange={() => onFilterChange(value)}
          />
          {label}
        </label>
      ))}
      {disabled ? (
        <span className="filter-bar-hint">Scan a character to filter by collected/uncollected.</span>
      ) : null}
    </div>
  );
}
