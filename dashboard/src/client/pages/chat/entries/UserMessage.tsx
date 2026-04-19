import type { ReactNode } from 'react';
import { File, Zap } from 'lucide-react';
import type { UserMessageEntry } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// UserMessage -- left-aligned message with blue "U" avatar (matches chat.html)
// ---------------------------------------------------------------------------

const SLASH_RE = /^(\/[a-zA-Z0-9_-]+)\s*/;
const FILE_REF_RE = /@([\w./\\-]+\.\w+)/g;

function formatMsgTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

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
    <div className="flex gap-[8px]" style={{ paddingTop: 10, paddingBottom: 10 }}>
      {/* User avatar */}
      <div
        className="shrink-0 w-6 h-6 rounded-[6px] flex items-center justify-center mt-[2px] text-[10px] font-bold"
        style={{ backgroundColor: 'var(--color-tint-exploring)', color: 'var(--color-accent-blue)' }}
      >
        U
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {/* Header: name + timestamp */}
        <div className="flex items-center gap-[5px] mb-[2px]">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            You
          </span>
          <span className="text-[9px]" style={{ color: 'var(--color-text-placeholder)' }}>
            {formatMsgTime(entry.timestamp)}
          </span>
        </div>
        <div className="text-[13px] leading-[1.6] whitespace-pre-wrap break-words" style={{ color: 'var(--color-text-primary)' }}>
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
    </div>
  );
}
