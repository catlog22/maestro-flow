import type { ReactNode } from 'react';
import { File, Zap } from 'lucide-react';
import type { UserMessageEntry } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// UserMessage -- right-aligned chat bubble for user input
// ---------------------------------------------------------------------------

const SLASH_RE = /^(\/[a-zA-Z0-9_-]+)\s*/;
const FILE_REF_RE = /@([\w./\\-]+\.\w+)/g;

function renderFileRefs(text: string): ReactNode[] | string {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(FILE_REF_RE);
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const filename = match[1];
    parts.push(
      <span
        key={match.index}
        className="inline-flex items-center gap-[3px] mx-[2px] px-[6px] py-[1px] rounded-[5px] text-[11px] font-mono align-middle"
        style={{ backgroundColor: 'var(--color-tint-exploring)', color: 'var(--color-accent-blue)' }}
      >
        <File size={10} strokeWidth={2} />
        {filename.split(/[\\/]/).pop()}
      </span>,
    );
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

export function UserMessage({ entry }: { entry: UserMessageEntry }) {
  const match = entry.content.match(SLASH_RE);
  const command = match?.[1];
  const body = match ? entry.content.slice(match[0].length) : entry.content;

  return (
    <div className="flex justify-end" style={{ paddingTop: 6, paddingBottom: 6 }}>
      <div
        className="max-w-[75%] px-[14px] py-[10px] text-[13px] leading-[1.6] whitespace-pre-wrap break-words rounded-[14px]"
        style={{
          backgroundColor: 'var(--color-tint-exploring)',
          color: 'var(--color-text-primary)',
          borderBottomRightRadius: '4px',
        }}
      >
        {command && (
          <span
            className="inline-flex items-center gap-[4px] mr-[6px] px-[7px] py-[1px] rounded-[6px] text-[11px] font-semibold align-middle"
            style={{ backgroundColor: 'var(--color-tint-planning)', color: 'var(--color-accent-purple)' }}
          >
            <Zap size={10} strokeWidth={2} />
            {command}
          </span>
        )}
        {renderFileRefs(body)}
      </div>
    </div>
  );
}
