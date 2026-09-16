import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col h-full overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">{children}</main>
      </div>
    </div>
  );
}
