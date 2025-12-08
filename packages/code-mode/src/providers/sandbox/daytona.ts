/**
 * Daytona Sandbox Provider
 *
 * This provider uses Daytona's sandbox SDK for code execution.
 * Daytona provides secure, isolated TypeScript/JavaScript execution environments.
 *
 * @see https://www.daytona.io/docs
 *
 * @example
 * ```typescript
 * import { DaytonaSandboxProvider } from "@askelephant/code-mode/providers";
 *
 * const provider = new DaytonaSandboxProvider({
 *   apiKey: process.env.DAYTONA_API_KEY,
 *   apiUrl: "https://app.daytona.io/api",
 *   target: "us",
 * });
 *
 * await provider.initialize({
 *   autoStopInterval: 30,
 *   labels: { purpose: "code-execution" },
 * });
 *
 * const result = await provider.executeCode(`
 *   console.log("Hello from Daytona!");
 * `);
 * ```
 */

import type { Daytona, Sandbox } from "@daytonaio/sdk";
import {
  BaseSandboxProvider,
  type SandboxState,
} from "../../core/sandbox-provider";
import type {
  CodeExecutionResult,
  SandboxConfig,
  Logger,
} from "../../core/types";

/**
 * Configuration options specific to Daytona
 */
export interface DaytonaSandboxProviderOptions {
  /**
   * Daytona API key
   */
  apiKey?: string;

  /**
   * Daytona API URL
   * @default "https://app.daytona.io/api"
   */
  apiUrl?: string;

  /**
   * Daytona target region
   * @default "us"
   */
  target?: string;

  /**
   * Sandbox language
   * @default "typescript"
   */
  language?: "typescript" | "javascript" | "python";

  /**
   * Sandbox label for finding/reusing existing sandboxes
   * @default "code-mode"
   */
  sandboxLabel?: string;
}

/**
 * Daytona sandbox provider implementation
 */
export class DaytonaSandboxProvider extends BaseSandboxProvider {
  readonly name = "daytona";

  private options: DaytonaSandboxProviderOptions;
  private daytonaClient: Daytona | null = null;
  private sandbox: Sandbox | null = null;

  constructor(options: DaytonaSandboxProviderOptions = {}) {
    super();
    this.options = {
      apiUrl: "https://app.daytona.io/api",
      target: "us",
      language: "typescript",
      sandboxLabel: "code-mode",
      ...options,
    };
  }

  protected async doInitialize(config: SandboxConfig): Promise<void> {
    // Dynamically import Daytona SDK to avoid bundling issues
    const { Daytona } = await import("@daytonaio/sdk");

    this.daytonaClient = new Daytona({
      apiKey: this.options.apiKey ?? process.env.DAYTONA_API_KEY,
      apiUrl: this.options.apiUrl ?? process.env.DAYTONA_API_URL,
      target: this.options.target ?? process.env.DAYTONA_TARGET,
    });

    // Try to find an existing sandbox with matching label
    const label = config.labels?.purpose ?? this.options.sandboxLabel;
    await this.findOrCreateSandbox(config, label!);
  }

  private async findOrCreateSandbox(
    config: SandboxConfig,
    label: string
  ): Promise<void> {
    if (!this.daytonaClient) {
      throw new Error("Daytona client not initialized");
    }

    // Try to find existing sandbox
    try {
      this.logger?.info("Looking for existing sandbox with label...", {
        label,
      });
      const existingSandbox = await this.daytonaClient.findOne({
        labels: { purpose: label },
      });

      if (existingSandbox) {
        this.sandbox = existingSandbox;
        this.logger?.info("Found existing sandbox", {
          id: existingSandbox.id,
          state: existingSandbox.state,
        });

        // Ensure it's started
        if (existingSandbox.state !== "started") {
          this.logger?.info("Starting existing sandbox...");
          await this.daytonaClient.start(existingSandbox, 60);
        }
        return;
      }
    } catch {
      // No existing sandbox found, will create new one
      this.logger?.debug("No existing sandbox found, creating new one...");
    }

    // Create new sandbox
    this.logger?.info("Creating new Daytona sandbox...");
    this.sandbox = await this.daytonaClient.create(
      {
        language: this.options.language,
        labels: {
          purpose: label,
          created: new Date().toISOString(),
          ...config.labels,
        },
        autoStopInterval: config.autoStopInterval ?? 30,
        // Network configuration
        networkBlockAll: config.network?.blockAll ?? false,
        networkAllowList: config.network?.allowList?.join(",") ?? "0.0.0.0/0",
      },
      { timeout: 120 }
    );

    this.logger?.info("Sandbox created", { id: this.sandbox.id });
  }

  protected async doExecuteCode(code: string): Promise<CodeExecutionResult> {
    if (!this.sandbox) {
      throw new Error("Sandbox not initialized");
    }

    const startTime = Date.now();

    try {
      const result = await this.sandbox.process.codeRun(code);
      const executionTimeMs = Date.now() - startTime;

      if (result.exitCode === 0) {
        return {
          success: true,
          output: result.result || "Code executed successfully (no output)",
          exitCode: result.exitCode,
          executionTimeMs,
          toolCalls: [],
        };
      } else {
        return {
          success: false,
          output: "",
          error: result.result || "Code execution failed",
          exitCode: result.exitCode,
          executionTimeMs,
          toolCalls: [],
        };
      }
    } catch (error) {
      return {
        success: false,
        output: "",
        error: error instanceof Error ? error.message : "Unknown error",
        exitCode: 1,
        executionTimeMs: Date.now() - startTime,
        toolCalls: [],
      };
    }
  }

  override async uploadFile(
    content: string | Buffer,
    path: string
  ): Promise<void> {
    if (!this.sandbox) {
      throw new Error("Sandbox not initialized");
    }

    const buffer = typeof content === "string" ? Buffer.from(content) : content;
    await this.sandbox.fs.uploadFile(buffer, path);
  }

  override async downloadFile(path: string): Promise<string> {
    if (!this.sandbox) {
      throw new Error("Sandbox not initialized");
    }

    const content = await this.sandbox.fs.downloadFile(path);
    return content.toString();
  }

  override async executeCommand(
    command: string,
    cwd?: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.sandbox) {
      throw new Error("Sandbox not initialized");
    }

    const result = await this.sandbox.process.executeCommand(
      command,
      cwd ?? "/home/daytona",
      {},
      60 // 1 minute timeout
    );

    return {
      stdout: result.result || "",
      stderr: "",
      exitCode: result.exitCode,
    };
  }

  override async installDependencies(
    packages: Record<string, string>
  ): Promise<void> {
    if (!this.sandbox) {
      throw new Error("Sandbox not initialized");
    }

    this.logger?.info("Installing dependencies in sandbox...", { packages });

    // Create package.json
    const packageJson = JSON.stringify(
      {
        name: "sandbox-runtime",
        version: "1.0.0",
        type: "module",
        dependencies: packages,
      },
      null,
      2
    );

    await this.uploadFile(packageJson, "/home/daytona/package.json");

    // Run npm install
    const result = await this.executeCommand("npm install --silent");

    if (result.exitCode !== 0) {
      throw new Error(`Failed to install dependencies: ${result.stdout}`);
    }

    this.logger?.info("Dependencies installed successfully");
  }

  protected async doCleanup(): Promise<void> {
    if (this.sandbox && this.daytonaClient) {
      this.logger?.info("Deleting sandbox...", { id: this.sandbox.id });
      await this.daytonaClient.delete(this.sandbox);
      this.sandbox = null;
    }
  }

  /**
   * Get the underlying Daytona sandbox instance
   */
  getSandbox(): Sandbox | null {
    return this.sandbox;
  }

  /**
   * Get the Daytona client
   */
  getClient(): Daytona | null {
    return this.daytonaClient;
  }
}
