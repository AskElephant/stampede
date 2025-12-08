import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
  BaseToolBridgeProtocol,
  type RequestHandler,
} from "./tool-bridge-protocol";
import { createToolRegistry, type ToolRegistry } from "./tool-registry";
import { defineTool } from "./types";
import type { ExecutionContext, ToolBridgeConfig, Logger } from "./types";

/**
 * Test implementation of BaseToolBridgeProtocol for testing the base class functionality
 */
class TestToolBridgeProtocol extends BaseToolBridgeProtocol {
  readonly name = "test";

  protected async doInitialize(): Promise<void> {
    // No-op for testing
  }

  generateClientRuntime(
    bridgeUrl: string,
    _executionToken: string,
    _toolNames: string[]
  ): string {
    return `// Test runtime for ${bridgeUrl}`;
  }

  createRequestHandler(): RequestHandler {
    return async () => new Response("test");
  }

  async createExecutionToken(): Promise<string> {
    return "test-token";
  }

  async verifyExecutionToken(): Promise<ExecutionContext | null> {
    return null;
  }

  getContentType(): string {
    return "application/json";
  }

  // Expose protected methods for testing
  public testCheckRateLimit(userId: string, maxPerMinute: number) {
    return this.checkRateLimit(userId, maxPerMinute);
  }

  public testCheckAuthorization(
    context: ExecutionContext,
    requiredScopes: string[]
  ) {
    return this.checkAuthorization(context, requiredScopes);
  }

  public async testExecuteToolWithChecks(
    toolName: string,
    input: unknown,
    context: ExecutionContext
  ) {
    return this.executeToolWithChecks(toolName, input, context);
  }
}

describe("BaseToolBridgeProtocol", () => {
  let protocol: TestToolBridgeProtocol;
  let registry: ToolRegistry;
  const defaultConfig: ToolBridgeConfig = {
    serverUrl: "http://localhost:3000/api/trpc",
    tokenConfig: {
      secretKey: "test-secret",
    },
    enableRateLimiting: true,
    defaultRateLimit: 60,
  };

  const testContext: ExecutionContext = {
    userId: "user-123",
    sessionId: "session-456",
    scopes: ["read", "write"],
  };

  beforeEach(async () => {
    protocol = new TestToolBridgeProtocol();
    registry = createToolRegistry();

    // Register a test tool
    const testTool = defineTool({
      name: "testTool",
      description: "A test tool",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ result: z.string() }),
      execute: async ({ value }) => ({ result: `Processed: ${value}` }),
    });
    registry.register(testTool);

    // Register a secured tool
    const securedTool = defineTool({
      name: "securedTool",
      description: "A secured tool",
      inputSchema: z.object({}),
      requiredScopes: ["admin"],
      execute: async () => ({ secret: "data" }),
    });
    registry.register(securedTool);

    // Register a rate-limited tool
    const rateLimitedTool = defineTool({
      name: "rateLimitedTool",
      description: "A rate limited tool",
      inputSchema: z.object({}),
      rateLimit: 2, // Very low limit for testing
      execute: async () => ({ called: true }),
    });
    registry.register(rateLimitedTool);

    await protocol.initialize(defaultConfig, registry);
  });

  describe("initialization", () => {
    it("should initialize successfully", async () => {
      const newProtocol = new TestToolBridgeProtocol();
      await expect(
        newProtocol.initialize(defaultConfig, registry)
      ).resolves.not.toThrow();
    });

    it("should log initialization when logger provided", async () => {
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const newProtocol = new TestToolBridgeProtocol();

      await newProtocol.initialize(defaultConfig, registry, mockLogger);

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Tool bridge protocol 'test' initialized"
      );
    });
  });

  describe("checkRateLimit", () => {
    it("should allow first request", () => {
      const result = protocol.testCheckRateLimit("user-1", 10);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      expect(result.resetIn).toBe(60);
    });

    it("should track request count", () => {
      protocol.testCheckRateLimit("user-2", 5);
      protocol.testCheckRateLimit("user-2", 5);
      const result = protocol.testCheckRateLimit("user-2", 5);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2); // 5 - 3 = 2
    });

    it("should block when limit exceeded", () => {
      const maxRequests = 3;

      // Use up all requests
      for (let i = 0; i < maxRequests; i++) {
        protocol.testCheckRateLimit("user-3", maxRequests);
      }

      // Next request should be blocked
      const result = protocol.testCheckRateLimit("user-3", maxRequests);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.resetIn).toBeGreaterThan(0);
    });

    it("should track different users separately", () => {
      // Use up all requests for user-4
      protocol.testCheckRateLimit("user-4", 1);

      // user-5 should still be allowed
      const result = protocol.testCheckRateLimit("user-5", 1);

      expect(result.allowed).toBe(true);
    });
  });

  describe("checkAuthorization", () => {
    it("should allow when no scopes required", () => {
      const context: ExecutionContext = {
        userId: "user",
        sessionId: "session",
        scopes: [],
      };

      const allowed = protocol.testCheckAuthorization(context, []);

      expect(allowed).toBe(true);
    });

    it("should allow when user has wildcard scope", () => {
      const context: ExecutionContext = {
        userId: "user",
        sessionId: "session",
        scopes: ["*"],
      };

      const allowed = protocol.testCheckAuthorization(context, [
        "admin",
        "write",
      ]);

      expect(allowed).toBe(true);
    });

    it("should allow when user has required scope", () => {
      const context: ExecutionContext = {
        userId: "user",
        sessionId: "session",
        scopes: ["read", "write"],
      };

      const allowed = protocol.testCheckAuthorization(context, ["write"]);

      expect(allowed).toBe(true);
    });

    it("should allow when required scopes includes wildcard", () => {
      const context: ExecutionContext = {
        userId: "user",
        sessionId: "session",
        scopes: ["read"],
      };

      const allowed = protocol.testCheckAuthorization(context, ["*"]);

      expect(allowed).toBe(true);
    });

    it("should deny when user lacks required scope", () => {
      const context: ExecutionContext = {
        userId: "user",
        sessionId: "session",
        scopes: ["read"],
      };

      const allowed = protocol.testCheckAuthorization(context, ["admin"]);

      expect(allowed).toBe(false);
    });

    it("should allow if user has ANY of the required scopes (OR logic)", () => {
      const context: ExecutionContext = {
        userId: "user",
        sessionId: "session",
        scopes: ["write"],
      };

      const allowed = protocol.testCheckAuthorization(context, [
        "admin",
        "write",
      ]);

      expect(allowed).toBe(true);
    });
  });

  describe("executeToolWithChecks", () => {
    it("should execute tool successfully", async () => {
      const result = await protocol.testExecuteToolWithChecks(
        "testTool",
        { value: "hello" },
        testContext
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ result: "Processed: hello" });
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should return error for unknown tool", async () => {
      const result = await protocol.testExecuteToolWithChecks(
        "unknownTool",
        {},
        testContext
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NOT_FOUND");
      expect(result.error?.message).toContain("unknownTool");
    });

    it("should return error when unauthorized", async () => {
      const contextWithoutAdmin: ExecutionContext = {
        userId: "user",
        sessionId: "session",
        scopes: ["read"], // Missing 'admin' scope
      };

      const result = await protocol.testExecuteToolWithChecks(
        "securedTool",
        {},
        contextWithoutAdmin
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("FORBIDDEN");
      expect(result.error?.message).toContain("scope");
    });

    it("should allow authorized access to secured tool", async () => {
      const adminContext: ExecutionContext = {
        userId: "admin-user",
        sessionId: "session",
        scopes: ["admin"],
      };

      const result = await protocol.testExecuteToolWithChecks(
        "securedTool",
        {},
        adminContext
      );

      expect(result.success).toBe(true);
    });

    it("should return error when rate limited", async () => {
      // First 2 calls should succeed (rateLimit is 2)
      await protocol.testExecuteToolWithChecks(
        "rateLimitedTool",
        {},
        testContext
      );
      await protocol.testExecuteToolWithChecks(
        "rateLimitedTool",
        {},
        testContext
      );

      // Third call should be rate limited
      const result = await protocol.testExecuteToolWithChecks(
        "rateLimitedTool",
        {},
        testContext
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("RATE_LIMITED");
    });

    it("should handle tool execution errors", async () => {
      // Register a tool that throws
      const errorTool = defineTool({
        name: "errorTool",
        description: "Tool that throws",
        inputSchema: z.object({}),
        execute: async () => {
          throw new Error("Something went wrong");
        },
      });
      registry.register(errorTool);

      const result = await protocol.testExecuteToolWithChecks(
        "errorTool",
        {},
        testContext
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("EXECUTION_ERROR");
      expect(result.error?.message).toBe("Something went wrong");
    });

    it("should return error when protocol not initialized", async () => {
      const uninitializedProtocol = new TestToolBridgeProtocol();

      const result = await uninitializedProtocol.testExecuteToolWithChecks(
        "testTool",
        {},
        testContext
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NOT_INITIALIZED");
    });

    it("should skip rate limiting when disabled", async () => {
      const configWithoutRateLimit: ToolBridgeConfig = {
        ...defaultConfig,
        enableRateLimiting: false,
      };

      const newProtocol = new TestToolBridgeProtocol();
      await newProtocol.initialize(configWithoutRateLimit, registry);

      // All calls should succeed even past the rate limit
      for (let i = 0; i < 10; i++) {
        const result = await newProtocol.testExecuteToolWithChecks(
          "rateLimitedTool",
          {},
          testContext
        );
        expect(result.success).toBe(true);
      }
    });

    it("should use default rate limit when tool has no specific limit", async () => {
      // testTool has no rateLimit set, should use defaultRateLimit (60)
      // This test verifies it doesn't fail after just a few calls
      for (let i = 0; i < 10; i++) {
        const result = await protocol.testExecuteToolWithChecks(
          "testTool",
          { value: `call-${i}` },
          testContext
        );
        expect(result.success).toBe(true);
      }
    });
  });
});
