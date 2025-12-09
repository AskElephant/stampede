/**
 * Example: Using the @askelephant/stampede Framework
 *
 * This file demonstrates how to use the modular stampede framework
 * that was extracted from this PoC. The framework provides:
 *
 * 1. Pluggable sandbox providers (Daytona by default, or your own)
 * 2. Pluggable protocol providers (tRPC by default, or gRPC, GraphQL, etc.)
 * 3. Type-safe tool definitions
 * 4. Built-in authentication, authorization, and rate limiting
 *
 * To use the framework in your own project:
 *
 * ```bash
 * pnpm add @askelephant/stampede @daytonaio/sdk @trpc/server @trpc/client superjson
 * ```
 */

import { z } from "zod";

// These imports would come from the @askelephant/stampede package
// import {
//   Stampede,
//   DaytonaSandboxProvider,
//   TRPCToolBridgeProtocol,
//   defineTool,
//   buildSystemPrompt,
// } from "@askelephant/stampede";

// =============================================================================
// Example: Define Custom Tools
// =============================================================================

/**
 * Example tool: Get current time
 */
export const getCurrentTimeTool = {
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
  execute: async ({ timezone }: { timezone: string }) => {
    const now = new Date();
    return {
      iso: now.toISOString(),
      unix: Math.floor(now.getTime() / 1000),
      readable: now.toLocaleString("en-US", { timeZone: timezone }),
      timezone,
    };
  },
};

/**
 * Example tool: Fetch URL (with security restrictions)
 */
export const fetchUrlTool = {
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
  requiredScopes: ["network:read", "network:admin"],
  rateLimit: 30, // 30 requests per minute
  execute: async ({
    url,
    method = "GET",
    headers,
    body,
  }: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }) => {
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
};

/**
 * Example tool: Search database (mock implementation)
 */
export const searchDatabaseTool = {
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
  requiredScopes: ["db:read", "db:admin"],
  rateLimit: 100,
  execute: async ({
    query,
    table,
    limit = 10,
  }: {
    query: string;
    table: string;
    limit?: number;
  }) => {
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
};

/**
 * Example tool: Send email (mock implementation)
 */
export const sendEmailTool = {
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
  requiredScopes: ["email:send", "email:admin"],
  rateLimit: 10, // Lower limit for email
  execute: async ({
    to,
    subject,
    body,
  }: {
    to: string;
    subject: string;
    body: string;
  }) => {
    // Security: Validate recipient domain
    const allowedDomains = ["example.com", "yourcompany.com"];
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
};

// =============================================================================
// Example: Initialize Stampede (would use the framework)
// =============================================================================

/**
 * Example initialization code (uncomment when using the @askelephant/stampede package)
 */
/*
import {
  Stampede,
  DaytonaSandboxProvider,
  TRPCToolBridgeProtocol,
} from "@askelephant/stampede";

// Create the Stampede instance
export const stampede = new Stampede({
  // Use Daytona sandbox provider (can be swapped for E2B, Docker, etc.)
  sandboxProvider: new DaytonaSandboxProvider({
    apiKey: process.env.DAYTONA_API_KEY,
    apiUrl: process.env.DAYTONA_API_URL,
    target: process.env.DAYTONA_TARGET || "us",
  }),

  // Use tRPC protocol (can be swapped for gRPC, GraphQL, REST, etc.)
  bridgeProtocol: new TRPCToolBridgeProtocol({
    endpointPath: "/api/trpc",
  }),

  // Bridge configuration
  bridgeConfig: {
    serverUrl: process.env.TOOL_BRIDGE_URL || "http://localhost:3000/api/trpc",
    tokenConfig: {
      secretKey: process.env.TOOL_BRIDGE_SECRET || "your-secret-key",
      expirationSeconds: 300,
    },
    enableRateLimiting: true,
    defaultRateLimit: 60,
  },

  // Sandbox configuration
  sandboxConfig: {
    autoStopInterval: 30,
    labels: { purpose: "stampede" },
    network: {
      blockAll: false,
      allowList: ["*"],
    },
  },

  // Register tools
  tools: [
    getCurrentTimeTool,
    fetchUrlTool,
    searchDatabaseTool,
    sendEmailTool,
  ],
});

// Initialize on startup
await stampede.initialize();

// Export for use in API routes
export { stampede };
*/

// =============================================================================
// Example: Next.js API Route (would use the framework)
// =============================================================================

/**
 * Example API route for tRPC bridge
 *
 * Create this file at: app/api/trpc/[trpc]/route.ts
 */
/*
import { stampede } from "@/lib/stampede";

const handler = async (req: Request) => {
  const requestHandler = stampede.getRequestHandler();
  return requestHandler(req);
};

export { handler as GET, handler as POST };
*/

// =============================================================================
// Example: Chat Route with Stampede
// =============================================================================

/**
 * Example chat route implementation
 *
 * Create this file at: app/api/chat/route.ts
 */
/*
import { streamText, convertToModelMessages } from "ai";
import { stampede, buildSystemPrompt } from "@askelephant/stampede";
import { z } from "zod";

export async function POST(req: Request) {
  const { messages } = await req.json();

  // Build system prompt with tool type definitions
  const system = buildSystemPrompt({
    toolTypeDefinitions: stampede.getToolTypeDefinitions(),
    customInstructions: `
      You are a helpful AI assistant with the ability to execute code.
      Use the executeCode tool when you need to:
      - Perform calculations or data analysis
      - Fetch data from APIs
      - Search databases
      - Process data
    `,
  });

  // Create the code execution tool
  const executeCode = {
    description: "Execute TypeScript code in a secure sandbox",
    parameters: z.object({
      code: z.string().describe("TypeScript code to execute"),
    }),
    execute: async ({ code }: { code: string }) => {
      return stampede.executeCode(code, {
        userId: "user-123",
        sessionId: "session-abc",
        scopes: ["*"], // Grant all scopes for this example
      });
    },
  };

  const result = streamText({
    model: "anthropic/claude-sonnet",
    system,
    messages: convertToModelMessages(messages),
    tools: { executeCode },
  });

  return result.toUIMessageStreamResponse();
}
*/

// =============================================================================
// Example: Custom Sandbox Provider
// =============================================================================

/**
 * Example of implementing a custom sandbox provider
 */
/*
import {
  BaseSandboxProvider,
  SandboxConfig,
  CodeExecutionResult,
} from "@askelephant/stampede";

class E2BSandboxProvider extends BaseSandboxProvider {
  readonly name = "e2b";
  
  private e2bClient: any;
  private sandbox: any;

  protected async doInitialize(config: SandboxConfig): Promise<void> {
    // Initialize E2B client
    const { E2B } = await import("@e2b/sdk");
    this.e2bClient = new E2B({ apiKey: config.options?.apiKey as string });
    this.sandbox = await this.e2bClient.sandbox.create();
  }

  protected async doExecuteCode(code: string): Promise<CodeExecutionResult> {
    const startTime = Date.now();
    const result = await this.sandbox.runCode(code);
    
    return {
      success: result.exitCode === 0,
      output: result.stdout || "",
      error: result.stderr,
      exitCode: result.exitCode,
      executionTimeMs: Date.now() - startTime,
      toolCalls: [],
    };
  }

  async uploadFile(content: string | Buffer, path: string): Promise<void> {
    await this.sandbox.filesystem.write(path, content);
  }

  async downloadFile(path: string): Promise<string> {
    return this.sandbox.filesystem.read(path);
  }

  async executeCommand(
    command: string,
    cwd?: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const result = await this.sandbox.process.start({ cmd: command, cwd });
    await result.wait();
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  async installDependencies(packages: Record<string, string>): Promise<void> {
    const packageJson = JSON.stringify({
      dependencies: packages,
    });
    await this.uploadFile(packageJson, "/home/user/package.json");
    await this.executeCommand("npm install");
  }

  protected async doCleanup(): Promise<void> {
    await this.sandbox?.close();
  }
}
*/

// =============================================================================
// Example: Custom Protocol Provider
// =============================================================================

/**
 * Example of implementing a custom protocol provider (GraphQL)
 */
/*
import {
  BaseToolBridgeProtocol,
  ToolBridgeConfig,
  ToolRegistry,
  ExecutionContext,
  RequestHandler,
  } from "@askelephant/stampede";

class GraphQLToolBridgeProtocol extends BaseToolBridgeProtocol {
  readonly name = "graphql";

  private schema: any;

  protected async doInitialize(
    config: ToolBridgeConfig,
    registry: ToolRegistry
  ): Promise<void> {
    // Build GraphQL schema from tool registry
    this.schema = this.buildSchemaFromRegistry(registry);
  }

  private buildSchemaFromRegistry(registry: ToolRegistry) {
    // Generate GraphQL schema from tool definitions
    // ...implementation details...
  }

  generateClientRuntime(
    bridgeUrl: string,
    executionToken: string,
    toolNames: string[]
  ): string {
    const mutations = toolNames.map(name => `
      async ${name}(input) {
        const response = await fetch("${bridgeUrl}", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer ${executionToken}",
          },
          body: JSON.stringify({
            query: \`mutation ${name}($input: ${name}Input!) {
              ${name}(input: $input) {
                ... on ${name}Output
              }
            }\`,
            variables: { input },
          }),
        });
        const { data, errors } = await response.json();
        if (errors) throw new Error(errors[0].message);
        return data.${name};
      }
    `);

    return \`const tools = { \${mutations.join(",\\n")} };\`;
  }

  createRequestHandler(): RequestHandler {
    return async (request: Request): Promise<Response> => {
      // Handle GraphQL requests
      const { query, variables } = await request.json();
      // Execute query against schema
      // ...implementation details...
      return new Response(JSON.stringify({ data: {} }));
    };
  }

  async createExecutionToken(context: ExecutionContext): Promise<string> {
    // JWT token creation
    // ...implementation details...
    return "token";
  }

  async verifyExecutionToken(token: string): Promise<ExecutionContext | null> {
    // JWT verification
    // ...implementation details...
    return null;
  }

  getContentType(): string {
    return "application/json";
  }
}
*/
