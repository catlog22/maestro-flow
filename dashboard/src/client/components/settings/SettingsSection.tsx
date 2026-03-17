import type { SettingsSectionType } from '@/client/store/settings-store.js';
import { GeneralSection } from './sections/GeneralSection.js';
import { AgentsSection } from './sections/AgentsSection.js';
import { CliToolsSection } from './sections/CliToolsSection.js';
import { SpecsSection } from './sections/SpecsSection.js';
import { LinearSection } from './sections/LinearSection.js';

// ---------------------------------------------------------------------------
// SettingsSection — switch dispatcher routing to concrete section components
// ---------------------------------------------------------------------------

export function SettingsSection({ section }: { section: SettingsSectionType }) {
  switch (section) {
    case 'general':
      return <GeneralSection />;
    case 'agents':
      return <AgentsSection />;
    case 'cli-tools':
      return <CliToolsSection />;
    case 'specs':
      return <SpecsSection />;
    case 'linear':
      return <LinearSection />;
    default:
      return null;
  }
}
