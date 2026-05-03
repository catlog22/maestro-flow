import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { InstallConfig } from './types.js';
import { McpConfig } from './McpConfig.js';
import { HooksConfig } from './HooksConfig.js';
import { BackupConfig } from './BackupConfig.js';

// ---------------------------------------------------------------------------
// ConfigPanel -- Tab-based container for MCP / Hooks / Backup configuration
// ---------------------------------------------------------------------------

interface ConfigPanelProps {
  config: InstallConfig;
  onConfigChange: (config: Partial<InstallConfig>) => void;
  onDone: () => void;
  onBack: () => void;
  existingManifest: boolean;
}

const TABS = ['MCP', 'Hooks', 'Backup'] as const;
type TabIndex = 0 | 1 | 2;

export function ConfigPanel({
  config,
  onConfigChange,
  onDone,
  onBack,
  existingManifest,
}: ConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<TabIndex>(0);

  const cycleTab = useCallback(() => {
    setActiveTab((prev) => ((prev + 1) % 3) as TabIndex);
  }, []);

  useInput(
    (_input, key) => {
      // Tab: cycle through tabs
      if (key.tab) {
        cycleTab();
        return;
      }

      // Enter: advance to review
      if (key.return) {
        onDone();
        return;
      }

      // Escape: go back to components
      if (key.escape) {
        onBack();
        return;
      }
    },
  );

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        Configuration
      </Text>

      {/* Tab indicators */}
      <Box marginTop={1} gap={2}>
        {TABS.map((tab, i) => {
          const isActive = i === activeTab;
          return (
            <Text
              key={tab}
              color={isActive ? 'cyan' : 'gray'}
              bold={isActive}
            >
              {isActive ? `[${tab}]` : ` ${tab} `}
            </Text>
          );
        })}
      </Box>

      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
      >
        {activeTab === 0 && (
          <McpConfig
            enabled={config.mcpEnabled}
            tools={config.mcpTools}
            projectRoot={config.mcpProjectRoot}
            mode={config.mode}
            onEnableChange={(v) => onConfigChange({ mcpEnabled: v })}
            onToolsChange={(tools) => onConfigChange({ mcpTools: tools })}
            onRootChange={(root) => onConfigChange({ mcpProjectRoot: root })}
          />
        )}
        {activeTab === 1 && (
          <HooksConfig
            level={config.hookLevel}
            onLevelChange={(level) => onConfigChange({ hookLevel: level })}
          />
        )}
        {activeTab === 2 && (
          <BackupConfig
            backupClaudeMd={config.backupClaudeMd}
            backupAll={config.backupAll}
            existingFileCount={0}
            onClaudeMdChange={(v: boolean) => onConfigChange({ backupClaudeMd: v })}
            onAllChange={(v: boolean) => onConfigChange({ backupAll: v })}
          />
        )}
      </Box>
    </Box>
  );
}
