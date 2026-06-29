import { Rmux } from '@rmux/sdk';
import { Channel } from '../src/channel.js';
import type { ChannelConfig } from '../src/types.js';

async function main() {
  const rmux = new Rmux();

  const config: ChannelConfig = {
    name: 'collab',
    visible: true,
    agents: [
      { name: 'claude', tool: 'claude', settings: 'D:\\settings.json', completionMarker: /❯\s*$/ },
    ],
  };

  console.log('Creating visible Claude agent...');
  const channel = await Channel.create(rmux, config);
  console.log('Agent ready! Asking...');

  const result = await channel.get('claude').ask('respond with just "hello world"', { timeout: 120_000 });
  console.log('Response:', result);

  console.log('\nClaude window is visible in your terminal.');
  console.log('Cleanup in 15s...');
  await new Promise(r => setTimeout(r, 15_000));
  await channel.destroy();
  console.log('Done ✓');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
