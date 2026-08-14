import type { GeneratedIdea } from "../sources/ideas/store";
import { escapeHtml } from "../channels/telegram/format";

const CATEGORY_EMOJI: Record<string, string> = {
  mobile_app: "\u{1F4F1}",
  crypto_project: "\u26D3\uFE0F",
  general: "\u{1F4A1}",
};

const MAX_LENGTH = 3000;

function trimTo(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

function formatIdeaBlock(idea: GeneratedIdea, index: number): string {
  const emoji = CATEGORY_EMOJI[idea.category] ?? "\u{1F4A1}";
  const cat = idea.category.replace(/_/g, " ");
  const title = escapeHtml(idea.title);
  const summary = escapeHtml(idea.summary);

  return [
    `${emoji} <b>${index + 1}. ${title}</b>`,
    `<i>${escapeHtml(cat)}</i>`,
    "",
    summary,
  ].join("\n");
}

export function formatIdeasMessage(
  jobName: string,
  ideas: readonly GeneratedIdea[],
): string {
  if (ideas.length === 0) {
    return `<b>${escapeHtml(jobName)}</b>\n\nNo new ideas generated this run.`;
  }

  const label = jobName.replace(/-/g, " ");
  const header = `<b>${escapeHtml(label)}</b> \u2014 ${ideas.length} new idea${ideas.length !== 1 ? "s" : ""}`;
  const blocks = ideas.map((idea, i) => formatIdeaBlock(idea, i));
  const full = [header, ...blocks].join("\n\n");

  if (full.length <= MAX_LENGTH) return full;

  // Truncate summaries to fit
  const budgetPerIdea = Math.floor(
    (MAX_LENGTH - header.length - 100) / ideas.length,
  );

  const shortBlocks = ideas.map((idea, i) => {
    const emoji = CATEGORY_EMOJI[idea.category] ?? "\u{1F4A1}";
    const cat = idea.category.replace(/_/g, " ");
    const title = escapeHtml(idea.title);
    const titleLine = `${emoji} <b>${i + 1}. ${title}</b>`;
    const catLine = `<i>${escapeHtml(cat)}</i>`;
    const overhead = titleLine.length + catLine.length + 4;
    const summaryBudget = Math.max(budgetPerIdea - overhead, 80);
    const summary = trimTo(escapeHtml(idea.summary), summaryBudget);
    return [titleLine, catLine, "", summary].join("\n");
  });

  return [header, ...shortBlocks].join("\n\n").slice(0, MAX_LENGTH);
}
