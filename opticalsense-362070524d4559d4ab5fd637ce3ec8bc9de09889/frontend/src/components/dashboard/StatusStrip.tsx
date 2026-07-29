import { GlassCard } from "@/components/common/GlassCard";
import { cn } from "@/lib/utils";
import type { ConnectionStatus, SystemStatus } from "@/types";
import { Cpu, Database, Radio, Server } from "lucide-react";

const LABEL: Record<keyof SystemStatus, string> = {
  backend: "Backend",
  mqtt: "MQTT",
  database: "Database",
  device: "ESP32",
};

const ICON = { backend: Server, mqtt: Radio, database: Database, device: Cpu } as const;

const DOT: Record<ConnectionStatus, string> = {
  connected: "bg-teal animate-pulse-glow",
  connecting: "bg-amber-400 animate-pulse",
  disconnected: "bg-muted-foreground/60",
  error: "bg-destructive",
};

const LABEL_TEXT: Record<ConnectionStatus, string> = {
  connected: "Online",
  connecting: "Connecting",
  disconnected: "Offline",
  error: "Error",
};

export function StatusStrip({ status }: { status: SystemStatus }) {
  const entries = Object.entries(status) as Array<[keyof SystemStatus, ConnectionStatus]>;
  return (
    <GlassCard padded={false} className="p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {entries.map(([k, v]) => {
          const Icon = ICON[k];
          return (
            <div key={k} className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/60 px-3 py-2.5">
              <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand")}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-muted-foreground">{LABEL[k]}</div>
                <div className="text-sm font-medium">{LABEL_TEXT[v]}</div>
              </div>
              <span className={cn("h-2 w-2 rounded-full", DOT[v])} />
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
