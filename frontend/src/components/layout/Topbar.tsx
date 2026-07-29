import { DemoBadge } from "@/components/brand/DemoBadge";
import { LogoMark } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { getServices } from "@/services";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, LogOut, Moon, Sun, Trash2, User } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/patients": "Patients",
  "/tests": "Tests",
  "/reports": "Reports",
  "/devices": "Devices",
  "/settings": "Settings",
};

export function Topbar() {
  const { user, logout, updateProfile } = useAuth();
  const { theme, setTheme } = useTheme();
  const nav = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const services = getServices();
  const fileRef = useRef<HTMLInputElement>(null);
  const title =
    Object.entries(TITLES).find(([p]) => pathname === p || pathname.startsWith(p + "/"))?.[1] ?? "";

  async function onSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await logout();
    nav({ to: "/login", replace: true });
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be under 2 MB");
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      await updateProfile({ avatarUrl: dataUrl });
      toast.success("Profile photo updated");
    } catch {
      toast.error("Could not update photo");
    }
  }

  async function onRemoveAvatar() {
    await updateProfile({ avatarUrl: undefined });
    toast.success("Profile photo removed");
  }


  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border/60 bg-background/70 px-4 backdrop-blur-xl lg:px-6">
      <div className="flex items-center gap-2 lg:hidden">
        <LogoMark size={28} />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-lg font-semibold tracking-tight">{title}</h1>
          {services.mode === "demo" && <DemoBadge />}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        aria-label="Toggle theme"
      >
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickAvatar}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="gap-2">
            <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-brand ring-1 ring-border">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <User className="h-4 w-4" />
              )}
            </span>
            <span className="hidden text-sm sm:inline">{user?.fullName ?? "Doctor"}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-brand ring-1 ring-border">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <User className="h-5 w-5" />
                )}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{user?.fullName}</div>
                <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); fileRef.current?.click(); }}>
            <Camera className="mr-2 h-4 w-4" /> {user?.avatarUrl ? "Change photo" : "Upload photo"}
          </DropdownMenuItem>
          {user?.avatarUrl && (
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onRemoveAvatar(); }}>
              <Trash2 className="mr-2 h-4 w-4" /> Remove photo
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => nav({ to: "/settings" })}>Account & settings</DropdownMenuItem>
          <DropdownMenuItem onSelect={onSignOut} className="text-destructive">
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
