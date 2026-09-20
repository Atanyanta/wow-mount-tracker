import "./globals.css";

export const metadata = {
  title: "Mount Tracker",
  description: "A World of Warcraft mount collection tracker.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
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
