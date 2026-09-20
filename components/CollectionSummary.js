export default function CollectionSummary({ total, collected, unobtainableOwned }) {
  if (collected == null) {
    return <p className="collection-summary">{total} mounts available</p>;
  }
  const pct = total ? Math.round((collected / total) * 100) : 0;
  return (
    <p className="collection-summary">
      {collected} / {total} mounts collected
      {unobtainableOwned > 0 ? ` (+${unobtainableOwned} unobtainable)` : ""} ({pct}%)
    </p>
  );
}
