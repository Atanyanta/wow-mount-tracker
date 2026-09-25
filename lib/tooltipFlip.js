// Tooltips are anchored to the icon's left edge (globals.css), which pushes them
// off-screen for icons in the right-hand ~250px of the window. This is attached
// once per container (MountGrid, DailiesView) as a delegated onMouseOver /
// onFocus handler - not per icon - and flips the hovered icon's tooltip to
// right-aligned when it would overflow on the right but fits on the left.
const TOOLTIP_WIDTH = 240 + 12; // .mount-tooltip max-width + a little slack

export function flipTooltip(event) {
  const link = event.target?.closest?.(".mount-icon-link");
  if (!link) return;
  const rect = link.getBoundingClientRect();
  const overflowsRight = rect.left + TOOLTIP_WIDTH > window.innerWidth;
  const fitsOnLeft = rect.right - TOOLTIP_WIDTH >= 0;
  link.classList.toggle("tip-right", overflowsRight && fitsOnLeft);
}
