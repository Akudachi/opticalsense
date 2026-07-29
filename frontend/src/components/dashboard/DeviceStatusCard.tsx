import { GlassCard } from "@/components/common/GlassCard";
import { Badge } from "@/components/ui/badge";
import type { Device } from "@/types";
import { formatDistanceToNowStrict } from "date-fns";
import { Battery, Radio, Wifi } from "lucide-react";

export function DeviceStatusCard({ device }: { device: Device | undefined }) {
  if (!device) {
    return (
      <GlassCard>
        <div className="text-sm text-muted-foreground">No device selected.</div>
      </GlassCard>
    );
  }
  return (
    <GlassCard>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-muted-foreground">Device</div>
          <div className="mt-0.5 font-medium">{device.name}</div>
          <div className="text-[11px] text-muted-foreground">{device.deviceId} · fw {device.firmware}</div>
        </div>
        <Badge
          variant="secondary"
          className={
            device.online
              ? "bg-teal/15 text-teal hover:bg-teal/15"
              : "bg-muted text-muted-foreground"
          }
        >
          {device.online ? "Online" : "Offline"}
        </Badge>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <Metric icon={<Wifi className="h-3.5 w-3.5" />} label="WiFi" value={`${device.wifi.rssi} dBm`} />
        <Metric icon={<Radio className="h-3.5 w-3.5" />} label="MQTT" value={device.mqtt} />
        <Metric icon={<Battery className="h-3.5 w-3.5" />} label="Battery" value={`${device.batteryPct}%`} />
      </div>
      <div className="mt-3 text-[11px] text-muted-foreground">
        Last seen {formatDistanceToNowStrict(new Date(device.lastSeen), { addSuffix: true })}
      </div>
    </GlassCard>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/60 px-2 py-2">
      <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-0.5 text-sm font-medium capitalize">{value}</div>
    </div>
  );
}
