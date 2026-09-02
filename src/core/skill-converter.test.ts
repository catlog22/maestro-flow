import { describe, expect, it } from 'vitest';
import { transformContentForPlatform } from './skill-converter.js';

describe('Pi Maestro platform conversion', () => {
  it('binds platform on Session and Run creation and content-loading commands', () => {
    const source = [
      'maestro session create "topic" --id demo --chain-file chain.json',
      'maestro session start "topic" --chain analyze execute',
      'maestro run start "goal" --cmd companion',
      'maestro run create plan --session demo --arg "change"',
      'maestro run prepare analyze --session demo',
      'maestro run skill analyze',
      'maestro run brief run-1 --session demo',
    ].join('\n');

    const converted = transformContentForPlatform(source, 'pi');

    expect(converted).toContain('maestro session create --platform pi "topic"');
    expect(converted).toContain('maestro session start --platform pi "topic"');
    expect(converted).toContain('maestro run start --platform pi "goal"');
    expect(converted).toContain('maestro run create --platform pi plan');
    expect(converted).toContain('maestro run prepare --platform pi analyze');
    expect(converted).toContain('maestro run skill --platform pi analyze');
    expect(converted).toContain('maestro run brief --platform pi run-1');
  });

  it('rewrites canonical platform placeholders and Claude bindings to Pi', () => {
    const source = [
      'maestro skills --steps --json --platform {target_platform}',
      'maestro session create "topic" --platform {target_platform} --chain analyze',
      'maestro session start "topic" --platform claude --chain analyze',
      'maestro run create plan --platform {target_platform} --session demo',
      'maestro run brief run-1 --platform claude',
    ].join('\n');

    const converted = transformContentForPlatform(source, 'pi');

    expect(converted).not.toContain('{target_platform}');
    expect(converted).not.toContain('--platform claude');
    expect(converted.match(/--platform pi/g)).toHaveLength(5);
  });

  it('does not add platform to commands that consume the persisted binding', () => {
    const source = [
      'maestro session next --session demo',
      'maestro session status demo',
      'maestro session done run-1 --session demo',
      'maestro run check run-1 --session demo',
      'maestro run done run-1 --session demo',
    ].join('\n');

    const converted = transformContentForPlatform(source, 'pi');

    expect(converted).toBe(source);
  });

  it('preserves complete delegate prompts and maps Pi teammate options', () => {
    const prompt = `PURPOSE: ${'inspect delegated behavior '.repeat(8)}\nMODE: analysis`;
    const source = `maestro delegate "${prompt}" --mode analysis --rule analysis-analyze-code-patterns --cd src --id delegate-check`;

    const converted = transformContentForPlatform(source, 'pi');

    expect(converted).toContain(`prompt: "${prompt.replace(/\n/g, '\\n')}"`);
    expect(converted).toContain('agent: "general"');
    expect(converted).toContain('taskType: "analysis"');
    expect(converted).toContain('tasks: [{ name: "delegate-check", prompt:');
    expect(converted).toContain('cwd: "src"');
    expect(converted).toContain('/* --rule analysis-analyze-code-patterns');
    expect(converted).not.toContain('…');
    expect(converted).not.toContain('agent: "delegate"');
    expect(converted).not.toContain('task: "');
  });

  it('rewrites multiline subagent_type calls and preserves escaped template prompts', () => {
    const source = [
      'const result = await Agent({',
      "  subagent_type: 'universal-executor',",
      '  run_in_background: phaseConfig.background || false,',
      '  prompt: \\`',
      '[PHASE] \\${phaseId}',
      '\\`',
      '});',
    ].join('\n');

    const converted = transformContentForPlatform(source, 'pi');

    expect(converted).toContain('const result = await teammate({ agent: "general"');
    expect(converted).toContain('tasks: [{ prompt: \\`\n[PHASE] \\${phaseId}\n\\` }]');
    expect(converted).toContain('background: phaseConfig.background || false');
    expect(converted).not.toContain('subagent_type');
    expect(converted).not.toContain('run_in_background');
  });

  it('normalizes direct legacy teammate task fields', () => {
    const source = 'teammate({ agent: "delegate", taskType: "analysis", task: "PURPOSE: inspect", prompt: "analysis-rule", name: "job-1" })';

    const converted = transformContentForPlatform(source, 'pi');

    expect(converted).toContain('agent: "general"');
    expect(converted).toContain('tasks: [{ name: "job-1", prompt: "PURPOSE: inspect" }]');
    expect(converted).toContain('/* --rule "analysis-rule" */');
    expect(converted).not.toContain('agent: "delegate"');
    expect(converted).not.toContain('task: "');
  });

  it('adds observe and the wait contract when a skill allows teammate', () => {
    const source = `---
name: teammate-skill
allowed-tools: Read Agent
---

Agent({ subagent_type: 'general-purpose', prompt: 'Inspect' })`;

    const converted = transformContentForPlatform(source, 'pi');

    expect(converted).toContain('teammate');
    expect(converted).toContain('observe');
    expect(converted).toContain('<teammate_contract>');
    expect(converted).toContain('action: "wait"');
    expect(converted).not.toContain('subagent_type');
  });

  it('rewrites legacy callback prose to teammate completion semantics', () => {
    const source = `teammate runs in background, wait for hook callback before proceeding
Worker callback -> handleCallback
SendMessage callback
On callback: consume result`;

    const converted = transformContentForPlatform(source, 'pi');

    expect(converted).toContain('teammate-complete notification');
    expect(converted).toContain('observe exactly once with action="wait"');
    expect(converted).not.toMatch(/hook callback|SendMessage callback|Worker callback|On callback/);
  });

  it('keeps an existing Pi binding idempotent', () => {
    const source = [
      'maestro session create "topic" --platform pi --chain analyze',
      'maestro run create plan --platform pi --session demo',
      'maestro run brief run-1 --platform pi',
    ].join('\n');

    const converted = transformContentForPlatform(source, 'pi');

    expect(converted).toBe(source);
    expect(converted.match(/--platform pi/g)).toHaveLength(3);
  });
});

describe('Grok platform conversion', () => {
  it('rewrites Claude tool calls to grok-native tools', () => {
    const source = [
      'Agent({ description: "x", prompt: "do it" })',
      'Read({ file_path: "a.ts" })',
      'Write({ file_path: "b.ts" })',
      'Edit({ file_path: "c.ts" })',
      'Bash({ command: "ls" })',
      'Grep({ pattern: "foo" })',
      'Glob({ pattern: "*.ts" })',
    ].join('\n');

    const converted = transformContentForPlatform(source, 'grok');

    expect(converted).toContain('spawn_subagent(');
    expect(converted).toContain('read_file(');
    expect(converted).toContain('write_file(');
    expect(converted).toContain('search_replace(');
    expect(converted).toContain('run_terminal_command(');
    expect(converted).toContain('grep(');
    expect(converted).toContain('list_dir(');
    expect(converted).not.toContain('delegate_subagent');
    expect(converted).not.toContain('spawn_agent(');
  });

  it('maps other-platform subagent tool names to grok-native ones', () => {
    const source = 'use delegate_subagent / spawn_agent then wait_agent and interrupt_agent';
    const converted = transformContentForPlatform(source, 'grok');
    expect(converted).toContain('spawn_subagent');
    expect(converted).toContain('get_command_or_subagent_output');
    expect(converted).toContain('kill_command_or_subagent');
    expect(converted).not.toContain('delegate_subagent');
    expect(converted).not.toContain('wait_agent');
  });

  it('binds --platform grok on run content-loading commands', () => {
    const converted = transformContentForPlatform('maestro run brief run-1 --session demo', 'grok');
    expect(converted).toContain('--platform grok');
  });

  it('maps Agent() fields per TOOL_FIELD_MAP: background rename, name/model/mode dropped', () => {
    const source = 'Agent({ prompt: "do it", description: "d", subagent_type: "worker", run_in_background: true, name: "w1", model: "grok-4", mode: "write" })';
    const converted = transformContentForPlatform(source, 'grok');
    expect(converted).toContain('spawn_subagent({');
    expect(converted).toContain('prompt: "do it"');
    expect(converted).toContain('subagent_type: "worker"');
    expect(converted).toContain('background: true');
    expect(converted).not.toContain('run_in_background');
    expect(converted).not.toContain('name:');
    expect(converted).not.toContain('model:');
    expect(converted).not.toContain('mode:');
  });

  it('adds grok subagent tools to restricted allowed-tools when body calls Agent()', () => {
    const source = [
      '---',
      'name: demo',
      'allowed-tools: Read, Grep',
      '---',
      'Run Agent({ prompt: "x", subagent_type: "w" }) now.',
    ].join('\n');
    const converted = transformContentForPlatform(source, 'grok');
    expect(converted).toContain('spawn_subagent');
    expect(converted).toContain('get_command_or_subagent_output');
    expect(converted).toContain('kill_command_or_subagent');
    expect(converted).toContain('wait_commands_or_subagents');
    expect(converted).toContain('read_file');
    // frontmatter 已映射,正文裸 Agent( 不残留
    expect(converted).not.toMatch(/\bAgent\s*\(/);
  });

  it('keeps unrestricted frontmatter without allowed-tools untouched by subagent injection', () => {
    const source = ['---', 'name: demo', '---', 'plain body'].join('\n');
    const converted = transformContentForPlatform(source, 'grok');
    expect(converted).not.toContain('spawn_subagent');
  });

  it('preserves expression and multiline Agent() values, renames mapped keys', () => {
    const source = [
      'Agent({',
      '  prompt: buildPrompt({ topic: "t" }),',
      '  subagent_type: workerType,',
      '  run_in_background: enabled,',
      '  model: preferredModel,',
      '})',
    ].join('\n');
    const converted = transformContentForPlatform(source, 'grok');
    expect(converted).toContain('spawn_subagent({');
    expect(converted).toContain('prompt: buildPrompt({ topic: "t" })');
    expect(converted).toContain('subagent_type: workerType');
    expect(converted).toContain('background: enabled');
    expect(converted).not.toContain('run_in_background');
    expect(converted).not.toContain('preferredModel');
  });

  it('keeps unknown Agent() fields verbatim instead of dropping them', () => {
    const source = 'Agent({ prompt: "x", team_name: "t1" })';
    const converted = transformContentForPlatform(source, 'grok');
    expect(converted).toContain('spawn_subagent({');
    expect(converted).toContain('prompt: "x"');
    expect(converted).toContain('team_name: "t1"');
  });

  it('treats a quote after an even run of backslashes as the string end', () => {
    // 文本为 Agent({ prompt: "C:\\" }):引号前两个反斜杠是字面量,引号闭合
    const source = 'Agent({ prompt: "C:\\\\" })';
    const converted = transformContentForPlatform(source, 'grok');
    expect(converted).toContain('spawn_subagent({ prompt: "C:\\\\" })');
  });
});
