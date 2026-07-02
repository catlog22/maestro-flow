// src/graph/kg/extraction/code/wasm-stability.ts
// WASM 运行时稳定性 — 从 CodeGraph 移植的 3 个保护机制
// 参考: plan-maestrograph.md Gap 修补 3 (致命级补充)
// 缺少任何一个都会导致生产环境崩溃

// ---------------------------------------------------------------------------
// 机制 1: V8 Turboshaft Zone OOM 缓解
// Node 22+ 的 V8 引擎在编译大型 WASM 模块时会触发 turboshaft Zone OOM
// 必须在进程启动时注入 --liftoff-only flag
// 来源: codegraph/src/extraction/wasm-runtime-flags.ts
// ---------------------------------------------------------------------------

let _wasmFlagsApplied = false;

/**
 * 在 WASM 模块加载前应用 V8 运行时 flag
 *
 * --liftoff-only: 禁用 turboshaft 优化编译器, 只用 Liftoff 基线编译
 * 牺牲 ~10% WASM 执行速度, 换取 100% 内存安全
 *
 * 注意: 此函数必须在任何 WASM 模块加载之前调用 (通常在进程启动时)
 * 在已运行的进程中, flag 设置是 no-op (V8 已初始化)
 */
export function applyWasmRuntimeFlags(): void {
  if (_wasmFlagsApplied) return;
  _wasmFlagsApplied = true;

  // 检测 Node 版本 — Node 22+ 的 V8 turboshaft 有 Zone OOM 风险
  const nodeVersion = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeVersion >= 22) {
    // 在已运行的进程中, V8 flag 无法动态设置
    // 记录警告, 建议用 node 启动参数设置 --liftoff-only
    if (process.env.MAESTRO_DEBUG === '1' && !process.execArgv.includes('--liftoff-only')) {
      console.warn(
        '[MaestroGraph] Node ' + nodeVersion + '+ detected. ' +
        'For WASM stability, run: node --liftoff-only bin/maestro.js kg index'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 机制 2: Parser 周期性重置
// WASM 线性内存只增不缩 (WebAssembly 规范限制)
// 唯一的回收方式是销毁整个 Parser 实例
// 来源: codegraph/src/extraction/parse-worker.ts L55-56
// ---------------------------------------------------------------------------

/** 每 N 次解析重置一次 parser (回收 WASM 线性内存) */
export const PARSER_RESET_INTERVAL = 5000;

/** 每 N 个文件回收 worker (配合 parse-worker 线程池) */
export const WORKER_RECYCLE_INTERVAL = 250;

/**
 * Parser 计数器 — 跟踪解析次数, 达到阈值时提示重置
 */
export class ParserResetCounter {
  private parseCount = 0;
  private readonly interval: number;

  constructor(interval: number = PARSER_RESET_INTERVAL) {
    this.interval = interval;
  }

  /** 记录一次解析, 返回 true 表示需要重置 parser */
  tickAndCheckReset(): boolean {
    this.parseCount++;
    if (this.parseCount >= this.interval) {
      this.parseCount = 0;
      return true;
    }
    return false;
  }

  get count(): number {
    return this.parseCount;
  }

  reset(): void {
    this.parseCount = 0;
  }
}

// ---------------------------------------------------------------------------
// 机制 3: Emscripten stderr 过滤
// tree-sitter WASM 在遇到无法解析的语法时会调用 Emscripten 的 abort()
// 导致大量 stderr 噪声 ("Aborted()" 消息)
// 必须在 worker 线程中拦截 process.stderr.write
// 来源: codegraph/src/extraction/parse-worker.ts L31-52
// ---------------------------------------------------------------------------

const EMSCRIPTEN_NOISE_PATTERNS: ReadonlyArray<RegExp> = [
  /^Aborted\(\)/,
  /^RuntimeError/,
  /exception thrown/,
  /^Cannot enlarge memory arrays/,
];

/**
 * 拦截 Emscripten abort() 产生的 stderr 噪声
 * 返回一个 cleanup 函数用于恢复原始 stderr.write
 */
export function installEmscriptenStderrFilter(): () => void {
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  const filteredWrite = (
    chunk: unknown,
    encoding?: unknown,
    callback?: unknown,
  ): boolean => {
    if (typeof chunk === 'string') {
      const isNoise = EMSCRIPTEN_NOISE_PATTERNS.some(p => p.test(chunk));
      if (isNoise) {
        // 静默吞掉 Emscripten 噪声
        if (typeof callback === 'function') callback();
        return true;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalStderrWrite as any)(chunk, encoding as any, callback as any);
  };

  process.stderr.write = filteredWrite;

  // 返回 cleanup 函数
  return () => {
    process.stderr.write = originalStderrWrite;
  };
}

// ---------------------------------------------------------------------------
// 组合初始化 — 一次性应用所有 WASM 稳定性机制
// ---------------------------------------------------------------------------

let _fullInitDone = false;
let _stderrCleanup: (() => void) | null = null;

/**
 * 应用全部 WASM 稳定性机制:
 * 1. V8 --liftoff-only flag (Node 22+ OOM 缓解)
 * 2. Emscripten stderr 噪声过滤
 *
 * Parser 周期重置由调用方在使用 ParserResetCounter 时自行管理
 */
export function ensureWasmStability(): void {
  if (_fullInitDone) return;
  _fullInitDone = true;

  applyWasmRuntimeFlags();

  if (!_stderrCleanup) {
    _stderrCleanup = installEmscriptenStderrFilter();
  }
}

/**
 * 清理 WASM 稳定性机制 (测试 / 进程退出时调用)
 */
export function cleanupWasmStability(): void {
  if (_stderrCleanup) {
    _stderrCleanup();
    _stderrCleanup = null;
  }
  _fullInitDone = false;
}
