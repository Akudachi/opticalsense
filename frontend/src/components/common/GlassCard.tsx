import { cn } from "@/lib/utils";
import { motion, type HTMLMotionProps } from "framer-motion";
import { forwardRef } from "react";

type Props = HTMLMotionProps<"div"> & {
  interactive?: boolean;
  padded?: boolean;
};

export const GlassCard = forwardRef<HTMLDivElement, Props>(function GlassCard(
  { className, children, interactive, padded = true, ...rest },
  ref,
) {
  return (
    <motion.div
      ref={ref}
      className={cn(
        "glass rounded-2xl shadow-soft",
        padded && "p-5",
        interactive && "transition-transform hover:-translate-y-0.5 hover:shadow-elevated",
        className,
      )}
      {...rest}
    >
      {children}
    </motion.div>
  );
});
