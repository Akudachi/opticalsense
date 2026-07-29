import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Lock, Mail, User as UserIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — OpticalSense" },
      { name: "description", content: "Sign into your OpticalSense clinical workspace." },
    ],
  }),
  component: LoginPage,
});

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.2s2.7-6.2 6-6.2c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.2 14.7 2 12 2 6.9 2 2.8 6.1 2.8 12S6.9 22 12 22c6.9 0 11.5-4.9 11.5-11.7 0-.8-.1-1.4-.2-2.1H12z"/>
      <path fill="#34A853" d="M3.9 7.5l3.3 2.4C8 8 9.9 6.6 12 6.6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.9 14.7 2.7 12 2.7 8.1 2.7 4.8 4.9 3.9 7.5z" opacity="0"/>
    </svg>
  );
}

function LoginPage() {
  const { login, signUp, loginWithGoogle, user, hydrated } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  useEffect(() => {
    if (hydrated && user) nav({ to: "/dashboard", replace: true });
  }, [hydrated, user, nav]);

  async function onSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
      toast.success("Welcome back");
      nav({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) return toast.error("Please enter your full name");
    if (password.length < 6) return toast.error("Password must be at least 6 characters");
    setBusy(true);
    try {
      await signUp(email, password, fullName.trim());
      toast.success("Account created — check your email to confirm, then sign in.");
      setTab("signin");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setGoogle(true);
    try {
      await loginWithGoogle();
      // Popup or redirect flow — onAuthStateChange will pick up the session.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign in failed");
    } finally {
      setGoogle(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden bg-brand-gradient lg:block">
        <div className="absolute inset-0 bg-mesh opacity-40" />
        <div className="relative z-10 flex h-full flex-col justify-between p-12 text-white">
          <Link to="/"><Logo /></Link>
          <div>
            <div className="font-display text-4xl font-semibold leading-tight">
              Optical pulp vitality, on every chair.
            </div>
            <p className="mt-4 max-w-md text-white/80">
              Real-time SpO₂, pulse, and optical waveform capture — delivered to your clinical workspace.
            </p>
          </div>
          <div className="text-xs text-white/70">© {new Date().getFullYear()} OpticalSense Medical Systems</div>
        </div>
      </div>

      <div className="flex items-center justify-center bg-hero px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm"
        >
          <div className="mb-8">
            <Logo />
          </div>

          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {tab === "signin" ? "Sign in" : "Create your account"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tab === "signin"
              ? "Access your clinical workspace."
              : "Start using OpticalSense in under a minute."}
          </p>

          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onGoogle}
            disabled={google || busy}
            className="mt-6 w-full gap-2"
          >
            <GoogleIcon />
            {google ? "Opening Google…" : "Continue with Google"}
          </Button>

          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            or with email
            <div className="h-px flex-1 bg-border" />
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "signin" | "signup")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form className="mt-4 space-y-4" onSubmit={onSignIn}>
                <EmailField value={email} onChange={setEmail} />
                <PasswordField value={password} onChange={setPassword} autoComplete="current-password" />
                <Button
                  type="submit"
                  size="lg"
                  className="w-full bg-brand-gradient text-white shadow-glow hover:opacity-95"
                  disabled={busy}
                >
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form className="mt-4 space-y-4" onSubmit={onSignUp}>
                <div>
                  <Label htmlFor="fullName">Full name</Label>
                  <div className="relative mt-1">
                    <UserIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="fullName"
                      className="pl-9"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Dr. Jane Smith"
                    />
                  </div>
                </div>
                <EmailField value={email} onChange={setEmail} />
                <PasswordField value={password} onChange={setPassword} autoComplete="new-password" />
                <Button
                  type="submit"
                  size="lg"
                  className="w-full bg-brand-gradient text-white shadow-glow hover:opacity-95"
                  disabled={busy}
                >
                  {busy ? "Creating account…" : "Create account"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    </div>
  );
}

function EmailField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label htmlFor="email">Email</Label>
      <div className="relative mt-1">
        <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          id="email"
          type="email"
          autoComplete="email"
          className="pl-9"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
        />
      </div>
    </div>
  );
}

function PasswordField({
  value,
  onChange,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  return (
    <div>
      <Label htmlFor="password">Password</Label>
      <div className="relative mt-1">
        <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          id="password"
          type="password"
          autoComplete={autoComplete}
          className="pl-9"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          minLength={6}
        />
      </div>
    </div>
  );
}
