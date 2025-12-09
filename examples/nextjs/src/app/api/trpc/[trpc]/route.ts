/**
 * tRPC API Route Handler
 *
 * This provides the type-safe tool bridge endpoint.
 * All tool calls from the sandbox go through this route.
 *
 * The Stampede instance handles:
 * - Token verification
 * - Scope-based authorization
 * - Rate limiting
 * - Tool execution
 */

import { getStampede } from "@/lib/stampede";

const handler = async (req: Request) => {
  const stampede = getStampede();

  // Ensure Stampede is initialized
  if (!(await stampede.isReady())) {
    await stampede.initialize();
  }

  // Get the request handler from the bridge protocol
  const requestHandler = stampede.getRequestHandler();
  return requestHandler(req);
};

export { handler as GET, handler as POST };
