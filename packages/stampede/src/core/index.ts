/**
 * Core exports for the Stampede framework
 */

// Types
export type {
  ExecutionContext,
  TokenConfig,
  ToolDefinition,
  ToolCallRecord,
  CodeExecutionResult,
  ExecutionConfig,
  ToolBridgeConfig,
  SandboxConfig,
  Logger,
  InferToolInput,
  InferToolOutput,
} from "./types";

export { defineTool, consoleLogger } from "./types";

// Sandbox Provider
export type { SandboxProvider, SandboxState } from "./sandbox-provider";
export { BaseSandboxProvider } from "./sandbox-provider";

// Tool Bridge Protocol
export type {
  ToolBridgeProtocol,
  RequestHandler,
  ToolBridgeProtocolOptions,
  CorsOptions,
  ToolBridgeResult,
  ToolCallRequest,
} from "./tool-bridge-protocol";
export { BaseToolBridgeProtocol } from "./tool-bridge-protocol";

// Tool Registry
export type { ToolRegistry, ToolRegistryOptions } from "./tool-registry";
export { createToolRegistry } from "./tool-registry";

// Stampede
export type { StampedeOptions } from "./stampede";
export {
  Stampede,
  SANDBOX_TYPE_DEFINITIONS,
  STAMPEDE_SYSTEM_PROMPT,
  buildSystemPrompt,
} from "./stampede";
