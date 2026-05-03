import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { t } from '../../i18n/index.js';

// ---------------------------------------------------------------------------
// BackupConfig — Granular backup options
//
// [1] Backup CLAUDE.md (default: on)
// [2] Backup all replaced files (default: off)
// ---------------------------------------------------------------------------

interface BackupConfigProps {
  backupClaudeMd: boolean;
  backupAll: boolean;
  existingFileCount: number;
  onClaudeMdChange: (v: boolean) => void;
  onAllChange: (v: boolean) => void;
}

interface BackupOption {
  id: string;
  label: string;
  desc: string;
  value: boolean;
  toggle: (v: boolean) => void;
}

export function BackupConfig({
  backupClaudeMd, backupAll, existingFileCount,
  onClaudeMdChange, onAllChange,
}: BackupConfigProps) {
  const options: BackupOption[] = [
    {
      id: 'claude-md',
      label: t.install.backupOptClaudeMd,
      desc: t.install.backupOptClaudeMdDesc,
      value: backupClaudeMd,
      toggle: onClaudeMdChange,
    },
    {
      id: 'all',
      label: t.install.backupOptAll,
      desc: t.install.backupOptAllDesc.replace('{count}', String(existingFileCount)),
      value: backupAll,
      toggle: onAllChange,
    },
  ];

  const [index, setIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setIndex((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (key.downArrow) {
      setIndex((i) => (i >= options.length - 1 ? 0 : i + 1));
    } else if (input === ' ') {
      options[index].toggle(!options[index].value);
    } else {
      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= options.length) {
        const opt = options[num - 1];
        opt.toggle(!opt.value);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{t.install.backupTitle}</Text>

      <Box flexDirection="column" marginTop={1}>
        {options.map((opt, i) => {
          const hl = i === index;
          return (
            <Box key={opt.id}>
              <Text color={hl ? 'cyan' : 'gray'}>[{i + 1}]</Text>
              <Text color={opt.value ? 'green' : 'gray'}> {opt.value ? '[x]' : '[ ]'} </Text>
              <Text color={hl ? 'cyan' : undefined} bold={hl}>{opt.label}</Text>
              <Text dimColor> — {opt.desc}</Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          [Up/Down] Navigate  [Space/1-{options.length}] Toggle  [Enter] Done  [Esc] Back
        </Text>
      </Box>
    </Box>
  );
}
