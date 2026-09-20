import { mountWowheadUrl } from "@/lib/wowhead";

export default function MountIcon({ mount, owned }) {
  const wowheadUrl = mountWowheadUrl(mount);

  return (
    <a
      href={wowheadUrl}
      target="_blank"
      rel="noreferrer"
      className={`mount-icon-link${owned ? " owned" : ""}`}
      aria-label={mount.name}
    >
      <span className="mount-icon-clip">
        {mount.icon ? <img src={mount.icon} alt={mount.name} loading="lazy" /> : null}
      </span>
      <span className="mount-tooltip" role="tooltip">
        <span className="mount-tooltip-name">{mount.name}</span>
        {mount.description ? (
          <span className="mount-tooltip-desc">{mount.description}</span>
        ) : null}
        {mount.source ? <span className="mount-tooltip-source">{mount.source}</span> : null}
        {mount.patch ? <span className="mount-tooltip-patch">{mount.patch}</span> : null}
      </span>
    </a>
  );
}
