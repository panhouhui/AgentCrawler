import type { ToolDefinition, ToolCategory } from "./types";
import { loadSkills } from "../skills/loader";

export function createListSkillsTool(): ToolDefinition {
  return {
    name: "list_skills",
    description:
      "List available skills by domain. Skills contain patterns, examples, and best practices. Use use_skill to load a specific skill into context before working on that domain.",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          description:
            'Optional keyword to filter skills (e.g. "security", "backend", "testing")',
        },
      },
    },
    categories: ["memory"] as readonly ToolCategory[],
    async execute(input) {
      const filter = (input.filter as string | undefined)?.toLowerCase();
      const skills = await loadSkills();
      const filtered = filter
        ? skills.filter(
            (s) =>
              s.id.includes(filter) ||
              s.description.toLowerCase().includes(filter),
          )
        : skills;

      if (filtered.length === 0) {
        return { output: "No skills found.", isError: false };
      }

      const lines = filtered.map((s) => `- **${s.id}**: ${s.description}`);
      return { output: lines.join("\n"), isError: false };
    },
  };
}
