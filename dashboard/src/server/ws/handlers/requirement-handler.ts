import type { WebSocket } from 'ws';

import type { WsHandler } from '../ws-handler.js';
import type { WsEventType } from '../../../shared/ws-protocol.js';
import type { RequirementExpander } from '../../requirement/requirement-expander.js';
import type { ExpansionDepth } from '../../../shared/requirement-types.js';

// ---------------------------------------------------------------------------
// RequirementWsHandler — requirement:expand, requirement:refine,
//                         requirement:commit
// ---------------------------------------------------------------------------

export class RequirementWsHandler implements WsHandler {
  readonly actions = [
    'requirement:expand',
    'requirement:refine',
    'requirement:commit',
  ] as const;

  constructor(private readonly requirementExpander: RequirementExpander) {}

  async handle(
    action: string,
    data: unknown,
    _ws: WebSocket,
    broadcast: (type: WsEventType, data: unknown) => void,
  ): Promise<void> {
    const msg = data as Record<string, unknown>;

    switch (action) {
      case 'requirement:expand': {
        const requirement = await this.requirementExpander.expand(
          msg.text as string,
          msg.depth as ExpansionDepth | undefined,
          msg.method as 'sdk' | 'cli' | undefined,
          msg.previousRequirementId as string | undefined,
        );
        broadcast('requirement:expanded', { requirement });
        break;
      }

      case 'requirement:refine': {
        const requirement = await this.requirementExpander.refine(
          msg.requirementId as string,
          msg.feedback as string,
        );
        broadcast('requirement:expanded', { requirement });
        break;
      }

      case 'requirement:commit': {
        if (msg.mode === 'issues') {
          const issueIds = await this.requirementExpander.commitAsIssues(
            msg.requirementId as string,
          );
          broadcast('requirement:committed', {
            requirementId: msg.requirementId,
            mode: 'issues',
            issueIds,
          });
        } else {
          const coordinateSessionId = await this.requirementExpander.commitAsCoordinate(
            msg.requirementId as string,
          );
          broadcast('requirement:committed', {
            requirementId: msg.requirementId,
            mode: 'coordinate',
            coordinateSessionId,
          });
        }
        break;
      }
    }
  }
}
