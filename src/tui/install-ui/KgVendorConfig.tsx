import React from 'react';
import { Box, Text } from 'ink';
import type { UaVendorStatus } from '../../commands/install-backend.js';
import { t } from '../../i18n/index.js';
import { C, SYM, SectionHeader, KeyHints } from '../shared/index.js';

// ---------------------------------------------------------------------------
// KgVendorConfig — info panel for Knowledge Graph vendor (Understand-Anything)
//
// Shows current install status and what the vendor provides.
// No complex settings — it's an on/off toggle controlled from the hub.
// ---------------------------------------------------------------------------

interface KgVendorConfigProps {
  status: UaVendorStatus;
}

export function KgVendorConfig({ status }: KgVendorConfigProps) {
  const isReady = status.installed && status.coreBuilt;

  return (
    <Box flexDirection="column">
      <SectionHeader title={t.install.kgVendorTitle} />

      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text bold>{t.install.kgVendorStatusLabel} </Text>
          {isReady ? (
            <Text color={C.success}>
              {SYM.checkOn} {t.install.kgVendorInstalled}
              {status.version ? ` (v${status.version})` : ''}
            </Text>
          ) : (
            <Text color={C.warning}>
              {SYM.checkOff} {t.install.kgVendorNotInstalled}
            </Text>
          )}
        </Box>

        <Box>
          <Text bold>{t.install.kgVendorPathLabel} </Text>
          <Text dimColor>{status.path}/understand-anything-plugin/</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{t.install.kgVendorDesc}</Text>
      </Box>

      {!isReady && (
        <Box marginTop={1}>
          <Text color={C.primary}>
            Enable this item in the hub and install to clone + build the vendor.
          </Text>
        </Box>
      )}

      <KeyHints hints={t.install.kgVendorHint} />
    </Box>
  );
}
