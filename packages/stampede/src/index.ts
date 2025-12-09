/**
 * Stampede Framework
 *
 * A modular framework for executing LLM-generated code in secure sandboxes
 * with pluggable sandbox providers and RPC protocols.
 *
 * @example
 * ```typescript
 * import {
 *   Stampede,
 *   DaytonaSandboxProvider,
 *   TRPCToolBridgeProtocol,
 *   defineTool,
 * } from "@askelephant/stampede";
 * import { z } from "zod";
 *
 * // Define a custom tool
 * const getCurrentTime = defineTool({
 *   name: "getCurrentTime",
 *   description: "Get the current date and time",
 *   inputSchema: z.object({
 *     timezone: z.string().optional().default("UTC"),
 *   }),
 *   outputSchema: z.object({
 *     iso: z.string(),
 *     unix: z.number(),
 *     readable: z.string(),
 *   }),
 *   execute: async ({ timezone }) => {
 *     const now = new Date();
 *     return {
 *       iso: now.toISOString(),
 *       unix: Math.floor(now.getTime() / 1000),
 *       readable: now.toLocaleString("en-US", { timeZone: timezone }),
 *     };
 *   },
 * });
 *
 * // Create the stampede instance
 * const stampede = new Stampede({
 *   sandboxProvider: new DaytonaSandboxProvider({
 *     apiKey: process.env.DAYTONA_API_KEY,
 *   }),
 *   bridgeProtocol: new TRPCToolBridgeProtocol(),
 *   bridgeConfig: {
 *     serverUrl: "http://localhost:3000/api/trpc",
 *     tokenConfig: {
 *       secretKey: process.env.SECRET_KEY!,
 *     },
 *   },
 *   tools: [getCurrentTime],
 * });
 *
 * // Initialize
 * await stampede.initialize();
 *
 * // Execute code
 * const result = await stampede.executeCode(`
 *   const time = await tools.getCurrentTime({ timezone: "America/New_York" });
 *   console.log("Current time:", time.readable);
 * `);
 *
 * console.log(result.output); // "Current time: 12/8/2025, 3:45:00 PM"
 * ```
 *
 * @packageDocumentation
 */

// Core exports
export * from "./core";

// Provider exports
export * from "./providers";

// Utility exports
export * from "./utils";

// AI SDK integration exports
export * from "./ai";

// Re-export commonly used types for convenience
export type {
  ExecutionContext,
  ToolDefinition,
  CodeExecutionResult,
  ExecutionConfig,
  ToolBridgeConfig,
  SandboxConfig,
  Logger,
} from "./core/types";

export type { SandboxProvider, SandboxState } from "./core/sandbox-provider";

export type {
  ToolBridgeProtocol,
  RequestHandler,
} from "./core/tool-bridge-protocol";

export type { ToolRegistry } from "./core/tool-registry";

// Re-export main classes for convenience
export {
  Stampede,
  buildSystemPrompt,
  STAMPEDE_SYSTEM_PROMPT,
  SANDBOX_TYPE_DEFINITIONS,
} from "./core/stampede";

export { defineTool, consoleLogger } from "./core/types";

export { createToolRegistry } from "./core/tool-registry";

export { DaytonaSandboxProvider } from "./providers/sandbox/daytona";

export { TRPCToolBridgeProtocol } from "./providers/protocol/trpc/protocol";
