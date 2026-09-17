import { Bell, ChevronsLeft, ChevronsRight, FlaskConical, FolderKanban, LayoutDashboard, LogOut, Menu, Moon, Plug, ScrollText, Settings, ShieldCheck, Sun, Users, X, type LucideIcon } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { useToast } from "../components/ui/toast";

const items: Array<[string, string, LucideIcon]> = [
  ["Overview", "/app", LayoutDashboard],
  ["Projects", "/app/projects", FolderKanban],
  ["Experiments", "/app/experiments", FlaskConical],
  ["Certificates", "/app/certificates", ShieldCheck],
  ["Reports", "/app/reports", ScrollText],
  ["Integrations", "/app/integrations", Plug],
  ["Team", "/app/team", Users],
  ["Settings", "/app/settings/profile", Settings]
];

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: any; organization: any; membership: any }>("/auth/me"),
    retry: false
  });
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading) return <div className="min-h-screen p-6"><Skeleton className="h-96 w-full" /></div>;
  if (me.isError) return <Navigate to="/login" replace />;
  return children;
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem("patchwork-theme");
    return stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const crumbs = location.pathname.split("/").filter(Boolean).slice(1);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    window.localStorage.setItem("patchwork-theme", dark ? "dark" : "light");
  }, [dark]);

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    queryClient.clear();
    toast.show("Signed out");
    navigate("/login");
  }

  return (
    <div className="app-grid-bg min-h-screen bg-[var(--canvas)] text-[var(--text-primary)]">
      <aside
        className={`${mobile ? "fixed inset-y-0 left-0 z-50" : "hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:block"} ${collapsed ? "w-20" : "w-72"} border-r border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-inverse)_96%,transparent)] p-3 text-[var(--text-inverse)] shadow-[var(--shadow-overlay)] transition-all`}
      >
        <div className="flex h-12 items-center justify-between">
          <Link to="/app" className="flex items-center gap-3 text-sm font-black tracking-[0.12em]">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--accent)] text-white"><ShieldCheck className="h-5 w-5" /></span>
            {!collapsed && <span>PATCHWORK</span>}
          </Link>
          <Button variant="ghost" size="icon" className="text-white/70 hover:bg-white/10 hover:text-white lg:hidden" onClick={() => setMobile(false)}><X className="h-4 w-4" /></Button>
        </div>
        <nav className="mt-6 grid gap-1">
          {items.map(([label, href, Icon]) => (
            <NavLink
              key={href as string}
              to={href as string}
              end={href === "/app"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition ${isActive ? "bg-white text-neutral-950 shadow-sm" : "text-white/60 hover:bg-white/10 hover:text-white"}`
              }
              onClick={() => setMobile(false)}
            >
              <Icon className="h-4 w-4" />
              {!collapsed && label}
            </NavLink>
          ))}
        </nav>
        <div className={`${collapsed ? "hidden" : "block"} mt-6 rounded-lg border border-white/10 bg-white/[0.045] p-3`}>
          <div className="text-xs font-semibold uppercase text-white/40">Status</div>
          <div className="mt-2 flex items-center gap-2 text-sm font-semibold"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Ready</div>
        </div>
        <Button variant="ghost" size="sm" className="mt-4 hidden w-full text-white/70 hover:bg-white/10 hover:text-white lg:flex" onClick={() => setCollapsed((value) => !value)}>
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          {!collapsed && "Collapse"}
        </Button>
      </aside>
      {mobile && <div className="fixed inset-0 z-40 bg-neutral-950/45 lg:hidden" onClick={() => setMobile(false)} />}
      <div className={`${collapsed ? "lg:pl-20" : "lg:pl-72"}`}>
        <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] backdrop-blur-xl">
          <div className="flex h-16 items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobile(true)}><Menu className="h-5 w-5" /></Button>
              <div>
                <div className="text-xs font-semibold capitalize text-[var(--text-tertiary)]">
                  {crumbs.length ? crumbs.map((crumb) => crumb.replaceAll("-", " ")).join(" / ") : "overview"}
                </div>
                <div className="font-semibold text-[var(--text-primary)]">{me.data?.organization.name}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="hidden sm:inline-flex"><Bell className="mr-1 h-3 w-3 text-[var(--accent)]" /> 3 review items</Badge>
              <Button aria-label="Toggle dark mode" variant="ghost" size="icon" onClick={() => setDark((value) => !value)}>
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={logout}><LogOut className="h-4 w-4" /> Log out</Button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
