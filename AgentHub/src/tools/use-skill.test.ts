import { describe, it, expect } from "bun:test";

describe("createUseSkillTool", () => {
  describe("tool definition", () => {
    it("should have the correct name", async () => {
      const { createUseSkillTool } = await import("./use-skill");
      const tool = createUseSkillTool();
      expect(tool.name).toBe("use_skill");
    });

    it("should have a description mentioning skill", async () => {
      const { createUseSkillTool } = await import("./use-skill");
      const tool = createUseSkillTool();
      expect(tool.description).toBeTruthy();
      expect(tool.description.toLowerCase()).toContain("skill");
    });

    it("should have memory category", async () => {
      const { createUseSkillTool } = await import("./use-skill");
      const tool = createUseSkillTool();
      expect(tool.categories).toEqual(["memory"]);
    });

    it("should require skill_id in inputSchema", async () => {
      const { createUseSkillTool } = await import("./use-skill");
      const tool = createUseSkillTool();
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.required).toEqual(["skill_id"]);
    });

    it("should have skill_id property in schema", async () => {
      const { createUseSkillTool } = await import("./use-skill");
      const tool = createUseSkillTool();
      const props = tool.inputSchema.properties as Record<string, unknown>;
      expect(props.skill_id).toBeDefined();
    });

    it("should have an execute function", async () => {
      const { createUseSkillTool } = await import("./use-skill");
      const tool = createUseSkillTool();
      expect(typeof tool.execute).toBe("function");
    });
  });

  describe("execute", () => {
    it("should return error when skill is not found", async () => {
      const { createUseSkillTool } = await import("./use-skill");
      const tool = createUseSkillTool();
      const result = await tool.execute({ skill_id: "nonexistent-skill-xyzzy" });
      expect(result.isError).toBe(true);
      expect(result.output).toContain("not found");
      expect(result.output).toContain("nonexistent-skill-xyzzy");
    });

    it("should include available skill IDs in error message", async () => {
      const { createUseSkillTool } = await import("./use-skill");
      const tool = createUseSkillTool();
      const result = await tool.execute({ skill_id: "bad-id" });
      expect(result.isError).toBe(true);
      expect(result.output).toContain("Available:");
    });

    it("should return content for a valid skill if any exist", async () => {
      // First get list of skills to find a valid one
      const { createListSkillsTool } = await import("./list-skills");
      const listTool = createListSkillsTool();
      const listResult = await listTool.execute({});

      if (listResult.output === "No skills found.") {
        // Skip this test if no skills are installed
        return;
      }

      // Extract the first skill ID from the markdown output
      const match = listResult.output.match(/\*\*(.+?)\*\*/);
      if (!match) return;
      const skillId = match[1]!;

      const { createUseSkillTool } = await import("./use-skill");
      const tool = createUseSkillTool();
      const result = await tool.execute({ skill_id: skillId });
      expect(result.isError).toBe(false);
      expect(result.output.length).toBeGreaterThan(0);
    });
  });
});
