export function mountWowheadUrl(mount) {
  // wowheadCommentId replaces the plain link once populated (future feature):
  // deep-links straight to a comment with obtain-instructions for hard mounts.
  if (mount.wowheadCommentId) {
    return `https://www.wowhead.com/mount=${mount.wowheadId}#comments:id=${mount.wowheadCommentId}`;
  }
  if (mount.wowheadId) {
    return `https://www.wowhead.com/spell=${mount.wowheadId}`;
  }
  return `https://www.wowhead.com/mounts?filter=na=${encodeURIComponent(mount.name)}`;
}
