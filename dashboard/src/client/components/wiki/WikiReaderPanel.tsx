import { useMemo } from 'react';
import { useWikiStore } from '@/client/store/wiki-store.js';
import { preprocessWikilinks } from './WikiLink.js';
import { ReaderView } from '@/client/components/artifacts/ReaderView.js';

/** Strip leading markdown heading markers from text. */
function cleanSummary(s: string): string {
  return s.replace(/^#{1,6}\s+/, '').trim();
}

/**
 * WikiReaderPanel — reuses the shared ReaderView component (header bar +
 * ContentRenderer + MetaPanel with outline/TOC). Composes the entry's
 * markdown body with wiki-specific context (type/status, backlinks, metadata)
 * into a single content string.
 */
export function WikiReaderPanel() {
  const selectedId = useWikiStore((s) => s.selectedId);
  const byId = useWikiStore((s) => s.byId);
  const backlinksCache = useWikiStore((s) => s.backlinksCache);
  const setSelected = useWikiStore((s) => s.setSelected);

  const entry = selectedId ? byId[selectedId] : undefined;
  const backlinks = selectedId ? backlinksCache[selectedId] ?? [] : [];

  // Compose full markdown content from wiki entry fields
  const content = useMemo(() => {
    if (!entry) return null;

    const parts: string[] = [];

    // Summary line
    if (entry.summary) {
      parts.push(`> ${cleanSummary(entry.summary)}`);
      parts.push('');
    }

    // Tags
    if (entry.tags.length > 0) {
      parts.push(entry.tags.map((t) => `\`${t}\``).join(' '));
      parts.push('');
    }

    // Category
    if (entry.category) {
      parts.push(`**Category:** ${entry.category}`);
      parts.push('');
    }

    parts.push('---');
    parts.push('');

    // Body (markdown, for file entries)
    if (entry.body && entry.source.kind === 'file') {
      parts.push(preprocessWikilinks(entry.body));
      parts.push('');
    }

    // Raw JSONL (for virtual entries)
    if (entry.source.kind === 'virtual' && entry.raw !== undefined) {
      parts.push('## Raw');
      parts.push('```json');
      parts.push(JSON.stringify(entry.raw, null, 2));
      parts.push('```');
      parts.push('');
    }

    // Extra frontmatter fields
    if (Object.keys(entry.ext).length > 0) {
      parts.push('## Metadata');
      parts.push('```json');
      parts.push(JSON.stringify(entry.ext, null, 2));
      parts.push('```');
      parts.push('');
    }

    // Backlinks
    if (backlinks.length > 0) {
      parts.push(`## Backlinks (${backlinks.length})`);
      for (const b of backlinks) {
        parts.push(`- **${b.title}** _${b.type}_`);
      }
      parts.push('');
    }

    return parts.join('\n');
  }, [entry, backlinks]);

  if (!selectedId) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-[length:var(--font-size-sm)]">
        Select an entry
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="p-4 text-text-tertiary text-[length:var(--font-size-sm)]">
        Entry not found.
      </div>
    );
  }

  // Build a virtual path for the header bar display
  const displayPath = entry.source.path + (entry.source.line !== undefined ? `:${entry.source.line}` : '');

  return (
    <ReaderView
      content={content}
      path={displayPath}
      onNavigate={() => {}}
      loading={false}
      error={null}
      title={entry.title}
      subtitle={`${entry.type.toUpperCase()} · ${entry.status.toUpperCase()}`}
    />
  );
}
