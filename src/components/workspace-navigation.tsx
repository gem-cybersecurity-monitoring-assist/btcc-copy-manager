"use client";

import { usePathname } from "next/navigation";
import "./workspace-navigation.css";

/**
 * Consistent cross-dashboard navigation. Internal workspace tabs remain in
 * CopyCenterWorkspace; this header connects routes without replacing controls.
 */
const sections = [
  { href: "/copy-center", label: "Home", path: "/copy-center" },
  { href: "/copy-center?view=providers", label: "Accounts", path: "/copy-center" },
  { href: "/copy-trading", label: "Traders", path: "/copy-trading" },
  { href: "/opportunities", label: "Opportunities", path: "/opportunities" },
  { href: "/copy-center?view=performance", label: "Performance", path: "/copy-center" },
  { href: "/copy-center?view=portfolio", label: "Positions", path: "/copy-center" },
  { href: "/automation", label: "Automation", path: "/automation" },
] as const;

const tools = [
  { href: "/purchase", label: "Purchase console" },
  { href: "/steel", label: "Browser session controls" },
  { href: "/copy-center/positions", label: "Local paper positions" },
];

export function WorkspaceNavigation() {
  const path = usePathname();
  if (!path || path === "/copy-center") return null;
  if (["/account", "/sign-in", "/forgot-password", "/reset-password"].includes(path)) return (
    <header className="gem-route-header">
      <div className="gem-route-header-inner">
        <a className="gem-route-brand" href="/sign-in" aria-label="GEM Copy Center sign in">
          <span aria-hidden="true" className="gem-route-mark">G</span>
          <span>GEM <small>Copy Center</small></span>
        </a>
      </div>
    </header>
  );
  return (
    <header className="gem-route-header">
      <div className="gem-route-header-inner">
        <a className="gem-route-brand" href="/copy-center" aria-label="GEM Copy Center home">
          <span aria-hidden="true" className="gem-route-mark">G</span>
          <span>GEM <small>Copy Center</small></span>
        </a>
        <nav className="gem-route-links" aria-label="GEM workspace pages">
          {sections.map(item => (
            <a href={item.href} key={item.label}
              aria-current={path === item.path && (path !== "/copy-center" || item.label === "Home") ? "page" : undefined}>
              {item.label}
            </a>
          ))}
        </nav>
        <details className="gem-route-more">
          <summary>More tools</summary>
          <div className="gem-route-more-panel">
            {tools.map(item => <a key={item.href} href={item.href} aria-current={path === item.href ? "page" : undefined}>{item.label}</a>)}
          </div>
        </details>
      </div>
    </header>
  );
}
