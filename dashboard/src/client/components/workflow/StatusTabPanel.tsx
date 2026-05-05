import { useBoardStore } from '@/client/store/board-store.js';
import type { PhaseCard } from '@/shared/types.js';

// ---------------------------------------------------------------------------
// StatusTabPanel — execution metadata, progress, and gaps visualization
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helper: MetricCard
// ---------------------------------------------------------------------------

interface MetricCardProps {
  title: string;
  children: React.ReactNode;
}

function MetricCard({ title, children }: MetricCardProps) {
  return (
    <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg p-4">
      <div className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-3">
        {title}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: StatusBadge
// ---------------------------------------------------------------------------

interface StatusBadgeProps {
  status: string;
}

function StatusBadge({ status }: StatusBadgeProps) {
  let colorClasses: string;

  switch (status) {
    case 'pending':
    case 'not_started':
      colorClasses = 'bg-[var(--color-bg-hover)] text-[var(--color-text-tertiary)]';
      break;
    case 'in_progress':
    case 'running':
      colorClasses = 'bg-blue-950/40 text-blue-400';
      break;
    case 'completed':
    case 'passed':
    case 'verified':
      colorClasses = 'bg-green-950/40 text-green-400';
      break;
    case 'failed':
    case 'blocked':
      colorClasses = 'bg-red-950/40 text-red-400';
      break;
    case 'gaps_found':
      colorClasses = 'bg-orange-950/40 text-orange-400';
      break;
    default:
      colorClasses = 'bg-[var(--color-bg-hover)] text-[var(--color-text-tertiary)]';
  }

  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colorClasses}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helper: ProgressBar
// ---------------------------------------------------------------------------

interface ProgressBarProps {
  value: number;
  total: number;
  label?: string;
}

function ProgressBar({ value, total, label }: ProgressBarProps) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const displayLabel = label ?? `${value}/${total} (${pct}%)`;

  return (
    <div>
      <div className="w-full bg-[var(--color-bg-active)] rounded-full h-2 relative overflow-hidden">
        <div
          className="h-full bg-[var(--color-accent-blue)] rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-[var(--color-text-tertiary)] mt-1">{displayLabel}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: MetaRow — label + value pair inside a MetricCard
// ---------------------------------------------------------------------------

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 text-sm py-1">
      <span className="text-[var(--color-text-tertiary)] shrink-0">{label}</span>
      <span className="text-[var(--color-text-primary)] text-right">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: GapItem — renders a single gap with a colored left border
// ---------------------------------------------------------------------------

type GapCategory = 'verification' | 'validation' | 'uat';

interface GapItemProps {
  text: string;
  category: GapCategory;
}

const GAP_BORDER_CLASSES: Record<GapCategory, string> = {
  verification: 'border-red-500 bg-red-950/10',
  validation: 'border-orange-400 bg-orange-950/10',
  uat: 'border-yellow-500 bg-yellow-950/10',
};

const GAP_BADGE_CLASSES: Record<GapCategory, string> = {
  verification: 'bg-red-950/40 text-red-400',
  validation: 'bg-orange-950/40 text-orange-400',
  uat: 'bg-yellow-950/40 text-yellow-400',
};

function GapItem({ text, category }: GapItemProps) {
  return (
    <div
      className={`border-l-4 rounded-r px-3 py-2 ${GAP_BORDER_CLASSES[category]}`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-xs font-medium mt-0.5 ${GAP_BADGE_CLASSES[category]}`}
        >
          {category}
        </span>
        <span className="text-sm text-[var(--color-text-primary)]">{text}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: format date string
// ---------------------------------------------------------------------------

function formatDate(value: string | null): string {
  if (!value) return '\u2014';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

// ---------------------------------------------------------------------------
// Main: StatusTabPanel
// ---------------------------------------------------------------------------

interface StatusTabPanelProps {
  phaseId: number | null;
}

export function StatusTabPanel({ phaseId }: StatusTabPanelProps) {
  const phase = useBoardStore(
    (s) => s.board?.phases.find((p) => p.phase === phaseId) ?? null,
  ) as PhaseCard | null;

  if (!phase) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-tertiary)] text-sm">
        Select a phase to view its status
      </div>
    );
  }

  const { execution, verification, validation, uat, reflection } = phase;

  // UAT pass rate
  const uatPassRate =
    uat.test_count > 0 ? Math.round((uat.passed / uat.test_count) * 100) : null;

  // Collect all gaps
  const gapText = (g: string | Record<string, unknown>): string =>
    typeof g === 'string' ? g : (g.description ?? g.requirement ?? g.id ?? JSON.stringify(g)) as string;

  const verificationGaps: Array<{ text: string; category: GapCategory }> = (
    verification.gaps ?? []
  ).map((g) => ({ text: gapText(g), category: 'verification' }));

  const validationGaps: Array<{ text: string; category: GapCategory }> = (
    validation.gaps ?? []
  ).map((g) => ({ text: gapText(g), category: 'validation' }));

  const uatGaps: Array<{ text: string; category: GapCategory }> = (uat.gaps ?? []).map(
    (g) => ({ text: gapText(g), category: 'uat' }),
  );

  const allGaps = [...verificationGaps, ...validationGaps, ...uatGaps];

  return (
    <div className="overflow-y-auto p-4 space-y-4 h-full">
      {/* Metric cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: Execution */}
        <MetricCard title="Execution">
          <div className="space-y-1">
            <MetaRow label="Method">{execution.method || '\u2014'}</MetaRow>
            <MetaRow label="Started">{formatDate(execution.started_at)}</MetaRow>
            <MetaRow label="Completed">{formatDate(execution.completed_at)}</MetaRow>
            <MetaRow label="Wave">
              {execution.current_wave > 0 ? `Wave ${execution.current_wave}` : '\u2014'}
            </MetaRow>
          </div>
          <div className="mt-3">
            <p className="text-xs text-[var(--color-text-tertiary)] mb-1">Task progress</p>
            <ProgressBar value={execution.tasks_completed} total={execution.tasks_total} />
          </div>
        </MetricCard>

        {/* Card 2: Verification */}
        <MetricCard title="Verification">
          <div className="flex items-center gap-2 mb-2">
            <StatusBadge status={verification.status} />
          </div>
          <div className="space-y-1">
            <MetaRow label="Verified at">{formatDate(verification.verified_at)}</MetaRow>
            <MetaRow label="Must-haves">
              {(verification.must_haves ?? []).length}
            </MetaRow>
            <MetaRow label="Gaps">{(verification.gaps ?? []).length}</MetaRow>
          </div>
        </MetricCard>

        {/* Card 3: UAT */}
        <MetricCard title="UAT">
          <div className="flex items-center gap-2 mb-2">
            <StatusBadge status={uat.status} />
          </div>
          <div className="space-y-1">
            <MetaRow label="Tests">
              {uat.passed}/{uat.test_count}
            </MetaRow>
            <MetaRow label="Pass rate">
              {uatPassRate !== null ? `${uatPassRate}%` : 'N/A'}
            </MetaRow>
            <MetaRow label="Gaps">{(uat.gaps ?? []).length}</MetaRow>
          </div>
          {uat.test_count > 0 && (
            <div className="mt-3">
              <ProgressBar value={uat.passed} total={uat.test_count} />
            </div>
          )}
        </MetricCard>

        {/* Card 4: Reflection */}
        <MetricCard title="Reflection">
          <div className="space-y-1 mb-3">
            <MetaRow label="Rounds">{reflection.rounds}</MetaRow>
          </div>
          {(reflection.strategy_adjustments ?? []).length > 0 ? (
            <ul className="list-disc list-inside space-y-1 text-sm text-[var(--color-text-primary)]">
              {reflection.strategy_adjustments.map((adj, i) => (
                <li key={i}>{adj}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[var(--color-text-tertiary)] text-sm">
              No strategy adjustments recorded
            </p>
          )}
        </MetricCard>
      </div>

      {/* Gaps section */}
      <div>
        <h3 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-3">
          Gaps ({allGaps.length})
        </h3>
        {allGaps.length > 0 ? (
          <div className="space-y-2">
            {allGaps.map((gap, i) => (
              <GapItem key={i} text={gap.text} category={gap.category} />
            ))}
          </div>
        ) : (
          <p className="text-[var(--color-text-tertiary)] text-sm">No gaps recorded</p>
        )}
      </div>
    </div>
  );
}
