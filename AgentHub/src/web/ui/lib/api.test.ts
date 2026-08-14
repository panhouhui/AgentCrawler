import { test, expect, beforeEach, mock } from "bun:test";

// Mock localStorage before importing api module
const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => {
    storage[key] = value;
  },
  removeItem: (key: string) => {
    delete storage[key];
  },
};
Object.defineProperty(globalThis, "localStorage", { value: mockLocalStorage });

// Mock window.location and window.history for initTokenFromUrl
const mockReplaceState = mock(() => {});
Object.defineProperty(globalThis, "history", {
  value: { replaceState: mockReplaceState },
});

import {
  getToken,
  setToken,
  clearToken,
  getConfigHash,
  setConfigHash,
} from "../api";

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  mockReplaceState.mockClear();
});

/* ---------- token management ---------- */

test("getToken returns null when no token stored", () => {
  expect(getToken()).toBeNull();
});

test("setToken stores and getToken retrieves", () => {
  setToken("test-token-123");
  expect(getToken()).toBe("test-token-123");
});

test("clearToken removes the token", () => {
  setToken("abc");
  clearToken();
  expect(getToken()).toBeNull();
});

test("setToken overwrites previous token", () => {
  setToken("first");
  setToken("second");
  expect(getToken()).toBe("second");
});

/* ---------- configHash management ---------- */

test("getConfigHash returns null before any setConfigHash call", () => {
  // _configHash is module-level; first access in test suite should be null
  // This test must run before setConfigHash is called
  expect(getConfigHash()).toBeNull();
});

test("setConfigHash stores and getConfigHash retrieves", () => {
  setConfigHash("hash-abc");
  expect(getConfigHash()).toBe("hash-abc");
});

test("setConfigHash overwrites previous hash", () => {
  setConfigHash("first");
  setConfigHash("second");
  expect(getConfigHash()).toBe("second");
});
