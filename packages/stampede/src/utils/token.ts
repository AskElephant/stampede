/**
 * Token Utilities
 *
 * Utility functions for creating and verifying JWT tokens
 * used in the tool bridge authentication.
 */

import { SignJWT, jwtVerify } from "jose";
import type { ExecutionContext, TokenConfig } from "../core/types";

/**
 * Create an execution token for sandbox authentication
 *
 * @param config - Token configuration (secret, expiration, etc.)
 * @param context - Execution context to encode in the token
 * @returns Signed JWT token
 */
export async function createExecutionToken(
  config: TokenConfig,
  context: ExecutionContext
): Promise<string> {
  const secret = new TextEncoder().encode(config.secretKey);
  const expirationSeconds = config.expirationSeconds ?? 300;
  const audience = config.audience ?? "tool-bridge";

  return new SignJWT({
    userId: context.userId,
    sessionId: context.sessionId,
    organizationId: context.organizationId,
    scopes: context.scopes,
    metadata: context.metadata,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expirationSeconds}s`)
    .setSubject(context.userId)
    .setAudience(audience)
    .sign(secret);
}

/**
 * Verify and decode an execution token
 *
 * @param config - Token configuration (must match creation config)
 * @param token - JWT token to verify
 * @returns Decoded execution context, or null if invalid
 */
export async function verifyExecutionToken(
  config: TokenConfig,
  token: string
): Promise<ExecutionContext | null> {
  const secret = new TextEncoder().encode(config.secretKey);
  const audience = config.audience ?? "tool-bridge";

  try {
    const { payload } = await jwtVerify(token, secret, {
      audience,
    });

    return {
      userId: payload.userId as string,
      sessionId: payload.sessionId as string,
      organizationId: payload.organizationId as string | undefined,
      scopes: payload.scopes as string[],
      metadata: payload.metadata as Record<string, unknown> | undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Generate a random session ID
 */
export function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Parse authorization header to extract token
 */
export function parseAuthHeader(header: string | null): string | null {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice(7);
}
