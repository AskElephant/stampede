"use client";

import { useChat } from "@ai-sdk/react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Suggestions, Suggestion } from "@/components/ai-elements/suggestion";
import { Loader } from "@/components/ai-elements/loader";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { CodeExecution } from "@/components/ai-elements/code-execution";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  MessageSquareIcon,
  CopyIcon,
  RefreshCwIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  SendIcon,
  CodeIcon,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { ToolUIPart } from "ai";

export default function ChatPage() {
  const { messages, sendMessage, status, error } = useChat();

  const [inputValue, setInputValue] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const suggestions = [
    "Get the current time in New York, Tokyo, and London",
    "Fetch the GitHub API and show my rate limit",
    "Calculate the Fibonacci sequence up to 20 terms",
    "Search the database for products and show results",
  ];

  const isLoading = status === "streaming" || status === "submitted";

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  const handleSuggestionClick = useCallback((text: string) => {
    setInputValue(text);
    // Submit after a tick to ensure input is updated
    setTimeout(() => {
      formRef.current?.requestSubmit();
    }, 50);
  }, []);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const message = inputValue.trim();
      if (message) {
        setInputValue("");
        sendMessage({ text: message });
      }
    },
    [sendMessage, inputValue]
  );

  // Helper to extract text content from message parts
  const getMessageText = (message: (typeof messages)[0]) => {
    return message.parts
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text"
      )
      .map((part) => part.text)
      .join("");
  };

  // Helper to get tool parts from a message
  const getToolParts = (message: (typeof messages)[0]) => {
    return message.parts
      .filter((part) => part.type.startsWith("tool-"))
      .map((part) => part as unknown as ToolUIPart);
  };

  return (
    <div className="flex h-screen flex-col bg-linear-to-b from-background via-background to-muted/20">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-linear-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/25">
                <CodeIcon className="size-4 text-white" />
              </div>
              <div>
                <h1 className="font-semibold text-sm">Stampede Chat</h1>
                <p className="text-muted-foreground text-xs">
                  Powered by Claude + Daytona Sandbox
                </p>
              </div>
            </div>
          </div>

          {messages.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
              className="gap-2"
            >
              <RefreshCwIcon className="size-3" />
              New Chat
            </Button>
          )}
        </div>
      </header>

      {/* Main Chat Area */}
      <main className="flex-1 overflow-hidden">
        <Conversation className="h-full">
          <ConversationContent className="mx-auto max-w-4xl px-4 py-6">
            {messages.length === 0 ? (
              <ConversationEmptyState className="h-full">
                <div className="flex flex-col items-center gap-6">
                  <div className="relative">
                    <div className="absolute -inset-4 rounded-full bg-linear-to-r from-violet-500/20 via-indigo-500/20 to-purple-500/20 blur-2xl" />
                    <div className="relative flex size-20 items-center justify-center rounded-2xl bg-linear-to-br from-violet-500 to-indigo-600 shadow-2xl shadow-violet-500/30">
                      <MessageSquareIcon className="size-10 text-white" />
                    </div>
                  </div>

                  <div className="space-y-2 text-center">
                    <Shimmer
                      as="h2"
                      className="text-2xl font-bold tracking-tight"
                      duration={3}
                    >
                      Stampede: Execute Code in a Sandbox
                    </Shimmer>
                    <p className="max-w-md text-muted-foreground">
                      I can write and execute TypeScript code in a secure
                      Daytona sandbox. Ask me to calculate, process data, or
                      perform complex operations!
                    </p>
                  </div>

                  <div className="w-full max-w-2xl">
                    <Suggestions className="justify-center">
                      {suggestions.map((suggestion) => (
                        <Suggestion
                          key={suggestion}
                          suggestion={suggestion}
                          onClick={handleSuggestionClick}
                          className="bg-secondary/50 hover:bg-secondary transition-colors"
                        />
                      ))}
                    </Suggestions>
                  </div>
                </div>
              </ConversationEmptyState>
            ) : (
              <div className="space-y-6">
                {messages.map((message) => {
                  const textContent = getMessageText(message);
                  const toolParts = getToolParts(message);

                  return (
                    <Message key={message.id} from={message.role}>
                      <MessageContent>
                        {message.role === "user" ? (
                          <span className="whitespace-pre-wrap">
                            {textContent}
                          </span>
                        ) : (
                          <>
                            {/* Render tool calls (code execution) */}
                            {toolParts.map((toolPart, index) => (
                              <CodeExecution
                                key={`${message.id}-tool-${index}`}
                                part={toolPart}
                              />
                            ))}
                            {/* Render text response */}
                            {textContent && (
                              <MessageResponse>{textContent}</MessageResponse>
                            )}
                          </>
                        )}
                      </MessageContent>

                      {/* Message Actions for assistant */}
                      {message.role === "assistant" && textContent && (
                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleCopy(textContent)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <CopyIcon className="size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <ThumbsUpIcon className="size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <ThumbsDownIcon className="size-3" />
                          </Button>
                        </div>
                      )}
                    </Message>
                  );
                })}

                {/* Loading indicator */}
                {isLoading && (
                  <div className="flex items-center gap-3 py-2">
                    <Loader size={16} />
                    <span className="text-muted-foreground text-sm">
                      Gemini is thinking...
                    </span>
                  </div>
                )}

                {/* Error display */}
                {error && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-500 text-sm">
                    Error: {error.message}
                  </div>
                )}
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </main>

      {/* Input Area */}
      <footer className="border-t bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-4xl px-4 py-4">
          <form ref={formRef} onSubmit={onSubmit} className="flex gap-3">
            <div className="relative flex-1">
              <Textarea
                name="message"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask me anything..."
                className="min-h-12 resize-none rounded-2xl border bg-secondary/30 pr-12 shadow-lg shadow-black/5 transition-shadow focus:shadow-xl focus:shadow-violet-500/5"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    formRef.current?.requestSubmit();
                  }
                }}
              />
            </div>
            <Button
              type="submit"
              disabled={!inputValue.trim() || isLoading}
              className="h-12 w-12 rounded-xl bg-linear-to-r from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/25 hover:from-violet-600 hover:to-indigo-700 disabled:opacity-50"
            >
              {isLoading ? (
                <Loader size={16} />
              ) : (
                <SendIcon className="size-4" />
              )}
            </Button>
          </form>

          <p className="mt-3 text-center text-muted-foreground text-xs">
            Code executes in a secure sandbox. Review generated code before
            using in production.
          </p>
        </div>
      </footer>
    </div>
  );
}
