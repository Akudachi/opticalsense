import { formatDistanceToNow, format } from "date-fns";

export function formatDateTime(iso: string) {
  try {
    return format(new Date(iso), "PP p");
  } catch {
    return iso;
  }
}

export function formatDate(iso: string) {
  try {
    return format(new Date(iso), "PP");
  } catch {
    return iso;
  }
}

export function timeAgo(iso: string) {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

export function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function calcAge(dobIso: string): number {
  const dob = new Date(dobIso);
  const diff = Date.now() - dob.getTime();
  return Math.floor(diff / (365.25 * 86_400_000));
}
