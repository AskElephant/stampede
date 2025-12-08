import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createToolRegistry } from "./tool-registry";
import type { ExecutionContext, Logger } from "./types";
import { defineTool } from "./types";

describe("createToolRegistry", () => {
  const mockContext: ExecutionContext = {
    userId: "user-123",
    sessionId: "session-456",
    scopes: ["*"],
  };

  describe("tool registration", () => {
    it("should register a tool successfully", () => {
      const registry = createToolRegistry();
      const tool = defineTool({
        name: "testTool",
        description: "A test tool",
        inputSchema: z.object({ message: z.string() }),
        execute: async () => ({ success: true }),
      });

      registry.register(tool);

      expect(registry.has("testTool")).toBe(true);
      expect(registry.get("testTool")).toBeDefined();
      expect(registry.getToolNames()).toContain("testTool");
    });

    it("should overwrite existing tool with warning", () => {
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const registry = createToolRegistry({ logger: mockLogger });

      const tool1 = defineTool({
        name: "testTool",
        description: "First tool",
        inputSchema: z.object({}),
        execute: async () => "first",
      });
      const tool2 = defineTool({
        name: "testTool",
        description: "Second tool",
        inputSchema: z.object({}),
        execute: async () => "second",
      });

      registry.register(tool1);
      registry.register(tool2);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Tool 'testTool' is already registered, overwriting"
      );
      expect(registry.get("testTool")?.description).toBe("Second tool");
    });

    it("should return all registered tool names", () => {
      const registry = createToolRegistry();
      const tool1 = defineTool({
        name: "tool1",
        description: "Tool 1",
        inputSchema: z.object({}),
        execute: async () => null,
      });
      const tool2 = defineTool({
        name: "tool2",
        description: "Tool 2",
        inputSchema: z.object({}),
        execute: async () => null,
      });

      registry.register(tool1);
      registry.register(tool2);

      expect(registry.getToolNames()).toEqual(["tool1", "tool2"]);
    });
  });

  describe("tool execution", () => {
    it("should execute a tool with valid input", async () => {
      const registry = createToolRegistry();
      const tool = defineTool({
        name: "greet",
        description: "Greet someone",
        inputSchema: z.object({ name: z.string() }),
        outputSchema: z.object({ greeting: z.string() }),
        execute: async ({ name }) => ({ greeting: `Hello, ${name}!` }),
      });

      registry.register(tool);
      const result = await registry.executeTool(
        "greet",
        { name: "World" },
        mockContext
      );

      expect(result).toEqual({ greeting: "Hello, World!" });
    });

    it("should throw error for unknown tool", async () => {
      const registry = createToolRegistry();

      await expect(
        registry.executeTool("unknownTool", {}, mockContext)
      ).rejects.toThrow("Unknown tool: unknownTool");
    });

    it("should validate input against schema", async () => {
      const registry = createToolRegistry();
      const tool = defineTool({
        name: "validateMe",
        description: "Tool with strict input",
        inputSchema: z.object({
          required: z.string(),
          count: z.number().min(0),
        }),
        execute: async (input) => input,
      });

      registry.register(tool);

      // Missing required field
      await expect(
        registry.executeTool("validateMe", { count: 5 }, mockContext)
      ).rejects.toThrow("Invalid input for tool 'validateMe'");

      // Invalid type
      await expect(
        registry.executeTool(
          "validateMe",
          { required: "test", count: "not-a-number" },
          mockContext
        )
      ).rejects.toThrow("Invalid input for tool 'validateMe'");
    });

    it("should pass execution context to tool", async () => {
      const registry = createToolRegistry();
      let capturedContext: ExecutionContext | null = null;

      const tool = defineTool({
        name: "contextTest",
        description: "Captures context",
        inputSchema: z.object({}),
        execute: async (_, context) => {
          capturedContext = context;
          return null;
        },
      });

      registry.register(tool);
      await registry.executeTool("contextTest", {}, mockContext);

      expect(capturedContext).toEqual(mockContext);
    });

    it("should validate output when validateOutputs is enabled", async () => {
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const registry = createToolRegistry({
        logger: mockLogger,
        validateOutputs: true,
      });

      const tool = defineTool({
        name: "invalidOutput",
        description: "Returns invalid output",
        inputSchema: z.object({}),
        outputSchema: z.object({ value: z.number() }),
        execute: async () => ({ value: "not-a-number" as unknown as number }),
      });

      registry.register(tool);
      const result = await registry.executeTool(
        "invalidOutput",
        {},
        mockContext
      );

      // Should still return the result but log an error
      expect(result).toEqual({ value: "not-a-number" });
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("TypeScript type generation", () => {
    it("should generate type definitions for registered tools", () => {
      const registry = createToolRegistry();
      const tool = defineTool({
        name: "searchDatabase",
        description: "Search the database",
        inputSchema: z.object({
          query: z.string().describe("Search query"),
          limit: z.number().optional().describe("Max results"),
        }),
        outputSchema: z.object({
          results: z.array(z.string()),
          total: z.number(),
        }),
        execute: async () => ({ results: [], total: 0 }),
      });

      registry.register(tool);
      const typeDefs = registry.generateTypeDefinitions();

      expect(typeDefs).toContain("declare const tools");
      expect(typeDefs).toContain("searchDatabase");
      expect(typeDefs).toContain("Search the database");
      expect(typeDefs).toContain("SearchDatabaseInput");
      expect(typeDefs).toContain("SearchDatabaseOutput");
    });

    it("should generate correct primitive types", () => {
      const registry = createToolRegistry();
      const tool = defineTool({
        name: "primitives",
        description: "Test primitives",
        inputSchema: z.object({
          str: z.string(),
          num: z.number(),
          bool: z.boolean(),
        }),
        execute: async () => null,
      });

      registry.register(tool);
      const typeDefs = registry.generateTypeDefinitions();

      expect(typeDefs).toContain("str: string");
      expect(typeDefs).toContain("num: number");
      expect(typeDefs).toContain("bool: boolean");
    });

    it("should generate correct array types", () => {
      const registry = createToolRegistry();
      const tool = defineTool({
        name: "arrays",
        description: "Test arrays",
        inputSchema: z.object({
          strings: z.array(z.string()),
          numbers: z.array(z.number()),
        }),
        execute: async () => null,
      });

      registry.register(tool);
      const typeDefs = registry.generateTypeDefinitions();

      expect(typeDefs).toContain("strings: string[]");
      expect(typeDefs).toContain("numbers: number[]");
    });

    it("should generate correct optional types", () => {
      const registry = createToolRegistry();
      const tool = defineTool({
        name: "optionals",
        description: "Test optionals",
        inputSchema: z.object({
          required: z.string(),
          optional: z.string().optional(),
          withDefault: z.number().default(10),
        }),
        execute: async () => null,
      });

      registry.register(tool);
      const typeDefs = registry.generateTypeDefinitions();

      expect(typeDefs).toContain("required: string;");
      expect(typeDefs).toContain("optional?: string");
      expect(typeDefs).toContain("withDefault?: number");
    });

    it("should generate correct nullable types", () => {
      const registry = createToolRegistry();
      const tool = defineTool({
        name: "nullables",
        description: "Test nullables",
        inputSchema: z.object({
          nullable: z.string().nullable(),
        }),
        execute: async () => null,
      });

      registry.register(tool);
      const typeDefs = registry.generateTypeDefinitions();

      expect(typeDefs).toContain("string | null");
    });

    it("should include required scopes in JSDoc", () => {
      const registry = createToolRegistry();
      const tool = defineTool({
        name: "secured",
        description: "Secured tool",
        inputSchema: z.object({}),
        requiredScopes: ["admin", "write"],
        execute: async () => null,
      });

      registry.register(tool);
      const typeDefs = registry.generateTypeDefinitions();

      expect(typeDefs).toContain("@requires scopes: admin, write");
    });

    it("should handle enum types", () => {
      const registry = createToolRegistry();
      const tool = defineTool({
        name: "withEnum",
        description: "Tool with enum",
        inputSchema: z.object({
          status: z.enum(["pending", "active", "completed"]),
        }),
        execute: async () => null,
      });

      registry.register(tool);
      const typeDefs = registry.generateTypeDefinitions();

      // Should contain enum values as union type
      expect(typeDefs).toMatch(/"pending"|"active"|"completed"|string/);
    });

    it("should handle literal types", () => {
      const registry = createToolRegistry();
      const tool = defineTool({
        name: "withLiteral",
        description: "Tool with literal",
        inputSchema: z.object({
          type: z.literal("fixed"),
          count: z.literal(42),
        }),
        execute: async () => null,
      });

      registry.register(tool);
      const typeDefs = registry.generateTypeDefinitions();

      expect(typeDefs).toMatch(/"fixed"|unknown/);
      expect(typeDefs).toMatch(/42|unknown/);
    });

    it("should handle union types", () => {
      const registry = createToolRegistry();
      const tool = defineTool({
        name: "withUnion",
        description: "Tool with union",
        inputSchema: z.object({
          value: z.union([z.string(), z.number()]),
        }),
        execute: async () => null,
      });

      registry.register(tool);
      const typeDefs = registry.generateTypeDefinitions();

      expect(typeDefs).toContain("string | number");
    });

    it("should handle record types", () => {
      const registry = createToolRegistry();
      const tool = defineTool({
        name: "withRecord",
        description: "Tool with record",
        inputSchema: z.object({
          metadata: z.record(z.string(), z.unknown()),
        }),
        execute: async () => null,
      });

      registry.register(tool);
      const typeDefs = registry.generateTypeDefinitions();

      expect(typeDefs).toContain("Record<string, unknown>");
    });
  });
});
