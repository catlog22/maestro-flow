// ---------------------------------------------------------------------------
// CSV Wave types — .workflow/.csv-wave/ directory data structures
// ---------------------------------------------------------------------------

/** A single CSV wave session (directory under .csv-wave/) */
export interface CsvWaveSession {
  /** Directory name (e.g. "cwp-maestro-async-delegate-channel-20260407") */
  id: string;
  /** Parsed prefix from directory name */
  prefix: string;
  /** Parsed date from directory name */
  date: string;
  /** Available wave numbers */
  waves: number[];
  /** Has tasks.csv */
  hasTasks: boolean;
  /** Has results.csv */
  hasResults: boolean;
  /** Summary from tasks.csv */
  tasks: CsvWaveTask[];
  /** Summary results from results.csv */
  results: CsvWaveResult[];
}

/** Task row from tasks.csv or wave-N.csv */
export interface CsvWaveTask {
  id: string;
  title: string;
  description: string;
  test: string;
  acceptance_criteria: string;
  scope: string;
  hints: string;
  execution_directives: string;
  deps: string;
  context_from: string;
  wave: number;
  prev_context: string;
}

/** Result row from results.csv or wave-N-results.csv */
export interface CsvWaveResult {
  id: string;
  title: string;
  status: 'completed' | 'failed' | 'in_progress' | 'pending';
  findings: string;
  files_modified: string[];
  tests_passed: boolean;
  acceptance_met: string;
  error: string;
  wave: number;
  reported_at: string;
  completed_at: string;
}
