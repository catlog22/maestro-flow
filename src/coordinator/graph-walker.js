// Graph Walker — State machine that traverses ChainGraph nodes autonomously.
import { writeFileSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
export class GraphWalker {
    loader;
    assembler;
    executor;
    analyzer;
    outputParser;
    evaluator;
    emitter;
    sessionDir;
    activeState = null;
    constructor(loader, assembler, executor, analyzer, outputParser, evaluator, emitter, sessionDir) {
        this.loader = loader;
        this.assembler = assembler;
        this.executor = executor;
        this.analyzer = analyzer;
        this.outputParser = outputParser;
        this.evaluator = evaluator;
        this.emitter = emitter;
        this.sessionDir = sessionDir;
    }
    async start(graphId, intent, options) {
        const sessionId = `coord-${Date.now()}-${randomBytes(2).toString('hex')}`;
        const graph = await this.loader.load(graphId);
        const ctx = this.buildInitialContext(options);
        const state = {
            session_id: sessionId,
            graph_id: graphId,
            current_node: graph.entry,
            status: 'running',
            context: ctx,
            history: [],
            fork_state: null,
            delegate_stack: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            tool: options.tool,
            auto_mode: options.autoMode,
            step_mode: options.stepMode ?? false,
            intent,
        };
        state.context.inputs['intent'] = intent;
        if (options.inputs)
            Object.assign(state.context.inputs, options.inputs);
        this.activeState = state;
        this.emit({ type: 'walker:started', session_id: sessionId, graph_id: graphId, intent });
        if (options.dryRun)
            return this.dryRunWalk(state, graph);
        return this.walkGraph(state, graph);
    }
    async resume(sessionId) {
        const state = this.loadState(sessionId);
        this.activeState = state;
        const graph = await this.loader.load(state.graph_id);
        state.status = 'running';
        return this.walkGraph(state, graph);
    }
    /** Load session state without executing — for status queries. */
    getState(sessionId) {
        return this.loadState(sessionId);
    }
    /** Continue a step_paused session — execute next command node, then pause again. */
    async next(sessionId) {
        const state = this.loadState(sessionId);
        if (state.status !== 'step_paused') {
            throw new Error(`Cannot advance: session status is '${state.status}', expected 'step_paused'`);
        }
        this.activeState = state;
        state.status = 'running';
        const graph = await this.loader.load(state.graph_id);
        return this.walkGraph(state, graph);
    }
    async stop() {
        await this.executor.abort();
        if (this.activeState) {
            this.activeState.status = 'paused';
            this.activeState.updated_at = new Date().toISOString();
            this.save(this.activeState);
        }
    }
    async walkGraph(state, graph) {
        this.activeState = state;
        await this.walk(state, graph);
        return state;
    }
    async walk(state, graph) {
        while (state.status === 'running') {
            const nodeId = state.current_node;
            const node = graph.nodes[nodeId];
            if (!node) {
                state.status = 'failed';
                this.emit({ type: 'walker:error', session_id: state.session_id, error: `Node not found: ${nodeId}` });
                break;
            }
            // Visit count guard
            const maxVisits = node.max_visits ?? graph.defaults?.max_visits ?? 10;
            const currentVisits = state.context.visits[nodeId] ?? 0;
            if (currentVisits >= maxVisits) {
                const cmdNode = node;
                if (node.type === 'command' && cmdNode.on_failure) {
                    state.current_node = cmdNode.on_failure;
                    continue;
                }
                state.status = 'failed';
                this.emit({ type: 'walker:error', session_id: state.session_id, error: `Max visits (${maxVisits}) exceeded for ${nodeId}` });
                break;
            }
            // Record visit
            state.context.visits[nodeId] = currentVisits + 1;
            const entry = {
                node_id: nodeId,
                node_type: node.type,
                entered_at: new Date().toISOString(),
            };
            state.history.push(entry);
            this.emit({ type: 'walker:node_enter', session_id: state.session_id, node_id: nodeId, node_type: node.type });
            // Dispatch by type
            switch (node.type) {
                case 'command':
                    await this.handleCommand(state, graph, nodeId, node, entry);
                    break;
                case 'decision':
                    this.handleDecision(state, nodeId, node);
                    break;
                case 'gate':
                    this.handleGate(state, node, entry);
                    break;
                case 'eval':
                    this.handleEval(state, node);
                    break;
                case 'fork':
                    await this.handleFork(state, graph, node);
                    break;
                case 'join':
                    this.handleJoin(state, node);
                    break;
                case 'terminal':
                    await this.handleTerminal(state, graph, nodeId, node);
                    break;
            }
            entry.exited_at = new Date().toISOString();
            this.emit({ type: 'walker:node_exit', session_id: state.session_id, node_id: nodeId, outcome: entry.outcome ?? 'success' });
            // Step mode: pause after each command node execution
            if (state.step_mode && node.type === 'command' && state.status === 'running') {
                state.status = 'step_paused';
            }
            state.updated_at = new Date().toISOString();
            this.save(state);
            if (state.status === 'step_paused')
                break;
            // Bail if status changed to non-running (waiting, paused, completed, failed)
            if (state.status !== 'running')
                break;
        }
    }
    async handleCommand(state, graph, nodeId, node, entry) {
        const prevCmd = this.findPreviousCommand(state);
        const cmdIndex = this.countCommandsBefore(state, nodeId) + 1;
        const cmdTotal = this.countCommandNodes(graph);
        const assembleReq = {
            node,
            node_id: nodeId,
            context: state.context,
            graph: { id: graph.id, name: graph.name },
            command_index: cmdIndex,
            command_total: cmdTotal,
            auto_mode: state.auto_mode,
            previous_command: prevCmd,
        };
        const prompt = await this.assembler.assemble(assembleReq);
        state.status = 'waiting_command';
        this.save(state);
        this.emit({ type: 'walker:command', session_id: state.session_id, node_id: nodeId, cmd: node.cmd, status: 'spawned' });
        const execResult = await this.executor.execute({
            prompt,
            agent_type: state.tool || 'claude',
            work_dir: state.context.inputs['workflowRoot'] ?? '.',
            approval_mode: state.auto_mode ? 'auto' : 'suggest',
            timeout_ms: node.timeout_ms ?? graph.defaults?.timeout_ms ?? 300000,
            node_id: nodeId,
            cmd: node.cmd,
        });
        const parsed = this.outputParser.parse(execResult.raw_output, node);
        state.context.result = parsed.structured;
        // Analyze if applicable
        let analysis = null;
        const shouldAnalyze = node.analyze !== false
            && (graph.defaults?.analyze !== false)
            && this.countCommandNodes(graph) > 1
            && this.analyzer !== null;
        if (shouldAnalyze && this.analyzer) {
            const analysisResult = await this.analyzer.analyze(node, execResult.raw_output, state.context, prevCmd);
            state.context.analysis = analysisResult;
            analysis = analysisResult;
        }
        else {
            state.context.analysis = null;
        }
        entry.exec_id = execResult.exec_id;
        entry.quality_score = analysis ? analysis.quality_score : undefined;
        entry.summary = parsed.structured.summary || undefined;
        if (execResult.success && parsed.structured.status === 'SUCCESS') {
            entry.outcome = 'success';
            state.current_node = node.next;
            state.status = 'running';
            this.emit({ type: 'walker:command', session_id: state.session_id, node_id: nodeId, cmd: node.cmd, status: 'completed' });
        }
        else {
            entry.outcome = 'failure';
            if (node.on_failure) {
                state.current_node = node.on_failure;
                state.status = 'running';
            }
            else {
                state.status = 'failed';
            }
            this.emit({ type: 'walker:command', session_id: state.session_id, node_id: nodeId, cmd: node.cmd, status: 'failed' });
        }
    }
    handleDecision(state, nodeId, node) {
        const strategy = node.strategy ?? 'expr';
        if (strategy === 'llm') {
            // LLM strategy: fallback to first default edge
            const defaultEdge = node.edges.find(e => e.default);
            if (defaultEdge) {
                state.current_node = defaultEdge.target;
            }
            else {
                state.status = 'failed';
            }
            return;
        }
        // expr strategy
        const resolvedValue = node.eval ? this.evaluator.resolve(node.eval, state.context) : undefined;
        let matched = false;
        for (const edge of node.edges) {
            if (this.evaluator.match(edge, resolvedValue, state.context)) {
                state.current_node = edge.target;
                matched = true;
                this.emit({ type: 'walker:decision', session_id: state.session_id, node_id: nodeId, resolved_value: resolvedValue, target: edge.target });
                break;
            }
        }
        if (!matched) {
            state.status = 'failed';
            this.emit({ type: 'walker:error', session_id: state.session_id, error: `No matching edge in decision ${nodeId}` });
        }
    }
    handleGate(state, node, entry) {
        const passed = this.evaluator.evaluate(node.condition, state.context);
        if (passed) {
            state.current_node = node.on_pass;
            entry.outcome = 'success';
        }
        else if (node.wait) {
            state.status = 'waiting_gate';
            entry.outcome = 'skipped';
            this.save(state);
        }
        else {
            state.current_node = node.on_fail;
            entry.outcome = 'failure';
        }
    }
    handleEval(state, node) {
        for (const [key, expr] of Object.entries(node.set)) {
            const value = this.evaluator.resolve(expr, state.context);
            this.setContextValue(state.context, key, value);
        }
        state.current_node = node.next;
    }
    async handleFork(state, graph, node) {
        // Sequential fallback (Phase 5 will add true parallelism)
        for (const branch of node.branches) {
            const branchNode = graph.nodes[branch];
            if (branchNode) {
                // Simple: just visit each branch entry sequentially via walk
                // For now, just record we visited it
                state.context.visits[branch] = (state.context.visits[branch] ?? 0) + 1;
            }
        }
        state.current_node = node.join;
    }
    handleJoin(state, node) {
        // Sequential fallback: just proceed
        state.current_node = node.next;
    }
    async handleTerminal(state, graph, nodeId, node) {
        if (node.status === 'delegate' && node.delegate_graph) {
            // Push current frame
            state.delegate_stack.push({
                parent_graph_id: state.graph_id,
                parent_node_id: nodeId,
                return_inputs: { ...state.context.inputs },
            });
            this.emit({ type: 'walker:delegate', session_id: state.session_id, from_graph: state.graph_id, to_graph: node.delegate_graph });
            const newGraph = await this.loader.load(node.delegate_graph);
            // Merge delegate_inputs
            if (node.delegate_inputs) {
                for (const [key, tmpl] of Object.entries(node.delegate_inputs)) {
                    state.context.inputs[key] = this.resolveTemplate(tmpl, state.context);
                }
            }
            state.graph_id = node.delegate_graph;
            state.current_node = newGraph.entry;
            await this.walk(state, newGraph);
            // After delegate completes, pop frame and return to parent
            if (state.delegate_stack.length > 0 && (state.status === 'completed' || state.status === 'failed')) {
                const frame = state.delegate_stack.pop();
                state.graph_id = frame.parent_graph_id;
                Object.assign(state.context.inputs, frame.return_inputs);
            }
            return;
        }
        // Non-delegate terminal
        if (node.status === 'success') {
            if (state.delegate_stack.length > 0) {
                const frame = state.delegate_stack.pop();
                state.graph_id = frame.parent_graph_id;
                Object.assign(state.context.inputs, frame.return_inputs);
                state.status = 'completed';
            }
            else {
                state.status = 'completed';
            }
        }
        else if (node.status === 'failure') {
            state.status = 'failed';
        }
        else if (node.status === 'paused') {
            state.status = 'paused';
        }
        const historySummary = state.history
            .filter(h => h.summary)
            .map(h => `${h.node_id}: ${h.summary}`);
        this.emit({
            type: 'walker:completed',
            session_id: state.session_id,
            status: state.status === 'completed' ? 'success' : 'failure',
            history_summary: historySummary,
        });
    }
    countCommandNodes(graph) {
        return Object.values(graph.nodes).filter(n => n.type === 'command').length;
    }
    countCommandsBefore(state, _nodeId) {
        const seen = new Set();
        for (const entry of state.history) {
            if (entry.node_type === 'command')
                seen.add(entry.node_id);
        }
        seen.delete(_nodeId);
        return seen.size;
    }
    findPreviousCommand(state) {
        for (let i = state.history.length - 1; i >= 0; i--) {
            const h = state.history[i];
            if (h.node_type === 'command' && h.outcome) {
                return {
                    node_id: h.node_id,
                    cmd: h.node_id,
                    outcome: h.outcome === 'skipped' ? 'failure' : h.outcome,
                    summary: h.summary,
                };
            }
        }
        return undefined;
    }
    setContextValue(ctx, path, value) {
        const parts = path.split('.');
        if (parts.length === 1) {
            ctx.var[parts[0]] = value;
            return;
        }
        const root = parts[0];
        const rest = parts.slice(1);
        let target;
        switch (root) {
            case 'inputs':
                target = ctx.inputs;
                break;
            case 'var':
                target = ctx.var;
                break;
            case 'result':
                target = (ctx.result ?? {});
                ctx.result = target;
                break;
            default:
                target = ctx.var;
                rest.unshift(root);
                break;
        }
        for (let i = 0; i < rest.length - 1; i++) {
            const key = rest[i];
            if (!(key in target) || typeof target[key] !== 'object' || target[key] === null) {
                target[key] = {};
            }
            target = target[key];
        }
        target[rest[rest.length - 1]] = value;
    }
    resolveTemplate(template, ctx) {
        return template.replace(/\{([^}]+)\}/g, (_match, key) => {
            const value = this.evaluator.resolve(key.trim(), ctx);
            return value !== undefined ? String(value) : `{${key}}`;
        });
    }
    buildInitialContext(options) {
        let project = {
            initialized: false,
            current_phase: null,
            phase_status: 'pending',
            artifacts: {},
            execution: { tasks_completed: 0, tasks_total: 0 },
            verification_status: 'pending',
            review_verdict: null,
            uat_status: 'pending',
            phases_total: 0,
            phases_completed: 0,
            accumulated_context: null,
        };
        try {
            const stateFile = join(options.workflowRoot, '.workflow', 'state.json');
            const raw = JSON.parse(readFileSync(stateFile, 'utf-8'));
            if (raw && typeof raw === 'object') {
                project = { ...project, ...raw, initialized: true };
            }
        }
        catch { /* no state file */ }
        return {
            inputs: {
                workflowRoot: options.workflowRoot,
                phase: project.current_phase != null ? String(project.current_phase) : '',
            },
            project,
            result: null,
            analysis: null,
            visits: {},
            var: {},
        };
    }
    save(state) {
        if (!this.sessionDir)
            return;
        try {
            const dir = join(this.sessionDir, state.session_id);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'walker-state.json'), JSON.stringify(state, null, 2), 'utf-8');
        }
        catch { /* best-effort */ }
    }
    loadState(sessionId) {
        if (!this.sessionDir)
            throw new Error('No sessionDir configured for resume');
        if (sessionId) {
            const filePath = join(this.sessionDir, sessionId, 'walker-state.json');
            try {
                return JSON.parse(readFileSync(filePath, 'utf-8'));
            }
            catch {
                throw new Error(`Session not found: ${sessionId} (expected ${filePath})`);
            }
        }
        let entries;
        try {
            entries = readdirSync(this.sessionDir, { withFileTypes: true });
        }
        catch {
            throw new Error(`No sessions directory at ${this.sessionDir}`);
        }
        const dirs = entries
            .filter(e => e.isDirectory() && e.name.startsWith('coord-'))
            .map(e => e.name)
            .sort()
            .reverse();
        if (dirs.length === 0)
            throw new Error('No walker sessions found');
        const filePath = join(this.sessionDir, dirs[0], 'walker-state.json');
        return JSON.parse(readFileSync(filePath, 'utf-8'));
    }
    dryRunWalk(state, graph) {
        const visited = [];
        let current = state.current_node;
        const seen = new Set();
        while (current && !seen.has(current)) {
            seen.add(current);
            const node = graph.nodes[current];
            if (!node)
                break;
            visited.push(`${current} (${node.type})`);
            switch (node.type) {
                case 'command':
                    current = node.next;
                    break;
                case 'decision':
                    current = node.edges[0]?.target ?? '';
                    break;
                case 'gate':
                    current = node.on_pass;
                    break;
                case 'eval':
                    current = node.next;
                    break;
                case 'fork':
                    current = node.join;
                    break;
                case 'join':
                    current = node.next;
                    break;
                case 'terminal':
                    current = '';
                    break;
            }
        }
        state.status = 'completed';
        state.context.var['dry_run_plan'] = visited;
        return state;
    }
    emit(event) {
        this.emitter?.emit(event);
    }
}
//# sourceMappingURL=graph-walker.js.map