import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { SkillConfigDashboard } from './SkillConfigDashboard.js';
import { ToolsDashboard } from '../tools-ui/ToolsDashboard.js';
import { HooksPanel } from './HooksPanel.js';
import { SpecPanel } from './SpecPanel.js';

const TABS = ['Skills', 'Delegate', 'Hooks', 'Overlay', 'Specs', 'Install'] as const;
type Tab = (typeof TABS)[number];

const TAB_DESCRIPTIONS: Record<Tab, string> = {
  Skills: 'Skill parameter defaults — configure default flag values for slash commands.',
  Delegate: 'Delegate tool configuration — manage CLI tools, role mappings, and settings.',
  Hooks: 'Hook installation status — Claude Code subprocess hooks and toggles.',
  Overlay: 'Command overlays — non-invasive patches for .claude/commands and .codex/skills.',
  Specs: 'Spec system — project knowledge (coding, arch, debug, test conventions).',
  Install: 'Install / uninstall maestro assets — components, hooks, MCP server.',
};

export interface ConfigHubProps {
  workDir: string;
  initialTab?: Tab;
  /** Pass-through: jump directly into a skills sub-view */
  skillsInitialView?: 'dashboard' | 'skills' | 'editor' | 'sources';
  editSkill?: string;
  /** Pass-through: jump directly into a delegate sub-view */
  delegateInitialView?: 'dashboard' | 'tools' | 'roles' | 'register' | 'reference' | 'sources';
}

export function ConfigHub({
  workDir,
  initialTab = 'Skills',
  skillsInitialView,
  editSkill,
  delegateInitialView,
}: ConfigHubProps) {
  const { exit } = useApp();
  const [tabIdx, setTabIdx] = useState(TABS.indexOf(initialTab as Tab));
  const tab = TABS[tabIdx];
  // Once the user enters a sub-dashboard, hand off input to it
  const [entered, setEntered] = useState(
    !!(skillsInitialView || editSkill || delegateInitialView),
  );

  useInput((input, key) => {
    if (entered) return;
    if (key.leftArrow) setTabIdx(i => (i > 0 ? i - 1 : TABS.length - 1));
    if (key.rightArrow || input === '\t') setTabIdx(i => (i < TABS.length - 1 ? i + 1 : 0));
    if (key.return) setEntered(true);
    if (input === 'q' || key.escape) exit();
  });

  if (entered) {
    const backToHub = () => setEntered(false);

    if (tab === 'Skills') {
      return (
        <SkillConfigDashboard
          workDir={workDir}
          initialView={skillsInitialView}
          editSkill={editSkill}
        />
      );
    }
    if (tab === 'Delegate') {
      return (
        <ToolsDashboard
          workDir={workDir}
          initialView={delegateInitialView}
        />
      );
    }
    if (tab === 'Hooks') {
      return <HooksPanel workDir={workDir} onBack={backToHub} />;
    }
    if (tab === 'Overlay') {
      return <OverlayLauncher onBack={backToHub} />;
    }
    if (tab === 'Specs') {
      return <SpecPanel workDir={workDir} onBack={backToHub} />;
    }
    if (tab === 'Install') {
      return <InstallLauncher onBack={backToHub} />;
    }
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color="cyan">MAESTRO CONFIG</Text>
        <Text> </Text>

        <Box gap={1}>
          {TABS.map((t, i) => (
            <Box key={t} paddingX={1}>
              {i === tabIdx
                ? <Text bold inverse color="cyan">{` ${t} `}</Text>
                : <Text dimColor>{` ${t} `}</Text>
              }
            </Box>
          ))}
        </Box>

        <Text> </Text>
        <Text>{TAB_DESCRIPTIONS[tab]}</Text>

        <Text> </Text>
        <Text dimColor>  ←/→ switch tab  ↵ enter  [q] quit</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Overlay panel — embeds OverlayList directly with live data
// ---------------------------------------------------------------------------

function OverlayLauncher({ onBack }: { onBack: () => void }) {
  const [OverlayList, setOverlayList] = useState<React.ComponentType<any> | null>(null);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      const { prepareOverlayData } = await import('../overlay-ui/index.js');
      const { OverlayList: OL } = await import('../overlay-ui/OverlayList.js');
      const d = prepareOverlayData();
      if (!d) {
        setError('No overlays installed.');
      } else {
        setData(d);
        setOverlayList(() => OL);
      }
    })();
  }, []);

  if (error) {
    return <OverlayFallback message={error} onBack={onBack} />;
  }
  if (!OverlayList || !data) {
    return <Text dimColor>Loading overlays...</Text>;
  }

  return React.createElement(OverlayList, {
    overlays: data.overlays,
    errors: data.errors,
    appliedState: data.appliedState,
    targets: data.targets,
    interactive: !!process.stdin.isTTY,
    onDelete: data.handleDelete,
  });
}

function OverlayFallback({ message, onBack }: { message: string; onBack: () => void }) {
  useInput((input, key) => {
    if (input === 'q' || key.escape) onBack();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color="cyan">OVERLAY MANAGER</Text>
        <Text> </Text>
        <Text dimColor>{message}</Text>
        <Text> </Text>
        <Text dimColor>  CLI: maestro overlay add {'<'}file{'>'}</Text>
        <Text dimColor>       maestro overlay apply</Text>
        <Text> </Text>
        <Text dimColor>  [q] back to hub</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Install launcher — entry to install/uninstall flows
// ---------------------------------------------------------------------------

function InstallLauncher({ onBack }: { onBack: () => void }) {
  const [choice, setChoice] = useState<'menu' | 'install' | 'uninstall'>('menu');
  const [cursor, setCursor] = useState(0);
  const options = ['Install (full wizard)', 'Uninstall'] as const;

  useInput((input, key) => {
    if (choice !== 'menu') return;
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(options.length - 1, c + 1));
    if (key.return) {
      setChoice(cursor === 0 ? 'install' : 'uninstall');
    }
    if (input === 'q' || key.escape) onBack();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color="cyan">INSTALL / UNINSTALL</Text>
        <Text> </Text>
        <Text>Launch the install or uninstall wizard from the CLI:</Text>
        <Text> </Text>
        <Text dimColor>  CLI: maestro install          — interactive install wizard</Text>
        <Text dimColor>       maestro install wizard    — full TUI wizard</Text>
        <Text dimColor>       maestro uninstall         — remove installed assets</Text>
        <Text> </Text>
        <Text dimColor>  [q] back to hub</Text>
      </Box>
    </Box>
  );
}
