"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  CodeIcon,
  PlayIcon,
  TerminalIcon,
  XCircleIcon,
  ZapIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { CodeBlock, CodeBlockCopyButton } from "./code-block";

export interface CodeExecutionProps {
  part: ToolUIPart;
  className?: string;
}

/**
 * Component for displaying code execution tool calls
 * Provides a rich UI for showing the code being executed and its results
 */
export const CodeExecution = ({
  className,
  part,
}: CodeExecutionProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const input = (part.input ?? {}) as {
    code?: string;
    explanation?: string;
  };

  const output = part.output as
    | {
        result?: {
          success: boolean;
          output: string;
          error?: string;
          exitCode: number;
          executionTimeMs: number;
        };
        explanation?: string;
      }
    | undefined;

  const isExecuting =
    part.state === "input-available" || part.state === "input-streaming";
  const isComplete = part.state === "output-available";
  const isError = part.state === "output-error" || output?.result?.error;

  return (
    <div
      className={cn(
        "my-4 overflow-hidden rounded-xl border bg-gradient-to-b from-background to-muted/20",
        isError && "border-red-500/30",
        isComplete && !isError && "border-green-500/30",
        className
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        {/* Header */}
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 p-4 transition-colors hover:bg-muted/50">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex size-9 items-center justify-center rounded-lg",
                isExecuting && "bg-amber-500/10 text-amber-500",
                isComplete && !isError && "bg-green-500/10 text-green-500",
                isError && "bg-red-500/10 text-red-500"
              )}
            >
              {isExecuting ? (
                <PlayIcon className="size-4 animate-pulse" />
              ) : isError ? (
                <XCircleIcon className="size-4" />
              ) : (
                <CheckCircleIcon className="size-4" />
              )}
            </div>
            <div className="text-left">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">Code Execution</span>
                <StatusBadge state={part.state} hasError={!!isError} />
              </div>
              {input.explanation && (
                <p className="mt-0.5 text-muted-foreground text-xs">
                  {input.explanation}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {output?.result?.executionTimeMs && (
              <div className="flex items-center gap-1 text-muted-foreground text-xs">
                <ZapIcon className="size-3" />
                {output.result.executionTimeMs}ms
              </div>
            )}
            <ChevronDownIcon
              className={cn(
                "size-4 text-muted-foreground transition-transform duration-200",
                isOpen && "rotate-180"
              )}
            />
          </div>
        </CollapsibleTrigger>

        {/* Content */}
        <CollapsibleContent>
          <div className="border-t">
            {/* Code Section */}
            {input.code && (
              <div className="p-4">
                <div className="mb-2 flex items-center gap-2">
                  <CodeIcon className="size-4 text-muted-foreground" />
                  <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    Code
                  </h4>
                </div>
                <CodeBlock code={input.code} language="typescript">
                  <CodeBlockCopyButton />
                </CodeBlock>
              </div>
            )}

            {/* Output Section */}
            {(output?.result?.output || output?.result?.error) && (
              <div className="border-t p-4">
                <div className="mb-2 flex items-center gap-2">
                  <TerminalIcon className="size-4 text-muted-foreground" />
                  <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {output.result.error ? "Error" : "Output"}
                  </h4>
                </div>
                <div
                  className={cn(
                    "rounded-lg p-3 font-mono text-sm",
                    output.result.error
                      ? "bg-red-500/10 text-red-500"
                      : "bg-muted/50"
                  )}
                >
                  <pre className="whitespace-pre-wrap">
                    {output.result.error || output.result.output}
                  </pre>
                </div>
              </div>
            )}

            {/* Execution Info */}
            {output?.result && (
              <div className="flex items-center gap-4 border-t bg-muted/30 px-4 py-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Exit code:</span>
                  <span
                    className={cn(
                      "font-medium",
                      output.result.exitCode === 0
                        ? "text-green-500"
                        : "text-red-500"
                    )}
                  >
                    {output.result.exitCode}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Duration:</span>
                  <span className="font-medium">
                    {output.result.executionTimeMs}ms
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Status:</span>
                  <span
                    className={cn(
                      "font-medium",
                      output.result.success ? "text-green-500" : "text-red-500"
                    )}
                  >
                    {output.result.success ? "Success" : "Failed"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

type StatusBadgeProps = {
  state: ToolUIPart["state"];
  hasError?: boolean;
};

const StatusBadge = ({ state, hasError }: StatusBadgeProps) => {
  const config: Record<
    ToolUIPart["state"],
    { label: string; icon: ReactNode; variant: "default" | "secondary" | "destructive" | "outline" }
  > = {
    "input-streaming": {
      label: "Preparing",
      icon: <CircleIcon className="size-3" />,
      variant: "secondary",
    },
    "input-available": {
      label: "Executing",
      icon: <ClockIcon className="size-3 animate-spin" />,
      variant: "secondary",
    },
    "output-available": {
      label: hasError ? "Error" : "Completed",
      icon: hasError ? (
        <XCircleIcon className="size-3" />
      ) : (
        <CheckCircleIcon className="size-3" />
      ),
      variant: hasError ? "destructive" : "default",
    },
    "output-error": {
      label: "Error",
      icon: <XCircleIcon className="size-3" />,
      variant: "destructive",
    },
  };

  const { label, icon, variant } = config[state];

  return (
    <Badge variant={variant} className="gap-1 text-[10px]">
      {icon}
      {label}
    </Badge>
  );
};

export default CodeExecution;

