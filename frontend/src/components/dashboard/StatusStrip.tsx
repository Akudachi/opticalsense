import { GlassCard } from "@/components/common/GlassCard";
import { cn } from "@/lib/utils";
import type { SystemStatus } from "@/types";
import { Radio, Cpu, Clock } from "lucide-react";

const STATUS_ITEMS = [
  {
    key: 'connection',
    label: 'MQTT Connection',
    icon: Radio,
    getValue: (status: SystemStatus) => status.connected ? 'Connected' : 'Disconnected',
    getStatus: (status: SystemStatus): 'connected' | 'disconnected' => status.connected ? 'connected' : 'disconnected',
  },
  {
    key: 'devices',
    label: 'Devices Online',
    icon: Cpu,
    getValue: (status: SystemStatus) => status.devicesOnline.toString(),
    getStatus: (status: SystemStatus): 'connected' | 'disconnected' => status.devicesOnline > 0 ? 'connected' : 'disconnected',
  },
  {
    key: 'lastUpdate',
    label: 'Last Update',
    icon: Clock,
    getValue: (status: SystemStatus) => {
      const date = new Date(status.lastUpdate);
      return date.toLocaleTimeString();
    },
    getStatus: (): 'connected' | 'disconnected' => 'connected',
  },
] as const;

const DOT: Record<'connected' | 'disconnected', string> = {
  connected: "bg-teal animate-pulse-glow",
  disconnected: "bg-muted-foreground/60",
};

export function StatusStrip({ status }: { status: SystemStatus }) {
  return (
    <GlassCard padded={false} className="p-3 sm:p-4">
      <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {STATUS_ITEMS.map((item) => {
          const Icon = item.icon;
          const itemStatus = item.getStatus(status);
          return (
            <div key={item.key} className="flex items-center gap-2.5 sm:gap-3 rounded-xl border border-border/50 bg-background/60 px-3 py-2 sm:py-2.5">
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand")}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-muted-foreground truncate">{item.label}</div>
                <div className="text-sm font-medium truncate">{item.getValue(status)}</div>
              </div>
              <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[itemStatus])} />
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
