import { convertToModelMessages, streamText, UIMessage, stepCountIs } from "ai";
import { stampede } from "@/lib/stampede";

// Allow streaming responses up to 60 seconds for code execution
export const maxDuration = 60;

/**
 * Chat API route with Stampede enabled
 *
 * This implements the "code mode" paradigm where instead of exposing tools
 * directly to the LLM, we present a TypeScript API. The LLM writes code
 * that gets executed in a secure Daytona sandbox.
 *
 * Benefits:
 * - LLMs are better at writing TypeScript than making tool calls
 * - Multiple operations can be composed in a single execution
 * - Intermediate results stay in the sandbox, reducing context usage
 * - More efficient for complex, multi-step operations
 */
export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Create code mode configuration with system prompt and tools
  const { system, tools } = stampede({
    system: `You are a helpful, friendly AI assistant`,
  });

  const result = streamText({
    model: "google/gemini-3-pro-preview",
    system,
    messages: convertToModelMessages(messages),
    tools,
    // Allow up to 5 tool calls in a conversation turn
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
