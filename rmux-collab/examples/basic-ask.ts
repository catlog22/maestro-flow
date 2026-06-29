import { Rmux } from '@rmux/sdk';
import { Agent } from '../src/agent.js';
import type { AgentConfig } from '../src/types.js';

async function main() {
  const rmux = new Rmux();
  const session = await rmux.ensureSession('test-collab');
  const win = await session.newWindow({ shellCommand: 'cmd.exe /k', name: 'shell-test' });
  const pane = win.pane(0);

  const config: AgentConfig = { name: 'shell-agent', tool: 'shell', completionMarker: '>' };
  const agent = new Agent(pane, config);

  await pane.waitForText('>', { timeout: 10_000 });
  console.log('[ready]');

  // Manual test to see what snapshot looks like after command
  await pane.sendText('echo test123 && echo __RD99__');
  await pane.sendKeys('Enter');
  await pane.waitForText('__RD99__', { timeout: 10_000 });

  const snap = await pane.snapshot();
  const lines = snap.lines.filter(l => l.trim());
  console.log('[snapshot lines]:', JSON.stringify(lines));

  // Now test ask()
  const result = await agent.ask('echo hello-world', { timeout: 10_000 });
  console.log('[ask result]:', JSON.stringify(result.output));

  // Second ask
  const result2 = await agent.ask('dir /b package.json', { timeout: 10_000 });
  console.log('[ask2 result]:', JSON.stringify(result2.output));

  await session.kill();
  console.log('[done]');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
