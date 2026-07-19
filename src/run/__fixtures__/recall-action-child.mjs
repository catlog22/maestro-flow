import { executeRecallAction } from '../../../dist/src/run/recall-actions.js';

const [projectRoot, encoded] = process.argv.slice(2);
try {
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  const configured = payload.options ?? {};
  const crash = () => process.exit(86);
  const options = {
    now: configured.now ? new Date(configured.now) : undefined,
    reservationTtlMs: configured.reservationTtlMs,
    afterClaim: configured.crashPoint === 'after-claim' ? crash : undefined,
    afterArtifactCopy: configured.crashPoint === 'after-artifact-copy' ? crash : undefined,
    afterCreate: configured.crashPoint === 'after-create' ? crash : undefined,
  };
  const result = executeRecallAction(projectRoot, payload.input, options);
  process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, code: error?.code ?? 'ERROR', message: error?.message ?? String(error) })}\n`);
  process.exitCode = 1;
}
