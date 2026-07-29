import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { FlaskConical } from "lucide-react";

export function DemoBadge({ className }: { className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-brand/10 px-2.5 py-1 text-[11px] font-medium text-brand",
        className,
      )}
    >
      <FlaskConical className="h-3 w-3" />
      Demo Mode
    </motion.div>
  );
}
