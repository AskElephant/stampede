/**
 * Code Mode - The Main Entry Point
 *
 * This is the main class that orchestrates the code execution system.
 * It brings together:
 * - Sandbox providers (for code execution)
 * - Tool bridge protocols (for RPC communication)
 * - Tool registry (for managing available tools)
 *
 * @example
 * ```typescript
 * import { CodeMode, DaytonaSandboxProvider, TRPCToolBridgeProtocol } from "@askelephant/code-mode";
 *
 * // Create the code mode instance
 * const codeMode = new CodeMode({
 *   sandboxProvider: new DaytonaSandboxProvider({
 *     apiKey: process.env.DAYTONA_API_KEY,
 *   }),
 *   bridgeProtocol: new TRPCToolBridgeProtocol(),
 *   bridgeConfig: {
 *     serverUrl: "http://localhost:3000/api/trpc",
 *     tokenConfig: { secretKey: process.env.SECRET_KEY },
 *   },
 * });
 *
 * // Register tools
 * codeMode.registerTool(myCustomTool);
 *
 * // Initialize
 * await codeMode.initialize();
 *
 * // Execute code
 * const result = await codeMode.executeCode(`
 *   const time = await tools.getCurrentTime({ timezone: "UTC" });
 *   console.log(time);
 * `);
 * ```
 */

import type { SandboxProvider } from "./sandbox-provider";
import type {
  ToolBridgeProtocol,
  RequestHandler,
} from "./tool-bridge-protocol";
import { createToolRegistry, type ToolRegistry } from "./tool-registry";
import type {
  ToolDefinition,
  ExecutionContext,
  ExecutionConfig,
  CodeExecutionResult,
  ToolBridgeConfig,
  SandboxConfig,
  Logger,
} from "./types";

/**
 * Configuration options for CodeMode
 */
export interface CodeModeOptions {
  /**
   * The sandbox provider for code execution
   */
  sandboxProvider: SandboxProvider;

  /**
   * The protocol for tool bridge communication
   */
  bridgeProtocol: ToolBridgeProtocol;

  /**
   * Configuration for the tool bridge
   */
  bridgeConfig: ToolBridgeConfig;

  /**
   * Configuration for the sandbox
   */
  sandboxConfig?: SandboxConfig;

  /**
   * Logger instance
   */
  logger?: Logger;

  /**
   * Tools to register on initialization
   */
  tools?: ToolDefinition[];
}

/**
 * The main CodeMode class
 *
 * This class orchestrates all components of the code execution system.
 */
export class CodeMode {
  private readonly sandboxProvider: SandboxProvider;
  private readonly bridgeProtocol: ToolBridgeProtocol;
  private readonly toolRegistry: ToolRegistry;
  private readonly bridgeConfig: ToolBridgeConfig;
  private readonly sandboxConfig: SandboxConfig;
  private readonly logger: Logger | undefined;
  private initialized = false;
  private dependenciesInstalled = false;

  constructor(options: CodeModeOptions) {
    this.sandboxProvider = options.sandboxProvider;
    this.bridgeProtocol = options.bridgeProtocol;
    this.bridgeConfig = options.bridgeConfig;
    this.sandboxConfig = options.sandboxConfig ?? {};
    this.logger = options.logger;

    // Create tool registry
    this.toolRegistry = createToolRegistry({ logger: this.logger });

    // Register initial tools if provided
    if (options.tools) {
      for (const tool of options.tools) {
        this.toolRegistry.register(tool);
      }
    }
  }

  /**
   * Initialize the code mode system
   * This must be called before executing code
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger?.info("Initializing CodeMode...");

    // Initialize the sandbox provider
    await this.sandboxProvider.initialize(this.sandboxConfig, this.logger);

    // Initialize the bridge protocol
    await this.bridgeProtocol.initialize(
      this.bridgeConfig,
      this.toolRegistry,
      this.logger
    );

    this.initialized = true;
    this.logger?.info("CodeMode initialized successfully");
  }

  /**
   * Register a tool
   */
  registerTool<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    this.toolRegistry.register(tool);
  }

  /**
   * Get the tool registry
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * Get TypeScript type definitions for all registered tools
   * This should be included in the LLM's system prompt
   */
  getToolTypeDefinitions(): string {
    return this.toolRegistry.generateTypeDefinitions();
  }

  /**
   * Execute code in the sandbox
   *
   * @param code - TypeScript/JavaScript code to execute
   * @param config - Execution configuration (user, session, scopes, etc.)
   * @returns The execution result
   */
  async executeCode(
    code: string,
    config: ExecutionConfig = {}
  ): Promise<CodeExecutionResult> {
    if (!this.initialized) {
      throw new Error("CodeMode not initialized. Call initialize() first.");
    }

    const startTime = Date.now();

    // Create execution context
    const executionContext: ExecutionContext = {
      userId: config.userId ?? "anonymous",
      sessionId: config.sessionId ?? `session-${Date.now()}`,
      organizationId: config.organizationId,
      scopes: config.scopes ?? ["*"],
      metadata: config.metadata,
    };

    // Create execution token
    const token = await this.bridgeProtocol.createExecutionToken(
      executionContext
    );

    // Install dependencies if not already done
    if (!this.dependenciesInstalled) {
      await this.installSandboxDependencies();
      this.dependenciesInstalled = true;
    }

    // Generate the wrapped code with tool runtime
    const toolNames = this.toolRegistry.getToolNames();
    const runtimeCode = this.bridgeProtocol.generateClientRuntime(
      this.bridgeConfig.serverUrl,
      token,
      toolNames
    );

    // Wrap user code with runtime
    const wrappedCode = `${runtimeCode}\n\n// User Code\n${code}`;

    // Execute in sandbox
    const result = await this.sandboxProvider.executeCode(wrappedCode);

    // Parse tool calls from output
    const { cleanOutput, toolCalls } = this.parseToolCallsFromOutput(
      result.output
    );

    return {
      ...result,
      output: cleanOutput || result.output,
      toolCalls,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Install required dependencies in the sandbox
   * Override this in subclasses if you need different dependencies
   */
  protected async installSandboxDependencies(): Promise<void> {
    const dependencies: Record<string, string> = {};

    // Add protocol-specific dependencies
    if (this.bridgeProtocol.name === "trpc") {
      dependencies["@trpc/client"] = "^11.0.0";
      dependencies["superjson"] = "^2.2.1";
    }

    if (Object.keys(dependencies).length > 0) {
      await this.sandboxProvider.installDependencies(dependencies);
    }
  }

  /**
   * Parse tool call records from sandbox output
   */
  private parseToolCallsFromOutput(output: string): {
    cleanOutput: string;
    toolCalls: CodeExecutionResult["toolCalls"];
  } {
    const toolCalls: CodeExecutionResult["toolCalls"] = [];
    const toolCallMap = new Map<string, CodeExecutionResult["toolCalls"][0]>();
    const lines = output.split("\n");
    const cleanLines: string[] = [];

    for (const line of lines) {
      // Match tool call start
      const toolCallMatch = line.match(/\[TOOL_CALL:(\w+)\]\s*(.*)/);
      if (toolCallMatch) {
        const [, toolName, inputJson] = toolCallMatch;
        try {
          const record: CodeExecutionResult["toolCalls"][0] = {
            tool: toolName,
            input: JSON.parse(inputJson),
            output: null,
            durationMs: 0,
            success: false,
          };
          toolCalls.push(record);
          toolCallMap.set(toolName, record);
        } catch {
          // Ignore parsing errors
        }
        continue;
      }

      // Match tool result (success)
      const toolResultMatch = line.match(/\[TOOL_RESULT:(\w+)\]\s*(.*)/);
      if (toolResultMatch) {
        const [, toolName, resultJson] = toolResultMatch;
        try {
          const resultData = JSON.parse(resultJson);
          const record = toolCallMap.get(toolName);
          if (record) {
            record.durationMs = resultData.durationMs || 0;
            record.success = true;
          }
        } catch {
          // Ignore parsing errors
        }
        continue;
      }

      // Match tool error
      const toolErrorMatch = line.match(/\[TOOL_ERROR:(\w+)\]\s*(.*)/);
      if (toolErrorMatch) {
        const [, toolName, errorJson] = toolErrorMatch;
        try {
          const errorData = JSON.parse(errorJson);
          const record = toolCallMap.get(toolName);
          if (record) {
            record.durationMs = errorData.durationMs || 0;
            record.success = false;
            record.error = errorData.error;
          }
        } catch {
          // Ignore parsing errors
        }
        continue;
      }

      // Keep non-tool lines as clean output
      cleanLines.push(line);
    }

    return {
      cleanOutput: cleanLines.join("\n").trim(),
      toolCalls,
    };
  }

  /**
   * Get the request handler for the tool bridge server
   * Use this to create your API endpoint
   *
   * @example
   * ```typescript
   * // Next.js API route
   * export async function POST(req: Request) {
   *   const handler = codeMode.getRequestHandler();
   *   return handler(req);
   * }
   * ```
   */
  getRequestHandler(): RequestHandler {
    if (!this.initialized) {
      throw new Error("CodeMode not initialized. Call initialize() first.");
    }
    return this.bridgeProtocol.createRequestHandler();
  }

  /**
   * Check if the system is ready for code execution
   */
  async isReady(): Promise<boolean> {
    return this.initialized && (await this.sandboxProvider.isReady());
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    this.logger?.info("Cleaning up CodeMode...");
    await this.sandboxProvider.cleanup();
    this.initialized = false;
    this.dependenciesInstalled = false;
  }

  /**
   * Get the sandbox provider
   */
  getSandboxProvider(): SandboxProvider {
    return this.sandboxProvider;
  }

  /**
   * Get the bridge protocol
   */
  getBridgeProtocol(): ToolBridgeProtocol {
    return this.bridgeProtocol;
  }
}

// =============================================================================
// System Prompt Helpers
// =============================================================================

/**
 * Default type definitions for sandbox built-in APIs
 */
export const SANDBOX_TYPE_DEFINITIONS = `
/**
 * Available APIs in the sandbox environment
 */

// File System API
interface FileInfo {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  modifiedTime: string;
}

interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listFiles(path: string): Promise<FileInfo[]>;
  createFolder(path: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

declare const fs: FileSystem;

// HTTP API
interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  json<T = unknown>(): T;
}

interface Http {
  request(url: string, options?: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers?: Record<string, string>;
    body?: string | object;
    timeout?: number;
  }): Promise<HttpResponse>;
  get(url: string, headers?: Record<string, string>): Promise<HttpResponse>;
  post(url: string, body: object, headers?: Record<string, string>): Promise<HttpResponse>;
}

declare const http: Http;

// Shell API
interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface Shell {
  exec(command: string, cwd?: string): Promise<CommandResult>;
  run(command: string): Promise<string>;
}

declare const shell: Shell;

// Data Processing API
interface DataUtils {
  parseCSV<T = Record<string, string>>(csv: string, options?: { headers?: boolean }): T[];
  toCSV(data: object[], options?: { headers?: boolean }): string;
  parseJSON<T = unknown>(json: string): T;
  toJSON(data: unknown, pretty?: boolean): string;
  groupBy<T>(array: T[], key: keyof T): Record<string, T[]>;
  sum(numbers: number[]): number;
  average(numbers: number[]): number;
  sortBy<T>(array: T[], key: keyof T, order?: 'asc' | 'desc'): T[];
}

declare const data: DataUtils;

// Console output
declare function console.log(...args: unknown[]): void;
declare function console.error(...args: unknown[]): void;

// Utility functions
declare function sleep(ms: number): Promise<void>;
`;

/**
 * Default system prompt for code mode
 */
export const CODE_MODE_SYSTEM_PROMPT = `You are an AI assistant with the ability to execute TypeScript code in a secure sandbox environment.

## When to Use Code Execution

Use code execution when you need to:
- Perform calculations or data analysis
- Process or transform data (CSV, JSON, etc.)
- Make HTTP requests to fetch information
- Work with files
- Perform complex operations that benefit from code

## How to Write Code

- Use TypeScript syntax
- Use console.log() to output results
- Handle errors gracefully with try/catch
- Compose multiple operations efficiently

## Example

\`\`\`typescript
// Calculate sum of numbers 1-10
const numbers = Array.from({ length: 10 }, (_, i) => i + 1);
const sum = numbers.reduce((a, b) => a + b, 0);
console.log(\`Sum of 1-10: \${sum}\`);
\`\`\`
`;

/**
 * Build a complete system prompt with type definitions
 */
export function buildSystemPrompt(options: {
  customInstructions?: string;
  toolTypeDefinitions?: string;
  includeSandboxTypes?: boolean;
}): string {
  let prompt = CODE_MODE_SYSTEM_PROMPT;

  if (options.includeSandboxTypes !== false) {
    prompt += "\n\n## Sandbox API Types\n\n```typescript";
    prompt += SANDBOX_TYPE_DEFINITIONS;
    prompt += "\n```";
  }

  if (options.toolTypeDefinitions) {
    prompt += "\n\n## Custom Tools\n\n```typescript";
    prompt += options.toolTypeDefinitions;
    prompt += "\n```";
  }

  if (options.customInstructions) {
    prompt += `\n\n## Additional Instructions\n\n${options.customInstructions}`;
  }

  return prompt;
}
