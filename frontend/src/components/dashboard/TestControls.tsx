import { GlassCard } from "@/components/common/GlassCard";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { formatDuration } from "@/utils/format";
import type { Device, Patient } from "@/types";
import { AlertTriangle, FileText, Loader2, Play, Square } from "lucide-react";

type Props = {
  patients: Patient[];
  devices: Device[];
  patientId?: string;
  deviceId?: string;
  toothOfInterest?: string;
  onPatientChange: (id: string) => void;
  onDeviceChange: (id: string) => void;
  onToothChange: (t: string) => void;
  running: boolean;
  finishing?: boolean;
  isButtonTesting?: boolean;
  elapsedSec: number;
  onStart: () => void;
  onStop: () => void;
  onGenerateReport: () => void;
  canGenerate: boolean;
};

export function TestControls(p: Props) {
  const activeDevice = p.devices.find(d => d.id === p.deviceId);
  const isDeviceOnline = activeDevice?.online ?? false;
  const isControlsLocked = p.running || p.finishing || p.isButtonTesting;
  
  return (
    <GlassCard>
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Test Session</div>
        <div className="rounded-full bg-muted px-2.5 py-0.5 font-mono text-xs font-medium">
          {formatDuration(p.elapsedSec)}
        </div>
      </div>

      {p.isButtonTesting && (
        <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div>
            <div className="font-semibold">Test running on device (button)</div>
            <div className="mt-0.5 text-[11px] opacity-90">Please refer to the device screen. Controls will re-enable once complete.</div>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3">
        <div>
          <Label className="text-xs">Patient</Label>
          <Select value={p.patientId} onValueChange={p.onPatientChange} disabled={isControlsLocked}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Select patient" /></SelectTrigger>
            <SelectContent>
              {p.patients.map((pt) => (
                <SelectItem key={pt.id} value={pt.id}>{pt.fullName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Device</Label>
          <Select value={p.deviceId} onValueChange={p.onDeviceChange} disabled={isControlsLocked}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Select device" /></SelectTrigger>
            <SelectContent>
              {p.devices.map((d) => (
                <SelectItem key={d.id} value={d.id} disabled={!d.online}>
                  {d.name} {!d.online && "· offline"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {!p.running && !p.finishing ? (
          <Button
            className="col-span-2 bg-brand-gradient text-white shadow-glow hover:opacity-95"
            onClick={p.onStart}
            disabled={!p.patientId || !p.deviceId || !isDeviceOnline || p.isButtonTesting}
          >
            <Play className="mr-2 h-4 w-4" /> Start Test
          </Button>
        ) : p.finishing ? (
          <Button className="col-span-2" variant="destructive" disabled>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Finishing...
          </Button>
        ) : (
          <Button className="col-span-2" variant="destructive" onClick={p.onStop}>
            <Square className="mr-2 h-4 w-4" /> Stop Test
          </Button>
        )}
        <Button variant="outline" onClick={p.onGenerateReport} disabled={!p.canGenerate || p.running || p.finishing} className="col-span-2">
          <FileText className="mr-2 h-4 w-4" /> Generate report from last test
        </Button>
      </div>
    </GlassCard>
  );
}
