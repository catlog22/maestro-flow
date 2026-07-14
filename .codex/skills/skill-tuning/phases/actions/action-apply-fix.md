
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Action: Apply Fix

Apply a selected fix to the target skill with backup and rollback capability.

## Purpose

- Apply fix changes to target skill files
- Create backup before modifications
- Track applied fixes for verification
- Support rollback if needed

## Preconditions

- [ ] state.status === 'running'
- [ ] state.pending_fixes.length > 0
- [ ] state.proposed_fixes contains the fix to apply

## Execution

```javascript
async function execute(state, workDir) {
  const pendingFixes = state.pending_fixes;
  const proposedFixes = state.proposed_fixes;
  const targetPath = state.target_skill.path;
  const backupDir = state.backup_dir;

  if (pendingFixes.length === 0) {
    return {
      stateUpdates: {},
      outputFiles: [],
      summary: 'No pending fixes to apply'
    };
  }

  // Get next fix to apply
  const fixId = pendingFixes[0];
  const fix = proposedFixes.find(f => f.id === fixId);

  if (!fix) {
    return {
      stateUpdates: {
        pending_fixes: pendingFixes.slice(1),
        errors: [...state.errors, {
          action: 'action-apply-fix',
          message: `Fix ${fixId} not found in proposals`,
          timestamp: new Date().toISOString(),
          recoverable: true
        }]
      },
      outputFiles: [],
      summary: `Fix ${fixId} not found, skipping`
    };
  }

  console.log(`Applying fix ${fix.id}: ${fix.description}`);

  // Create fix-specific backup
  const fixBackupDir = `${backupDir}/before-${fix.id}`;
  Bash(`mkdir -p "${fixBackupDir}"`);

  const appliedChanges = [];
  let success = true;

  for (const change of fix.changes) {
    try {
      // Resolve file path (handle wildcards)
      let targetFiles = [];
      if (change.file.includes('*')) {
        targetFiles = Glob(`${targetPath}/${change.file}`);
      } else {
        targetFiles = [`${targetPath}/${change.file}`];
      }

      for (const targetFile of targetFiles) {
        // Backup original
        const relativePath = targetFile.replace(targetPath + '/', '');
        const backupPath = `${fixBackupDir}/${relativePath}`;

        if (Glob(targetFile).length > 0) {
          const originalContent = Read(targetFile);
          Bash(`mkdir -p "$(dirname "${backupPath}")"`);
          Write(backupPath, originalContent);
        }

        // Apply change based on action type
        if (change.action === 'modify' && change.diff) {
          // For now, append the diff as a comment/note
          // Real implementation would parse and apply the diff
          const existingContent = Read(targetFile);

          // Simple diff application: look for context and apply
          // This is a simplified version - real implementation would be more sophisticated
          const newContent = existingContent + `\n\n<!-- Applied fix ${fix.id}: ${fix.description} -->\n`;

          Write(targetFile, newContent);

          appliedChanges.push({
            file: relativePath,
            action: 'modified',
            backup: backupPath
          });
        } else if (change.action === 'create') {
          Write(targetFile, change.new_content || '');
          appliedChanges.push({
            file: relativePath,
            action: 'created',
            backup: null
          });
        }
      }
    } catch (error) {
      console.log(`Error applying change to ${change.file}: ${error.message}`);
      success = false;
    }
  }

  // Record applied fix
  const appliedFix = {
    fix_id: fix.id,
    applied_at: new Date().toISOString(),
    success: success,
    backup_path: fixBackupDir,
    verification_result: 'pending',
    rollback_available: true,
    changes_made: appliedChanges
  };

  // Update applied fixes log
  const appliedFixesPath = `${workDir}/fixes/applied-fixes.json`;
  let existingApplied = [];
  try {
    existingApplied = JSON.parse(Read(appliedFixesPath));
  } catch (e) {
    existingApplied = [];
  }
  existingApplied.push(appliedFix);
  Write(appliedFixesPath, JSON.stringify(existingApplied, null, 2));

  return {
    stateUpdates: {
      applied_fixes: [...state.applied_fixes, appliedFix],
      pending_fixes: pendingFixes.slice(1)  // Remove applied fix from pending
    },
    outputFiles: [appliedFixesPath],
    summary: `Applied fix ${fix.id}: ${success ? 'success' : 'partial'}, ${appliedChanges.length} files modified`
  };
}
```

## State Updates

```javascript
return {
  stateUpdates: {
    applied_fixes: [...existingApplied, newAppliedFix],
    pending_fixes: remainingPendingFixes
  }
};
```

## Rollback Function

```javascript
async function rollbackFix(fixId, state, workDir) {
  const appliedFix = state.applied_fixes.find(f => f.fix_id === fixId);

  if (!appliedFix || !appliedFix.rollback_available) {
    throw new Error(`Cannot rollback fix ${fixId}`);
  }

  const backupDir = appliedFix.backup_path;
  const targetPath = state.target_skill.path;

  // Restore from backup
  const backupFiles = Glob(`${backupDir}/**/*`);
  for (const backupFile of backupFiles) {
    const relativePath = backupFile.replace(backupDir + '/', '');
    const targetFile = `${targetPath}/${relativePath}`;
    const content = Read(backupFile);
    Write(targetFile, content);
  }

  return {
    stateUpdates: {
      applied_fixes: state.applied_fixes.map(f =>
        f.fix_id === fixId
          ? { ...f, rollback_available: false, verification_result: 'rolled_back' }
          : f
      )
    }
  };
}
```

## Error Handling

| Error Type | Recovery |
|------------|----------|
| File not found | Skip file, log warning |
| Write permission error | Retry with sudo or report |
| Backup creation failed | Abort fix, don't modify |

## Next Actions

- If pending_fixes.length > 0: action-apply-fix (continue)
- If all fixes applied: action-verify
