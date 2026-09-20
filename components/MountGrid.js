"use client";

import { useMemo } from "react";
import { groupMounts } from "@/lib/groupMounts";
import MountIcon from "./MountIcon";

function PatchBlock({ patch, sources, ownedIds }) {
  return (
    <div className="patch-block">
      <h3 className="patch-heading">{patch}</h3>
      <div className="source-card-row">
        {sources.map(({ source, mounts }, i) => (
          <div className="source-card" key={source ?? i}>
            {source ? <h4 className="source-heading">{source}</h4> : null}
            <div className="mount-grid">
              {mounts.map((mount) => (
                <MountIcon key={mount.id} mount={mount} owned={ownedIds?.has(mount.id)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MountGrid({ mounts, ownedIds }) {
  const { expansions, crosscutSections } = useMemo(() => groupMounts(mounts), [mounts]);

  return (
    <div>
      {expansions.map(({ expansion, patches }) => (
        <section className="expansion-section" key={expansion}>
          <h2 className="expansion-heading">{expansion}</h2>
          {patches.map(({ patch, sources }) => (
            <PatchBlock key={patch} patch={patch} sources={sources} ownedIds={ownedIds} />
          ))}
        </section>
      ))}
      {crosscutSections.map(({ title, patches }) => (
        <section className="expansion-section crosscut-section" key={title}>
          <h2 className="expansion-heading">{title}</h2>
          {patches.map(({ patch, sources }) => (
            <PatchBlock key={patch} patch={patch} sources={sources} ownedIds={ownedIds} />
          ))}
        </section>
      ))}
    </div>
  );
}
