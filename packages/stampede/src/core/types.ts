/**
 * Core Types for Stampede Framework
 *
 * This file defines the foundational types used throughout the framework.
 * These types are provider-agnostic and define the contracts between
 * different components of the system.
 */

import { z } from "zod";

// =============================================================================
// Execution Context & Authentication
// =============================================================================

/**
 * Execution context passed to tool calls for authentication and authorization.
 * This context is created from a JWT token and contains user/session information.
 */
export interface ExecutionContext {
  /** Unique identifier of the user making the request */
  userId: string;
  /** Session ID for tracking/correlation */
  sessionId: string;
  /** Organization/tenant ID for multi-tenant systems */
  organizationId?: string;
  /** Permission scopes granted for this execution */
  scopes: string[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Configuration for execution token creation
 */
export interface TokenConfig {
  /** Secret key for signing tokens */
  secretKey: string;
  /** Token expiration time in seconds (default: 300 = 5 minutes) */
  expirationSeconds?: number;
  /** Audience claim for the token */
  audience?: string;
}

// =============================================================================
// Tool Definitions
// =============================================================================

/**
 * Definition of a tool that can be called from sandbox code.
 * Tools are registered with the framework and exposed to the LLM as a TypeScript API.
 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  /** Unique name of the tool (used as the function name in sandbox) */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** Zod schema for validating tool inputs */
  inputSchema: z.ZodType<TInput>;
  /** Optional Zod schema for validating tool outputs */
  outputSchema?: z.ZodType<TOutput>;
  /** Required permission scopes to call this tool */
  requiredScopes?: string[];
  /** Rate limit (requests per minute) for this tool */
  rateLimit?: number;
  /** The actual implementation of the tool */
  execute: (input: TInput, context: ExecutionContext) => Promise<TOutput>;
}

/**
 * Record of a tool call made during code execution (for logging/debugging)
 */
export interface ToolCallRecord {
  /** Name of the tool that was called */
  tool: string;
  /** Input parameters passed to the tool */
  input: unknown;
  /** Output returned by the tool (or error) */
  output: unknown;
  /** Duration of the tool call in milliseconds */
  durationMs: number;
  /** Whether the call succeeded */
  success: boolean;
  /** Error message if the call failed */
  error?: string;
}

// =============================================================================
// Code Execution
// =============================================================================

/**
 * Result of executing code in a sandbox
 */
export interface CodeExecutionResult {
  /** Whether the code execution succeeded */
  success: boolean;
  /** The output produced by the code (console.log output) */
  output: string;
  /** Error message if execution failed */
  error?: string;
  /** Exit code from the sandbox process */
  exitCode: number;
  /** Total execution time in milliseconds */
  executionTimeMs: number;
  /** Record of all tool calls made during execution */
  toolCalls: ToolCallRecord[];
}

/**
 * Configuration for code execution
 */
export interface ExecutionConfig {
  /** User ID for authentication */
  userId?: string;
  /** Session ID for tracking */
  sessionId?: string;
  /** Organization ID for multi-tenant isolation */
  organizationId?: string;
  /** Permission scopes granted to the execution */
  scopes?: string[];
  /** Timeout in milliseconds for the execution */
  timeoutMs?: number;
  /** Additional metadata to pass to tools */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Provider Configuration
// =============================================================================

/**
 * Configuration for the tool bridge (protocol-agnostic)
 */
export interface ToolBridgeConfig {
  /** Base URL of the tool bridge server */
  serverUrl: string;
  /** Token configuration for JWT signing/verification */
  tokenConfig: TokenConfig;
  /** Enable rate limiting */
  enableRateLimiting?: boolean;
  /** Default rate limit (requests per minute) */
  defaultRateLimit?: number;
}

/**
 * Configuration for a sandbox provider
 */
export interface SandboxConfig {
  /** Provider-specific configuration options */
  options?: Record<string, unknown>;
  /** Auto-stop interval in minutes (for providers that support it) */
  autoStopInterval?: number;
  /** Network configuration */
  network?: {
    /** Block all network access */
    blockAll?: boolean;
    /** Allowed hosts/IPs for network access */
    allowList?: string[];
  };
  /** Labels/tags for the sandbox */
  labels?: Record<string, string>;
}

// =============================================================================
// Logging & Observability
// =============================================================================

/**
 * Logger interface for the framework
 * Allows consumers to plug in their own logging implementation
 */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Default console logger implementation
 */
export const consoleLogger: Logger = {
  debug: (message, data) => console.debug(`[DEBUG] ${message}`, data || ""),
  info: (message, data) => console.info(`[INFO] ${message}`, data || ""),
  warn: (message, data) => console.warn(`[WARN] ${message}`, data || ""),
  error: (message, data) => console.error(`[ERROR] ${message}`, data || ""),
};

// =============================================================================
// Type Helpers
// =============================================================================

/**
 * Helper to define a tool with proper typing
 */
export function defineTool<TInput, TOutput>(
  config: ToolDefinition<TInput, TOutput>
): ToolDefinition<TInput, TOutput> {
  return config;
}

/**
 * Infer input type from a ToolDefinition
 */
export type InferToolInput<T> = T extends ToolDefinition<infer I, unknown>
  ? I
  : never;

/**
 * Infer output type from a ToolDefinition
 */
export type InferToolOutput<T> = T extends ToolDefinition<unknown, infer O>
  ? O
  : never;
