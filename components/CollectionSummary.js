import { toSlug } from "@/lib/slug";

// Rankings (world/region/server) can't be computed from Blizzard's API - the
// sites that show them (missingmounts.com, Data for Azeroth) rank only
// characters *their own users* scanned/uploaded. So instead of faking a rank,
// link out to the character's page there. URL shape confirmed for missingmounts:
// /<region>/<realm-slug>/<character-slug>.
function rankingsUrl(character) {
  if (!character?.realm?.trim() || !character?.name?.trim()) return null;
  return `https://www.missingmounts.com/${character.region}/${toSlug(character.realm)}/${toSlug(character.name)}`;
}

export default function CollectionSummary({
  total,
  collected,
  usable,
  unobtainableOwned,
  retiredCount,
  character,
}) {
  const retiredNote = retiredCount > 0 ? ` · ${retiredCount} retired not counted` : "";
  if (collected == null) {
    return (
      <p className="collection-summary">
        {total} obtainable mounts{retiredNote}
      </p>
    );
  }
  const pct = total ? Math.round((collected / total) * 100) : 0;
  const url = rankingsUrl(character);
  return (
    <p className="collection-summary">
      {collected} / {total} mounts collected
      {unobtainableOwned > 0 ? ` (+${unobtainableOwned} unobtainable)` : ""} ({pct}%)
      {usable != null ? ` · ${usable} usable on this character` : " · rescan to see usable count"}
      {retiredNote}
      {url ? (
        <>
          {" · "}
          <a className="summary-link" href={url} target="_blank" rel="noreferrer">
            rankings on missingmounts.com
          </a>
        </>
      ) : null}
    </p>
  );
}
