import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "../../lib/utils";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("rounded-lg border border-dashed border-neutral-950/20 bg-white/55 p-6 text-center", className)}>
      <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-md border border-neutral-950/15 bg-white text-neutral-600">
        <Inbox className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="mt-3 text-sm font-semibold text-neutral-950">{title}</div>
      {description ? <p className="mx-auto mt-1 max-w-sm text-sm text-neutral-600">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
