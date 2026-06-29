import { Rmux } from '@rmux/sdk';
import { Channel } from '../src/channel.js';
import type { ChannelConfig } from '../src/types.js';

async function main() {
  const rmux = new Rmux();

  const config: ChannelConfig = {
    name: 'demo',
    visible: true,
    agents: [
      { name: 'worker-a', tool: 'shell', completionMarker: '>' },
      { name: 'worker-b', tool: 'shell', completionMarker: '>' },
    ],
  };

  console.log('Creating visible channel...');
  const channel = await Channel.create(rmux, config);
  console.log('Agents:', [...channel.agents.keys()]);

  console.log('Broadcasting...');
  const results = await channel.broadcast('echo VISIBLE_TEST_OK', { timeout: 15_000 });
  for (const r of results) {
    console.log(`  ${r.agent}: ${r.output}`);
  }

  console.log('Windows are open — check your terminal tabs!');
  console.log('Cleaning up in 10s...');
  await new Promise(r => setTimeout(r, 10_000));
  await channel.destroy();
  console.log('Done ✓');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
