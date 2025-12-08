# Code Mode Demo

A Next.js application demonstrating the **Code Mode** paradigm for AI tool execution, inspired by [Anthropic's Code Execution with MCP](https://www.anthropic.com/engineering/claude-code-sandbox) and [Cloudflare's Code Mode](https://blog.cloudflare.com/code-mode/) blog posts.

## What is Code Mode?

Instead of exposing tools directly to an LLM via traditional tool calling, **Code Mode** presents tools as a TypeScript API. The LLM writes code that calls this API, which is then executed in a secure sandbox.

### Why Code Mode?

| Traditional Tool Calls | Code Mode |
|------------------------|-----------|
| One tool call at a time | Compose multiple calls in single execution |
| Results flow through LLM context | Intermediate results stay in sandbox |
| Limited to simple operations | Full programming logic (loops, conditionals) |
| High token usage | Efficient - only final output to LLM |
| LLMs see synthetic training data | LLMs leverage real TypeScript knowledge |

**Key insight:** LLMs are much better at writing TypeScript code than making tool calls, because they've seen millions of real-world TypeScript examples in training.

## Architecture

### Basic Code Mode Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   User Query    │────▶│   LLM (Claude)   │────▶│   TypeScript    │
│                 │     │                  │     │   Code          │
│ "Calculate      │     │ Writes code that │     │                 │
│  Fibonacci"     │     │ uses available   │     │ const fib = ... │
│                 │     │ APIs             │     │ console.log()   │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Response to   │◀────│   LLM interprets │◀────│  Daytona        │
│   User          │     │   results        │     │  Sandbox        │
│                 │     │                  │     │  (executes code)│
│ "The sequence   │     │                  │     │                 │
│  is: 0,1,1,2.." │     │                  │     │  Output: ...    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Secure Tool Bridge Architecture

For production systems where tools need access to your database and services:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              YOUR APPLICATION                                │
│                                                                             │
│  ┌─────────────┐    1. Create execution token    ┌───────────────────────┐ │
│  │   Chat API  │ ─────────────────────────────▶  │  Token Generator      │ │
│  │   Route     │    (userId, scopes, orgId)      │  - Short-lived (5min) │ │
│  └──────┬──────┘                                 │  - Scoped permissions │ │
│         │                                        └───────────────────────┘ │
│         │ 2. Pass token to sandbox                                         │
│         ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     DAYTONA SANDBOX (Isolated)                       │   │
│  │                                                                      │   │
│  │  const result = await tools.searchDatabase({                        │   │
│  │    query: "wireless headphones",                                    │   │
│  │    table: "products"                                                │   │
│  │  });                                                                │   │
│  │                                                                      │   │
│  │  // tools.* calls go through the bridge with the token              │   │
│  │  // ⚠️ NO DATABASE CREDENTIALS IN SANDBOX                           │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                 │                                          │
│                                 │ 3. HTTP POST with Bearer token           │
│                                 ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     TOOL BRIDGE ENDPOINT                             │   │
│  │                     /api/tool-bridge                                 │   │
│  │                                                                      │   │
│  │  ✓ Verify JWT token                                                 │   │
│  │  ✓ Check authorization (scopes)                                     │   │
│  │  ✓ Apply rate limiting                                              │   │
│  │  ✓ Multi-tenant isolation (filter by orgId)                         │   │
│  │  ✓ Block internal URLs (SSRF protection)                            │   │
│  │  ✓ Audit logging                                                    │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                 │                                          │
│                                 │ 4. Execute with full access              │
│                                 ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     YOUR SERVICES                                    │   │
│  │                                                                      │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │   │
│  │  │  PostgreSQL │  │   Redis     │  │  SendGrid   │                  │   │
│  │  │  Database   │  │   Cache     │  │   Email     │                  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                  │   │
│  │                                                                      │   │
│  │  🔐 Full credentials available                                       │   │
│  │  🔐 Connection pooling                                               │   │
│  │  🔐 Audit trails                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Security Features

### 1. Short-Lived, Scoped Tokens

```typescript
const token = await createExecutionToken(config, {
  userId: "user_123",
  sessionId: "session_abc",
  organizationId: "org_456",
  scopes: ["db:read", "network:read"], // Only grant needed permissions
});
```

### 2. Scope-Based Authorization

```typescript
const TOOL_SCOPES = {
  searchDatabase: ["db:read", "db:admin"],
  sendEmail: ["email:send", "email:admin"],
  deleteRecord: ["db:delete", "db:admin"],
  executeRawQuery: ["db:admin"], // Admin only
};
```

### 3. Multi-Tenant Data Isolation

```typescript
async searchDatabase(input, context) {
  return db.query(
    `SELECT * FROM products 
     WHERE organization_id = $1  -- Always filter by tenant!
     AND name ILIKE $2`,
    [context.organizationId, `%${input.query}%`]
  );
}
```

### 4. SSRF Protection

```typescript
const blockedPatterns = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/10\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/.*\.internal/i,
];
```

### 5. Rate Limiting

```typescript
const rateLimit = checkRateLimit(userId, 60); // 60 requests/minute
if (!rateLimit.allowed) {
  return { error: "Rate limit exceeded", retryAfter: rateLimit.resetIn };
}
```

### 6. Audit Logging

```typescript
console.log(JSON.stringify({
  type: "tool_execution",
  tool: "searchDatabase",
  userId: context.userId,
  organizationId: context.organizationId,
  success: true,
  durationMs: 45,
  timestamp: new Date().toISOString(),
}));
```

## Getting Started

### Prerequisites

- Node.js 18+
- A [Daytona](https://daytona.io) account for sandbox execution
- An LLM API key (Anthropic, OpenAI, or Google)

### Environment Variables

Create a `.env` file:

```bash
# Daytona Sandbox
DAYTONA_API_KEY=your-daytona-api-key
DAYTONA_API_URL=https://app.daytona.io/api
DAYTONA_TARGET=us

# LLM Provider (choose one)
ANTHROPIC_API_KEY=your-anthropic-key
# or
OPENAI_API_KEY=your-openai-key
# or
GOOGLE_GENERATIVE_AI_API_KEY=your-google-key

# Tool Bridge Security (for production)
TOOL_BRIDGE_SECRET=your-secret-key-min-32-chars
TOOL_BRIDGE_URL=https://your-domain.com/api/tool-bridge
```

### Installation

```bash
npm install
npm run dev
```

Open [http://localhost:3000/chat](http://localhost:3000/chat) to try the Code Mode chat interface.

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── chat/
│   │   │   └── route.ts          # Chat API with Code Mode
│   │   └── tool-bridge/
│   │       └── route.ts          # Secure tool execution endpoint
│   └── chat/
│       └── page.tsx              # Chat UI
├── components/
│   └── ai-elements/
│       ├── code-execution.tsx    # Code execution display component
│       └── ...
└── lib/
    └── code-mode/
        ├── index.ts              # Main exports and createCodeMode()
        ├── sandbox.ts            # Daytona sandbox management
        ├── sandbox-types.ts      # TypeScript API definitions for LLM
        ├── sandbox-with-tools.ts # Sandbox with custom tools
        ├── tool-registry.ts      # Tool definition and registration
        └── tool-bridge.ts        # Secure RPC bridge implementation
```

## Usage Examples

### Basic Code Mode

```typescript
import { createCodeMode } from "@/lib/code-mode";

const { system, tools } = createCodeMode({
  additionalInstructions: "Focus on data analysis tasks"
});

const result = streamText({
  model: "anthropic/claude-sonnet",
  system,
  tools,
  messages,
});
```

### With Custom Tools

```typescript
import { createCodeMode } from "@/lib/code-mode";

const { system, tools } = createCodeMode({
  withTools: true, // Enable custom tools
  additionalInstructions: "You have access to database and email tools"
});
```

### Defining Custom Tools

```typescript
import { defineTool, createToolRegistry } from "@/lib/code-mode";
import { z } from "zod";

const myTool = defineTool({
  name: "searchProducts",
  description: "Search the product catalog",
  inputSchema: z.object({
    query: z.string(),
    category: z.string().optional(),
  }),
  outputSchema: z.object({
    products: z.array(z.object({
      id: z.string(),
      name: z.string(),
      price: z.number(),
    })),
  }),
  execute: async ({ query, category }) => {
    // Your implementation here
    return { products: [...] };
  },
});

const registry = createToolRegistry();
registry.register(myTool);
```

## Key Files

| File | Purpose |
|------|---------|
| `sandbox.ts` | Manages Daytona sandbox lifecycle |
| `sandbox-types.ts` | TypeScript definitions injected into LLM context |
| `tool-registry.ts` | Define and register custom tools |
| `tool-bridge.ts` | Secure RPC layer for production tools |
| `code-execution.tsx` | React component for displaying execution results |

## References

- [Anthropic: Code Execution with MCP](https://www.anthropic.com/engineering/claude-code-sandbox)
- [Cloudflare: Code Mode - The Better Way to Use MCP](https://blog.cloudflare.com/code-mode/)
- [Daytona SDK Documentation](https://www.daytona.io/docs)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)

## License

MIT
