export default function CollectionSummary({ total, collected, usable, unobtainableOwned, retiredCount }) {
  const retiredNote = retiredCount > 0 ? ` · ${retiredCount} retired not counted` : "";
  if (collected == null) {
    return (
      <p className="collection-summary">
        {total} obtainable mounts{retiredNote}
      </p>
    );
  }
  const pct = total ? Math.round((collected / total) * 100) : 0;
  return (
    <p className="collection-summary">
      {collected} / {total} mounts collected
      {unobtainableOwned > 0 ? ` (+${unobtainableOwned} unobtainable)` : ""} ({pct}%)
      {usable != null ? ` · ${usable} usable on this character` : " · rescan to see usable count"}
      {retiredNote}
    </p>
  );
}
