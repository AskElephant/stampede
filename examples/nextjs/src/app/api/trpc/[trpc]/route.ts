/**
 * tRPC API Route Handler
 *
 * This provides the type-safe tool bridge endpoint.
 * All tool calls from the sandbox go through this route.
 *
 * The CodeMode instance handles:
 * - Token verification
 * - Scope-based authorization
 * - Rate limiting
 * - Tool execution
 */

import { getCodeMode } from "@/lib/code-mode";

const handler = async (req: Request) => {
  const codeMode = getCodeMode();

  // Ensure CodeMode is initialized
  if (!(await codeMode.isReady())) {
    await codeMode.initialize();
  }

  // Get the request handler from the bridge protocol
  const requestHandler = codeMode.getRequestHandler();
  return requestHandler(req);
};

export { handler as GET, handler as POST };
