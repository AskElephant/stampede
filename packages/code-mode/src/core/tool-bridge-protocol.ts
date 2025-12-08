/**
 * Tool Bridge Protocol Interface
 *
 * This interface defines the contract for different RPC protocols that can be
 * used to communicate between the sandbox and the server.
 *
 * The protocol is responsible for:
 * - Creating the server-side handler for tool calls
 * - Generating the client-side runtime code for the sandbox
 * - Handling authentication and authorization
 *
 * The framework ships with tRPC support by default, but consumers can implement
 * their own protocols (gRPC, GraphQL, REST, etc.).
 */

import type {
  ToolDefinition,
  ExecutionContext,
  ToolBridgeConfig,
  Logger,
} from "./types";
import type { ToolRegistry } from "./tool-registry";

/**
 * Interface for tool bridge protocol implementations
 *
 * @example
 * ```typescript
 * class GraphQLToolBridgeProtocol implements ToolBridgeProtocol {
 *   readonly name = "graphql";
 *
 *   async initialize(config, registry, logger) {
 *     // Initialize GraphQL server
 *   }
 *
 *   generateClientRuntime(bridgeUrl, token) {
 *     return `
 *       const tools = {
 *         async searchDatabase(input) {
 *           const result = await fetch('${bridgeUrl}', {
 *             method: 'POST',
 *             headers: { 'Authorization': 'Bearer ${token}' },
 *             body: JSON.stringify({ query: '...', variables: { input } })
 *           });
 *           return result.json();
 *         }
 *       };
 *     `;
 *   }
 * }
 * ```
 */
export interface ToolBridgeProtocol {
  /**
   * Unique identifier for this protocol (e.g., "trpc", "grpc", "graphql", "rest")
   */
  readonly name: string;

  /**
   * Initialize the protocol with configuration and tool registry.
   * This is called once when the protocol is first used.
   *
   * @param config - Bridge configuration
   * @param registry - Tool registry containing all registered tools
   * @param logger - Optional logger for debugging
   */
  initialize(
    config: ToolBridgeConfig,
    registry: ToolRegistry,
    logger?: Logger
  ): Promise<void>;

  /**
   * Generate the client-side runtime code that gets injected into the sandbox.
   * This code should create a `tools` object with methods for each registered tool.
   *
   * @param bridgeUrl - The URL of the tool bridge server
   * @param executionToken - JWT token for authentication
   * @param toolNames - Names of tools to include in the runtime
   * @returns JavaScript/TypeScript code to inject into the sandbox
   */
  generateClientRuntime(
    bridgeUrl: string,
    executionToken: string,
    toolNames: string[]
  ): string;

  /**
   * Create a request handler for the server-side of the bridge.
   * This handler receives tool call requests from the sandbox.
   *
   * The returned handler should:
   * - Verify the execution token
   * - Check authorization (scopes)
   * - Execute the tool
   * - Return the result or error
   *
   * @returns A function that handles incoming requests
   */
  createRequestHandler(): RequestHandler;

  /**
   * Create an execution token for sandbox authentication.
   *
   * @param context - The execution context to encode in the token
   * @returns A signed JWT token
   */
  createExecutionToken(context: ExecutionContext): Promise<string>;

  /**
   * Verify and decode an execution token.
   *
   * @param token - The JWT token to verify
   * @returns The decoded execution context, or null if invalid
   */
  verifyExecutionToken(token: string): Promise<ExecutionContext | null>;

  /**
   * Get the content type expected by this protocol.
   * Used for setting request headers.
   */
  getContentType(): string;
}

/**
 * Generic request handler type that can work with different frameworks.
 * Most frameworks (Express, Hono, Next.js, etc.) can convert to/from this.
 */
export type RequestHandler = (request: Request) => Promise<Response>;

/**
 * Options for creating a tool bridge protocol
 */
export interface ToolBridgeProtocolOptions {
  /**
   * Custom error formatter
   */
  formatError?: (error: Error) => { code: string; message: string };

  /**
   * Custom response transformer
   */
  transformResponse?: (result: unknown) => unknown;

  /**
   * Additional headers to include in responses
   */
  responseHeaders?: Record<string, string>;

  /**
   * Enable CORS support
   */
  cors?: boolean | CorsOptions;
}

/**
 * CORS configuration options
 */
export interface CorsOptions {
  origin: string | string[] | boolean;
  methods?: string[];
  allowedHeaders?: string[];
  credentials?: boolean;
}

/**
 * Result of a tool execution through the bridge
 */
export interface ToolBridgeResult {
  success: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
  executionTimeMs: number;
}

/**
 * Tool call request from the sandbox
 */
export interface ToolCallRequest {
  /** Name of the tool to execute */
  tool: string;
  /** Input parameters for the tool */
  input: unknown;
}

/**
 * Base class for tool bridge protocol implementations
 *
 * Provides common functionality for token management, authorization,
 * and rate limiting that all protocol implementations can use.
 */
export abstract class BaseToolBridgeProtocol implements ToolBridgeProtocol {
  abstract readonly name: string;

  protected config: ToolBridgeConfig | null = null;
  protected registry: ToolRegistry | null = null;
  protected logger: Logger | null = null;
  protected rateLimitStore = new Map<
    string,
    { count: number; resetTime: number }
  >();

  async initialize(
    config: ToolBridgeConfig,
    registry: ToolRegistry,
    logger?: Logger
  ): Promise<void> {
    this.config = config;
    this.registry = registry;
    this.logger = logger ?? null;

    await this.doInitialize(config, registry);
    this.logger?.info(`Tool bridge protocol '${this.name}' initialized`);
  }

  /**
   * Check rate limit for a user
   */
  protected checkRateLimit(
    userId: string,
    maxPerMinute: number
  ): { allowed: boolean; remaining: number; resetIn: number } {
    const now = Date.now();
    const key = `rate:${userId}`;
    const entry = this.rateLimitStore.get(key);

    if (!entry || now > entry.resetTime) {
      this.rateLimitStore.set(key, { count: 1, resetTime: now + 60000 });
      return { allowed: true, remaining: maxPerMinute - 1, resetIn: 60 };
    }

    if (entry.count >= maxPerMinute) {
      return {
        allowed: false,
        remaining: 0,
        resetIn: Math.ceil((entry.resetTime - now) / 1000),
      };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: maxPerMinute - entry.count,
      resetIn: Math.ceil((entry.resetTime - now) / 1000),
    };
  }

  /**
   * Check if the execution context has required scopes
   */
  protected checkAuthorization(
    context: ExecutionContext,
    requiredScopes: string[]
  ): boolean {
    if (requiredScopes.length === 0 || requiredScopes.includes("*")) {
      return true;
    }
    return requiredScopes.some(
      (scope) => context.scopes.includes(scope) || context.scopes.includes("*")
    );
  }

  /**
   * Execute a tool with authorization and rate limiting
   */
  protected async executeToolWithChecks(
    toolName: string,
    input: unknown,
    context: ExecutionContext
  ): Promise<ToolBridgeResult> {
    const startTime = Date.now();

    if (!this.registry) {
      return {
        success: false,
        error: { code: "NOT_INITIALIZED", message: "Protocol not initialized" },
        executionTimeMs: Date.now() - startTime,
      };
    }

    const tool = this.registry.get(toolName);
    if (!tool) {
      return {
        success: false,
        error: { code: "NOT_FOUND", message: `Unknown tool: ${toolName}` },
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Check authorization
    const requiredScopes = tool.requiredScopes ?? [];
    if (!this.checkAuthorization(context, requiredScopes)) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: `Missing required scope. Required: ${requiredScopes.join(
            " or "
          )}`,
        },
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Check rate limit
    if (this.config?.enableRateLimiting) {
      const limit = tool.rateLimit ?? this.config.defaultRateLimit ?? 60;
      const rateCheck = this.checkRateLimit(context.userId, limit);
      if (!rateCheck.allowed) {
        return {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: `Rate limit exceeded. Try again in ${rateCheck.resetIn} seconds`,
          },
          executionTimeMs: Date.now() - startTime,
        };
      }
    }

    // Execute the tool
    try {
      const result = await this.registry.executeTool(toolName, input, context);
      return {
        success: true,
        result,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "EXECUTION_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Override this in subclasses for protocol-specific initialization
   */
  protected abstract doInitialize(
    config: ToolBridgeConfig,
    registry: ToolRegistry
  ): Promise<void>;

  // Abstract methods that must be implemented
  abstract generateClientRuntime(
    bridgeUrl: string,
    executionToken: string,
    toolNames: string[]
  ): string;

  abstract createRequestHandler(): RequestHandler;

  abstract createExecutionToken(context: ExecutionContext): Promise<string>;

  abstract verifyExecutionToken(
    token: string
  ): Promise<ExecutionContext | null>;

  abstract getContentType(): string;
}
