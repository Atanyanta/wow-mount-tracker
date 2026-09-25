import { mountWowheadUrl } from "@/lib/wowhead";

// `owned` is three-state: true (collected), false (scanned character is
// missing it) and undefined/null (no scan yet - render neutrally, so a
// "dim the missing ones" style never greys out an unscanned catalog).
export default function MountIcon({ mount, owned }) {
  const wowheadUrl = mountWowheadUrl(mount);
  const state = owned ? " owned" : owned === false ? " unowned" : "";

  return (
    <a
      href={wowheadUrl}
      target="_blank"
      rel="noreferrer"
      className={`mount-icon-link${state}`}
      aria-label={owned ? `${mount.name} (collected)` : mount.name}
    >
      <span className="mount-icon-clip">
        {mount.icon ? <img src={mount.icon} alt={mount.name} loading="lazy" /> : null}
      </span>
      {owned ? (
        <span className="mount-owned-badge" aria-hidden="true">
          ✓
        </span>
      ) : null}
      <span className="mount-tooltip" role="tooltip">
        <span className="mount-tooltip-name">{mount.name}</span>
        {mount.description ? (
          <span className="mount-tooltip-desc">{mount.description}</span>
        ) : null}
        {mount.source ? <span className="mount-tooltip-source">{mount.source}</span> : null}
        {mount.patch ? <span className="mount-tooltip-patch">{mount.patch}</span> : null}
        {owned ? <span className="mount-tooltip-owned">✓ Collected</span> : null}
      </span>
    </a>
  );
}
