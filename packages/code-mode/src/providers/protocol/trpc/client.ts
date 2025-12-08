/**
 * tRPC Client Runtime Generator
 *
 * This module generates the client-side code that gets injected into the sandbox.
 * The generated code creates a `tools` object that makes tRPC calls back to the server.
 */

/**
 * Options for generating the client runtime
 */
export interface TRPCClientRuntimeOptions {
  /**
   * URL of the tRPC server
   */
  bridgeUrl: string;

  /**
   * JWT execution token for authentication
   */
  executionToken: string;

  /**
   * Names of tools to include
   */
  toolNames: string[];

  /**
   * Tool names that should be mutations (write operations)
   * Others are treated as queries (read operations)
   */
  mutations?: string[];
}

/**
 * Generate the tRPC client runtime code for injection into sandbox
 */
export function generateTRPCClientRuntime(
  options: TRPCClientRuntimeOptions
): string {
  const { bridgeUrl, executionToken, toolNames, mutations = [] } = options;

  // Default mutations based on naming convention
  const mutationTools = new Set([
    ...mutations,
    ...toolNames.filter(
      (name) =>
        name.startsWith("create") ||
        name.startsWith("send") ||
        name.startsWith("delete") ||
        name.startsWith("update")
    ),
  ]);

  const toolProxyMethods = toolNames.map((name) => {
    const isMutation = mutationTools.has(name);
    const trpcMethod = isMutation ? "mutate" : "query";

    return `
  async ${name}(input: any) {
    const startTime = Date.now();
    console.log('[TOOL_CALL:${name}]', JSON.stringify(input));
    
    try {
      const result = await trpcClient.${name}.${trpcMethod}(input);
      const durationMs = Date.now() - startTime;
      console.log('[TOOL_RESULT:${name}]', JSON.stringify({ durationMs, success: true }));
      return result;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      console.log('[TOOL_ERROR:${name}]', JSON.stringify({ 
        durationMs, 
        success: false, 
        error: error.message || 'Unknown error' 
      }));
      throw error;
    }
  }`;
  });

  return `// @ts-nocheck
// =============================================================================
// Auto-generated tRPC Client Runtime
// =============================================================================

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';

// Configuration
const TOOL_BRIDGE_URL = '${bridgeUrl}';
const EXECUTION_TOKEN = '${executionToken}';

// Create the tRPC client
const trpcClient: any = createTRPCClient({
  links: [
    httpBatchLink({
      url: TOOL_BRIDGE_URL,
      headers: () => ({
        'Authorization': \`Bearer \${EXECUTION_TOKEN}\`,
        'Content-Type': 'application/json',
      }),
      transformer: superjson,
    }),
  ],
});

// =============================================================================
// Tool Proxy - Wraps tRPC calls with logging
// =============================================================================

const tools = {${toolProxyMethods.join(",\n")}
};
`;
}

/**
 * Generate a minimal fetch-based client runtime
 * This can be used when you don't want to install @trpc/client in the sandbox
 */
export function generateFetchClientRuntime(
  options: TRPCClientRuntimeOptions
): string {
  const { bridgeUrl, executionToken, toolNames, mutations = [] } = options;

  const mutationTools = new Set([
    ...mutations,
    ...toolNames.filter(
      (name) =>
        name.startsWith("create") ||
        name.startsWith("send") ||
        name.startsWith("delete") ||
        name.startsWith("update")
    ),
  ]);

  const toolMethods = toolNames.map((name) => {
    const isMutation = mutationTools.has(name);
    const type = isMutation ? "mutation" : "query";

    return `
  async ${name}(input: any) {
    const startTime = Date.now();
    console.log('[TOOL_CALL:${name}]', JSON.stringify(input));
    
    try {
      const response = await fetch(\`\${TOOL_BRIDGE_URL}/${name}?batch=1\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${EXECUTION_TOKEN}\`,
        },
        body: JSON.stringify({
          "0": { json: input, meta: { values: {} } }
        }),
      });
      
      if (!response.ok) {
        throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
      }
      
      const data = await response.json();
      const result = data[0]?.result?.data?.json;
      
      if (data[0]?.error) {
        throw new Error(data[0].error.message || 'Tool execution failed');
      }
      
      const durationMs = Date.now() - startTime;
      console.log('[TOOL_RESULT:${name}]', JSON.stringify({ durationMs, success: true }));
      return result;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      console.log('[TOOL_ERROR:${name}]', JSON.stringify({ 
        durationMs, 
        success: false, 
        error: error.message || 'Unknown error' 
      }));
      throw error;
    }
  }`;
  });

  return `// @ts-nocheck
// =============================================================================
// Auto-generated Fetch-based Client Runtime
// =============================================================================

const TOOL_BRIDGE_URL = '${bridgeUrl}';
const EXECUTION_TOKEN = '${executionToken}';

const tools = {${toolMethods.join(",\n")}
};
`;
}
