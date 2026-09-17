import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "./button";
import { cn } from "../../lib/utils";

type DiffViewerProps = {
  diff: string;
  title?: string;
  filePath?: string;
  language?: string;
  className?: string;
};

export function DiffViewer({ diff, title = "Patch diff", filePath, language = "diff", className }: DiffViewerProps) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => diff.split("\n"), [diff]);

  async function copy() {
    await navigator.clipboard?.writeText(diff);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className={cn("overflow-hidden rounded-lg border border-neutral-950/12 bg-neutral-950 text-neutral-100", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-neutral-900 px-3 py-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-neutral-100">{title}</div>
          <div className="mono-meta mt-0.5 truncate text-[11px] text-neutral-400">{filePath || language}</div>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-8 border-white/10 text-neutral-200 hover:bg-white/10 hover:text-white" onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="code-scroll max-h-80 overflow-auto p-0 text-xs leading-6">
        {lines.map((line, index) => (
          <div
            key={`${index}-${line}`}
            className={cn(
              "grid grid-cols-[3rem_1fr] border-b border-white/[0.03]",
              line.startsWith("+") && "bg-emerald-400/10 text-emerald-100",
              line.startsWith("-") && "bg-red-400/10 text-red-100",
              line.startsWith("@@") && "bg-orange-400/10 text-orange-100"
            )}
          >
            <span className="select-none border-r border-white/[0.06] px-3 text-right text-neutral-500">{index + 1}</span>
            <code className="min-w-0 overflow-visible px-3">{line || " "}</code>
          </div>
        ))}
      </pre>
    </div>
  );
}
