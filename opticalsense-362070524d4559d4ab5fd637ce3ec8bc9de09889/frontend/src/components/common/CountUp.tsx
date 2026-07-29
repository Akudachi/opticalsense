import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  decimals?: number;
  duration?: number;
  className?: string;
  suffix?: string;
};

export function CountUp({ value, decimals = 0, duration = 400, className, suffix }: Props) {
  const [display, setDisplay] = useState(value);
  const from = useRef(value);
  const start = useRef<number | null>(null);
  useEffect(() => {
    from.current = display;
    start.current = null;
    let raf = 0;
    const step = (ts: number) => {
      if (start.current === null) start.current = ts;
      const t = Math.min(1, (ts - start.current) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const cur = from.current + (value - from.current) * eased;
      setDisplay(cur);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span className={className}>
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
}
