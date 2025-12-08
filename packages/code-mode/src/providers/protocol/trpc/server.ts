/**
 * tRPC Server Implementation for Tool Bridge
 *
 * This module provides the server-side implementation for the tRPC protocol.
 * It creates a tRPC router that handles tool calls from the sandbox.
 *
 * @example
 * ```typescript
 * // In your Next.js API route
 * import { createTRPCRouter, createTRPCContext } from "@askelephant/code-mode/providers";
 *
 * const router = createTRPCRouter(toolRegistry);
 *
 * export const handler = (req: Request) =>
 *   fetchRequestHandler({
 *     endpoint: "/api/trpc",
 *     req,
 *     router,
 *     createContext: () => createTRPCContext({ req }),
 *   });
 * ```
 */

import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import superjson from "superjson";
import type { ToolRegistry } from "../../../core/tool-registry";
import type { ExecutionContext, Logger } from "../../../core/types";

// =============================================================================
// Types
// =============================================================================

export interface TRPCContext {
  executionContext: ExecutionContext | null;
}

export interface CreateTRPCRouterOptions {
  /**
   * Tool registry containing registered tools
   */
  registry: ToolRegistry;

  /**
   * Function to verify execution tokens
   */
  verifyToken: (token: string) => Promise<ExecutionContext | null>;

  /**
   * Enable rate limiting
   */
  enableRateLimiting?: boolean;

  /**
   * Default rate limit per minute
   */
  defaultRateLimit?: number;

  /**
   * Logger for debugging
   */
  logger?: Logger;
}

// =============================================================================
// Rate Limiting
// =============================================================================

const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(
  userId: string,
  maxPerMinute: number
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const key = `rate:${userId}`;
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + 60000 });
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

// =============================================================================
// tRPC Router Factory
// =============================================================================

/**
 * Create a tRPC router for tool execution
 *
 * This creates a dynamic router with a procedure for each registered tool.
 */
export function createTRPCRouter(options: CreateTRPCRouterOptions) {
  const {
    registry,
    verifyToken,
    enableRateLimiting = true,
    defaultRateLimit = 60,
    logger,
  } = options;

  // Initialize tRPC
  const t = initTRPC.context<TRPCContext>().create({
    transformer: superjson,
    errorFormatter({ shape, error }) {
      return {
        ...shape,
        data: {
          ...shape.data,
          code: error.code,
        },
      };
    },
  });

  // Authentication middleware
  const isAuthenticated = t.middleware(async ({ ctx, next }) => {
    if (!ctx.executionContext) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Missing or invalid execution token",
      });
    }
    return next({
      ctx: {
        ...ctx,
        executionContext: ctx.executionContext,
      },
    });
  });

  // Scope checking middleware factory
  function requireScopes(...requiredScopes: string[]) {
    return t.middleware(async ({ ctx, next }) => {
      const userScopes = ctx.executionContext?.scopes ?? [];
      const hasScope = requiredScopes.some(
        (scope) =>
          userScopes.includes(scope) ||
          userScopes.includes("*") ||
          scope === "*"
      );

      if (!hasScope) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Missing required scope. Required: ${requiredScopes.join(
            " or "
          )}`,
        });
      }

      return next();
    });
  }

  // Rate limiting middleware factory
  function rateLimit(maxPerMinute: number) {
    return t.middleware(async ({ ctx, next }) => {
      if (!enableRateLimiting) return next();

      const userId = ctx.executionContext?.userId ?? "anonymous";
      const result = checkRateLimit(userId, maxPerMinute);

      if (!result.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Rate limit exceeded. Try again in ${result.resetIn} seconds`,
        });
      }

      return next();
    });
  }

  const authenticatedProcedure = t.procedure.use(isAuthenticated);

  // Build procedures dynamically from registry
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const procedures: Record<string, any> = {};

  for (const [toolName, tool] of registry.tools) {
    const scopes = tool.requiredScopes ?? ["*"];
    const limit = tool.rateLimit ?? defaultRateLimit;

    // Determine if this should be a mutation (write operation) or query (read)
    const isMutation =
      toolName.startsWith("create") ||
      toolName.startsWith("send") ||
      toolName.startsWith("delete") ||
      toolName.startsWith("update");

    const procedure = authenticatedProcedure
      .use(requireScopes(...scopes))
      .use(rateLimit(limit))
      .input(tool.inputSchema);

    if (tool.outputSchema) {
      const procedureWithOutput = procedure.output(tool.outputSchema);
      if (isMutation) {
        procedures[toolName] = procedureWithOutput.mutation(
          async ({ input, ctx }) => {
            logger?.debug(`Executing tool: ${toolName}`, { input });
            return registry.executeTool(toolName, input, ctx.executionContext);
          }
        );
      } else {
        procedures[toolName] = procedureWithOutput.query(
          async ({ input, ctx }) => {
            logger?.debug(`Executing tool: ${toolName}`, { input });
            return registry.executeTool(toolName, input, ctx.executionContext);
          }
        );
      }
    } else {
      if (isMutation) {
        procedures[toolName] = procedure.mutation(async ({ input, ctx }) => {
          logger?.debug(`Executing tool: ${toolName}`, { input });
          return registry.executeTool(toolName, input, ctx.executionContext);
        });
      } else {
        procedures[toolName] = procedure.query(async ({ input, ctx }) => {
          logger?.debug(`Executing tool: ${toolName}`, { input });
          return registry.executeTool(toolName, input, ctx.executionContext);
        });
      }
    }
  }

  return t.router(procedures);
}

/**
 * Create tRPC context from a request
 */
export function createContextFactory(
  verifyToken: (token: string) => Promise<ExecutionContext | null>
) {
  return async function createTRPCContext(opts: {
    req: Request;
  }): Promise<TRPCContext> {
    const authHeader = opts.req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return { executionContext: null };
    }

    const token = authHeader.slice(7);
    const executionContext = await verifyToken(token);

    return { executionContext };
  };
}

export type TRPCRouter = ReturnType<typeof createTRPCRouter>;
