import "./globals.css";
import "./themes.css";
import InlineScript from "@/components/InlineScript";
import StylePicker from "@/components/StylePicker";
import ThemeSync from "@/components/ThemeSync";
import { STYLE_AXES } from "@/lib/styleOptions";
import {
  CUSTOMIZER_ENABLED,
  DEFAULT_THEME_ID,
  THEMES,
  THEME_STORAGE_KEY,
  getTheme,
  picksToAttributes,
} from "@/lib/themes";

export const metadata = {
  title: "Mount Tracker",
  description: "A World of Warcraft mount collection tracker.",
};

// The default theme is rendered straight onto <html> on the server, so a
// first-time visitor never sees an unthemed page. A returning visitor's saved
// theme is applied by the inline script below during HTML parsing (before
// first paint) - same merge as lib/themeStore.js: theme picks, then overrides.
// See node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md
const APPLY_THEME_SCRIPT = `(function(){try{var T=${JSON.stringify(
  Object.fromEntries(THEMES.map((t) => [t.id, t.picks]))
)},K=${JSON.stringify(STYLE_AXES.map((a) => a.key))},s={};try{s=JSON.parse(localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)}))||{}}catch(e){}var p=T[s.theme]||T[${JSON.stringify(DEFAULT_THEME_ID)}],o=(${JSON.stringify(CUSTOMIZER_ENABLED)}&&s.overrides)||{},r=document.documentElement;K.forEach(function(k){var v=/^[a-z]+$/.test(o[k]||"")?o[k]:p[k];if(!v||v==="default")r.removeAttribute("data-"+k);else r.setAttribute("data-"+k,v)})}catch(e){}})()`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning {...picksToAttributes(getTheme(DEFAULT_THEME_ID).picks)}>
      <head>
        <InlineScript html={APPLY_THEME_SCRIPT} />
      </head>
      <body>
        {children}
        <ThemeSync />
        {CUSTOMIZER_ENABLED ? <StylePicker /> : null}
        <footer className="site-disclaimer">
          This site was built with the assistance of AI (Claude Code). Mount
          data and tooltips are sourced from{" "}
          <a href="https://www.wowhead.com" target="_blank" rel="noreferrer">
            Wowhead
          </a>{" "}
          and{" "}
          <a href="https://www.warcraftmounts.com" target="_blank" rel="noreferrer">
            Warcraft Mounts
          </a>
          .
        </footer>
      </body>
    </html>
  );
}
