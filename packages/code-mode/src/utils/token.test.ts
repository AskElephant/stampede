import { describe, it, expect } from "vitest";
import {
  createExecutionToken,
  verifyExecutionToken,
  generateSessionId,
  parseAuthHeader,
} from "./token";
import type { ExecutionContext, TokenConfig } from "../core/types";

describe("Token Utilities", () => {
  const testSecretKey = "test-secret-key-for-testing-purposes-only";
  const defaultConfig: TokenConfig = {
    secretKey: testSecretKey,
    expirationSeconds: 300,
    audience: "test-audience",
  };

  const testContext: ExecutionContext = {
    userId: "user-123",
    sessionId: "session-456",
    organizationId: "org-789",
    scopes: ["read", "write"],
    metadata: { customField: "value" },
  };

  describe("createExecutionToken", () => {
    it("should create a valid JWT token", async () => {
      const token = await createExecutionToken(defaultConfig, testContext);

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3); // JWT format: header.payload.signature
    });

    it("should use default expiration when not specified", async () => {
      const config: TokenConfig = {
        secretKey: testSecretKey,
      };

      const token = await createExecutionToken(config, testContext);

      expect(token).toBeDefined();
      // Token should be verifiable
      const verified = await verifyExecutionToken(config, token);
      expect(verified).not.toBeNull();
    });

    it("should use default audience when not specified", async () => {
      const config: TokenConfig = {
        secretKey: testSecretKey,
      };

      const token = await createExecutionToken(config, testContext);

      // Should be verifiable with default audience
      const verified = await verifyExecutionToken(config, token);
      expect(verified).not.toBeNull();
    });
  });

  describe("verifyExecutionToken", () => {
    it("should verify and decode a valid token", async () => {
      const token = await createExecutionToken(defaultConfig, testContext);
      const decoded = await verifyExecutionToken(defaultConfig, token);

      expect(decoded).not.toBeNull();
      expect(decoded?.userId).toBe(testContext.userId);
      expect(decoded?.sessionId).toBe(testContext.sessionId);
      expect(decoded?.organizationId).toBe(testContext.organizationId);
      expect(decoded?.scopes).toEqual(testContext.scopes);
      expect(decoded?.metadata).toEqual(testContext.metadata);
    });

    it("should return null for invalid token", async () => {
      const invalidToken = "invalid.token.here";
      const decoded = await verifyExecutionToken(defaultConfig, invalidToken);

      expect(decoded).toBeNull();
    });

    it("should return null for token with wrong secret", async () => {
      const token = await createExecutionToken(defaultConfig, testContext);
      const wrongConfig: TokenConfig = {
        secretKey: "wrong-secret-key",
        audience: defaultConfig.audience,
      };

      const decoded = await verifyExecutionToken(wrongConfig, token);

      expect(decoded).toBeNull();
    });

    it("should return null for token with wrong audience", async () => {
      const token = await createExecutionToken(defaultConfig, testContext);
      const wrongAudienceConfig: TokenConfig = {
        secretKey: testSecretKey,
        audience: "wrong-audience",
      };

      const decoded = await verifyExecutionToken(wrongAudienceConfig, token);

      expect(decoded).toBeNull();
    });

    it("should return null for expired token", async () => {
      const shortLivedConfig: TokenConfig = {
        secretKey: testSecretKey,
        expirationSeconds: 1, // 1 second
        audience: "test-audience",
      };

      const token = await createExecutionToken(shortLivedConfig, testContext);

      // Wait for token to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const decoded = await verifyExecutionToken(shortLivedConfig, token);

      expect(decoded).toBeNull();
    });

    it("should handle context without optional fields", async () => {
      const minimalContext: ExecutionContext = {
        userId: "user-only",
        sessionId: "session-only",
        scopes: [],
      };

      const token = await createExecutionToken(defaultConfig, minimalContext);
      const decoded = await verifyExecutionToken(defaultConfig, token);

      expect(decoded).not.toBeNull();
      expect(decoded?.userId).toBe("user-only");
      expect(decoded?.organizationId).toBeUndefined();
      expect(decoded?.metadata).toBeUndefined();
    });
  });

  describe("generateSessionId", () => {
    it("should generate unique session IDs", () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();

      expect(id1).not.toBe(id2);
    });

    it("should start with 'session-' prefix", () => {
      const id = generateSessionId();

      expect(id.startsWith("session-")).toBe(true);
    });

    it("should contain timestamp", () => {
      const before = Date.now();
      const id = generateSessionId();
      const after = Date.now();

      // Extract timestamp from session ID (format: session-{timestamp}-{random})
      const parts = id.split("-");
      expect(parts.length).toBeGreaterThanOrEqual(2);

      const timestamp = parseInt(parts[1], 10);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it("should include random component", () => {
      const id = generateSessionId();
      const parts = id.split("-");

      expect(parts.length).toBe(3);
      expect(parts[2].length).toBeGreaterThan(0);
    });
  });

  describe("parseAuthHeader", () => {
    it("should extract token from valid Bearer header", () => {
      const token = "my-jwt-token";
      const header = `Bearer ${token}`;

      const parsed = parseAuthHeader(header);

      expect(parsed).toBe(token);
    });

    it("should return null for null header", () => {
      const parsed = parseAuthHeader(null);

      expect(parsed).toBeNull();
    });

    it("should return null for non-Bearer header", () => {
      const parsed = parseAuthHeader("Basic some-credentials");

      expect(parsed).toBeNull();
    });

    it("should return null for empty header", () => {
      const parsed = parseAuthHeader("");

      expect(parsed).toBeNull();
    });

    it("should return null for header with only 'Bearer'", () => {
      const parsed = parseAuthHeader("Bearer");

      expect(parsed).toBeNull();
    });

    it("should handle token with spaces", () => {
      // In real JWTs this wouldn't happen, but test edge case
      const parsed = parseAuthHeader("Bearer token with spaces");

      expect(parsed).toBe("token with spaces");
    });

    it("should be case-sensitive for Bearer prefix", () => {
      const parsed = parseAuthHeader("bearer my-token");

      expect(parsed).toBeNull();
    });
  });
});
