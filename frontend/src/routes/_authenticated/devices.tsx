import { AppShell } from "@/components/layout/AppShell";
import { GlassCard } from "@/components/common/GlassCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getServices } from "@/services";
import { pairingSchema, type PairingFormValues } from "@/utils/validators";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { Battery, Cpu, Plus, RefreshCw, Signal, Trash2, Wifi } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/devices")({
  head: () => ({ meta: [{ title: "Devices — OpticalSense" }] }),
  component: DevicesPage,
});

function DevicesPage() {
  const services = getServices();
  const qc = useQueryClient();
  const { data: devices = [] } = useQuery({ queryKey: ["devices"], queryFn: () => services.devices.list() });
  const [pairOpen, setPairOpen] = useState(false);

  const refreshMut = useMutation({
    mutationFn: (id: string) => services.devices.refresh(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => services.devices.unpair(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Device unpaired");
    },
  });

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Paired ESP32 devices and their health.</p>
        <Button onClick={() => setPairOpen(true)} className="bg-brand-gradient text-white hover:opacity-95">
          <Plus className="mr-1 h-4 w-4" /> Pair device
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {devices.map((d) => (
          <GlassCard key={d.id}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-brand" />
                  <div className="font-medium">{d.name}</div>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{d.deviceId} · fw {d.firmware}</div>
              </div>
              <Badge className={d.online ? "bg-teal/15 text-teal" : "bg-muted text-muted-foreground"}>
                {d.online ? "Online" : "Offline"}
              </Badge>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2 text-center">
              <Stat icon={<Wifi className="h-3.5 w-3.5" />} label="WiFi" value={d.wifi.connected ? `${d.wifi.rssi} dBm` : "—"} />
              <Stat icon={<Signal className="h-3.5 w-3.5" />} label="Signal" value={`${d.signalStrength}%`} />
              <Stat icon={<Battery className="h-3.5 w-3.5" />} label="Battery" value={`${d.batteryPct}%`} />
              <Stat icon={<Cpu className="h-3.5 w-3.5" />} label="MQTT" value={d.mqtt} />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>Last seen {formatDistanceToNowStrict(new Date(d.lastSeen), { addSuffix: true })}</span>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => refreshMut.mutate(d.id)}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => removeMut.mutate(d.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      <PairDialog open={pairOpen} onOpenChange={setPairOpen} />
    </AppShell>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/60 p-2">
      <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">{icon}<span>{label}</span></div>
      <div className="mt-0.5 text-sm font-medium capitalize">{value}</div>
    </div>
  );
}

function PairDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const services = getServices();
  const qc = useQueryClient();
  const form = useForm<PairingFormValues>({ resolver: zodResolver(pairingSchema), defaultValues: { code: "" } });
  const mut = useMutation({
    mutationFn: (code: string) => services.devices.pair(code),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      toast.success(`Paired ${d.name}`);
      onOpenChange(false);
      form.reset();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Pairing failed"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pair a new device</DialogTitle>
          <DialogDescription>
            Enter the 6-digit code shown on the ESP32 display. The device will register itself with the workspace.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mut.mutate(v.code))} className="space-y-3">
          <div>
            <Label className="text-xs">Pairing code</Label>
            <Input className="mt-1 text-center font-mono text-lg tracking-widest" maxLength={6} {...form.register("code")} />
            {form.formState.errors.code && (
              <p className="mt-1 text-xs text-destructive">{form.formState.errors.code.message}</p>
            )}
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/50 p-3 text-xs text-muted-foreground">
            Tip: any 6 digits work in Demo Mode. In Live Mode this triggers an MQTT handshake with the device.
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="bg-brand-gradient text-white hover:opacity-95" disabled={mut.isPending}>
              {mut.isPending ? "Pairing…" : "Pair device"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
