/**
 * Sandbox Provider Interface
 *
 * This interface defines the contract that sandbox providers must implement.
 * A sandbox provider is responsible for:
 * - Creating and managing isolated code execution environments
 * - Executing code within those environments
 * - Managing the lifecycle of sandboxes (create, start, stop, delete)
 *
 * The framework ships with a Daytona provider by default, but consumers
 * can implement their own providers for E2B, Docker, Firecracker, etc.
 */

import type { CodeExecutionResult, SandboxConfig, Logger } from "./types";

/**
 * Interface for sandbox providers
 *
 * Implement this interface to add support for different sandbox runtimes.
 *
 * @example
 * ```typescript
 * class E2BSandboxProvider implements SandboxProvider {
 *   async initialize(config: SandboxConfig): Promise<void> {
 *     // Initialize E2B client
 *   }
 *
 *   async executeCode(code: string): Promise<CodeExecutionResult> {
 *     // Execute code in E2B sandbox
 *   }
 *   // ... implement other methods
 * }
 * ```
 */
export interface SandboxProvider {
  /**
   * Unique identifier for this provider (e.g., "daytona", "e2b", "docker")
   */
  readonly name: string;

  /**
   * Initialize the provider with configuration.
   * Called once when the provider is first used.
   *
   * @param config - Provider configuration options
   * @param logger - Optional logger for debugging
   */
  initialize(config: SandboxConfig, logger?: Logger): Promise<void>;

  /**
   * Check if the provider is ready to execute code.
   * Returns true if a sandbox is available and running.
   */
  isReady(): Promise<boolean>;

  /**
   * Execute code in the sandbox.
   * The code should be valid TypeScript/JavaScript.
   *
   * @param code - The code to execute
   * @returns The execution result including output, errors, and timing
   */
  executeCode(code: string): Promise<CodeExecutionResult>;

  /**
   * Upload a file to the sandbox filesystem.
   *
   * @param content - The file content (as string or Buffer)
   * @param path - The destination path in the sandbox
   */
  uploadFile(content: string | Buffer, path: string): Promise<void>;

  /**
   * Download a file from the sandbox filesystem.
   *
   * @param path - The path to the file in the sandbox
   * @returns The file content as a string
   */
  downloadFile(path: string): Promise<string>;

  /**
   * Execute a shell command in the sandbox.
   *
   * @param command - The command to execute
   * @param cwd - Optional working directory
   * @returns The command output and exit code
   */
  executeCommand(
    command: string,
    cwd?: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;

  /**
   * Install dependencies in the sandbox (e.g., npm packages).
   *
   * @param packages - Map of package names to versions
   */
  installDependencies(packages: Record<string, string>): Promise<void>;

  /**
   * Clean up resources when the sandbox is no longer needed.
   * Should be called when shutting down to release resources.
   */
  cleanup(): Promise<void>;

  /**
   * Get the current state of the sandbox.
   */
  getState(): Promise<SandboxState>;
}

/**
 * Possible states for a sandbox
 */
export type SandboxState =
  | "uninitialized"
  | "creating"
  | "starting"
  | "running"
  | "stopped"
  | "error"
  | "destroyed";

/**
 * Base class for sandbox providers with common functionality
 *
 * Extend this class to create a new sandbox provider. It provides
 * default implementations for some methods and common state management.
 *
 * @example
 * ```typescript
 * class MySandboxProvider extends BaseSandboxProvider {
 *   readonly name = "my-sandbox";
 *
 *   protected async doInitialize(config: SandboxConfig): Promise<void> {
 *     // Your initialization logic
 *   }
 *
 *   protected async doExecuteCode(code: string): Promise<CodeExecutionResult> {
 *     // Your code execution logic
 *   }
 *   // ... implement other abstract methods
 * }
 * ```
 */
export abstract class BaseSandboxProvider implements SandboxProvider {
  abstract readonly name: string;

  protected config: SandboxConfig | null = null;
  protected logger: Logger | null = null;
  protected state: SandboxState = "uninitialized";
  protected initializationPromise: Promise<void> | null = null;

  async initialize(config: SandboxConfig, logger?: Logger): Promise<void> {
    // Prevent multiple simultaneous initializations
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.config = config;
    this.logger = logger ?? null;
    this.state = "creating";

    this.initializationPromise = this.doInitialize(config)
      .then(() => {
        this.state = "running";
        this.logger?.info(`Sandbox provider '${this.name}' initialized`);
      })
      .catch((error) => {
        this.state = "error";
        this.logger?.error(
          `Failed to initialize sandbox provider '${this.name}'`,
          {
            error: error instanceof Error ? error.message : String(error),
          }
        );
        throw error;
      });

    return this.initializationPromise;
  }

  async isReady(): Promise<boolean> {
    return this.state === "running";
  }

  async getState(): Promise<SandboxState> {
    return this.state;
  }

  async executeCode(code: string): Promise<CodeExecutionResult> {
    if (this.state !== "running") {
      throw new Error(
        `Sandbox is not ready. Current state: ${this.state}. Call initialize() first.`
      );
    }

    const startTime = Date.now();
    try {
      const result = await this.doExecuteCode(code);
      this.logger?.debug("Code execution completed", {
        success: result.success,
        executionTimeMs: Date.now() - startTime,
      });
      return result;
    } catch (error) {
      this.logger?.error("Code execution failed", {
        error: error instanceof Error ? error.message : String(error),
      });
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

  async cleanup(): Promise<void> {
    this.logger?.info(`Cleaning up sandbox provider '${this.name}'`);
    try {
      await this.doCleanup();
      this.state = "destroyed";
    } catch (error) {
      this.logger?.error(`Failed to cleanup sandbox provider '${this.name}'`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Override this method to implement provider-specific initialization
   */
  protected abstract doInitialize(config: SandboxConfig): Promise<void>;

  /**
   * Override this method to implement provider-specific code execution
   */
  protected abstract doExecuteCode(code: string): Promise<CodeExecutionResult>;

  /**
   * Override this method to implement provider-specific cleanup
   */
  protected abstract doCleanup(): Promise<void>;

  /**
   * Default implementations that should be overridden by providers
   */
  async uploadFile(content: string | Buffer, path: string): Promise<void> {
    throw new Error(`uploadFile not implemented by ${this.name} provider`);
  }

  async downloadFile(path: string): Promise<string> {
    throw new Error(`downloadFile not implemented by ${this.name} provider`);
  }

  async executeCommand(
    command: string,
    cwd?: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    throw new Error(`executeCommand not implemented by ${this.name} provider`);
  }

  async installDependencies(packages: Record<string, string>): Promise<void> {
    throw new Error(
      `installDependencies not implemented by ${this.name} provider`
    );
  }
}
