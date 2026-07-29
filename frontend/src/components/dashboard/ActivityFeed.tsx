import { GlassCard } from "@/components/common/GlassCard";
import { timeAgo } from "@/utils/format";
import type { ActivityEvent } from "@/types";
import { Activity, FilePlus, Play, Radio, Square, UserPlus, WifiOff } from "lucide-react";

const ICON = {
  test_started: Play,
  test_stopped: Square,
  report_generated: FilePlus,
  patient_added: UserPlus,
  device_paired: Radio,
  device_online: Activity,
  device_offline: WifiOff,
} as const;

export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  return (
    <GlassCard padded={false}>
      <div className="border-b border-border/60 px-5 py-3">
        <div className="text-sm font-semibold">Recent Activity</div>
      </div>
      <ul className="divide-y divide-border/60">
        {events.length === 0 && (
          <li className="px-5 py-6 text-sm text-muted-foreground">No activity yet.</li>
        )}
        {events.map((e) => {
          const Icon = ICON[e.kind] ?? Activity;
          return (
            <li key={e.id} className="flex items-start gap-3 px-5 py-3">
              <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{e.message}</div>
                <div className="text-[11px] text-muted-foreground">{timeAgo(e.at)}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}
