import type { DialogueConfig, DialogueMessage, AskOptions } from '../types.js';

export async function dialogue(
  config: DialogueConfig,
  opts?: AskOptions,
): Promise<DialogueMessage[]> {
  const messages: DialogueMessage[] = [];

  for (const agent of config.agents) {
    const result = await agent.ask(
      `Topic for discussion: ${config.topic}\nPlease share your perspective.`,
      opts,
    );
    messages.push({ from: agent.name, content: result.output, round: 0 });
  }

  for (let round = 1; round <= config.maxRounds; round++) {
    for (const agent of config.agents) {
      const context = messages
        .filter(m => m.from !== agent.name && m.round === round - 1)
        .map(m => `[${m.from}]: ${m.content}`)
        .join('\n\n');

      const prompt = context
        ? `Other perspectives:\n${context}\n\nYour response:`
        : `Continue the discussion on: ${config.topic}`;

      const result = await agent.ask(prompt, opts);
      messages.push({ from: agent.name, content: result.output, round });
    }

    if (config.shouldContinue && !config.shouldContinue(round, messages)) {
      break;
    }
  }

  return messages;
}
