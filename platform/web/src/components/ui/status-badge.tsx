import { AlertTriangle, CheckCircle2, Circle, Clock3, Loader2, ShieldCheck, Wrench, XCircle, type LucideIcon } from "lucide-react";
import { cn, statusTone } from "../../lib/utils";

type StatusBadgeProps = {
  status?: string;
  className?: string;
};

const icons: Record<string, LucideIcon> = {
  success: CheckCircle2,
  danger: XCircle,
  info: Loader2,
  warning: AlertTriangle,
  repair: Wrench,
  verified: ShieldCheck,
  neutral: Circle
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const tone = statusTone(status);
  const iconTone = tone === "success" && normalized(status).includes("verified") ? "verified" : tone;
  const Icon = icons[iconTone] ?? icons.neutral;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold",
        tone === "success" && "border-emerald-600/25 bg-emerald-50 text-emerald-700",
        tone === "danger" && "border-red-600/25 bg-red-50 text-red-700",
        tone === "warning" && "border-amber-600/25 bg-amber-50 text-amber-800",
        tone === "info" && "border-blue-600/25 bg-blue-50 text-blue-700",
        tone === "repair" && "border-orange-500/30 bg-orange-50 text-orange-700",
        tone === "neutral" && "border-neutral-950/15 bg-white text-neutral-700",
        className
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", tone === "info" && "animate-spin")} aria-hidden="true" />
      <span className="truncate">{labelForStatus(status)}</span>
    </span>
  );
}

function normalized(status?: string) {
  return String(status ?? "recorded").toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function labelForStatus(status?: string) {
  return String(status ?? "recorded")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
