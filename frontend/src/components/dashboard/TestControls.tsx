import { GlassCard } from "@/components/common/GlassCard";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDuration } from "@/utils/format";
import type { Device, Patient } from "@/types";
import { FileText, Play, Square } from "lucide-react";

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
  elapsedSec: number;
  onStart: () => void;
  onStop: () => void;
  onGenerateReport: () => void;
  canGenerate: boolean;
};

export function TestControls(p: Props) {
  const activeDevice = p.devices.find(d => d.id === p.deviceId);
  const isDeviceOnline = activeDevice?.online ?? false;
  
  return (
    <GlassCard>
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Test Session</div>
        <div className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs">
          {formatDuration(p.elapsedSec)}
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <div>
          <Label className="text-xs">Patient</Label>
          <Select value={p.patientId} onValueChange={p.onPatientChange} disabled={p.running}>
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
          <Select value={p.deviceId} onValueChange={p.onDeviceChange} disabled={p.running}>
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
        {!p.running ? (
          <Button
            className="col-span-2 bg-brand-gradient text-white shadow-glow hover:opacity-95"
            onClick={p.onStart}
            disabled={!p.patientId || !p.deviceId || !isDeviceOnline}
          >
            <Play className="mr-2 h-4 w-4" /> Start Test
          </Button>
        ) : (
          <Button className="col-span-2" variant="destructive" onClick={p.onStop}>
            <Square className="mr-2 h-4 w-4" /> Stop Test
          </Button>
        )}
        <Button variant="outline" onClick={p.onGenerateReport} disabled={!p.canGenerate} className="col-span-2">
          <FileText className="mr-2 h-4 w-4" /> Generate report from last test
        </Button>
      </div>
    </GlassCard>
  );
}
