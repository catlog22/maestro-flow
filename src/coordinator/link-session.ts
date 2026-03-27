// ---------------------------------------------------------------------------
// LinkSession — Dynamic chain editing on a mutable graph copy.
// Supports add/remove/modify of command nodes for interactive coordination.
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import type {
  ChainGraph,
  CommandNode,
  GraphNode,
  LinkUpcomingStep,
} from './graph-types.js';

export class LinkSession {
  constructor(private readonly graph: ChainGraph) {}

  /**
   * Insert a new command node after the given node.
   * Returns the generated node_id.
   */
  addNode(afterNodeId: string, cmd: string, args?: string): string {
    const afterNode = this.graph.nodes[afterNodeId];
    if (!afterNode) throw new Error(`Node not found: ${afterNodeId}`);

    const nextTarget = this.getNextTarget(afterNode);
    if (!nextTarget) throw new Error(`Cannot insert after non-linear node: ${afterNodeId}`);

    const newId = `link-${cmd}-${randomBytes(2).toString('hex')}`;
    const newNode: CommandNode = {
      type: 'command',
      cmd,
      args: args ?? '',
      next: nextTarget,
    };

    this.graph.nodes[newId] = newNode;
    this.setNextTarget(afterNode, newId);

    return newId;
  }

  /**
   * Remove a node, reconnecting its predecessor to its successor.
   */
  removeNode(nodeId: string): void {
    const node = this.graph.nodes[nodeId];
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    if (node.type === 'terminal') throw new Error('Cannot remove terminal node');

    const successor = this.getNextTarget(node);
    if (!successor) throw new Error(`Cannot remove non-linear node: ${nodeId}`);

    // Find predecessor(s) and repoint
    const predecessors = this.findPredecessors(nodeId);
    if (predecessors.length === 0 && this.graph.entry === nodeId) {
      this.graph.entry = successor;
    }

    for (const predId of predecessors) {
      const predNode = this.graph.nodes[predId];
      if (predNode) this.retarget(predNode, nodeId, successor);
    }

    delete this.graph.nodes[nodeId];
  }

  /**
   * Modify the args of a command node.
   */
  modifyArgs(nodeId: string, newArgs: string): void {
    const node = this.graph.nodes[nodeId];
    if (!node || node.type !== 'command') {
      throw new Error(`Node ${nodeId} is not a command node`);
    }
    node.args = newArgs;
  }

  /**
   * Trace forward from startNode, collecting command nodes along the default path.
   */
  traceCommandPath(startNode: string): LinkUpcomingStep[] {
    const steps: LinkUpcomingStep[] = [];
    const seen = new Set<string>();
    let current: string | null = startNode;

    while (current && !seen.has(current)) {
      seen.add(current);
      const node = this.graph.nodes[current];
      if (!node) break;

      if (node.type === 'command') {
        steps.push({
          node_id: current,
          cmd: node.cmd,
          args_template: node.args ?? '',
          description: node.description,
        });
      }

      if (node.type === 'terminal') break;
      current = this.getNextTarget(node);
    }

    return steps;
  }

  getGraph(): ChainGraph {
    return this.graph;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getNextTarget(node: GraphNode): string | null {
    switch (node.type) {
      case 'command': return node.next;
      case 'eval': return node.next;
      case 'join': return node.next;
      case 'gate': return node.on_pass; // default path
      case 'decision': {
        const def = node.edges.find(e => e.default);
        return def?.target ?? node.edges[0]?.target ?? null;
      }
      case 'fork': return node.join;
      case 'terminal': return null;
    }
  }

  private setNextTarget(node: GraphNode, target: string): void {
    switch (node.type) {
      case 'command': node.next = target; break;
      case 'eval': node.next = target; break;
      case 'join': node.next = target; break;
      default: break; // gate/decision/fork: more complex, not supported for direct set
    }
  }

  private retarget(node: GraphNode, oldTarget: string, newTarget: string): void {
    switch (node.type) {
      case 'command':
        if (node.next === oldTarget) node.next = newTarget;
        if (node.on_failure === oldTarget) node.on_failure = newTarget;
        break;
      case 'eval':
        if (node.next === oldTarget) node.next = newTarget;
        break;
      case 'join':
        if (node.next === oldTarget) node.next = newTarget;
        break;
      case 'gate':
        if (node.on_pass === oldTarget) node.on_pass = newTarget;
        if (node.on_fail === oldTarget) node.on_fail = newTarget;
        break;
      case 'decision':
        for (const edge of node.edges) {
          if (edge.target === oldTarget) edge.target = newTarget;
        }
        break;
      case 'fork':
        node.branches = node.branches.map(b => b === oldTarget ? newTarget : b);
        if (node.join === oldTarget) node.join = newTarget;
        break;
      case 'terminal':
        break;
    }
  }

  private findPredecessors(nodeId: string): string[] {
    const preds: string[] = [];
    for (const [id, node] of Object.entries(this.graph.nodes)) {
      if (id === nodeId) continue;
      if (this.referencesTarget(node, nodeId)) preds.push(id);
    }
    return preds;
  }

  private referencesTarget(node: GraphNode, target: string): boolean {
    switch (node.type) {
      case 'command':
        return node.next === target || node.on_failure === target;
      case 'eval':
      case 'join':
        return node.next === target;
      case 'gate':
        return node.on_pass === target || node.on_fail === target;
      case 'decision':
        return node.edges.some(e => e.target === target);
      case 'fork':
        return node.branches.includes(target) || node.join === target;
      case 'terminal':
        return false;
    }
  }
}
