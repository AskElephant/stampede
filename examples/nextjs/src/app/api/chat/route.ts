import { convertToModelMessages, streamText, UIMessage, stepCountIs } from "ai";
import { createCodeMode } from "@/lib/code-mode";

// Allow streaming responses up to 60 seconds for code execution
export const maxDuration = 60;

/**
 * Chat API route with Code Mode enabled
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
  const { system, tools } = createCodeMode({
    additionalInstructions: `
You are a helpful, friendly AI assistant with the ability to execute code.

When appropriate, use markdown formatting to make your responses more readable:
- Use **bold** for emphasis
- Use code blocks for code snippets
- Use bullet points for lists
- Use headers for organizing long responses

## When to Use Code Execution

Use the executeCode tool when you need to:
- Perform calculations or data analysis
- Process or transform data (CSV, JSON, etc.)
- Make HTTP requests to fetch information using the tools.fetchUrl API
- Get current time information using tools.getCurrentTime
- Work with files
- Generate unique IDs or hashes
- Do any complex operation that benefits from code

## Available Custom Tools

You have access to these custom tools via the \`tools\` object:
- \`tools.getCurrentTime({ timezone?: string })\` - Get current date/time
- \`tools.fetchUrl({ url, method?, headers?, body? })\` - Fetch data from URLs
- \`tools.searchDatabase({ query, table, limit? })\` - Search database (demo)
- \`tools.sendEmail({ to, subject, body })\` - Send email (demo)

## When NOT to Use Code Execution

Don't use code execution for:
- Simple conversational responses
- General knowledge questions
- Explaining concepts (unless demonstration code helps)

Be concise but thorough. If you're unsure about something, say so.
Always explain what your code does and interpret the results for the user.
    `,
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
