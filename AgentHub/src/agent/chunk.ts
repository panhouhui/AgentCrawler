const MAX_CHUNK_LENGTH = 4000;

export function chunkMessage(
  text: string,
  maxLength = MAX_CHUNK_LENGTH,
): readonly string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const rawChunks = splitAtBoundaries(text, maxLength);
  return repairChunks(rawChunks);
}

function splitAtBoundaries(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf("\n\n", maxLength);
    if (splitIndex === -1 || splitIndex < maxLength * 0.3) {
      splitIndex = remaining.lastIndexOf("\n", maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength * 0.3) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength * 0.3) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

/** Tags that Telegram supports and that we need to track across chunks. */
const VOID_TAGS = new Set(["br", "hr", "img"]);

const OPEN_TAG_RE = /<(b|i|u|s|code|pre|blockquote|a|tg-spoiler)(?:\s[^>]*)?>/gi;
const CLOSE_TAG_RE = /<\/(b|i|u|s|code|pre|blockquote|a|tg-spoiler)>/gi;

/**
 * Repair HTML tag and fenced code block splits across chunks.
 *
 * For each chunk, tracks which tags were opened but not closed,
 * appends closing tags, and prepends them as re-opened tags on the next chunk.
 */
function repairChunks(chunks: string[]): string[] {
  const result: string[] = [];
  let carryTags: string[] = []; // tags to re-open at start of next chunk
  let inFencedBlock = false;
  let fenceLang = "";

  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i]!;

    // Re-open carried state from previous chunk
    if (inFencedBlock) {
      chunk = "```" + fenceLang + "\n" + chunk;
    }
    if (carryTags.length > 0) {
      chunk = carryTags.map((tag) => `<${tag}>`).join("") + chunk;
    }

    // Track fenced code blocks (``` toggles)
    const fenceMatches = chunk.match(/^```/gm);
    if (fenceMatches) {
      for (const _ of fenceMatches) {
        if (!inFencedBlock) {
          inFencedBlock = true;
          // Capture language from the opening fence
          const langMatch = chunk.match(/```(\w*)/);
          fenceLang = langMatch?.[1] ?? "";
        } else {
          inFencedBlock = false;
          fenceLang = "";
        }
      }
    }

    // If chunk ends inside a fenced block, close it
    if (inFencedBlock && i < chunks.length - 1) {
      chunk = chunk + "\n```";
      // inFencedBlock stays true so next chunk re-opens it
    }

    // Track HTML tags — build a stack of unclosed tags
    const openTags: string[] = [];

    let match: RegExpExecArray | null;
    OPEN_TAG_RE.lastIndex = 0;
    CLOSE_TAG_RE.lastIndex = 0;

    // Collect all open and close tag events in order
    const events: { index: number; type: "open" | "close"; tag: string }[] = [];

    while ((match = OPEN_TAG_RE.exec(chunk)) !== null) {
      const tag = match[1]!.toLowerCase();
      if (!VOID_TAGS.has(tag)) {
        events.push({ index: match.index, type: "open", tag });
      }
    }
    while ((match = CLOSE_TAG_RE.exec(chunk)) !== null) {
      events.push({ index: match.index, type: "close", tag: match[1]!.toLowerCase() });
    }

    events.sort((a, b) => a.index - b.index);

    for (const event of events) {
      if (event.type === "open") {
        openTags.push(event.tag);
      } else {
        // Close the most recent matching open tag
        for (let j = openTags.length - 1; j >= 0; j--) {
          if (openTags[j] === event.tag) {
            openTags.splice(j, 1);
            break;
          }
        }
      }
    }

    // Close unclosed tags at end of this chunk (reverse order)
    if (openTags.length > 0 && i < chunks.length - 1) {
      const closers = [...openTags].reverse().map((tag) => `</${tag}>`).join("");
      chunk = chunk + closers;
    }

    carryTags = openTags;
    result.push(chunk);
  }

  return result;
}
