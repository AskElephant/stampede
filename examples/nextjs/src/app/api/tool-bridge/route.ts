/**
 * Tool Bridge Health Check Endpoint
 *
 * This provides a simple health check and debugging endpoint.
 * The actual tool execution is handled by the tRPC endpoint at /api/trpc.
 *
 * Use this endpoint to:
 * - Check if the service is running
 * - See what tools are available
 * - Debug tool bridge configuration
 */

import { getCodeMode } from "@/lib/code-mode";

// Health check endpoint
export async function GET() {
  const codeMode = getCodeMode();
  const registry = codeMode.getToolRegistry();
  const toolNames = registry.getToolNames();

  return new Response(
    JSON.stringify({
      status: "healthy",
      bridge: "tRPC",
      endpoint: "/api/trpc",
      availableTools: toolNames,
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

// POST is handled by tRPC at /api/trpc
export async function POST() {
  return new Response(
    JSON.stringify({
      error: "Tool execution is handled by tRPC",
      redirect: "/api/trpc",
      hint: "Use the tRPC endpoint for tool calls",
    }),
    {
      status: 308,
      headers: {
        "Content-Type": "application/json",
        Location: "/api/trpc",
      },
    }
  );
}
