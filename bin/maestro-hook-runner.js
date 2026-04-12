#!/usr/bin/env node

// Dedicated hook runner — bypasses cli.ts and commander entirely.
// Usage: node maestro-hook-runner.js <hook-name>
// Reads stdin JSON, dynamically imports only the needed hook module, writes stdout.

const hookName = process.argv[2];
if (!hookName) {
  process.stderr.write('Usage: maestro-hook-runner <hook-name>\n');
  process.exit(1);
}

// Lightweight stdin reader with 500ms timeout
function readStdin() {
  return new Promise((resolve) => {
    let input = '';
    const timeout = setTimeout(() => resolve(input), 500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (input += chunk));
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      resolve(input);
    });
  });
}

// Hook evaluator map — dynamic imports load only what's needed
const HOOKS = {
  'context-monitor': async (raw) => {
    const { evaluateContext } = await import('../dist/src/hooks/context-monitor.js');
    const data = JSON.parse(raw);
    const result = evaluateContext(data);
    if (result) process.stdout.write(JSON.stringify(result));
  },
  'delegate-monitor': async (raw) => {
    const { evaluateDelegateNotifications } = await import('../dist/src/hooks/delegate-monitor.js');
    const data = JSON.parse(raw);
    const result = evaluateDelegateNotifications(data);
    if (result) process.stdout.write(JSON.stringify(result));
  },
  'team-monitor': async (raw) => {
    const { runTeamMonitor } = await import('../dist/src/hooks/team-monitor.js');
    const data = raw ? JSON.parse(raw) : {};
    runTeamMonitor(data);
  },
  'session-context': async (raw) => {
    const { loadHooksConfig } = await import('../dist/src/config/index.js');
    const config = loadHooksConfig();
    if (config.toggles['sessionContext'] === false) return;
    const { evaluateSessionContext } = await import('../dist/src/hooks/session-context.js');
    const data = raw ? JSON.parse(raw) : {};
    const result = evaluateSessionContext(data);
    if (result) process.stdout.write(JSON.stringify(result));
  },
  'spec-injector': async (raw) => {
    const { loadHooksConfig } = await import('../dist/src/config/index.js');
    const config = loadHooksConfig();
    if (config.toggles['specInjector'] === false) return;
    const { evaluateSpecInjection } = await import('../dist/src/hooks/spec-injector.js');
    const data = JSON.parse(raw);
    const toolInput = data.tool_input ?? {};
    const agentType = toolInput.subagent_type ?? '';
    if (!agentType) return;
    const cwd = data.cwd ?? process.cwd();
    const sessionId = data.session_id ?? '';
    const result = evaluateSpecInjection(agentType, cwd, sessionId);
    if (result.inject && result.content) {
      const originalPrompt = toolInput.prompt ?? '';
      const augmentedPrompt = `${result.content}\n\n---\n\n${originalPrompt}`;
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: { ...toolInput, prompt: augmentedPrompt },
        },
      }));
    }
  },
  'workflow-guard': async (raw) => {
    const { loadHooksConfig } = await import('../dist/src/config/index.js');
    const config = loadHooksConfig();
    if (config.toggles['workflowGuard'] === false) return;
    const { evaluateWorkflowGuard } = await import('../dist/src/hooks/guards/workflow-guard.js');
    const data = JSON.parse(raw);
    const toolName = data.tool_name ?? '';
    const toolInput = typeof data.tool_input === 'string'
      ? data.tool_input
      : typeof data.tool_input?.command === 'string'
        ? data.tool_input.command
        : JSON.stringify(data.tool_input ?? '');
    const result = evaluateWorkflowGuard(toolName, toolInput);
    if (result.blocked) {
      process.stdout.write(JSON.stringify({ decision: 'block', reason: result.reason }));
      process.exit(2);
    }
  },
  'prompt-guard': async (raw) => {
    const { loadHooksConfig } = await import('../dist/src/config/index.js');
    const config = loadHooksConfig();
    if (config.toggles['promptGuard'] === false) return;
    const { evaluatePromptGuard } = await import('../dist/src/hooks/guards/prompt-guard.js');
    const data = JSON.parse(raw);
    const prompt = data.user_prompt ?? data.prompt ?? '';
    if (!prompt) return;
    const result = evaluatePromptGuard(prompt);
    if (result.flagged) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: result.warning,
        },
      }));
    }
  },
  'telemetry': async (raw) => {
    const { loadHooksConfig } = await import('../dist/src/config/index.js');
    const config = loadHooksConfig();
    if (config.toggles['telemetry'] === false) return;
    const data = JSON.parse(raw);
    const toolName = data.tool_name ?? 'unknown';
    const sessionId = data.session_id ?? '';
    if (!sessionId) return;
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { appendFileSync } = await import('node:fs');
    const telemetryPath = join(tmpdir(), `maestro-telemetry-${sessionId}.jsonl`);
    const entry = JSON.stringify({
      tool: toolName,
      timestamp: Date.now(),
      success: data.tool_output !== undefined,
    });
    appendFileSync(telemetryPath, entry + '\n');
  },
};

const handler = HOOKS[hookName];
if (!handler) {
  process.stderr.write(`Unknown hook: ${hookName}. Available: ${Object.keys(HOOKS).join(', ')}\n`);
  process.exit(1);
}

try {
  const raw = await readStdin();
  await handler(raw);
} catch {
  // Silent fail — never block tool execution
}
process.exit(0);
