import { LogoMark } from "@/components/brand/Logo";
import { useAuth } from "@/contexts/AuthContext";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "OpticalSense — Cloud Pulp Vitality Monitoring" },
      {
        name: "description",
        content:
          "Cloud-based dental optical pulp vitality monitoring with ESP32 telemetry, patient records, and clinical reports.",
      },
    ],
  }),
  component: SplashScreen,
});

function SplashScreen() {
  const { user, hydrated } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      nav({ to: user ? "/dashboard" : "/login", replace: true });
    }, 1900);
    return () => clearTimeout(t);
  }, [hydrated, user, nav]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-background via-background to-brand/10">
      {/* Ambient glow */}
      <motion.div
        aria-hidden
        className="absolute h-[520px] w-[520px] rounded-full bg-brand/20 blur-3xl"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: [0.6, 1.1, 0.9], opacity: [0, 0.7, 0.5] }}
        transition={{ duration: 2, ease: "easeOut" }}
      />
      {/* Pulse rings */}
      {[0, 0.4, 0.8].map((delay) => (
        <motion.span
          key={delay}
          aria-hidden
          className="absolute rounded-full border border-brand/40"
          initial={{ width: 96, height: 96, opacity: 0.6 }}
          animate={{ width: 360, height: 360, opacity: 0 }}
          transition={{ duration: 1.8, delay, repeat: Infinity, ease: "easeOut" }}
        />
      ))}

      <div className="relative z-10 flex flex-col items-center gap-6">
        <motion.div
          initial={{ scale: 0.4, opacity: 0, rotate: -12 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 180, damping: 14 }}
        >
          <LogoMark size={96} />
        </motion.div>

        <motion.div
          className="flex flex-col items-center gap-2"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
        >
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Optical<span className="text-brand-gradient">Sense</span>
          </h1>
          <p className="text-sm text-muted-foreground">Cloud Pulp Vitality Monitoring</p>
        </motion.div>

        <motion.div
          className="mt-4 h-1 w-40 overflow-hidden rounded-full bg-border"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          <motion.div
            className="h-full bg-gradient-to-r from-brand to-cyan-400"
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            transition={{ duration: 1.6, ease: "easeInOut", delay: 0.4 }}
          />
        </motion.div>
      </div>
    </div>
  );
}
