/**
 * Stampede Configuration
 *
 * This file configures the Stampede instance for the application.
 * It uses the @askelephant/stampede package to set up:
 * - Daytona sandbox provider for code execution
 * - tRPC protocol for secure tool communication
 * - Custom tools that can be called from sandbox code
 */

import { z } from "zod";
import {
  Stampede,
  DaytonaSandboxProvider,
  TRPCToolBridgeProtocol,
  defineTool,
  buildSystemPrompt,
  STAMPEDE_SYSTEM_PROMPT,
  SANDBOX_TYPE_DEFINITIONS,
  withStampede,
  type ToolDefinition,
} from "@askelephant/stampede";

// =============================================================================
// Custom Tool Definitions
// =============================================================================

/**
 * Tool: Get current time
 */
export const getCurrentTimeTool = defineTool({
  name: "getCurrentTime",
  description: "Get the current date and time in various formats",
  inputSchema: z.object({
    timezone: z
      .string()
      .optional()
      .default("UTC")
      .describe("Timezone (e.g., 'America/New_York')"),
  }),
  outputSchema: z.object({
    iso: z.string(),
    unix: z.number(),
    readable: z.string(),
    timezone: z.string(),
  }),
  requiredScopes: ["*"], // Available to everyone
  execute: async ({ timezone }) => {
    const now = new Date();
    return {
      iso: now.toISOString(),
      unix: Math.floor(now.getTime() / 1000),
      readable: now.toLocaleString("en-US", { timeZone: timezone }),
      timezone,
    };
  },
});

/**
 * Tool: Fetch URL (with security restrictions)
 */
export const fetchUrlTool = defineTool({
  name: "fetchUrl",
  description: "Fetch content from a URL (external URLs only)",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to fetch"),
    method: z
      .enum(["GET", "POST", "PUT", "DELETE"])
      .optional()
      .default("GET")
      .describe("HTTP method"),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe("HTTP headers"),
    body: z.string().optional().describe("Request body for POST/PUT"),
  }),
  outputSchema: z.object({
    status: z.number(),
    headers: z.record(z.string(), z.string()),
    body: z.string(),
  }),
  requiredScopes: ["network:read", "network:admin", "*"],
  rateLimit: 30,
  execute: async ({ url, method = "GET", headers, body }) => {
    // Security: Block internal/private URLs
    const blockedPatterns = [
      /^https?:\/\/localhost/i,
      /^https?:\/\/127\./,
      /^https?:\/\/10\./,
      /^https?:\/\/192\.168\./,
      /^https?:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\./,
    ];

    if (blockedPatterns.some((pattern) => pattern.test(url))) {
      throw new Error("Access to internal URLs is not allowed");
    }

    const response = await fetch(url, {
      method,
      headers: headers as HeadersInit | undefined,
      body,
    });

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  },
});

/**
 * Tool: Search database (mock implementation)
 */
export const searchDatabaseTool = defineTool({
  name: "searchDatabase",
  description: "Search the database for records matching a query",
  inputSchema: z.object({
    query: z.string().min(1).max(500).describe("The search query"),
    table: z
      .enum(["products", "orders", "customers", "inventory"])
      .describe("Table to search in"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(10)
      .describe("Maximum results"),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        data: z.record(z.string(), z.unknown()),
      })
    ),
    totalCount: z.number(),
    hasMore: z.boolean(),
  }),
  requiredScopes: ["db:read", "db:admin", "*"],
  rateLimit: 100,
  execute: async ({ query, table, limit = 10 }) => {
    // Mock implementation - replace with actual database query
    console.log(`[DB] Searching ${table} for "${query}" (limit: ${limit})`);

    return {
      results: [
        {
          id: "prod_1",
          name: `${query} Result 1`,
          data: { price: 29.99, category: "Electronics" },
        },
        {
          id: "prod_2",
          name: `${query} Result 2`,
          data: { price: 49.99, category: "Electronics" },
        },
      ],
      totalCount: 2,
      hasMore: false,
    };
  },
});

/**
 * Tool: Send email (mock implementation)
 */
export const sendEmailTool = defineTool({
  name: "sendEmail",
  description: "Send an email to a recipient",
  inputSchema: z.object({
    to: z.string().email().describe("Recipient email address"),
    subject: z.string().min(1).max(200).describe("Email subject"),
    body: z.string().min(1).max(10000).describe("Email body"),
    isHtml: z.boolean().optional().default(false).describe("Is HTML content"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.string(),
    sentAt: z.date(),
  }),
  requiredScopes: ["email:send", "email:admin", "*"],
  rateLimit: 10,
  execute: async ({ to, subject, body }) => {
    // Security: Validate recipient domain
    const allowedDomains = ["example.com", "askelephant.ai"];
    const domain = to.split("@")[1];

    if (!allowedDomains.includes(domain)) {
      throw new Error(
        `Cannot send to domain "${domain}". Allowed: ${allowedDomains.join(
          ", "
        )}`
      );
    }

    console.log(`[EMAIL] Sending to ${to}: ${subject}`);

    return {
      success: true,
      messageId: `msg_${Date.now()}`,
      sentAt: new Date(),
    };
  },
});

// =============================================================================
// Stampede Instance
// =============================================================================

let stampedeInstance: Stampede | null = null;

/**
 * Get or create the Stampede instance
 */
export function getStampede(): Stampede {
  if (!stampedeInstance) {
    stampedeInstance = new Stampede({
      // Daytona sandbox provider for secure code execution
      sandboxProvider: new DaytonaSandboxProvider({
        apiKey: process.env.DAYTONA_API_KEY,
        apiUrl: process.env.DAYTONA_API_URL || "https://app.daytona.io/api",
        target: process.env.DAYTONA_TARGET || "us",
        sandboxLabel: "stampede-trpc-network-v2",
      }),

      // tRPC protocol for type-safe tool communication
      bridgeProtocol: new TRPCToolBridgeProtocol({
        endpointPath: "/api/trpc",
      }),

      // Bridge configuration
      bridgeConfig: {
        serverUrl:
          process.env.TOOL_BRIDGE_URL ||
          "http://host.docker.internal:3000/api/trpc",
        tokenConfig: {
          secretKey:
            process.env.TOOL_BRIDGE_SECRET ||
            "your-secret-key-change-in-production",
          expirationSeconds: 300,
        },
        enableRateLimiting: true,
        defaultRateLimit: 60,
      },

      // Sandbox configuration
      sandboxConfig: {
        autoStopInterval: 30,
        labels: { purpose: "stampede-trpc-network-v2" },
        network: {
          blockAll: false,
          // allowList: ["*"],
        },
      },

      // Register custom tools (cast to ToolDefinition[] for type compatibility)
      tools: [
        getCurrentTimeTool,
        fetchUrlTool,
        searchDatabaseTool,
        sendEmailTool,
      ] as ToolDefinition[],
    });
  }

  return stampedeInstance;
}

// =============================================================================
// AI SDK Integration
// =============================================================================

/**
 * Create the stampede function with our pre-configured Stampede instance.
 *
 * This provides a clean, ergonomic API for integrating with the AI SDK:
 *
 * @example
 * ```typescript
 * import { aiStampede } from "@/lib/stampede";
 *
 * const { system, tools } = aiStampede({
 *   system: "You are a helpful assistant",
 * });
 *
 * const stream = streamText({
 *   model: openai("gpt-4"),
 *   system,
 *   tools,
 *   messages,
 * });
 * ```
 */
export const aiStampede = withStampede(() => getStampede());

// Re-export useful items from the package
export {
  Stampede,
  buildSystemPrompt,
  STAMPEDE_SYSTEM_PROMPT,
  SANDBOX_TYPE_DEFINITIONS,
  defineTool,
};
