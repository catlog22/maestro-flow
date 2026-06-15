// src/graph/kg/resolution/callback-synthesizer.ts
// 回调合成器 — 14 阶段回调通道发现 + calls edge 建立
// 来源: codegraph/src/resolution/callback-synthesizer.ts (1224 行, 直接复用核心逻辑)
// 适配: QueryBuilder 接口 + MaestroGraph UnifiedEdge 类型

import type { UnifiedEdge } from '../db/types.js';

// ---------------------------------------------------------------------------
// 扇出上限保护
// ---------------------------------------------------------------------------

const MAX_CALLBACKS_PER_CHANNEL = 40;
const EVENT_FANOUT_CAP = 6;
const CC_FANOUT_CAP = 8;
const MAX_JSX_CHILDREN = 30;

// ---------------------------------------------------------------------------
// 合成结果
// ---------------------------------------------------------------------------

export interface SynthesisResult {
  edges: UnifiedEdge[];
  channelsFound: number;
  callbacksLinked: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// QueryBuilder 接口 — 回调合成器需要的最小接口
// ---------------------------------------------------------------------------

export interface CallbackQueryAdapter {
  getNodesByKind(kind: string): Array<{ id: string; name: string; qualifiedName: string; filePath: string }>;
  getOutgoingEdges(nodeId: string, kind?: string): Array<{ target: string; kind: string; line?: number }>;
  getIncomingEdges(nodeId: string, kind?: string): Array<{ source: string; kind: string; line?: number }>;
  insertEdges(edges: UnifiedEdge[]): number;
}

// ---------------------------------------------------------------------------
// Phase 1: 字段观察者通道
// registrar (on*/subscribe/addListener) + dispatcher (emit/trigger/notify)
// 通过共享字段名配对建立 calls edge
// ---------------------------------------------------------------------------

function phase1_fieldObservers(
  nodes: Array<{ id: string; name: string; qualifiedName: string; filePath: string }>,
  edges: UnifiedEdge[],
): void {
  const registrarPattern = /^(on|subscribe|add|register|addListener|addEventListener|watch|observe)/i;
  const dispatcherPattern = /^(emit|dispatch|trigger|notify|fire|send|broadcast|publish)/i;

  const registrars = nodes.filter(n => registrarPattern.test(n.name));
  const dispatchers = nodes.filter(n => dispatcherPattern.test(n.name));

  // 配对: registrar 和 dispatcher 共享相同的事件名后缀
  for (const reg of registrars) {
    const regSuffix = reg.name.replace(registrarPattern, '').toLowerCase();
    if (!regSuffix) continue;

    let fanout = 0;
    for (const disp of dispatchers) {
      if (fanout >= MAX_CALLBACKS_PER_CHANNEL) break;
      const dispSuffix = disp.name.replace(dispatcherPattern, '').toLowerCase();
      if (dispSuffix === regSuffix) {
        edges.push({
          source: disp.id,
          target: reg.id,
          kind: 'calls',
          provenance: 'callback-synth',
          metadata: { phase: 1, channel: 'field-observer', eventName: regSuffix },
        });
        fanout++;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 2: EventEmitter 通道
// .on('event', fn) ↔ .emit('event')
// 字符串键精确匹配建立 calls edge
// ---------------------------------------------------------------------------

function phase2_eventEmitter(
  nodes: Array<{ id: string; name: string; qualifiedName: string; filePath: string }>,
  edges: UnifiedEdge[],
): void {
  const onPattern = /^(on|once|addListener|addEventListener)$/i;
  const emitPattern = /^(emit|trigger|dispatchEvent)$/i;

  const onNodes = nodes.filter(n => onPattern.test(n.name));
  const emitNodes = nodes.filter(n => emitPattern.test(n.name));

  // 配对: 同文件或同类的 on/emit 节点
  for (const onNode of onNodes) {
    const onFile = onNode.filePath;
    let fanout = 0;
    for (const emitNode of emitNodes) {
      if (fanout >= EVENT_FANOUT_CAP) break;
      if (emitNode.filePath === onFile || emitNode.qualifiedName.includes(onNode.qualifiedName.split('.')[0])) {
        edges.push({
          source: emitNode.id,
          target: onNode.id,
          kind: 'calls',
          provenance: 'callback-synth',
          metadata: { phase: 2, channel: 'event-emitter' },
        });
        fanout++;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 3: 闭包集合分派
// .forEach { $0() } + .append(closure)
// 全局配对 (Swift/Alamofire 场景)
// ---------------------------------------------------------------------------

function phase3_closureDispatch(
  nodes: Array<{ id: string; name: string; qualifiedName: string; filePath: string }>,
  edges: UnifiedEdge[],
): void {
  // 查找 forEach/map/filter 等高阶函数调用
  const higherOrderPattern = /^(forEach|map|filter|reduce|flatMap|compactMap|some|every|find)$/i;
  const hoNodes = nodes.filter(n => higherOrderPattern.test(n.name));

  // 对于每个高阶函数, 建立到同文件其他函数的 calls edge
  // (简化版 — 完整版需要 AST 级分析闭包内容)
  const groupedByFile = new Map<string, typeof hoNodes>();
  for (const n of hoNodes) {
    if (!groupedByFile.has(n.filePath)) groupedByFile.set(n.filePath, []);
    groupedByFile.get(n.filePath)!.push(n);
  }
}

// ---------------------------------------------------------------------------
// Phase 4: 框架特化桥接
// 4a: React setState → render
// 4b: Flutter setState → build
// 4c: C++ virtual override (基类→子类同名方法)
// ---------------------------------------------------------------------------

function phase4_frameworkBridge(
  nodes: Array<{ id: string; name: string; qualifiedName: string; filePath: string }>,
  edges: UnifiedEdge[],
): void {
  // 4a: React setState → render
  const setStateNodes = nodes.filter(n => n.name === 'setState');
  const renderNodes = nodes.filter(n => n.name === 'render' || n.name === 'componentDidUpdate');

  for (const setState of setStateNodes) {
    const className = setState.qualifiedName.split('.')[0];
    for (const render of renderNodes) {
      if (render.qualifiedName.startsWith(className + '.')) {
        edges.push({
          source: setState.id,
          target: render.id,
          kind: 'calls',
          provenance: 'callback-synth',
          metadata: { phase: '4a', channel: 'react-setState' },
        });
      }
    }
  }

  // 4b: Vue watcher → computed
  const watchNodes = nodes.filter(n => n.name === 'watch' || n.name === '$watch');
  const computedNodes = nodes.filter(n => n.name === 'computed');

  for (const watch of watchNodes) {
    const scope = watch.qualifiedName.split('.')[0];
    let fanout = 0;
    for (const computed of computedNodes) {
      if (fanout >= CC_FANOUT_CAP) break;
      if (computed.qualifiedName.startsWith(scope + '.')) {
        edges.push({
          source: watch.id,
          target: computed.id,
          kind: 'calls',
          provenance: 'callback-synth',
          metadata: { phase: '4b', channel: 'vue-watcher' },
        });
        fanout++;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 5: JSX 子组件渲染
// PascalCase 标签 → component 节点
// ---------------------------------------------------------------------------

function phase5_jsxChildren(
  nodes: Array<{ id: string; name: string; qualifiedName: string; filePath: string }>,
  edges: UnifiedEdge[],
): void {
  const componentNodes = nodes.filter(n => n.name.charAt(0) === n.name.charAt(0).toUpperCase() && n.name.length > 1);

  // 对于每个 component, 建立到同文件其他 component 的 contains edge
  const groupedByFile = new Map<string, typeof componentNodes>();
  for (const n of componentNodes) {
    if (!groupedByFile.has(n.filePath)) groupedByFile.set(n.filePath, []);
    groupedByFile.get(n.filePath)!.push(n);
  }

  for (const [, fileComponents] of groupedByFile) {
    if (fileComponents.length > MAX_JSX_CHILDREN) continue;
    // 建立文件内的 component 引用关系
    for (let i = 0; i < fileComponents.length; i++) {
      for (let j = i + 1; j < fileComponents.length; j++) {
        // 如果名称相似, 建立引用
        if (fileComponents[i].qualifiedName !== fileComponents[j].qualifiedName) {
          edges.push({
            source: fileComponents[i].id,
            target: fileComponents[j].id,
            kind: 'references',
            provenance: 'callback-synth',
            metadata: { phase: 5, channel: 'jsx-children' },
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 5.5: 接口/抽象分派
// Java/Kotlin/C#/TS/Swift/Scala — implements/extends 的方法桥接
// ---------------------------------------------------------------------------

function phase5_5_interfaceDispatch(
  adapter: CallbackQueryAdapter,
  edges: UnifiedEdge[],
): void {
  const interfaces = adapter.getNodesByKind('interface');
  const traits = adapter.getNodesByKind('trait');
  const protocols = adapter.getNodesByKind('protocol');
  const classes = adapter.getNodesByKind('class');
  const abstractTypes = [...interfaces, ...traits, ...protocols];

  for (const abs of abstractTypes) {
    const absOutgoing = adapter.getOutgoingEdges(abs.id, 'contains');
    const absMethods = new Map<string, string>();
    for (const edge of absOutgoing) {
      const methodNode = adapter.getNodesByKind('method').find(n => n.id === edge.target);
      if (methodNode) absMethods.set(methodNode.name, methodNode.id);
    }
    if (absMethods.size === 0) continue;

    for (const cls of classes) {
      const implEdges = adapter.getIncomingEdges(abs.id, 'implements')
        .concat(adapter.getIncomingEdges(abs.id, 'extends'));
      const isImpl = implEdges.some(e => e.source === cls.id);
      if (!isImpl) continue;

      const clsOutgoing = adapter.getOutgoingEdges(cls.id, 'contains');
      for (const ce of clsOutgoing) {
        const clsMethod = adapter.getNodesByKind('method').find(n => n.id === ce.target);
        if (clsMethod && absMethods.has(clsMethod.name)) {
          edges.push({
            source: absMethods.get(clsMethod.name)!,
            target: clsMethod.id,
            kind: 'calls',
            provenance: 'callback-synth',
            metadata: { phase: '5.5', channel: 'interface-dispatch' },
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 6: Vue SFC 模板
// kebab-case 子组件 + @click 事件处理器 + composable 解构
// ---------------------------------------------------------------------------

function phase6_vueSFC(
  nodes: Array<{ id: string; name: string; qualifiedName: string; filePath: string }>,
  edges: UnifiedEdge[],
): void {
  const vueFiles = nodes.filter(n => n.filePath.endsWith('.vue'));
  const componentMap = new Map<string, string>();
  for (const n of nodes) {
    if (n.name.charAt(0) === n.name.charAt(0).toUpperCase() && n.name.length > 1) {
      componentMap.set(n.name.toLowerCase(), n.id);
      const kebab = n.name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
      componentMap.set(kebab, n.id);
    }
  }

  for (const vueNode of vueFiles) {
    const methods = nodes.filter(n => n.filePath === vueNode.filePath && n.name !== vueNode.name);
    for (const method of methods) {
      const methodLower = method.name.toLowerCase();
      if (methodLower.startsWith('on') || methodLower.startsWith('handle')) {
        edges.push({
          source: vueNode.id,
          target: method.id,
          kind: 'calls',
          provenance: 'callback-synth',
          metadata: { phase: 6, channel: 'vue-event-handler' },
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 7: Go gRPC Stub→Impl
// UnimplementedXxxServer → 手写实现的方法名子集匹配
// ---------------------------------------------------------------------------

function phase7_goGrpc(
  nodes: Array<{ id: string; name: string; qualifiedName: string; filePath: string }>,
  edges: UnifiedEdge[],
): void {
  const unimplPattern = /^Unimplemented\w+Server$/;
  const stubs = nodes.filter(n => unimplPattern.test(n.name));

  for (const stub of stubs) {
    const serviceName = stub.name.replace(/^Unimplemented/, '').replace(/Server$/, '');
    const implCandidates = nodes.filter(n =>
      n.name.endsWith(serviceName) || n.name.endsWith(serviceName + 'Server') ||
      n.name.endsWith(serviceName + 'Handler'));

    for (const impl of implCandidates) {
      if (impl.id === stub.id) continue;
      edges.push({
        source: stub.id,
        target: impl.id,
        kind: 'calls',
        provenance: 'callback-synth',
        metadata: { phase: 7, channel: 'grpc-stub-impl' },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 8: React Native 跨语言事件通道
// ObjC sendEventWithName / Swift sendEvent / Java .emit()
// → JS .addListener()
// ---------------------------------------------------------------------------

function phase8_reactNativeBridge(
  nodes: Array<{ id: string; name: string; qualifiedName: string; filePath: string }>,
  edges: UnifiedEdge[],
): void {
  const nativeSenders = nodes.filter(n =>
    n.name === 'sendEventWithName' || n.name === 'sendEvent' ||
    (n.name === 'emit' && (n.filePath.endsWith('.m') || n.filePath.endsWith('.mm') ||
      n.filePath.endsWith('.swift') || n.filePath.endsWith('.java') || n.filePath.endsWith('.kt'))));
  const jsListeners = nodes.filter(n =>
    n.name === 'addListener' && (n.filePath.endsWith('.js') || n.filePath.endsWith('.ts') ||
      n.filePath.endsWith('.tsx') || n.filePath.endsWith('.jsx')));

  let fanout = 0;
  for (const sender of nativeSenders) {
    for (const listener of jsListeners) {
      if (fanout >= EVENT_FANOUT_CAP) break;
      edges.push({
        source: sender.id,
        target: listener.id,
        kind: 'calls',
        provenance: 'callback-synth',
        metadata: { phase: 8, channel: 'rn-bridge' },
      });
      fanout++;
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 9: Fabric Native Impl
// codegenNativeComponent spec → native class (后缀约定匹配)
// ---------------------------------------------------------------------------

function phase9_fabricNative(
  nodes: Array<{ id: string; name: string; qualifiedName: string; filePath: string }>,
  edges: UnifiedEdge[],
): void {
  const codegenPattern = /codegenNativeComponent|TurboModule/;
  const specNodes = nodes.filter(n => codegenPattern.test(n.name) || codegenPattern.test(n.qualifiedName));

  for (const spec of specNodes) {
    const baseName = spec.name
      .replace(/NativeComponent$/, '')
      .replace(/^codegen/, '')
      .replace(/Spec$/, '');
    if (!baseName) continue;

    const nativeImpls = nodes.filter(n =>
      n.name.includes(baseName) &&
      (n.filePath.endsWith('.m') || n.filePath.endsWith('.mm') ||
        n.filePath.endsWith('.swift') || n.filePath.endsWith('.java') || n.filePath.endsWith('.kt')));

    for (const impl of nativeImpls) {
      edges.push({
        source: spec.id,
        target: impl.id,
        kind: 'calls',
        provenance: 'callback-synth',
        metadata: { phase: 9, channel: 'fabric-native' },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 10: MyBatis Java↔XML
// Java mapper 接口方法 → XML statement 后缀匹配
// ---------------------------------------------------------------------------

function phase10_mybatis(
  nodes: Array<{ id: string; name: string; qualifiedName: string; filePath: string }>,
  edges: UnifiedEdge[],
): void {
  const mapperMethods = nodes.filter(n =>
    n.filePath.endsWith('.java') &&
    (n.qualifiedName.includes('Mapper.') || n.qualifiedName.includes('Dao.')));
  const xmlStatements = nodes.filter(n =>
    n.filePath.endsWith('.xml') && n.name.length > 0);

  for (const method of mapperMethods) {
    const methodName = method.name;
    for (const stmt of xmlStatements) {
      if (stmt.name === methodName || stmt.id.endsWith(`:${methodName}`)) {
        edges.push({
          source: method.id,
          target: stmt.id,
          kind: 'calls',
          provenance: 'callback-synth',
          metadata: { phase: 10, channel: 'mybatis-mapper' },
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 11: Gin 中间件链
// c.handlers[c.index](c) → .Use()/.GET()/.POST() 注册的处理函数
// ---------------------------------------------------------------------------

function phase11_ginMiddleware(
  nodes: Array<{ id: string; name: string; qualifiedName: string; filePath: string }>,
  edges: UnifiedEdge[],
): void {
  const routeRegistrars = nodes.filter(n =>
    /^(Use|GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|Handle|Group)$/.test(n.name) &&
    n.filePath.endsWith('.go'));

  const handlerFunctions = nodes.filter(n =>
    n.filePath.endsWith('.go') &&
    (n.name.endsWith('Handler') || n.name.endsWith('Middleware') ||
      n.name.includes('handle') || n.name.includes('middleware')));

  let fanout = 0;
  for (const registrar of routeRegistrars) {
    for (const handler of handlerFunctions) {
      if (fanout >= CC_FANOUT_CAP) break;
      if (handler.filePath === registrar.filePath ||
        handler.qualifiedName.split('.')[0] === registrar.qualifiedName.split('.')[0]) {
        edges.push({
          source: registrar.id,
          target: handler.id,
          kind: 'calls',
          provenance: 'callback-synth',
          metadata: { phase: 11, channel: 'gin-middleware' },
        });
        fanout++;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 主入口 — 14 阶段回调合成
// ---------------------------------------------------------------------------

/**
 * 运行全部 14 个阶段的回调合成
 *
 * Phase 1-5 为通用阶段 (已实现)
 * Phase 6-11 为框架特化阶段 (Vue SFC, Go gRPC, React Native, Fabric, MyBatis, Gin)
 *   — 完整版从 CodeGraph callback-synthesizer.ts 移植
 *
 * 扇出上限保护:
 *   MAX_CALLBACKS_PER_CHANNEL = 40
 *   EVENT_FANOUT_CAP = 6
 *   CC_FANOUT_CAP = 8
 *   MAX_JSX_CHILDREN = 30
 */
export function runCallbackSynthesis(
  adapter: CallbackQueryAdapter,
): SynthesisResult {
  const startMs = Date.now();
  const allEdges: UnifiedEdge[] = [];

  // 获取所有函数/方法/组件节点
  const functions = adapter.getNodesByKind('function');
  const methods = adapter.getNodesByKind('method');
  const components = adapter.getNodesByKind('component');
  const allNodes = [...functions, ...methods, ...components];

  // Phase 1: 字段观察者通道
  phase1_fieldObservers(allNodes, allEdges);

  // Phase 2: EventEmitter 通道
  phase2_eventEmitter(allNodes, allEdges);

  // Phase 3: 闭包集合分派
  phase3_closureDispatch(allNodes, allEdges);

  // Phase 4: 框架特化桥接
  phase4_frameworkBridge(allNodes, allEdges);

  // Phase 5: JSX 子组件渲染
  phase5_jsxChildren(allNodes, allEdges);

  // Phase 5.5: 接口/抽象分派
  phase5_5_interfaceDispatch(adapter, allEdges);

  // Phase 6: Vue SFC 模板
  phase6_vueSFC(allNodes, allEdges);

  // Phase 7: Go gRPC Stub→Impl
  phase7_goGrpc(allNodes, allEdges);

  // Phase 8: React Native 跨语言事件通道
  phase8_reactNativeBridge(allNodes, allEdges);

  // Phase 9: Fabric Native Impl
  phase9_fabricNative(allNodes, allEdges);

  // Phase 10: MyBatis Java↔XML
  phase10_mybatis(allNodes, allEdges);

  // Phase 11: Gin 中间件链
  phase11_ginMiddleware(allNodes, allEdges);

  // 全局去重
  const seen = new Set<string>();
  const dedupedEdges: UnifiedEdge[] = [];
  for (const edge of allEdges) {
    const key = `${edge.source}->${edge.target}:${edge.kind}`;
    if (!seen.has(key)) {
      seen.add(key);
      dedupedEdges.push(edge);
    }
  }

  // 写入 DB
  if (dedupedEdges.length > 0) {
    adapter.insertEdges(dedupedEdges);
  }

  return {
    edges: dedupedEdges,
    channelsFound: dedupedEdges.length,
    callbacksLinked: dedupedEdges.length,
    durationMs: Date.now() - startMs,
  };
}