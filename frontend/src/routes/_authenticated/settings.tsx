import { AppShell } from "@/components/layout/AppShell";
import { GlassCard } from "@/components/common/GlassCard";
import { LogoMark } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { env } from "@/config/env";
import { getServices } from "@/services";
import { clinicSchema, type ClinicFormValues } from "@/utils/validators";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Building2, Cpu, Database, Key, Palette, Radio, UserCog } from "lucide-react";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — OpticalSense" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <AppShell>
      <Tabs defaultValue="clinic" className="space-y-6">
        <TabsList className="flex flex-wrap gap-2 bg-transparent p-0">
          <Tab value="clinic" icon={<Building2 className="h-4 w-4" />} label="Clinic" />
          <Tab value="account" icon={<UserCog className="h-4 w-4" />} label="Account" />
          <Tab value="theme" icon={<Palette className="h-4 w-4" />} label="Appearance" />
          <Tab value="mqtt" icon={<Radio className="h-4 w-4" />} label="MQTT" />
          <Tab value="db" icon={<Database className="h-4 w-4" />} label="Database" />
          <Tab value="device" icon={<Cpu className="h-4 w-4" />} label="Device defaults" />
          <Tab value="api" icon={<Key className="h-4 w-4" />} label="API keys" />
        </TabsList>

        <TabsContent value="clinic"><ClinicSettings /></TabsContent>
        <TabsContent value="account"><AccountSettings /></TabsContent>
        <TabsContent value="theme"><ThemeSettings /></TabsContent>
        <TabsContent value="mqtt"><MqttSettings /></TabsContent>
        <TabsContent value="db"><DbSettings /></TabsContent>
        <TabsContent value="device"><DeviceSettings /></TabsContent>
        <TabsContent value="api"><ApiSettings /></TabsContent>
      </Tabs>
    </AppShell>
  );
}

function Tab({ value, icon, label }: { value: string; icon: React.ReactNode; label: string }) {
  return (
    <TabsTrigger value={value} className="gap-2 rounded-xl border border-border/60 bg-glass px-3 py-2 data-[state=active]:bg-brand/10 data-[state=active]:text-brand">
      {icon} {label}
    </TabsTrigger>
  );
}

function ClinicSettings() {
  const services = getServices();
  const qc = useQueryClient();
  const { data: clinic } = useQuery({ queryKey: ["clinic"], queryFn: () => services.clinic.get() });
  const form = useForm<ClinicFormValues>({
    resolver: zodResolver(clinicSchema),
    defaultValues: { name: "", doctorName: "", address: "", phone: "", email: "", licenseNo: "", logoDataUrl: "" },
  });
  useEffect(() => { if (clinic) form.reset(clinic); }, [clinic, form]);
  const fileRef = useRef<HTMLInputElement>(null);

  const mut = useMutation({
    mutationFn: (v: ClinicFormValues) => services.clinic.update(v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clinic"] });
      toast.success("Clinic settings saved");
    },
  });

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 200_000) { toast.error("Logo must be under 200 KB"); return; }
    const reader = new FileReader();
    reader.onload = () => form.setValue("logoDataUrl", String(reader.result));
    reader.readAsDataURL(f);
  }

  const logo = form.watch("logoDataUrl");
  return (
    <GlassCard>
      <div className="mb-4 flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-white">
          {logo ? <img src={logo} alt="Clinic logo" className="max-h-full max-w-full" /> : <LogoMark size={36} />}
        </div>
        <div>
          <div className="font-medium">Clinic branding</div>
          <p className="text-xs text-muted-foreground">These details appear at the top of every generated report.</p>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>Upload logo</Button>
            {logo && <Button size="sm" variant="ghost" onClick={() => form.setValue("logoDataUrl", "")}>Remove</Button>}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
          </div>
        </div>
      </div>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => mut.mutate(v))}>
        <Field label="Clinic name" error={form.formState.errors.name?.message}><Input {...form.register("name")} /></Field>
        <Field label="Doctor name" error={form.formState.errors.doctorName?.message}><Input {...form.register("doctorName")} /></Field>
        <Field label="Email" error={form.formState.errors.email?.message}><Input type="email" {...form.register("email")} /></Field>
        <Field label="Phone" error={form.formState.errors.phone?.message}><Input {...form.register("phone")} /></Field>
        <div className="sm:col-span-2"><Field label="Address" error={form.formState.errors.address?.message}><Textarea rows={2} {...form.register("address")} /></Field></div>
        <Field label="License number"><Input {...form.register("licenseNo")} /></Field>
        <div className="sm:col-span-2 flex justify-end">
          <Button type="submit" className="bg-brand-gradient text-white hover:opacity-95" disabled={mut.isPending}>
            Save clinic settings
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}

function AccountSettings() {
  const { user } = useAuth();
  return (
    <GlassCard>
      <div className="text-sm font-semibold">Account</div>
      <p className="mt-1 text-xs text-muted-foreground">Editing account details is available in Live Mode with backend auth.</p>
      <div className="mt-4 space-y-3">
        <Field label="Full name"><Input value={user?.fullName ?? ""} readOnly /></Field>
        <Field label="Email"><Input value={user?.email ?? ""} readOnly /></Field>
        <Field label="Role"><Input value={user?.role ?? ""} readOnly className="capitalize" /></Field>
      </div>
    </GlassCard>
  );
}

function ThemeSettings() {
  const { theme, setTheme } = useTheme();
  return (
    <GlassCard>
      <div className="text-sm font-semibold">Appearance</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {(["light", "dark", "system"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTheme(t)}
            className={
              "rounded-xl border p-4 text-left transition-colors " +
              (theme === t ? "border-brand bg-brand/5" : "border-border/60 hover:bg-accent")
            }
          >
            <div className="text-sm font-medium capitalize">{t}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t === "system" ? "Follow OS preference" : t === "light" ? "Bright clinical" : "Low-light operatory"}
            </div>
          </button>
        ))}
      </div>
    </GlassCard>
  );
}

function MqttSettings() {
  return (
    <GlassCard>
      <div className="text-sm font-semibold">MQTT (HiveMQ Cloud)</div>
      <p className="mt-1 text-xs text-muted-foreground">Values read from environment variables. Set them in your .env to enable Live Mode.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Ro label="Host" v={env.MQTT.host || "— not set —"} />
        <Ro label="Port" v={String(env.MQTT.port)} />
        <Ro label="Username" v={env.MQTT.username ? "•".repeat(env.MQTT.username.length) : "— not set —"} />
        <Ro label="Topic prefix" v={env.MQTT.topicPrefix} />
      </div>
    </GlassCard>
  );
}

function DbSettings() {
  return (
    <GlassCard>
      <div className="text-sm font-semibold">Database (MongoDB Atlas)</div>
      <p className="mt-1 text-xs text-muted-foreground">Connection is server-side. Set VITE_MONGODB_URI in your backend .env.</p>
      <div className="mt-4"><Ro label="Backend API" v={env.API_URL || "— not set —"} /></div>
      <div className="mt-3"><Ro label="Realtime socket" v={env.SOCKET_URL || "— not set —"} /></div>
    </GlassCard>
  );
}

function DeviceSettings() {
  return (
    <GlassCard>
      <div className="text-sm font-semibold">Device defaults</div>
      <p className="mt-1 text-xs text-muted-foreground">These parameters apply to newly paired ESP32 devices.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Sampling rate (Hz)"><Input defaultValue={10} /></Field>
        <Field label="Waveform window (s)"><Input defaultValue={8} /></Field>
        <Field label="Confidence threshold"><Input defaultValue={0.7} /></Field>
        <div className="flex items-center justify-between rounded-xl border border-border/60 bg-background/60 px-3 py-2.5">
          <div>
            <div className="text-sm font-medium">Auto-generate report on stop</div>
            <div className="text-xs text-muted-foreground">Skip the manual step for routine captures.</div>
          </div>
          <Switch defaultChecked />
        </div>
      </div>
    </GlassCard>
  );
}

function ApiSettings() {
  return (
    <GlassCard>
      <div className="text-sm font-semibold">API keys</div>
      <p className="mt-1 text-xs text-muted-foreground">API keys are managed by your backend. Rotate via the backend admin.</p>
      <div className="mt-4 rounded-xl border border-dashed border-border/70 bg-muted/40 p-4 text-sm text-muted-foreground">
        No client-side API keys are used in Demo Mode. In Live Mode, JWT session tokens are issued by the backend at login.
      </div>
    </GlassCard>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
function Ro({ label, v }: { label: string; v: string }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={v} readOnly className="mt-1" />
    </div>
  );
}
