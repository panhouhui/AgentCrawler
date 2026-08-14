import type { ToolDefinition, ToolCategory } from "./types";
import { readSkillContent, loadSkills } from "../skills/loader";

export function createUseSkillTool(): ToolDefinition {
  return {
    name: "use_skill",
    description:
      "Load the full content of a skill into context. Use list_skills first to find the right skill ID. The skill content contains patterns and examples you should apply to the current task.",
    categories: ["memory"] as readonly ToolCategory[],
    inputSchema: {
      type: "object",
      properties: {
        skill_id: {
          type: "string",
          description:
            'Skill ID from list_skills (e.g. "backend-patterns", "security-review", "tdd-workflow")',
        },
      },
      required: ["skill_id"],
    },
    async execute(input) {
      const id = input.skill_id as string;
      const content = await readSkillContent(id);
      if (!content) {
        const skills = await loadSkills();
        const available = skills.map((s) => s.id).join(", ");
        return {
          output: `Skill "${id}" not found. Available: ${available}`,
          isError: true,
        };
      }
      return { output: content, isError: false };
    },
  };
}
