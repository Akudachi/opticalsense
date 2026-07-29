import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  size?: number;
  showWordmark?: boolean;
};

/**
 * OpticalSense logo — minimal tooth silhouette combined with an optical pulse waveform.
 * Uses a blue → cyan gradient with a glass highlight.
 */
export function Logo({ className, size = 32, showWordmark = true }: Props) {
  return (
    <div className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      {showWordmark && (
        <span className="font-display text-lg font-semibold tracking-tight">
          Optical<span className="text-brand-gradient">Sense</span>
        </span>
      )}
    </div>
  );
}

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={cn("drop-shadow-[0_2px_10px_oklch(0.62_0.16_235/0.35)]", className)}
      aria-label="OpticalSense"
    >
      <defs>
        <linearGradient id="os-g" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="oklch(0.55 0.18 250)" />
          <stop offset="100%" stopColor="oklch(0.75 0.14 200)" />
        </linearGradient>
        <linearGradient id="os-h" x1="8" y1="6" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="white" stopOpacity="0.55" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Rounded square backdrop */}
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#os-g)" />
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#os-h)" />
      {/* Tooth silhouette */}
      <path
        d="M17.5 11.5c-3.6 0-6 2.6-6 6.3 0 3.2 1.5 5.3 2.5 8.4.7 2.2.7 4.5 1.4 7 .5 1.7 1.5 3.3 2.6 3.3 1.3 0 1.7-1.6 2-3.4.3-2 .5-4 1.7-4 1.2 0 1.4 2 1.7 4 .3 1.8.7 3.4 2 3.4 1.1 0 2.1-1.6 2.6-3.3.7-2.5.7-4.8 1.4-7 1-3.1 2.5-5.2 2.5-8.4 0-3.7-2.4-6.3-6-6.3-1.8 0-3 .7-4.2 1.4-1.2-.7-2.4-1.4-4.2-1.4z"
        fill="white"
        fillOpacity="0.96"
      />
      {/* Optical pulse waveform across the tooth */}
      <path
        d="M9 27 L15 27 L17 22 L20 32 L23 20 L26 30 L29 25 L39 25"
        stroke="oklch(0.55 0.18 250)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.9"
      />
    </svg>
  );
}
