import { LogoMark } from "@/components/brand/Logo";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

const STEPS = [
  { key: "backend", label: "Connecting to Backend" },
  { key: "mqtt", label: "Connecting to MQTT Broker" },
  { key: "database", label: "Syncing with Database" },
  { key: "device", label: "Checking ESP32 Device" },
  { key: "ready", label: "Ready" },
];

export function LoadingScreen({ onDone }: { onDone?: () => void }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (idx >= STEPS.length) {
      onDone?.();
      return;
    }
    const t = setTimeout(() => setIdx((i) => i + 1), 380);
    return () => clearTimeout(t);
  }, [idx, onDone]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-hero">
      <div className="w-[min(92vw,420px)] rounded-3xl border border-glass-border bg-glass p-8 shadow-elevated backdrop-blur-xl">
        <div className="mb-6 flex items-center gap-3">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 220, damping: 18 }}
          >
            <LogoMark size={42} />
          </motion.div>
          <div>
            <div className="font-display text-lg font-semibold tracking-tight">OpticalSense</div>
            <div className="text-xs text-muted-foreground">Initializing clinical workspace</div>
          </div>
        </div>
        <ul className="space-y-2.5">
          <AnimatePresence>
            {STEPS.map((s, i) => {
              const done = i < idx;
              const active = i === idx;
              return (
                <motion.li
                  key={s.key}
                  layout
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-2 text-sm"
                >
                  <span
                    className={
                      done
                        ? "flex h-5 w-5 items-center justify-center rounded-full bg-brand text-brand-foreground"
                        : active
                        ? "flex h-5 w-5 items-center justify-center rounded-full bg-brand/20 text-brand"
                        : "flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground"
                    }
                  >
                    {done ? <Check className="h-3 w-3" /> : active ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  </span>
                  <span className={done ? "text-foreground" : active ? "text-foreground" : "text-muted-foreground"}>
                    {s.label}
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}
