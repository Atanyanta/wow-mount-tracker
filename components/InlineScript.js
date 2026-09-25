"use client";

// Inline <script> that runs during HTML parsing (before first paint) without
// tripping React's dev-mode error "Encountered a script tag while rendering
// React component". The server emits a real script; on the client (hydration
// and any client-side re-render, e.g. hot-reload recovery) React sees an inert
// type="text/plain" script instead. suppressHydrationWarning accepts the
// resulting attribute difference.
// Pattern from node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md
export default function InlineScript({ html }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
