/**
 * Tool Registry
 *
 * The tool registry is responsible for:
 * - Registering tools with their schemas and implementations
 * - Generating TypeScript type definitions for the LLM
 * - Validating tool inputs and outputs
 * - Executing tools with proper error handling
 *
 * This is the central place where custom tools are defined and managed.
 */

import { z } from "zod";
import type { ToolDefinition, ExecutionContext, Logger } from "./types";

/**
 * Registry for managing tools
 */
export interface ToolRegistry {
  /**
   * Map of tool name to definition
   */
  readonly tools: ReadonlyMap<string, ToolDefinition>;

  /**
   * Register a new tool
   */
  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void;

  /**
   * Get a tool by name
   */
  get(name: string): ToolDefinition | undefined;

  /**
   * Check if a tool exists
   */
  has(name: string): boolean;

  /**
   * Get all tool names
   */
  getToolNames(): string[];

  /**
   * Generate TypeScript type definitions for all tools
   * These are shown to the LLM so it knows what APIs are available
   */
  generateTypeDefinitions(): string;

  /**
   * Execute a tool with input validation
   */
  executeTool(
    name: string,
    input: unknown,
    context: ExecutionContext
  ): Promise<unknown>;
}

/**
 * Options for creating a tool registry
 */
export interface ToolRegistryOptions {
  /**
   * Logger for debugging
   */
  logger?: Logger;

  /**
   * Whether to validate outputs against schema (if provided)
   */
  validateOutputs?: boolean;
}

/**
 * Create a new tool registry
 */
export function createToolRegistry(
  options: ToolRegistryOptions = {}
): ToolRegistry {
  const tools = new Map<string, ToolDefinition>();
  const { logger, validateOutputs = true } = options;

  return {
    get tools() {
      return tools as ReadonlyMap<string, ToolDefinition>;
    },

    register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>) {
      if (tools.has(tool.name)) {
        logger?.warn(`Tool '${tool.name}' is already registered, overwriting`);
      }
      tools.set(tool.name, tool as ToolDefinition);
      logger?.debug(`Registered tool: ${tool.name}`);
    },

    get(name: string) {
      return tools.get(name);
    },

    has(name: string) {
      return tools.has(name);
    },

    getToolNames() {
      return Array.from(tools.keys());
    },

    generateTypeDefinitions(): string {
      const lines: string[] = [
        "// =============================================================================",
        "// Custom Tools API - Available functions you can call in your code",
        "// =============================================================================",
        "",
        "declare const tools: {",
      ];

      for (const [name, tool] of tools) {
        const inputType = zodToTypeString(
          tool.inputSchema,
          `${capitalize(name)}Input`
        );
        const outputType = tool.outputSchema
          ? zodToTypeString(tool.outputSchema, `${capitalize(name)}Output`)
          : "unknown";

        lines.push(`  /**`);
        lines.push(`   * ${tool.description}`);
        if (tool.requiredScopes && tool.requiredScopes.length > 0) {
          lines.push(
            `   * @requires scopes: ${tool.requiredScopes.join(", ")}`
          );
        }
        lines.push(`   */`);
        lines.push(
          `  ${name}: (input: ${inputType}) => Promise<${outputType}>;`
        );
        lines.push("");
      }

      lines.push("};");

      // Add interface definitions
      lines.push("");
      lines.push("// Tool input/output types");

      for (const [name, tool] of tools) {
        const interfaceDef = zodToInterfaceString(
          tool.inputSchema,
          `${capitalize(name)}Input`
        );
        lines.push(interfaceDef);

        if (tool.outputSchema) {
          const outputInterfaceDef = zodToInterfaceString(
            tool.outputSchema,
            `${capitalize(name)}Output`
          );
          lines.push(outputInterfaceDef);
        }
      }

      return lines.join("\n");
    },

    async executeTool(
      name: string,
      input: unknown,
      context: ExecutionContext
    ): Promise<unknown> {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }

      // Validate input
      let validatedInput: unknown;
      try {
        validatedInput = tool.inputSchema.parse(input);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new Error(
            `Invalid input for tool '${name}': ${error.issues
              .map((e) => `${e.path.join(".")}: ${e.message}`)
              .join(", ")}`
          );
        }
        throw error;
      }

      // Execute the tool
      const result = await tool.execute(validatedInput, context);

      // Validate output if schema provided and validation enabled
      if (validateOutputs && tool.outputSchema) {
        try {
          return tool.outputSchema.parse(result);
        } catch (error) {
          if (error instanceof z.ZodError) {
            logger?.error(`Tool '${name}' returned invalid output`, {
              errors: error.issues,
            });
            // Return the result anyway but log the validation error
          }
        }
      }

      return result;
    },
  };
}

// =============================================================================
// Type Generation Helpers
// =============================================================================

/**
 * Zod 4 internal type for literal schemas
 * The values array contains all allowed literal values
 */
interface Zod4LiteralDef {
  values: ReadonlyArray<string | number | boolean>;
}

/**
 * Zod 4 internal type for enum schemas
 * The entries record maps enum keys to their values
 */
interface Zod4EnumDef {
  entries: Record<string, string>;
}

/**
 * Helper to safely access Zod 4 internal definition
 * Zod 4 moved `._def` to `._zod.def`
 */
function getZod4Def<T>(schema: z.ZodType): T | undefined {
  // Zod 4 structure: schema._zod.def
  const zodMeta = schema as { _zod?: { def?: unknown } };
  if (zodMeta._zod?.def) {
    return zodMeta._zod.def as T;
  }
  // Fallback for potential older structure
  const legacyMeta = schema as { _def?: unknown };
  return legacyMeta._def as T | undefined;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert a Zod schema to a TypeScript type string
 */
function zodToTypeString(schema: z.ZodType, typeName: string): string {
  // For complex types, use the interface name
  if (schema instanceof z.ZodObject) {
    return typeName;
  }

  // For simple types, return inline
  if (schema instanceof z.ZodString) return "string";
  if (schema instanceof z.ZodNumber) return "number";
  if (schema instanceof z.ZodBoolean) return "boolean";
  if (schema instanceof z.ZodArray) {
    const elementType = zodToTypeString(
      (schema as z.ZodArray<z.ZodType>).element,
      "Element"
    );
    return `${elementType}[]`;
  }
  if (schema instanceof z.ZodOptional) {
    const innerType = zodToTypeString(
      (schema as z.ZodOptional<z.ZodType>).unwrap(),
      typeName
    );
    return `${innerType} | undefined`;
  }
  if (schema instanceof z.ZodNullable) {
    const innerType = zodToTypeString(
      (schema as z.ZodNullable<z.ZodType>).unwrap(),
      typeName
    );
    return `${innerType} | null`;
  }
  if (schema instanceof z.ZodRecord) {
    return `Record<string, unknown>`;
  }
  if (schema instanceof z.ZodEnum) {
    // In Zod 4, access enum entries through the internal def structure
    const enumDef = getZod4Def<Zod4EnumDef>(schema);
    if (enumDef?.entries) {
      const values = Object.values(enumDef.entries);
      return values.map((v) => `"${v}"`).join(" | ");
    }
    return "string"; // fallback if structure changed
  }
  if (schema instanceof z.ZodLiteral) {
    // In Zod 4, literal values are stored in a values array
    const literalDef = getZod4Def<Zod4LiteralDef>(schema);
    if (literalDef?.values && literalDef.values.length > 0) {
      // If multiple values, create a union type
      if (literalDef.values.length > 1) {
        return literalDef.values
          .map((v) => (typeof v === "string" ? `"${v}"` : String(v)))
          .join(" | ");
      }
      const value = literalDef.values[0];
      return typeof value === "string" ? `"${value}"` : String(value);
    }
    return "unknown"; // fallback if structure changed
  }
  if (schema instanceof z.ZodUnion) {
    const types = (schema as z.ZodUnion<[z.ZodType, ...z.ZodType[]]>).options;
    return types
      .map((t, i) => zodToTypeString(t, `${typeName}${i}`))
      .join(" | ");
  }

  return typeName;
}

/**
 * Convert a Zod object schema to a TypeScript interface string
 */
function zodToInterfaceString(
  schema: z.ZodType,
  interfaceName: string
): string {
  if (!(schema instanceof z.ZodObject)) {
    return `type ${interfaceName} = ${zodToTypeString(schema, interfaceName)};`;
  }

  const shape = schema.shape as Record<string, z.ZodType>;
  const lines: string[] = [`interface ${interfaceName} {`];

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const isOptional =
      fieldSchema instanceof z.ZodOptional ||
      fieldSchema instanceof z.ZodDefault;

    let unwrappedSchema = fieldSchema;
    if (fieldSchema instanceof z.ZodOptional) {
      unwrappedSchema = (fieldSchema as z.ZodOptional<z.ZodType>).unwrap();
    } else if (fieldSchema instanceof z.ZodDefault) {
      unwrappedSchema = (
        fieldSchema as z.ZodDefault<z.ZodType>
      ).removeDefault();
    }

    const fieldType = zodToTypeString(
      unwrappedSchema,
      `${interfaceName}${capitalize(key)}`
    );

    const description = fieldSchema.description;

    if (description) {
      lines.push(`  /** ${description} */`);
    }
    lines.push(`  ${key}${isOptional ? "?" : ""}: ${fieldType};`);
  }

  lines.push("}");
  return lines.join("\n");
}
