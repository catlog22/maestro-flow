/**
 * Test Claude Code as an rmux-collab agent.
 * Key findings:
 *   - rmux 默认启动 PowerShell（Windows）
 *   - 直接用 `claude` 命令（PowerShell 找到 .ps1 wrapper）
 *   - send-keys -l + 150ms delay + C-m
 */
import { Rmux } from '@rmux/sdk';
import { Agent } from '../src/agent.js';
import type { AgentConfig } from '../src/types.js';
import { execSync } from 'node:child_process';

function rmux(args: string): string {
  try {
    return execSync(`rmux ${args}`, { encoding: 'utf-8', timeout: 10_000 }).trim();
  } catch (e: any) {
    return e.stdout?.trim() ?? e.stderr?.trim() ?? '';
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const SESSION = 'collab-claude';

  // 1. Clean + create session
  rmux(`kill-session -t ${SESSION}`);
  console.log('[1] Creating session...');
  rmux(`new-session -d -s ${SESSION} -n claude`);

  // 2. Launch Claude
  console.log('[2] Launching Claude...');
  rmux(`send-keys -t ${SESSION}:0.0 -l "claude --dangerously-skip-permissions --permission-mode bypassPermissions"`);
  await sleep(200);
  rmux(`send-keys -t ${SESSION}:0.0 C-m`);

  // 3. Wait for ❯
  console.log('[3] Waiting for Claude prompt...');
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const text = rmux(`capture-pane -p -t ${SESSION}:0.0`);
    if (text.includes('❯')) { ready = true; console.log(`   ✓ Ready (${i + 1}s)`); break; }
    if (i % 10 === 9) console.log(`   ...${i + 1}s`);
  }
  if (!ready) { console.error('   ✗ Timeout'); rmux(`kill-session -t ${SESSION}`); process.exit(1); }

  // 4. Connect SDK Pane handle
  const sdk = new Rmux();
  const session = sdk.session(SESSION);
  const pane = session.pane(0, 0);

  const config: AgentConfig = {
    name: 'claude-worker',
    tool: 'claude',
    completionMarker: /❯\s*$/,
  };
  const agent = new Agent(pane, config);

  // 5. First ask
  console.log('[4] ask("pong")...');
  const r1 = await agent.ask('respond with just "pong"', { timeout: 120_000 });
  console.log('   →', JSON.stringify(r1.output.slice(0, 200)));

  // 6. idle check
  console.log('[5] isIdle:', await agent.isIdle());

  // 7. Multi-turn
  console.log('[6] ask("what did you say?")...');
  const r2 = await agent.ask('what was the word you just said?', { timeout: 120_000 });
  console.log('   →', JSON.stringify(r2.output.slice(0, 200)));

  // 8. Cleanup
  rmux(`kill-session -t ${SESSION}`);
  console.log('[done] ✓');
}

main().catch(e => {
  console.error('ERROR:', e.message);
  rmux('kill-session -t collab-claude');
});
