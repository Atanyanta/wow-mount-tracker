"use client";

import { useLayoutEffect } from "react";
import { applyToDocument, getSnapshot } from "@/lib/themeStore";

// Renders nothing. The inline script in layout.js applies the saved theme
// during HTML parsing; this re-applies it once React has mounted, because
// React's dev-mode remount resets <html> to the attributes managed in JSX
// (see node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md).
export default function ThemeSync() {
  useLayoutEffect(() => {
    applyToDocument(getSnapshot());
  }, []);
  return null;
}
