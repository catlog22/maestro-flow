import { Coordinator } from '../src/coordinator.js';

async function main() {
  console.log('[e2e] Creating coordinator...');
  const coord = await Coordinator.create({
    channels: [{
      name: 'team',
      agents: [
        { name: 'analyst', tool: 'shell', completionMarker: '>' },
        { name: 'worker', tool: 'shell', completionMarker: '>' },
      ],
    }],
  });

  console.log('[e2e] 1. Single ask...');
  const info = await coord.ask('team', 'analyst', 'echo system-info-ok', { timeout: 10_000 });
  console.log('   result:', JSON.stringify(info.output));

  console.log('[e2e] 2. Broadcast...');
  const results = await coord.broadcast('team', 'echo STATUS_OK', { timeout: 10_000 });
  for (const r of results) {
    console.log(`   ${r.agent}: ${r.output}`);
  }

  console.log('[e2e] 3. Pipeline...');
  const pipeResult = await coord.pipeline(
    [
      { agent: coord.channel('team').get('analyst') },
      { agent: coord.channel('team').get('worker'), transform: (v) => `echo processed: ${v.trim()}` },
    ],
    'echo PLAN_STEP_1',
    { timeout: 10_000 },
  );
  console.log('   result:', JSON.stringify(pipeResult));

  console.log('[e2e] 4. Dynamic channel...');
  const debug = await coord.addChannel({
    name: 'debug',
    agents: [{ name: 'inspector', tool: 'shell', completionMarker: '>' }],
  });
  const diag = await debug.get('inspector').ask('echo diagnostics-complete', { timeout: 10_000 });
  console.log('   result:', JSON.stringify(diag.output));

  console.log('[e2e] 5. Shutdown...');
  await coord.shutdown();
  console.log('[e2e] ALL PASSED ✓');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
