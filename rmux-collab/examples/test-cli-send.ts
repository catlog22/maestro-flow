import { Rmux } from '@rmux/sdk';
import { Agent } from '../src/agent.js';

async function main() {
  const sdk = new Rmux();
  const session = sdk.session('collab-claude');
  const pane = session.pane(0, 0);

  const agent = new Agent(pane, {
    name: 'claude',
    tool: 'claude',
    completionMarker: /❯\s*$/,
  }, 'collab-claude:0.0');

  console.log('[1] isIdle:', await agent.isIdle());

  console.log('[2] ask("respond with just pong")...');
  const r1 = await agent.ask('respond with just pong', { timeout: 120_000 });
  console.log('   →', JSON.stringify(r1.output.slice(0, 200)));

  console.log('[3] isIdle:', await agent.isIdle());

  console.log('[4] ask("what did you just say?")...');
  const r2 = await agent.ask('what word did you just say?', { timeout: 120_000 });
  console.log('   →', JSON.stringify(r2.output.slice(0, 200)));

  console.log('[done] ✓');
}

main().catch(e => console.error('ERR:', e.message));
