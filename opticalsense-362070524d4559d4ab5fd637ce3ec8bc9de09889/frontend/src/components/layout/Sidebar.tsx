import { Logo } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import { FileText, LayoutDashboard, Radio, Settings, Stethoscope, UsersRound } from "lucide-react";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/patients", label: "Patients", icon: UsersRound },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/devices", label: "Devices", icon: Radio },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside className="hidden w-64 shrink-0 border-r border-border/60 bg-sidebar lg:flex lg:flex-col">
      <div className="flex h-16 items-center border-b border-border/60 px-5">
        <Link to="/dashboard" className="flex items-center gap-2">
          <Logo />
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 p-3">
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = pathname === to || pathname.startsWith(to + "/");
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-brand/10 text-brand"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border/60 p-4">
        <div className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
          <Stethoscope className="h-4 w-4 text-brand" />
          <span>Clinical workspace</span>
        </div>
      </div>
    </aside>
  );
}
