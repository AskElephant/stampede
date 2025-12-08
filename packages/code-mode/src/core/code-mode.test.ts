import { describe, it, expect, vi } from "vitest";
import {
  buildSystemPrompt,
  CODE_MODE_SYSTEM_PROMPT,
  SANDBOX_TYPE_DEFINITIONS,
  CodeMode,
} from "./code-mode";
import type { SandboxProvider, SandboxState } from "./sandbox-provider";
import type { ToolBridgeProtocol } from "./tool-bridge-protocol";
import type { ToolBridgeConfig } from "./types";

describe("System Prompt Helpers", () => {
  describe("CODE_MODE_SYSTEM_PROMPT", () => {
    it("should contain instructions for code execution", () => {
      expect(CODE_MODE_SYSTEM_PROMPT).toContain("execute TypeScript code");
      expect(CODE_MODE_SYSTEM_PROMPT).toContain("sandbox environment");
    });

    it("should explain when to use code execution", () => {
      expect(CODE_MODE_SYSTEM_PROMPT).toContain("When to Use Code Execution");
      expect(CODE_MODE_SYSTEM_PROMPT).toContain("calculations");
      expect(CODE_MODE_SYSTEM_PROMPT).toContain("data analysis");
    });

    it("should include code writing guidelines", () => {
      expect(CODE_MODE_SYSTEM_PROMPT).toContain("How to Write Code");
      expect(CODE_MODE_SYSTEM_PROMPT).toContain("TypeScript syntax");
      expect(CODE_MODE_SYSTEM_PROMPT).toContain("console.log");
    });

    it("should include an example", () => {
      expect(CODE_MODE_SYSTEM_PROMPT).toContain("Example");
      expect(CODE_MODE_SYSTEM_PROMPT).toContain("```typescript");
    });
  });

  describe("SANDBOX_TYPE_DEFINITIONS", () => {
    it("should define FileSystem API", () => {
      expect(SANDBOX_TYPE_DEFINITIONS).toContain("interface FileSystem");
      expect(SANDBOX_TYPE_DEFINITIONS).toContain("readFile");
      expect(SANDBOX_TYPE_DEFINITIONS).toContain("writeFile");
      expect(SANDBOX_TYPE_DEFINITIONS).toContain("declare const fs");
    });

    it("should define HTTP API", () => {
      expect(SANDBOX_TYPE_DEFINITIONS).toContain("interface Http");
      expect(SANDBOX_TYPE_DEFINITIONS).toContain("request");
      expect(SANDBOX_TYPE_DEFINITIONS).toContain("get");
      expect(SANDBOX_TYPE_DEFINITIONS).toContain("post");
      expect(SANDBOX_TYPE_DEFINITIONS).toContain("declare const http");
    });

    it("should define Shell API", () => {
      expect(SANDBOX_TYPE_DEFINITIONS).toContain("interface Shell");
      expect(SANDBOX_TYPE_DEFINITIONS).toContain("exec");
      expect(SANDBOX_TYPE_DEFINITIONS).toContain("declare const shell");
    });

    it("should define Data Processing API", () => {
      expect(SANDBOX_TYPE_DEFINITIONS).toContain("interface DataUtils");
      expect(SANDBOX_TYPE_DEFINITIONS).toContain("parseCSV");
      expect(SANDBOX_TYPE_DEFINITIONS).toContain("toJSON");
      expect(SANDBOX_TYPE_DEFINITIONS).toContain("declare const data");
    });

    it("should define utility functions", () => {
      expect(SANDBOX_TYPE_DEFINITIONS).toContain("sleep");
    });
  });

  describe("buildSystemPrompt", () => {
    it("should include base system prompt", () => {
      const prompt = buildSystemPrompt({});

      expect(prompt).toContain(CODE_MODE_SYSTEM_PROMPT);
    });

    it("should include sandbox types by default", () => {
      const prompt = buildSystemPrompt({});

      expect(prompt).toContain("Sandbox API Types");
      expect(prompt).toContain(SANDBOX_TYPE_DEFINITIONS);
    });

    it("should exclude sandbox types when disabled", () => {
      const prompt = buildSystemPrompt({ includeSandboxTypes: false });

      expect(prompt).not.toContain("Sandbox API Types");
      expect(prompt).not.toContain("interface FileSystem");
    });

    it("should include tool type definitions when provided", () => {
      const toolTypes = `declare const tools: {
  searchDatabase: (input: SearchInput) => Promise<SearchOutput>;
};`;

      const prompt = buildSystemPrompt({ toolTypeDefinitions: toolTypes });

      expect(prompt).toContain("Custom Tools");
      expect(prompt).toContain("searchDatabase");
    });

    it("should include custom instructions when provided", () => {
      const customInstructions =
        "Always format output as JSON. Never reveal API keys.";

      const prompt = buildSystemPrompt({ customInstructions });

      expect(prompt).toContain("Additional Instructions");
      expect(prompt).toContain(customInstructions);
    });

    it("should combine all sections correctly", () => {
      const prompt = buildSystemPrompt({
        toolTypeDefinitions: "// Tool types here",
        customInstructions: "Custom instruction",
        includeSandboxTypes: true,
      });

      // Check sections appear in order
      const sandboxTypesIndex = prompt.indexOf("Sandbox API Types");
      const toolTypesIndex = prompt.indexOf("Custom Tools");
      const instructionsIndex = prompt.indexOf("Additional Instructions");

      expect(sandboxTypesIndex).toBeLessThan(toolTypesIndex);
      expect(toolTypesIndex).toBeLessThan(instructionsIndex);
    });
  });
});

describe("CodeMode", () => {
  // Mock implementations
  const createMockSandboxProvider = (): SandboxProvider => ({
    name: "mock",
    initialize: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockResolvedValue(true),
    executeCode: vi.fn().mockResolvedValue({
      success: true,
      output: "Hello World",
      exitCode: 0,
      executionTimeMs: 100,
      toolCalls: [],
    }),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    downloadFile: vi.fn().mockResolvedValue(""),
    executeCommand: vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    }),
    installDependencies: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockResolvedValue("running" as SandboxState),
  });

  const createMockBridgeProtocol = (): ToolBridgeProtocol => ({
    name: "mock",
    initialize: vi.fn().mockResolvedValue(undefined),
    generateClientRuntime: vi.fn().mockReturnValue("// mock runtime"),
    createRequestHandler: vi.fn().mockReturnValue(async () => new Response()),
    createExecutionToken: vi.fn().mockResolvedValue("mock-token"),
    verifyExecutionToken: vi.fn().mockResolvedValue(null),
    getContentType: vi.fn().mockReturnValue("application/json"),
  });

  const defaultConfig: ToolBridgeConfig = {
    serverUrl: "http://localhost:3000/api",
    tokenConfig: { secretKey: "test-secret" },
  };

  describe("initialization", () => {
    it("should initialize sandbox provider and bridge protocol", async () => {
      const sandboxProvider = createMockSandboxProvider();
      const bridgeProtocol = createMockBridgeProtocol();

      const codeMode = new CodeMode({
        sandboxProvider,
        bridgeProtocol,
        bridgeConfig: defaultConfig,
      });

      await codeMode.initialize();

      expect(sandboxProvider.initialize).toHaveBeenCalled();
      expect(bridgeProtocol.initialize).toHaveBeenCalled();
    });

    it("should only initialize once", async () => {
      const sandboxProvider = createMockSandboxProvider();
      const bridgeProtocol = createMockBridgeProtocol();

      const codeMode = new CodeMode({
        sandboxProvider,
        bridgeProtocol,
        bridgeConfig: defaultConfig,
      });

      await codeMode.initialize();
      await codeMode.initialize();

      expect(sandboxProvider.initialize).toHaveBeenCalledTimes(1);
    });

    it("should register provided tools", async () => {
      const sandboxProvider = createMockSandboxProvider();
      const bridgeProtocol = createMockBridgeProtocol();

      const codeMode = new CodeMode({
        sandboxProvider,
        bridgeProtocol,
        bridgeConfig: defaultConfig,
        tools: [
          {
            name: "testTool",
            description: "Test",
            inputSchema: { parse: vi.fn() } as unknown as import("zod").ZodType,
            execute: vi.fn(),
          },
        ],
      });

      const registry = codeMode.getToolRegistry();
      expect(registry.has("testTool")).toBe(true);
    });
  });

  describe("code execution", () => {
    it("should throw if not initialized", async () => {
      const codeMode = new CodeMode({
        sandboxProvider: createMockSandboxProvider(),
        bridgeProtocol: createMockBridgeProtocol(),
        bridgeConfig: defaultConfig,
      });

      await expect(codeMode.executeCode('console.log("test")')).rejects.toThrow(
        "not initialized"
      );
    });

    it("should execute code in sandbox", async () => {
      const sandboxProvider = createMockSandboxProvider();
      const bridgeProtocol = createMockBridgeProtocol();

      const codeMode = new CodeMode({
        sandboxProvider,
        bridgeProtocol,
        bridgeConfig: defaultConfig,
      });

      await codeMode.initialize();
      const result = await codeMode.executeCode('console.log("test")');

      expect(sandboxProvider.executeCode).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("should create execution token for each run", async () => {
      const bridgeProtocol = createMockBridgeProtocol();

      const codeMode = new CodeMode({
        sandboxProvider: createMockSandboxProvider(),
        bridgeProtocol,
        bridgeConfig: defaultConfig,
      });

      await codeMode.initialize();
      await codeMode.executeCode('console.log("test")');

      expect(bridgeProtocol.createExecutionToken).toHaveBeenCalled();
    });

    it("should inject runtime code", async () => {
      const sandboxProvider = createMockSandboxProvider();
      const bridgeProtocol = createMockBridgeProtocol();
      (
        bridgeProtocol.generateClientRuntime as ReturnType<typeof vi.fn>
      ).mockReturnValue("const tools = {};");

      const codeMode = new CodeMode({
        sandboxProvider,
        bridgeProtocol,
        bridgeConfig: defaultConfig,
      });

      await codeMode.initialize();
      await codeMode.executeCode('console.log("test")');

      const executedCode = (
        sandboxProvider.executeCode as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(executedCode).toContain("const tools = {};");
      expect(executedCode).toContain('console.log("test")');
    });

    it("should install dependencies on first execution", async () => {
      const sandboxProvider = createMockSandboxProvider();
      const bridgeProtocol = createMockBridgeProtocol();
      (bridgeProtocol as { name: string }).name = "trpc"; // Set to trpc to trigger dependency install

      const codeMode = new CodeMode({
        sandboxProvider,
        bridgeProtocol,
        bridgeConfig: defaultConfig,
      });

      await codeMode.initialize();
      await codeMode.executeCode('console.log("test")');

      expect(sandboxProvider.installDependencies).toHaveBeenCalledWith({
        "@trpc/client": "^11.0.0",
        superjson: "^2.2.1",
      });
    });

    it("should only install dependencies once", async () => {
      const sandboxProvider = createMockSandboxProvider();
      const bridgeProtocol = createMockBridgeProtocol();
      (bridgeProtocol as { name: string }).name = "trpc";

      const codeMode = new CodeMode({
        sandboxProvider,
        bridgeProtocol,
        bridgeConfig: defaultConfig,
      });

      await codeMode.initialize();
      await codeMode.executeCode('console.log("test1")');
      await codeMode.executeCode('console.log("test2")');

      expect(sandboxProvider.installDependencies).toHaveBeenCalledTimes(1);
    });
  });

  describe("output parsing", () => {
    it("should parse tool calls from output", async () => {
      const sandboxProvider = createMockSandboxProvider();
      (
        sandboxProvider.executeCode as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        success: true,
        output: `[TOOL_CALL:getData]{"query":"test"}
[TOOL_RESULT:getData]{"durationMs":50}
Result: test data`,
        exitCode: 0,
        executionTimeMs: 100,
        toolCalls: [],
      });

      const codeMode = new CodeMode({
        sandboxProvider,
        bridgeProtocol: createMockBridgeProtocol(),
        bridgeConfig: defaultConfig,
      });

      await codeMode.initialize();
      const result = await codeMode.executeCode("await tools.getData({})");

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe("getData");
      expect(result.toolCalls[0].input).toEqual({ query: "test" });
      expect(result.toolCalls[0].success).toBe(true);
      expect(result.toolCalls[0].durationMs).toBe(50);
      expect(result.output).toBe("Result: test data");
    });

    it("should parse tool errors from output", async () => {
      const sandboxProvider = createMockSandboxProvider();
      (
        sandboxProvider.executeCode as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        success: true,
        output: `[TOOL_CALL:failingTool]{}
[TOOL_ERROR:failingTool]{"error":"Connection failed","durationMs":100}
Handled error`,
        exitCode: 0,
        executionTimeMs: 150,
        toolCalls: [],
      });

      const codeMode = new CodeMode({
        sandboxProvider,
        bridgeProtocol: createMockBridgeProtocol(),
        bridgeConfig: defaultConfig,
      });

      await codeMode.initialize();
      const result = await codeMode.executeCode(
        "try { await tools.failingTool({}) }"
      );

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe("failingTool");
      expect(result.toolCalls[0].success).toBe(false);
      expect(result.toolCalls[0].error).toBe("Connection failed");
      expect(result.output).toBe("Handled error");
    });

    it("should handle multiple tool calls", async () => {
      const sandboxProvider = createMockSandboxProvider();
      (
        sandboxProvider.executeCode as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        success: true,
        output: `[TOOL_CALL:tool1]{"a":1}
[TOOL_RESULT:tool1]{"durationMs":10}
[TOOL_CALL:tool2]{"b":2}
[TOOL_RESULT:tool2]{"durationMs":20}
Done`,
        exitCode: 0,
        executionTimeMs: 50,
        toolCalls: [],
      });

      const codeMode = new CodeMode({
        sandboxProvider,
        bridgeProtocol: createMockBridgeProtocol(),
        bridgeConfig: defaultConfig,
      });

      await codeMode.initialize();
      const result = await codeMode.executeCode("// code");

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].tool).toBe("tool1");
      expect(result.toolCalls[1].tool).toBe("tool2");
    });

    it("should handle output with no tool calls", async () => {
      const sandboxProvider = createMockSandboxProvider();
      (
        sandboxProvider.executeCode as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        success: true,
        output: "Just regular output\nNo tools here",
        exitCode: 0,
        executionTimeMs: 10,
        toolCalls: [],
      });

      const codeMode = new CodeMode({
        sandboxProvider,
        bridgeProtocol: createMockBridgeProtocol(),
        bridgeConfig: defaultConfig,
      });

      await codeMode.initialize();
      const result = await codeMode.executeCode("console.log('test')");

      expect(result.toolCalls).toHaveLength(0);
      expect(result.output).toBe("Just regular output\nNo tools here");
    });

    it("should handle malformed tool call JSON", async () => {
      const sandboxProvider = createMockSandboxProvider();
      (
        sandboxProvider.executeCode as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        success: true,
        output: `[TOOL_CALL:badTool]not-json
Regular output`,
        exitCode: 0,
        executionTimeMs: 10,
        toolCalls: [],
      });

      const codeMode = new CodeMode({
        sandboxProvider,
        bridgeProtocol: createMockBridgeProtocol(),
        bridgeConfig: defaultConfig,
      });

      await codeMode.initialize();
      const result = await codeMode.executeCode("// code");

      // Should gracefully skip malformed tool call
      expect(result.toolCalls).toHaveLength(0);
      expect(result.output).toBe("Regular output");
    });
  });

  describe("cleanup", () => {
    it("should cleanup sandbox provider", async () => {
      const sandboxProvider = createMockSandboxProvider();

      const codeMode = new CodeMode({
        sandboxProvider,
        bridgeProtocol: createMockBridgeProtocol(),
        bridgeConfig: defaultConfig,
      });

      await codeMode.initialize();
      await codeMode.cleanup();

      expect(sandboxProvider.cleanup).toHaveBeenCalled();
    });

    it("should reset initialization state after cleanup", async () => {
      const sandboxProvider = createMockSandboxProvider();

      const codeMode = new CodeMode({
        sandboxProvider,
        bridgeProtocol: createMockBridgeProtocol(),
        bridgeConfig: defaultConfig,
      });

      await codeMode.initialize();
      await codeMode.cleanup();

      // Should throw because not initialized anymore
      await expect(codeMode.executeCode("test")).rejects.toThrow(
        "not initialized"
      );
    });
  });

  describe("request handler", () => {
    it("should throw if not initialized", () => {
      const codeMode = new CodeMode({
        sandboxProvider: createMockSandboxProvider(),
        bridgeProtocol: createMockBridgeProtocol(),
        bridgeConfig: defaultConfig,
      });

      expect(() => codeMode.getRequestHandler()).toThrow("not initialized");
    });

    it("should return request handler from protocol", async () => {
      const mockHandler = vi.fn();
      const bridgeProtocol = createMockBridgeProtocol();
      (
        bridgeProtocol.createRequestHandler as ReturnType<typeof vi.fn>
      ).mockReturnValue(mockHandler);

      const codeMode = new CodeMode({
        sandboxProvider: createMockSandboxProvider(),
        bridgeProtocol,
        bridgeConfig: defaultConfig,
      });

      await codeMode.initialize();
      const handler = codeMode.getRequestHandler();

      expect(handler).toBe(mockHandler);
    });
  });

  describe("isReady", () => {
    it("should return false when not initialized", async () => {
      const codeMode = new CodeMode({
        sandboxProvider: createMockSandboxProvider(),
        bridgeProtocol: createMockBridgeProtocol(),
        bridgeConfig: defaultConfig,
      });

      const ready = await codeMode.isReady();

      expect(ready).toBe(false);
    });

    it("should check sandbox provider readiness", async () => {
      const sandboxProvider = createMockSandboxProvider();
      (sandboxProvider.isReady as ReturnType<typeof vi.fn>).mockResolvedValue(
        true
      );

      const codeMode = new CodeMode({
        sandboxProvider,
        bridgeProtocol: createMockBridgeProtocol(),
        bridgeConfig: defaultConfig,
      });

      await codeMode.initialize();
      const ready = await codeMode.isReady();

      expect(ready).toBe(true);
      expect(sandboxProvider.isReady).toHaveBeenCalled();
    });

    it("should return false when sandbox not ready", async () => {
      const sandboxProvider = createMockSandboxProvider();
      (sandboxProvider.isReady as ReturnType<typeof vi.fn>).mockResolvedValue(
        false
      );

      const codeMode = new CodeMode({
        sandboxProvider,
        bridgeProtocol: createMockBridgeProtocol(),
        bridgeConfig: defaultConfig,
      });

      await codeMode.initialize();
      const ready = await codeMode.isReady();

      expect(ready).toBe(false);
    });
  });
});
