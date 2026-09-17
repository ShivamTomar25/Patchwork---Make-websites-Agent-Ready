import { ArrowRight, Menu, Moon, ShieldCheck, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { Button } from "../components/ui/button";

const nav = [
  ["Platform", "/platform"],
  ["How it works", "/how-it-works"],
  ["Research", "/research"],
  ["Pricing", "/pricing"],
  ["Docs", "/docs"]
];

export function PublicLayout() {
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem("patchwork-theme");
    return stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    window.localStorage.setItem("patchwork-theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <div className="min-h-screen text-[var(--text-primary)]">
      <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface)_84%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-3 text-sm font-black tracking-[0.12em]">
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-inverse)] text-[var(--text-inverse)] shadow-sm">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <span>PATCHWORK</span>
          </Link>
          <nav className="hidden items-center rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] p-1 shadow-sm md:flex">
            {nav.map(([label, href]) => (
              <NavLink key={href} to={href} className={({ isActive }) => `rounded-full px-3.5 py-2 text-sm font-semibold transition ${isActive ? "bg-[var(--surface-inverse)] text-[var(--text-inverse)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            <Button aria-label="Toggle dark mode" variant="ghost" size="icon" onClick={() => setDark((value) => !value)}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Link to="/login">
              <Button variant="ghost">Log in</Button>
            </Link>
            <Link to="/signup">
              <Button>Start workspace <ArrowRight className="h-4 w-4" /></Button>
            </Link>
          </div>
          <Button aria-label="Toggle navigation" variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen((value) => !value)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
        {open ? (
          <div className="border-t border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow-overlay)] md:hidden">
            <div className="grid gap-2">
              {nav.map(([label, href]) => (
                <Link key={href} to={href} className="rounded-md px-3 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]" onClick={() => setOpen(false)}>
                  {label}
                </Link>
              ))}
              <button className="rounded-md px-3 py-2 text-left text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]" onClick={() => setDark((value) => !value)}>
                {dark ? "Light mode" : "Dark mode"}
              </button>
              <Link to="/login" className="rounded-md px-3 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]" onClick={() => setOpen(false)}>
                Log in
              </Link>
              <Link to="/signup" onClick={() => setOpen(false)}>
                <Button className="w-full">Start workspace</Button>
              </Link>
            </div>
          </div>
        ) : null}
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="border-t border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface)_72%,transparent)]">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 text-sm text-[var(--text-secondary)] sm:px-6 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <div className="font-black tracking-[0.12em] text-[var(--text-primary)]">PATCHWORK</div>
            <p className="mt-3 max-w-sm leading-6">Test. Repair. Confirm.</p>
          </div>
          {["security", "privacy", "terms"].map((item) => (
            <Link key={item} to={`/${item}`} className="capitalize hover:text-[var(--text-primary)]">
              {item}
            </Link>
          ))}
        </div>
      </footer>
    </div>
  );
}
