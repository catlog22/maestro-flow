import { useInstallStore, MCP_TOOLS, type AddonInfo } from '@/client/store/install-store.js';

export function StepConfigure() {
  const detection = useInstallStore((s) => s.detection);
  const selectedComponents = useInstallStore((s) => s.selectedComponents);
  const toggleComponent = useInstallStore((s) => s.toggleComponent);
  const selectAllComponents = useInstallStore((s) => s.selectAllComponents);
  const backup = useInstallStore((s) => s.backup);
  const setBackup = useInstallStore((s) => s.setBackup);
  const mcpEnabled = useInstallStore((s) => s.mcpEnabled);
  const setMcpEnabled = useInstallStore((s) => s.setMcpEnabled);
  const enabledTools = useInstallStore((s) => s.enabledTools);
  const toggleTool = useInstallStore((s) => s.toggleTool);
  const setStep = useInstallStore((s) => s.setStep);

  if (!detection) return null;

  const allSelected =
    detection.components.filter((c) => c.available).every((c) => selectedComponents.has(c.id));

  return (
    <div className="flex flex-col gap-5 max-w-[560px] mx-auto py-4">
      {/* Components */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold text-text-primary">Components</h3>
          <button
            type="button"
            onClick={selectAllComponents}
            className="text-[10px] font-semibold text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          >
            {allSelected ? 'All selected' : 'Select all'}
          </button>
        </div>

        <div className="flex flex-col gap-[6px]">
          {detection.components.map((comp) => (
            <label
              key={comp.id}
              className="flex items-center gap-3 px-3 py-[10px] rounded-[var(--radius-md)] border border-border bg-bg-card cursor-pointer hover:bg-bg-hover transition-colors"
              style={{
                opacity: comp.available ? 1 : 0.4,
                pointerEvents: comp.available ? 'auto' : 'none',
              }}
            >
              <input
                type="checkbox"
                checked={selectedComponents.has(comp.id)}
                onChange={() => toggleComponent(comp.id)}
                disabled={!comp.available}
                className="w-[14px] h-[14px] accent-[var(--color-text-primary,#1A1917)] cursor-pointer"
              />
              <div className="flex-1 min-w-0">
                <span className="text-[12px] font-semibold text-text-primary">{comp.label}</span>
                <span className="text-[10px] text-text-tertiary ml-2 font-mono">
                  {comp.fileCount} files
                </span>
              </div>
              <span className="text-[9px] text-text-tertiary font-mono max-w-[200px] truncate" title={comp.targetDir}>
                {comp.targetDir.replace(/\\/g, '/').replace(/^.*\/\./, '~\/.')}
              </span>
            </label>
          ))}

          {/* MCP config row */}
          <label className="flex items-center gap-3 px-3 py-[10px] rounded-[var(--radius-md)] border border-border bg-bg-card cursor-pointer hover:bg-bg-hover transition-colors">
            <input
              type="checkbox"
              checked={selectedComponents.has('mcp')}
              onChange={() => toggleComponent('mcp')}
              className="w-[14px] h-[14px] accent-[var(--color-text-primary,#1A1917)] cursor-pointer"
            />
            <div className="flex-1 min-w-0">
              <span className="text-[12px] font-semibold text-text-primary">MCP Server</span>
              <span className="text-[10px] text-text-tertiary ml-2">Register maestro-tools MCP</span>
            </div>
          </label>
        </div>
      </div>

      {/* Existing installation warning + backup */}
      {detection.existingManifest && (
        <div className="rounded-[var(--radius-md)] border border-[rgba(184,149,64,0.3)] bg-[rgba(184,149,64,0.04)] px-4 py-3">
          <p className="text-[11px] font-semibold text-[var(--color-status-executing,#B89540)] mb-2">
            Existing installation (v{detection.existingManifest.version}) will be overwritten
          </p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={backup}
              onChange={(e) => setBackup(e.target.checked)}
              className="w-[14px] h-[14px] accent-[var(--color-status-executing,#B89540)] cursor-pointer"
            />
            <span className="text-[11px] text-text-secondary">Create backup before installing</span>
          </label>
        </div>
      )}

      {/* MCP tool selection */}
      {selectedComponents.has('mcp') && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-[13px] font-semibold text-text-primary">MCP Tools</h3>
            <label className="flex items-center gap-[6px] cursor-pointer ml-auto">
              <input
                type="checkbox"
                checked={mcpEnabled}
                onChange={(e) => setMcpEnabled(e.target.checked)}
                className="w-[13px] h-[13px] accent-[var(--color-text-primary,#1A1917)] cursor-pointer"
              />
              <span className="text-[10px] text-text-secondary font-semibold">Enable MCP</span>
            </label>
          </div>

          {mcpEnabled && (
            <div className="flex flex-wrap gap-[6px]">
              {MCP_TOOLS.map((tool) => (
                <button
                  key={tool}
                  type="button"
                  onClick={() => toggleTool(tool)}
                  className="px-[10px] py-[5px] rounded-full border text-[10px] font-mono font-semibold transition-all cursor-pointer"
                  style={{
                    borderColor: enabledTools.has(tool) ? 'var(--color-text-primary)' : 'var(--color-border)',
                    background: enabledTools.has(tool) ? 'var(--color-text-primary)' : 'var(--color-bg-card)',
                    color: enabledTools.has(tool) ? '#fff' : 'var(--color-text-tertiary)',
                  }}
                >
                  {tool}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Addons */}
      <AddonSection />

      {/* Disabled items info */}
      {detection.disabledItems.length > 0 && (
        <div className="rounded-[var(--radius-md)] border border-border bg-bg-card px-4 py-3">
          <p className="text-[11px] font-semibold text-text-secondary mb-1">
            {detection.disabledItems.length} disabled item(s) will be preserved
          </p>
          <div className="flex flex-wrap gap-1">
            {detection.disabledItems.map((item) => (
              <span key={item.relativePath} className="text-[9px] font-mono text-text-tertiary px-[6px] py-[2px] rounded bg-bg-secondary">
                {item.name} ({item.type})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={() => setStep('mode')}
          className="px-4 py-[7px] rounded-[var(--radius-lg)] border border-border bg-bg-card text-[12px] font-semibold text-text-secondary hover:text-text-primary hover:border-text-tertiary transition-all cursor-pointer"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => setStep('review')}
          disabled={selectedComponents.size === 0}
          className="px-5 py-[8px] rounded-[var(--radius-lg)] border-none bg-text-primary text-white text-[12px] font-semibold cursor-pointer transition-all hover:-translate-y-px hover:shadow-md disabled:opacity-40 disabled:cursor-default disabled:transform-none"
        >
          Review
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Addon Section — external skill marketplace
// ---------------------------------------------------------------------------

function AddonSection() {
  const addons = useInstallStore((s) => s.addons);
  const addonInstalling = useInstallStore((s) => s.addonInstalling);
  const installAddon = useInstallStore((s) => s.installAddon);

  if (addons.length === 0) return null;

  return (
    <div>
      <h3 className="text-[13px] font-semibold text-text-primary mb-3">Addons</h3>
      <div className="flex flex-col gap-[6px]">
        {addons.map((addon) => {
          const harnessEntries = Object.entries(addon.harnesses);
          const allInstalled = harnessEntries.every(([, v]) => v);

          return (
            <div
              key={addon.id}
              className="px-3 py-[10px] rounded-[var(--radius-md)] border border-border bg-bg-card"
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-text-primary">{addon.name}</span>
                    {addon.tags?.map((tag) => (
                      <span key={tag} className="text-[9px] font-mono text-text-tertiary px-[5px] py-[1px] rounded bg-bg-secondary">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-text-tertiary mt-[2px] leading-relaxed">{addon.description}</p>
                </div>
                {allInstalled ? (
                  <span className="text-[10px] font-semibold text-[var(--color-status-completed,#5A9E78)] px-3 py-[5px] shrink-0">
                    Installed
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={addonInstalling === addon.id}
                    onClick={() => installAddon(addon.id)}
                    className="px-3 py-[5px] rounded-[var(--radius-md)] border border-text-primary bg-transparent text-[10px] font-semibold text-text-primary hover:bg-text-primary hover:text-white transition-all cursor-pointer disabled:opacity-40 disabled:cursor-default shrink-0"
                  >
                    {addonInstalling === addon.id ? 'Installing...' : 'Install All'}
                  </button>
                )}
              </div>
              {/* Per-harness status */}
              <div className="flex items-center gap-3 mt-2">
                {harnessEntries.map(([harness, installed]) => (
                  <div key={harness} className="flex items-center gap-[5px]">
                    <span
                      className="w-[6px] h-[6px] rounded-full shrink-0"
                      style={{ background: installed ? 'var(--color-status-completed,#5A9E78)' : 'var(--color-text-tertiary)' }}
                    />
                    <span className="text-[10px] font-mono text-text-tertiary">{harness}</span>
                    {!installed && !allInstalled && (
                      <button
                        type="button"
                        disabled={addonInstalling === addon.id}
                        onClick={() => installAddon(addon.id, [harness])}
                        className="text-[9px] text-text-tertiary hover:text-text-primary underline cursor-pointer disabled:opacity-40 disabled:cursor-default"
                      >
                        install
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
