import type { PipelineStage, AskOptions } from '../types.js';

export async function pipeline(
  stages: PipelineStage[],
  initialPrompt: string,
  opts?: AskOptions,
): Promise<string> {
  let currentInput = initialPrompt;

  for (const stage of stages) {
    const prompt = stage.transform
      ? stage.transform(currentInput)
      : currentInput;

    const result = await stage.agent.ask(prompt, opts);
    currentInput = result.output;
  }

  return currentInput;
}
