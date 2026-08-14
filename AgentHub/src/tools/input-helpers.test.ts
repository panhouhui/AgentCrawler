import { describe, it, expect } from "bun:test";
import { requireString, getString, getNumber, getBoolean, getEnum, isToolError } from "./input-helpers";

describe("requireString", () => {
  it("should return string value when present", () => {
    const input = { name: "test" };
    const result = requireString(input, "name");
    expect(result).toBe("test");
  });

  it("should return error for missing required field", () => {
    const input = {};
    const result = requireString(input, "name");
    expect(isToolError(result)).toBe(true);
    expect((result as { output: string }).output).toContain("Missing required field");
  });

  it("should convert non-string types to string", () => {
    const input = { name: 123 };
    const result = requireString(input, "name");
    expect(result).toBe("123");
  });

  it("should return error for null value", () => {
    const input = { name: null };
    const result = requireString(input, "name");
    expect(isToolError(result)).toBe(true);
  });

  it("should return error for undefined value", () => {
    const input = { name: undefined };
    const result = requireString(input, "name");
    expect(isToolError(result)).toBe(true);
  });

  it("should truncate if maxLength exceeded", () => {
    const input = { name: "verylongstring" };
    const result = requireString(input, "name", { maxLength: 5 });
    expect(result).toBe("veryl");
  });

  it("should treat empty string as missing", () => {
    const input = { name: "" };
    const result = requireString(input, "name");
    expect(isToolError(result)).toBe(true);
  });

  it("should return error for empty string when allowEmpty=false", () => {
    const input = { name: "" };
    const result = requireString(input, "name", { allowEmpty: false });
    expect(isToolError(result)).toBe(true);
  });
});

describe("getString", () => {
  it("should return string value when present", () => {
    const input = { name: "test" };
    const result = getString(input, "name");
    expect(result).toBe("test");
  });

  it("should return undefined for missing field", () => {
    const input = {};
    const result = getString(input, "name");
    expect(result).toBeUndefined();
  });

  it("should return undefined for null value", () => {
    const input = { name: null };
    const result = getString(input, "name");
    expect(result).toBeUndefined();
  });

  it("should trim by default", () => {
    const input = { name: "  test  " };
    const result = getString(input, "name");
    expect(result).toBe("test");
  });

  it("should disable trimming with trim=false", () => {
    const input = { name: "  test  " };
    const result = getString(input, "name", { trim: false });
    expect(result).toBe("  test  ");
  });

  it("should truncate if maxLength exceeded", () => {
    const input = { name: "verylong" };
    const result = getString(input, "name", { maxLength: 4 });
    expect(result).toBe("very");
  });

  it("should return undefined for empty string by default", () => {
    const input = { name: "" };
    const result = getString(input, "name");
    expect(result).toBeUndefined();
  });

  it("should allow empty string with allowEmpty=true", () => {
    const input = { name: "" };
    const result = getString(input, "name", { allowEmpty: true });
    expect(result).toBe("");
  });
});

describe("getNumber", () => {
  it("should return number value when present", () => {
    const input = { count: 42 };
    const result = getNumber(input, "count");
    expect(result).toBe(42);
  });

  it("should convert string to number", () => {
    const input = { count: "42" };
    const result = getNumber(input, "count");
    expect(result).toBe(42);
  });

  it("should return 0 for missing field by default", () => {
    const input = {};
    const result = getNumber(input, "count");
    expect(result).toBe(0);
  });

  it("should return custom default when provided", () => {
    const input = {};
    const result = getNumber(input, "count", { defaultVal: 10 });
    expect(result).toBe(10);
  });

  it("should return 0 for NaN values", () => {
    const input = { count: "not a number" };
    const result = getNumber(input, "count");
    expect(result).toBe(0);
  });

  it("should clamp to min", () => {
    const input = { count: 5 };
    const result = getNumber(input, "count", { min: 10 });
    expect(result).toBe(10);
  });

  it("should clamp to max", () => {
    const input = { count: 100 };
    const result = getNumber(input, "count", { max: 50 });
    expect(result).toBe(50);
  });

  it("should handle float values", () => {
    const input = { value: 3.14 };
    const result = getNumber(input, "value");
    expect(result).toBe(3.14);
  });

  it("should handle zero", () => {
    const input = { count: 0 };
    const result = getNumber(input, "count");
    expect(result).toBe(0);
  });
});

describe("getBoolean", () => {
  it("should return boolean value when present", () => {
    const input = { flag: true };
    const result = getBoolean(input, "flag");
    expect(result).toBe(true);
  });

  it("should return false for false value", () => {
    const input = { flag: false };
    const result = getBoolean(input, "flag");
    expect(result).toBe(false);
  });

  it("should return false for missing field by default", () => {
    const input = {};
    const result = getBoolean(input, "flag");
    expect(result).toBe(false);
  });

  it("should return custom default when provided", () => {
    const input = {};
    const result = getBoolean(input, "flag", true);
    expect(result).toBe(true);
  });

  it("should parse string 'true'", () => {
    const input = { flag: "true" };
    const result = getBoolean(input, "flag");
    expect(result).toBe(true);
  });

  it("should parse string 'false'", () => {
    const input = { flag: "false" };
    const result = getBoolean(input, "flag");
    expect(result).toBe(false);
  });

  it("should parse number 1 as true", () => {
    const input = { flag: 1 };
    const result = getBoolean(input, "flag");
    expect(result).toBe(true);
  });

  it("should parse number 0 as false", () => {
    const input = { flag: 0 };
    const result = getBoolean(input, "flag");
    expect(result).toBe(false);
  });

  it("should return default for unknown string", () => {
    const input = { flag: "unknown" };
    const result = getBoolean(input, "flag", true);
    expect(result).toBe(true);
  });
});

describe("getEnum", () => {
  const validEnums = ["low", "medium", "high"] as const;

  it("should return valid enum value", () => {
    const input = { level: "high" };
    const result = getEnum(input, "level", validEnums);
    expect(result).toBe("high");
  });

  it("should return undefined for invalid enum value", () => {
    const input = { level: "extreme" };
    const result = getEnum(input, "level", validEnums);
    expect(result).toBeUndefined();
  });

  it("should return undefined for missing field", () => {
    const input = {};
    const result = getEnum(input, "level", validEnums);
    expect(result).toBeUndefined();
  });

  it("should return undefined for wrong type (converted to string)", () => {
    const input = { level: 123 };
    const result = getEnum(input, "level", validEnums);
    expect(result).toBeUndefined();
  });

  it("should be case sensitive", () => {
    const input = { level: "HIGH" };
    const result = getEnum(input, "level", validEnums);
    expect(result).toBeUndefined();
  });

  it("should trim whitespace", () => {
    const input = { level: "  high  " };
    const result = getEnum(input, "level", validEnums);
    expect(result).toBe("high");
  });
});

describe("isToolError", () => {
  it("should return true for error object", () => {
    const errorResult = { output: "Error: something", isError: true };
    expect(isToolError(errorResult)).toBe(true);
  });

  it("should return true for any object with isError=true", () => {
    const errorResult = { output: "warning", isError: true };
    expect(isToolError(errorResult)).toBe(true);
  });

  it("should return false for non-error object", () => {
    const successResult = { output: "success", isError: false };
    expect(isToolError(successResult)).toBe(false);
  });

  it("should return false for null", () => {
    expect(isToolError(null as unknown)).toBe(false);
  });

  it("should return false for undefined", () => {
    expect(isToolError(undefined as unknown)).toBe(false);
  });

  it("should return false for string", () => {
    expect(isToolError("string" as unknown)).toBe(false);
  });

  it("should return false for number", () => {
    expect(isToolError(42 as unknown)).toBe(false);
  });
});
