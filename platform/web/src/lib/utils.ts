import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function statusTone(status?: string) {
  if (!status) return "neutral";
  const normalized = status.toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
  if (["completed", "certified", "healthy", "passed", "verified", "contained", "feasible"].includes(normalized)) return "success";
  if (["failed", "not_certified", "down", "rejected", "critical", "error", "unresolved"].includes(normalized)) return "danger";
  if (["warning", "needs_review", "open", "bound"].includes(normalized) || normalized.includes("not_certified")) return "warning";
  if (["running", "queued", "pending", "proposed", "recorded", "search", "metric", "budget", "bundle", "regret", "recall", "objective", "frozen"].includes(normalized)) return "info";
  if (["repair", "patched", "patch_ready", "runtime_validated", "static_validated"].includes(normalized)) return "repair";
  return "neutral";
}
