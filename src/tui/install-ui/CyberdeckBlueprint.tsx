import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { type WizardStep, type InstallConfig, type InstallResult, DEFAULT_INSTALL_CONFIG, WIZARD_STEPS } from './types.js';
import { GradientHeader } from './GradientHeader.js';
import { ShortcutFooter } from './ShortcutFooter.js';
import { ComponentGrid } from './ComponentGrid.js';
import { BlueprintPreview } from './BlueprintPreview.js';
import { ConfigPanel } from './ConfigPanel.js';
import { ReviewPanel } from './ReviewPanel.js';
import { ExecutionView } from './ExecutionView.js';
import { ResultDashboard } from './ResultDashboard.js';
import { scanComponents, COMPONENT_DEFS } from '../../commands/install-backend.js';

// ---------------------------------------------------------------------------
// CyberdeckBlueprint — root component with step state machine
// ---------------------------------------------------------------------------

interface CyberdeckBlueprintProps {
  pkgRoot: string;
  version: string;
}

function stepForward(current: WizardStep): WizardStep | null {
  const idx = WIZARD_STEPS.indexOf(current);
  if (idx < 0 || idx >= WIZARD_STEPS.length - 1) return null;
  return WIZARD_STEPS[idx + 1];
}

function stepBack(current: WizardStep): WizardStep | null {
  const idx = WIZARD_STEPS.indexOf(current);
  if (idx <= 0) return null;
  return WIZARD_STEPS[idx - 1];
}

export function CyberdeckBlueprint({ pkgRoot, version }: CyberdeckBlueprintProps) {
  const { exit } = useApp();
  const [currentStep, setCurrentStep] = useState<WizardStep>('mode');
  const [config, setConfig] = useState<InstallConfig>({ ...DEFAULT_INSTALL_CONFIG });
  const [installResult, setInstallResult] = useState<InstallResult | null>(null);

  const goForward = useCallback(() => {
    setCurrentStep((prev) => {
      const next = stepForward(prev);
      return next ?? prev;
    });
  }, []);

  const goBack = useCallback(() => {
    setCurrentStep((prev) => {
      const prevStep = stepBack(prev);
      return prevStep ?? prev;
    });
  }, []);

  // Scan components once mode/projectPath are set
  const scannedComponents = useMemo(
    () => scanComponents(pkgRoot, config.mode, config.projectPath),
    [pkgRoot, config.mode, config.projectPath],
  );

  // Compute labels and file count for ReviewPanel
  const componentLabels = useMemo(
    () => config.selectedIds
      .map((id) => COMPONENT_DEFS.find((d) => d.id === id)?.label ?? id),
    [config.selectedIds],
  );
  const totalFileCount = useMemo(
    () => scannedComponents
      .filter((c) => config.selectedIds.includes(c.def.id))
      .reduce((sum, c) => sum + c.fileCount, 0),
    [scannedComponents, config.selectedIds],
  );

  useInput((input, key) => {
    // executing step: ignore all input
    if (currentStep === 'executing') return;

    // Escape: go back or exit
    if (key.escape) {
      if (currentStep === 'mode') {
        exit();
      } else {
        goBack();
      }
      return;
    }

    // Enter: advance or exit
    if (key.return) {
      if (currentStep === 'complete') {
        exit();
        return;
      }
      goForward();
      return;
    }

    // Step-specific keys
    if (currentStep === 'mode') {
      if (input === 'g' || input === 'G') {
        setConfig((c) => ({ ...c, mode: 'global' }));
      } else if (input === 'p' || input === 'P') {
        setConfig((c) => ({ ...c, mode: 'project' }));
      }
    }
  });

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <GradientHeader currentStep={currentStep} version={version} />
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        {currentStep === 'mode' && (
          <Box flexDirection="column">
            <Text bold color="cyan">Installation Mode</Text>
            <Box marginTop={1}>
              <Text color={config.mode === 'global' ? 'green' : 'gray'}>
                {config.mode === 'global' ? '[x]' : '[ ]'} Global
              </Text>
              <Text>  </Text>
              <Text color={config.mode === 'project' ? 'green' : 'gray'}>
                {config.mode === 'project' ? '[x]' : '[ ]'} Project
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>
                {config.mode === 'global'
                  ? 'Install to home directory (~/.claude/, ~/.maestro/)'
                  : 'Install to a specific project directory'}
              </Text>
            </Box>
          </Box>
        )}
        {currentStep === 'components' && (
          <ComponentGrid
            components={scannedComponents}
            selectedIds={config.selectedIds}
            onSelectionChange={(ids) => setConfig((c) => ({ ...c, selectedIds: ids }))}
            onDone={goForward}
          />
        )}
        {currentStep === 'config' && (
          <ConfigPanel
            config={config}
            onConfigChange={(partial) => setConfig((c) => ({ ...c, ...partial }))}
            onDone={goForward}
            onBack={goBack}
            existingManifest={false}
          />
        )}
        {currentStep === 'review' && (
          <Box flexDirection="column">
            <BlueprintPreview
              mode={config.mode}
              projectPath={config.projectPath}
              selectedIds={config.selectedIds}
            />
            <ReviewPanel
              config={config}
              componentLabels={componentLabels}
              fileCount={totalFileCount}
              onConfirm={goForward}
              onBack={goBack}
            />
          </Box>
        )}
        {currentStep === 'executing' && (
          <ExecutionView
            components={scanComponents(pkgRoot, config.mode, config.projectPath)}
            config={config}
            pkgRoot={pkgRoot}
            version={version}
            onComplete={(result) => {
              setInstallResult(result);
              goForward();
            }}
          />
        )}
        {currentStep === 'complete' && installResult && (
          <ResultDashboard
            result={installResult}
            onClose={() => exit()}
          />
        )}
      </Box>
      <ShortcutFooter currentStep={currentStep} />
    </Box>
  );
}
