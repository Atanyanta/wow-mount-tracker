"use client";

import SegmentedControl from "./SegmentedControl";
import Toggle from "./Toggle";

// `disabled`: no character scanned yet, so Collected / Uncollected can't apply.
export default function FilterBar({
  filter,
  onFilterChange,
  disabled,
  showRetired,
  onShowRetiredChange,
  onExpandAll,
  onCollapseAll,
}) {
  const options = [
    { value: "all", label: "All" },
    { value: "collected", label: "Collected", disabled },
    { value: "uncollected", label: "Uncollected", disabled },
  ];

  return (
    <div className="filter-bar">
      <div className="filter-group">
        <span className="filter-label">Show</span>
        <SegmentedControl
          name="collection-filter"
          label="Show mounts"
          options={options}
          value={filter}
          onChange={onFilterChange}
        />
      </div>
      <Toggle checked={showRetired} onChange={onShowRetiredChange}>
        Show retired
      </Toggle>
      <div className="filter-group filter-actions">
        <button type="button" className="filter-button expand" onClick={onExpandAll}>
          Expand all
        </button>
        <button type="button" className="filter-button collapse" onClick={onCollapseAll}>
          Collapse all
        </button>
      </div>
      {disabled ? (
        <p className="filter-bar-hint">Scan a character to filter by collected / uncollected.</p>
      ) : null}
    </div>
  );
}
