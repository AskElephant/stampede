/**
 * AI SDK Integration for Stampede
 *
 * This module provides a clean, ergonomic API for integrating Stampede
 * with the Vercel AI SDK (or compatible SDKs).
 *
 * @example
 * ```typescript
 * import { stampede } from "@askelephant/stampede/ai";
 * import { streamText } from "ai";
 * import { openai } from "@ai-sdk/openai";
 *
 * const { system, tools } = stampede({
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
import { Stampede, buildSystemPrompt } from "../core/stampede";
import type { StampedeOptions } from "../core/stampede";
import type { ToolDefinition, ExecutionConfig } from "../core/types";

/**
 * Configuration options for the stampede() function
 */
export interface StampedeConfig {
  /**
   * Custom system prompt / instructions to include.
   * This will be appended to the Stampede system prompt.
   */
  system?: string;

  /**
   * Additional AI SDK tools to pass through.
   * These will be merged with the executeCode tool.
   */
  tools?: ToolSet;

  /**
   * Pre-configured Stampede instance to use.
   * If not provided, you must provide stampedeOptions.
   */
  stampede?: Stampede;

  /**
   * Options to create a new Stampede instance.
   * Required if stampede is not provided.
   */
  stampedeOptions?: StampedeOptions;

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
 * Result of the stampede() function
 */
export interface StampedeResult {
  /**
   * The complete system prompt including Stampede instructions,
   * tool type definitions, and custom instructions.
   */
  system: string;

  /**
   * Tools object containing executeCode and any pass-through tools.
   * Ready to use with streamText/generateText.
   */
  tools: ToolSet;

  /**
   * The Stampede instance (for advanced use cases)
   */
  stampede: Stampede;

  /**
   * Initialize the Stampede instance.
   * Must be called before the first code execution.
   */
  initialize: () => Promise<void>;

  /**
   * Cleanup resources when done.
   */
  cleanup: () => Promise<void>;
}

// Module-level Stampede instance for singleton pattern
let defaultStampedeInstance: Stampede | null = null;

/**
 * Create a code execution integration for the AI SDK.
 *
 * This function provides a clean API for setting up Stampede with the AI SDK.
 * It returns a `system` prompt and `tools` object ready to use with `streamText`.
 *
 * @example Basic usage
 * ```typescript
 * import { stampede } from "@askelephant/stampede/ai";
 * import { streamText } from "ai";
 *
 * const { system, tools, initialize } = stampede({
 *   system: "You are a helpful coding assistant",
 *   stampedeOptions: {
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
 * @example With existing Stampede instance
 * ```typescript
 * const myStampede = getStampede(); // Your configured instance
 *
 * const { system, tools } = stampede({
 *   system: "You are a data analysis assistant",
 *   stampede: myStampede,
 * });
 * ```
 *
 * @example With additional tools
 * ```typescript
 * import { tool } from "ai";
 *
 * const { system, tools } = stampede({
 *   system: "You are a helpful assistant",
 *   stampede: myStampede,
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
export function stampede(config: StampedeConfig): StampedeResult {
  const {
    system: customSystem,
    tools: additionalTools,
    stampede: providedStampede,
    stampedeOptions,
    executeCodeDescription,
    executionConfig,
    executeCodeToolName = "executeCode",
    includeSandboxTypes = true,
  } = config;

  // Get or create Stampede instance
  let stampede: Stampede;
  if (providedStampede) {
    stampede = providedStampede;
  } else if (stampedeOptions) {
    stampede = new Stampede(stampedeOptions);
  } else {
    throw new Error(
      "Either stampede or stampedeOptions must be provided to stampede()"
    );
  }

  // Build the system prompt
  const toolTypeDefs = stampede.getToolTypeDefinitions();
  const systemPrompt = buildSystemPrompt({
    toolTypeDefinitions: toolTypeDefs,
    includeSandboxTypes,
    customInstructions: customSystem,
  });

  // Create the code execution tool
  const executeCodeTool = createExecuteCodeTool(stampede, {
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
    stampede,
    initialize: async () => {
      if (!(await stampede.isReady())) {
        await stampede.initialize();
      }
    },
    cleanup: () => stampede.cleanup(),
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
  stampede: Stampede,
  config: ExecuteCodeToolConfig = {}
) {
  const { description, executionConfig } = config;

  // Generate description from registered tools
  const toolRegistry = stampede.getToolRegistry();
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
      // Ensure Stampede is initialized
      if (!(await stampede.isReady())) {
        await stampede.initialize();
      }

      const result = await stampede.executeCode(code, {
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
 * Create a stampede factory with pre-configured Stampede options.
 *
 * This is useful when you want to reuse the same Stampede configuration
 * across multiple places in your application.
 *
 * @example
 * ```typescript
 * // lib/stampede.ts
 * import { createStampedeFactory } from "@askelephant/stampede/ai";
 *
 * export const stampede = createStampedeFactory({
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
 * import { stampede } from "@/lib/stampede";
 *
 * const { system, tools } = stampede({
 *   system: "You are a helpful assistant",
 * });
 * ```
 */
export function createStampedeFactory(
  defaultOptions: StampedeOptions
): (
  config?: Omit<StampedeConfig, "stampedeOptions" | "stampede">
) => StampedeResult {
  // Create a singleton Stampede instance
  if (!defaultStampedeInstance) {
    defaultStampedeInstance = new Stampede(defaultOptions);
  }

  return (config = {}) => {
    return stampede({
      ...config,
      stampede: defaultStampedeInstance!,
    });
  };
}

/**
 * Helper to create a configured stampede function from a Stampede instance.
 *
 * @example
 * ```typescript
 * import { withStampede } from "@askelephant/stampede/ai";
 *
 * const myStampede = getStampede(); // Your existing instance
 * const configuredStampede = withStampede(myStampede);
 *
 * const { system, tools } = configuredStampede({
 *   system: "You are a helpful assistant",
 * });
 * ```
 */
export function withStampede(
  stampedeInstance: Stampede
): (
  config?: Omit<StampedeConfig, "stampedeOptions" | "stampede">
) => StampedeResult {
  return (config = {}) => {
    return stampede({
      ...config,
      stampede: stampedeInstance,
    });
  };
}

// Re-export useful types
export type { StampedeOptions } from "../core/stampede";
export type { ToolDefinition, ExecutionConfig } from "../core/types";
