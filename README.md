# @askelephant/stampede

A modular framework for executing LLM-generated code in secure sandboxes with pluggable sandbox providers and RPC protocols.

## Overview

This framework implements the "Code Mode" paradigm for AI assistants, where instead of exposing tools directly to the LLM, we present them as a TypeScript API. The LLM writes code that calls this API, which is then executed in a secure sandbox.

### Benefits

- **Better tool usage**: LLMs are better at writing TypeScript than making function calls
- **Composition**: Multiple operations can be composed in a single execution
- **Efficiency**: Intermediate results stay in the sandbox, reducing context usage
- **Type safety**: Full TypeScript type definitions for the LLM
- **Pluggable**: Swap out sandbox providers and RPC protocols as needed

## Installation

```bash
# Core package
pnpm add @askelephant/stampede

# Required peer dependencies (based on your providers)
pnpm add @daytonaio/sdk        # For Daytona sandbox provider
pnpm add @trpc/server @trpc/client superjson  # For tRPC protocol
```

## Quick Start

```typescript
import {
  CodeMode,
  DaytonaSandboxProvider,
  TRPCToolBridgeProtocol,
  defineTool,
} from "@askelephant/stampede";
import { z } from "zod";

// 1. Define your custom tools
const getCurrentTime = defineTool({
  name: "getCurrentTime",
  description: "Get the current date and time",
  inputSchema: z.object({
    timezone: z.string().optional().default("UTC"),
  }),
  outputSchema: z.object({
    iso: z.string(),
    unix: z.number(),
    readable: z.string(),
  }),
  execute: async ({ timezone }) => {
    const now = new Date();
    return {
      iso: now.toISOString(),
      unix: Math.floor(now.getTime() / 1000),
      readable: now.toLocaleString("en-US", { timeZone: timezone }),
    };
  },
});

const fetchUrl = defineTool({
  name: "fetchUrl",
  description: "Fetch data from a URL",
  inputSchema: z.object({
    url: z.string().url(),
    method: z.enum(["GET", "POST"]).default("GET"),
  }),
  outputSchema: z.object({
    status: z.number(),
    body: z.string(),
  }),
  requiredScopes: ["network:read"],
  execute: async ({ url, method }) => {
    const response = await fetch(url, { method });
    return {
      status: response.status,
      body: await response.text(),
    };
  },
});

// 2. Create CodeMode instance
const codeMode = new CodeMode({
  sandboxProvider: new DaytonaSandboxProvider({
    apiKey: process.env.DAYTONA_API_KEY,
  }),
  bridgeProtocol: new TRPCToolBridgeProtocol(),
  bridgeConfig: {
    serverUrl: "http://localhost:3000/api/trpc",
    tokenConfig: {
      secretKey: process.env.SECRET_KEY!,
    },
    enableRateLimiting: true,
  },
  tools: [getCurrentTime, fetchUrl],
});

// 3. Initialize
await codeMode.initialize();

// 4. Execute code
const result = await codeMode.executeCode(`
  const time = await tools.getCurrentTime({ timezone: "America/New_York" });
  console.log("Current time:", time.readable);

  const data = await tools.fetchUrl({ url: "https://api.example.com/data" });
  console.log("Response status:", data.status);
`);

console.log(result.output);
// Current time: 12/8/2025, 3:45:00 PM
// Response status: 200
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your Application                          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                         CodeMode                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  Tool Registry  │  │ Sandbox Provider│  │ Bridge Protocol │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
          │                      │                      │
          ▼                      ▼                      ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐
│  Your Custom    │  │    Daytona      │  │        tRPC         │
│     Tools       │  │  (or E2B, etc)  │  │ (or gRPC, GraphQL)  │
└─────────────────┘  └─────────────────┘  └─────────────────────┘
```

## Creating Custom Providers

### Custom Sandbox Provider

```typescript
import {
  BaseSandboxProvider,
  SandboxConfig,
  CodeExecutionResult,
} from "@askelephant/stampede";

class E2BSandboxProvider extends BaseSandboxProvider {
  readonly name = "e2b";

  protected async doInitialize(config: SandboxConfig): Promise<void> {
    // Initialize E2B client
    this.e2bClient = new E2B({ apiKey: config.options?.apiKey });
    this.sandbox = await this.e2bClient.create();
  }

  protected async doExecuteCode(code: string): Promise<CodeExecutionResult> {
    const result = await this.sandbox.execute(code);
    return {
      success: result.exitCode === 0,
      output: result.stdout,
      error: result.stderr,
      exitCode: result.exitCode,
      executionTimeMs: result.duration,
      toolCalls: [],
    };
  }

  protected async doCleanup(): Promise<void> {
    await this.sandbox?.close();
  }
}
```

### Custom Protocol Provider

```typescript
import {
  BaseToolBridgeProtocol,
  ToolBridgeConfig,
  ToolRegistry,
} from "@askelephant/stampede";

class GraphQLToolBridgeProtocol extends BaseToolBridgeProtocol {
  readonly name = "graphql";

  protected async doInitialize(
    config: ToolBridgeConfig,
    registry: ToolRegistry
  ): Promise<void> {
    // Build GraphQL schema from registry
    this.schema = buildSchemaFromRegistry(registry);
  }

  generateClientRuntime(
    bridgeUrl: string,
    token: string,
    toolNames: string[]
  ): string {
    return `
      const tools = {
        ${toolNames
          .map(
            (name) => `
        async ${name}(input) {
          const response = await fetch("${bridgeUrl}", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer ${token}",
            },
            body: JSON.stringify({
              query: \`mutation { ${name}(input: $input) { ... } }\`,
              variables: { input },
            }),
          });
          return response.json();
        }`
          )
          .join(",")}
      };
    `;
  }

  createRequestHandler() {
    return async (request: Request) => {
      // Handle GraphQL requests
    };
  }
}
```

## Using with AI SDK

The package provides a clean, ergonomic API for integrating with the Vercel AI SDK:

```typescript
import { codemode } from "@askelephant/stampede/ai";
import { streamText } from "ai";

// Create a configured codemode function
const { system, tools, initialize } = codemode({
  system: "You are a helpful assistant",
  codeModeOptions: {
    sandboxProvider: new DaytonaSandboxProvider({ apiKey: process.env.DAYTONA_API_KEY }),
    bridgeProtocol: new TRPCToolBridgeProtocol(),
    bridgeConfig: {
      serverUrl: "http://localhost:3000/api/trpc",
      tokenConfig: { secretKey: process.env.SECRET_KEY },
    },
    tools: [myCustomTool],
  },
});

// Initialize before first use
await initialize();

// Use with streamText - it's that simple!
const stream = streamText({
  model: openai("gpt-4"),
  system,
  tools,
  messages: [{ role: "user", content: "What time is it in New York?" }],
});
```

### Using withCodeMode for Reusable Configuration

For applications where you configure CodeMode once and reuse it:

```typescript
// lib/codemode.ts
import { withCodeMode, CodeMode, DaytonaSandboxProvider, TRPCToolBridgeProtocol } from "@askelephant/stampede";

// Configure your CodeMode instance
const codeModeInstance = new CodeMode({
  sandboxProvider: new DaytonaSandboxProvider({ apiKey: process.env.DAYTONA_API_KEY }),
  bridgeProtocol: new TRPCToolBridgeProtocol(),
  bridgeConfig: {
    serverUrl: process.env.TOOL_BRIDGE_URL,
    tokenConfig: { secretKey: process.env.SECRET_KEY },
  },
  tools: [getCurrentTimeTool, fetchUrlTool],
});

// Export a pre-configured codemode function
export const codemode = withCodeMode(codeModeInstance);
```

```typescript
// app/api/chat/route.ts
import { codemode } from "@/lib/codemode";
import { streamText } from "ai";

export async function POST(req: Request) {
  const { messages } = await req.json();

  const { system, tools } = codemode({
    system: "You are a helpful coding assistant",
  });

  const stream = streamText({
    model: "openai/gpt-4",
    system,
    tools,
    messages,
  });

  return stream.toUIMessageStreamResponse();
}
```

### Passing Additional Tools

You can also pass additional AI SDK tools to merge with executeCode:

```typescript
import { codemode } from "@/lib/codemode";
import { tool } from "ai";
import { z } from "zod";

const { system, tools } = codemode({
  system: "You are a helpful assistant",
  tools: {
    getWeather: tool({
      description: "Get current weather",
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => fetchWeather(city),
    }),
  },
});
```

## API Route Setup (Next.js)

```typescript
// app/api/trpc/[trpc]/route.ts
import { codeMode } from "@/lib/stampede";

const handler = async (req: Request) => {
  const requestHandler = codeMode.getRequestHandler();
  return requestHandler(req);
};

export { handler as GET, handler as POST };
```

## Security

The framework includes several security features:

- **JWT tokens**: Short-lived, scoped tokens for sandbox-to-server communication
- **Scope-based authorization**: Tools can require specific scopes
- **Rate limiting**: Configurable per-tool or global rate limits
- **Multi-tenant isolation**: Organization ID in execution context
- **Input validation**: Zod schemas validate all tool inputs

## API Reference

### CodeMode

The main class that orchestrates the code execution system.

```typescript
const codeMode = new CodeMode({
  sandboxProvider: SandboxProvider,
  bridgeProtocol: ToolBridgeProtocol,
  bridgeConfig: ToolBridgeConfig,
  sandboxConfig?: SandboxConfig,
  logger?: Logger,
  tools?: ToolDefinition[],
});

// Methods
await codeMode.initialize();
await codeMode.executeCode(code, config?);
codeMode.registerTool(tool);
codeMode.getToolTypeDefinitions();
codeMode.getRequestHandler();
await codeMode.cleanup();
```

### defineTool

Helper function for defining type-safe tools.

```typescript
const myTool = defineTool({
  name: string,
  description: string,
  inputSchema: ZodSchema,
  outputSchema?: ZodSchema,
  requiredScopes?: string[],
  rateLimit?: number,
  execute: (input, context) => Promise<output>,
});
```

### ExecutionContext

Context passed to tool executions.

```typescript
interface ExecutionContext {
  userId: string;
  sessionId: string;
  organizationId?: string;
  scopes: string[];
  metadata?: Record<string, unknown>;
}
```

## License

MIT
