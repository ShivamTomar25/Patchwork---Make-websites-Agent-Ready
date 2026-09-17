import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
};

export function Button({ className, variant = "primary", size = "md", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md border font-semibold transition-[background,border-color,color,box-shadow,transform] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50",
        size === "sm" && "h-9 px-3 text-sm",
        size === "md" && "h-10 px-4 text-sm",
        size === "icon" && "h-10 w-10 p-0",
        variant === "primary" && "border-[var(--accent)] bg-[var(--accent)] text-[var(--text-inverse)] shadow-[0_12px_28px_rgba(243,90,27,0.22)] hover:border-[var(--accent-hover)] hover:bg-[var(--accent-hover)]",
        variant === "secondary" && "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-primary)] shadow-[0_1px_0_rgba(255,255,255,0.65)_inset] hover:bg-[var(--surface-hover)]",
        variant === "ghost" && "border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
        variant === "danger" && "border-red-600/35 bg-red-50 text-red-700 hover:bg-red-100",
        className
      )}
      {...props}
    />
  );
}
