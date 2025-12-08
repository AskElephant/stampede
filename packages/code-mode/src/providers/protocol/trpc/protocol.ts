/**
 * tRPC Tool Bridge Protocol Implementation
 *
 * This is the main protocol implementation that brings together
 * the tRPC server, client runtime generation, and token management.
 *
 * @example
 * ```typescript
 * import { TRPCToolBridgeProtocol } from "@askelephant/code-mode/providers";
 *
 * const protocol = new TRPCToolBridgeProtocol();
 *
 * // Initialize with config and registry
 * await protocol.initialize(bridgeConfig, toolRegistry);
 *
 * // Get request handler for your API
 * const handler = protocol.createRequestHandler();
 *
 * // Generate client runtime for sandbox
 * const runtime = protocol.generateClientRuntime(
 *   "http://localhost:3000/api/trpc",
 *   token,
 *   ["searchDatabase", "sendEmail"]
 * );
 * ```
 */

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { SignJWT, jwtVerify } from "jose";
import { BaseToolBridgeProtocol } from "../../../core/tool-bridge-protocol";
import type { ToolRegistry } from "../../../core/tool-registry";
import type { RequestHandler } from "../../../core/tool-bridge-protocol";
import type {
  ToolBridgeConfig,
  ExecutionContext,
  Logger,
} from "../../../core/types";
import {
  createTRPCRouter,
  createContextFactory,
  type TRPCRouter,
} from "./server";
import {
  generateTRPCClientRuntime,
  generateFetchClientRuntime,
} from "./client";

/**
 * Options for the tRPC protocol
 */
export interface TRPCToolBridgeProtocolOptions {
  /**
   * Whether to use the full tRPC client (requires @trpc/client in sandbox)
   * or a minimal fetch-based client
   * @default false (uses fetch-based client)
   */
  useTRPCClient?: boolean;

  /**
   * Custom endpoint path
   * @default "/api/trpc"
   */
  endpointPath?: string;
}

/**
 * tRPC Tool Bridge Protocol implementation
 */
export class TRPCToolBridgeProtocol extends BaseToolBridgeProtocol {
  readonly name = "trpc";

  private options: TRPCToolBridgeProtocolOptions;
  private router: TRPCRouter | null = null;
  private endpointPath: string;

  constructor(options: TRPCToolBridgeProtocolOptions = {}) {
    super();
    this.options = options;
    this.endpointPath = options.endpointPath ?? "/api/trpc";
  }

  protected async doInitialize(
    config: ToolBridgeConfig,
    registry: ToolRegistry
  ): Promise<void> {
    // Create the tRPC router
    this.router = createTRPCRouter({
      registry,
      verifyToken: (token) => this.verifyExecutionToken(token),
      enableRateLimiting: config.enableRateLimiting,
      defaultRateLimit: config.defaultRateLimit,
      logger: this.logger ?? undefined,
    });

    this.logger?.info("tRPC router created", {
      tools: registry.getToolNames(),
    });
  }

  generateClientRuntime(
    bridgeUrl: string,
    executionToken: string,
    toolNames: string[]
  ): string {
    const options = {
      bridgeUrl,
      executionToken,
      toolNames,
    };

    if (this.options.useTRPCClient) {
      return generateTRPCClientRuntime(options);
    }

    return generateFetchClientRuntime(options);
  }

  createRequestHandler(): RequestHandler {
    if (!this.router) {
      throw new Error("Protocol not initialized. Call initialize() first.");
    }

    const router = this.router;
    const verifyToken = (token: string) => this.verifyExecutionToken(token);
    const endpointPath = this.endpointPath;
    const logger = this.logger;

    return async (request: Request): Promise<Response> => {
      return fetchRequestHandler({
        endpoint: endpointPath,
        req: request,
        router,
        createContext: createContextFactory(verifyToken),
        onError:
          process.env.NODE_ENV === "development"
            ? ({ path, error }) => {
                logger?.error(`tRPC error on ${path ?? "<no-path>"}`, {
                  message: error.message,
                });
              }
            : undefined,
      });
    };
  }

  async createExecutionToken(context: ExecutionContext): Promise<string> {
    if (!this.config) {
      throw new Error("Protocol not initialized");
    }

    const secret = new TextEncoder().encode(this.config.tokenConfig.secretKey);
    const expirationSeconds = this.config.tokenConfig.expirationSeconds ?? 300;

    return new SignJWT({
      ...context,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${expirationSeconds}s`)
      .setAudience(this.config.tokenConfig.audience ?? "tool-bridge-trpc")
      .sign(secret);
  }

  async verifyExecutionToken(token: string): Promise<ExecutionContext | null> {
    if (!this.config) {
      return null;
    }

    try {
      const secret = new TextEncoder().encode(
        this.config.tokenConfig.secretKey
      );
      const { payload } = await jwtVerify(token, secret, {
        audience: this.config.tokenConfig.audience ?? "tool-bridge-trpc",
      });

      return {
        userId: payload.userId as string,
        sessionId: payload.sessionId as string,
        organizationId: payload.organizationId as string | undefined,
        scopes: payload.scopes as string[],
        metadata: payload.metadata as Record<string, unknown> | undefined,
      };
    } catch {
      return null;
    }
  }

  getContentType(): string {
    return "application/json";
  }

  /**
   * Get the underlying tRPC router
   */
  getRouter(): TRPCRouter | null {
    return this.router;
  }
}
