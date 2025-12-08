/**
 * AI SDK Integration for Code Mode
 *
 * This module provides a clean, ergonomic API for integrating Code Mode
 * with the Vercel AI SDK (or compatible SDKs).
 *
 * @example
 * ```typescript
 * import { codemode } from "@askelephant/code-mode/ai";
 * import { streamText } from "ai";
 * import { openai } from "@ai-sdk/openai";
 *
 * const { system, tools } = codemode({
 *   system: "You are a helpful assistant",
 *   tools: {
 *     // Additional AI SDK tools can be passed through
 *   },
 * });
 *
 * const stream = streamText({
 *   model: openai("gpt-4"),
 *   system,
 *   tools,
 *   messages: [{ role: "user", content: "Write a function that adds two numbers" }],
 * });
 * ```
 *
 * @packageDocumentation
 */

import { z } from "zod";
import { tool, type ToolSet } from "ai";
import { CodeMode, buildSystemPrompt } from "../core/code-mode";
import type { CodeModeOptions } from "../core/code-mode";
import type { ToolDefinition, ExecutionConfig } from "../core/types";

/**
 * Configuration options for the codemode() function
 */
export interface CodemodeConfig {
  /**
   * Custom system prompt / instructions to include.
   * This will be appended to the Code Mode system prompt.
   */
  system?: string;

  /**
   * Additional AI SDK tools to pass through.
   * These will be merged with the executeCode tool.
   */
  tools?: ToolSet;

  /**
   * Pre-configured CodeMode instance to use.
   * If not provided, you must provide codeModeOptions.
   */
  codeMode?: CodeMode;

  /**
   * Options to create a new CodeMode instance.
   * Required if codeMode is not provided.
   */
  codeModeOptions?: CodeModeOptions;

  /**
   * Custom description for the executeCode tool.
   * Overrides the auto-generated description.
   */
  executeCodeDescription?: string;

  /**
   * Default execution config for code execution.
   * These values are used when executing code.
   */
  executionConfig?: ExecutionConfig;

  /**
   * Name of the code execution tool.
   * @default "executeCode"
   */
  executeCodeToolName?: string;

  /**
   * Whether to include sandbox type definitions in the system prompt.
   * @default true
   */
  includeSandboxTypes?: boolean;
}

/**
 * Result of the codemode() function
 */
export interface CodemodeResult {
  /**
   * The complete system prompt including Code Mode instructions,
   * tool type definitions, and custom instructions.
   */
  system: string;

  /**
   * Tools object containing executeCode and any pass-through tools.
   * Ready to use with streamText/generateText.
   */
  tools: ToolSet;

  /**
   * The CodeMode instance (for advanced use cases)
   */
  codeMode: CodeMode;

  /**
   * Initialize the CodeMode instance.
   * Must be called before the first code execution.
   */
  initialize: () => Promise<void>;

  /**
   * Cleanup resources when done.
   */
  cleanup: () => Promise<void>;
}

// Module-level CodeMode instance for singleton pattern
let defaultCodeModeInstance: CodeMode | null = null;

/**
 * Create a code execution integration for the AI SDK.
 *
 * This function provides a clean API for setting up Code Mode with the AI SDK.
 * It returns a `system` prompt and `tools` object ready to use with `streamText`.
 *
 * @example Basic usage
 * ```typescript
 * import { codemode } from "@askelephant/code-mode/ai";
 * import { streamText } from "ai";
 *
 * const { system, tools, initialize } = codemode({
 *   system: "You are a helpful coding assistant",
 *   codeModeOptions: {
 *     sandboxProvider: new DaytonaSandboxProvider({ apiKey: process.env.DAYTONA_API_KEY }),
 *     bridgeProtocol: new TRPCToolBridgeProtocol(),
 *     bridgeConfig: {
 *       serverUrl: "http://localhost:3000/api/trpc",
 *       tokenConfig: { secretKey: process.env.SECRET_KEY },
 *     },
 *   },
 * });
 *
 * // Initialize before first use
 * await initialize();
 *
 * const stream = streamText({
 *   model: openai("gpt-4"),
 *   system,
 *   tools,
 *   messages,
 * });
 * ```
 *
 * @example With existing CodeMode instance
 * ```typescript
 * const codeMode = getCodeMode(); // Your configured instance
 *
 * const { system, tools } = codemode({
 *   system: "You are a data analysis assistant",
 *   codeMode,
 * });
 * ```
 *
 * @example With additional tools
 * ```typescript
 * import { tool } from "ai";
 *
 * const { system, tools } = codemode({
 *   system: "You are a helpful assistant",
 *   codeMode,
 *   tools: {
 *     getWeather: tool({
 *       description: "Get current weather",
 *       inputSchema: z.object({ city: z.string() }),
 *       execute: async ({ city }) => fetchWeather(city),
 *     }),
 *   },
 * });
 * ```
 */
export function codemode(config: CodemodeConfig): CodemodeResult {
  const {
    system: customSystem,
    tools: additionalTools,
    codeMode: providedCodeMode,
    codeModeOptions,
    executeCodeDescription,
    executionConfig,
    executeCodeToolName = "executeCode",
    includeSandboxTypes = true,
  } = config;

  // Get or create CodeMode instance
  let codeMode: CodeMode;
  if (providedCodeMode) {
    codeMode = providedCodeMode;
  } else if (codeModeOptions) {
    codeMode = new CodeMode(codeModeOptions);
  } else {
    throw new Error(
      "Either codeMode or codeModeOptions must be provided to codemode()"
    );
  }

  // Build the system prompt
  const toolTypeDefs = codeMode.getToolTypeDefinitions();
  const systemPrompt = buildSystemPrompt({
    toolTypeDefinitions: toolTypeDefs,
    includeSandboxTypes,
    customInstructions: customSystem,
  });

  // Create the code execution tool
  const executeCodeTool = createExecuteCodeTool(codeMode, {
    description: executeCodeDescription,
    executionConfig,
  });

  // Merge tools
  const tools: ToolSet = {
    ...additionalTools,
    [executeCodeToolName]: executeCodeTool,
  };

  return {
    system: systemPrompt,
    tools,
    codeMode,
    initialize: async () => {
      if (!(await codeMode.isReady())) {
        await codeMode.initialize();
      }
    },
    cleanup: () => codeMode.cleanup(),
  };
}

/**
 * Configuration for creating the executeCode tool
 */
interface ExecuteCodeToolConfig {
  description?: string;
  executionConfig?: ExecutionConfig;
}

/**
 * Create the executeCode tool for AI SDK
 */
function createExecuteCodeTool(
  codeMode: CodeMode,
  config: ExecuteCodeToolConfig = {}
) {
  const { description, executionConfig } = config;

  // Generate description from registered tools
  const toolRegistry = codeMode.getToolRegistry();
  const toolNames = toolRegistry.getToolNames();

  const defaultDescription = `Execute TypeScript code in a secure sandbox environment.

The sandbox provides built-in APIs:
- fs: File system operations (read, write, list files)
- http: HTTP requests (GET, POST, PUT, DELETE)
- shell: Shell command execution
- data: Data processing utilities (CSV, JSON, grouping, sorting)

${
  toolNames.length > 0
    ? `Custom tools are available via the \`tools\` object:
${toolNames.map((name) => `- tools.${name}()`).join("\n")}`
    : ""
}

Use console.log() to output results.`;

  return tool({
    description: description || defaultDescription,
    inputSchema: z.object({
      code: z
        .string()
        .describe(
          "TypeScript code to execute. Use console.log() to output results."
        ),
      explanation: z
        .string()
        .optional()
        .describe("Brief explanation of what the code does"),
    }),
    execute: async ({ code, explanation }) => {
      // Ensure CodeMode is initialized
      if (!(await codeMode.isReady())) {
        await codeMode.initialize();
      }

      const result = await codeMode.executeCode(code, {
        userId: executionConfig?.userId ?? "sandbox-user",
        sessionId: executionConfig?.sessionId ?? `session-${Date.now()}`,
        scopes: executionConfig?.scopes ?? ["*"],
        organizationId: executionConfig?.organizationId,
        metadata: executionConfig?.metadata,
        timeoutMs: executionConfig?.timeoutMs,
      });

      return {
        result,
        explanation,
      };
    },
  });
}

/**
 * Create a codemode factory with pre-configured CodeMode options.
 *
 * This is useful when you want to reuse the same CodeMode configuration
 * across multiple places in your application.
 *
 * @example
 * ```typescript
 * // lib/codemode.ts
 * import { createCodemodeFactory } from "@askelephant/code-mode/ai";
 *
 * export const codemode = createCodemodeFactory({
 *   sandboxProvider: new DaytonaSandboxProvider({ apiKey: process.env.DAYTONA_API_KEY }),
 *   bridgeProtocol: new TRPCToolBridgeProtocol(),
 *   bridgeConfig: {
 *     serverUrl: process.env.TOOL_BRIDGE_URL,
 *     tokenConfig: { secretKey: process.env.SECRET_KEY },
 *   },
 *   tools: [myTool1, myTool2],
 * });
 *
 * // In your API route
 * import { codemode } from "@/lib/codemode";
 *
 * const { system, tools } = codemode({
 *   system: "You are a helpful assistant",
 * });
 * ```
 */
export function createCodemodeFactory(
  defaultOptions: CodeModeOptions
): (
  config?: Omit<CodemodeConfig, "codeModeOptions" | "codeMode">
) => CodemodeResult {
  // Create a singleton CodeMode instance
  if (!defaultCodeModeInstance) {
    defaultCodeModeInstance = new CodeMode(defaultOptions);
  }

  return (config = {}) => {
    return codemode({
      ...config,
      codeMode: defaultCodeModeInstance!,
    });
  };
}

/**
 * Helper to create a configured codemode function from a CodeMode instance.
 *
 * @example
 * ```typescript
 * import { withCodeMode } from "@askelephant/code-mode/ai";
 *
 * const codeMode = getCodeMode(); // Your existing instance
 * const codemode = withCodeMode(codeMode);
 *
 * const { system, tools } = codemode({
 *   system: "You are a helpful assistant",
 * });
 * ```
 */
export function withCodeMode(
  codeModeInstance: CodeMode
): (
  config?: Omit<CodemodeConfig, "codeModeOptions" | "codeMode">
) => CodemodeResult {
  return (config = {}) => {
    return codemode({
      ...config,
      codeMode: codeModeInstance,
    });
  };
}

// Re-export useful types
export type { CodeModeOptions } from "../core/code-mode";
export type { ToolDefinition, ExecutionConfig } from "../core/types";
