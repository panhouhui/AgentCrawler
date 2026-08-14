import { describe, expect, test } from "bun:test";
import {
  MODEL_ROUTING_DEFAULTS,
  MODEL_ROUTING_KEYS,
  modelRouteSchema,
} from "./model-routing";

describe("model-routing constants", () => {
  test("defines process keys", () => {
    expect(MODEL_ROUTING_KEYS.length).toBe(11);
    expect(MODEL_ROUTING_KEYS).toContain("signal.facets");
    expect(MODEL_ROUTING_KEYS).toContain("agent-templates");
    expect(MODEL_ROUTING_KEYS).toContain("social.gate");
  });

  test("every key has a default route", () => {
    for (const key of MODEL_ROUTING_KEYS) {
      const def = MODEL_ROUTING_DEFAULTS[key];
      expect(typeof def.provider).toBe("string");
      expect(def.model.length).toBeGreaterThan(0);
    }
  });

  test("signal.facets default is alibaba/deepseek-v4-flash", () => {
    expect(MODEL_ROUTING_DEFAULTS["signal.facets"]).toEqual({
      provider: "alibaba",
      model: "deepseek-v4-flash",
    });
  });

  test("social routes default to MiniMax", () => {
    expect(MODEL_ROUTING_DEFAULTS["social.gate"]).toEqual({
      provider: "minimax",
      model: "MiniMax-M2.7",
    });
    expect(MODEL_ROUTING_DEFAULTS["social.platform"]).toEqual({
      provider: "minimax",
      model: "MiniMax-M2.7",
    });
    expect(MODEL_ROUTING_DEFAULTS["social.fusion"]).toEqual({
      provider: "minimax",
      model: "MiniMax-M2.7",
    });
  });

  test("modelRouteSchema rejects unknown provider", () => {
    const r = modelRouteSchema.safeParse({ provider: "bogus", model: "x" });
    expect(r.success).toBe(false);
  });

  test("modelRouteSchema accepts opencode", () => {
    const r = modelRouteSchema.safeParse({ provider: "opencode", model: "deepseek-v4-flash" });
    expect(r.success).toBe(true);
  });

  test("modelRouteSchema accepts minimax", () => {
    const r = modelRouteSchema.safeParse({ provider: "minimax", model: "MiniMax-M2.7" });
    expect(r.success).toBe(true);
  });
});
