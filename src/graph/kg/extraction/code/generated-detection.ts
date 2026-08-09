// src/graph/kg/extraction/code/generated-detection.ts
// 从 CodeGraph 直接复用, 30+ 正则模式识别生成文件
// 参考: plan-maestrograph.md Gap 修补 7

const GENERATED_PATTERNS: ReadonlyArray<RegExp> = [
  // Go — protobuf / gRPC / mockgen
  /\.pb\.go$/,
  /\.pulsar\.go$/,
  /_grpc\.pb\.go$/,
  /_mock\.go$/,
  /_mocks\.go$/,
  /^mock_[^/]+\.go$/,

  // TypeScript / JavaScript — codegen
  /\.generated\.[jt]sx?$/,
  /\.gen\.[jt]sx?$/,
  /\.pb\.[jt]s$/,
  /_pb\.[jt]s$/,
  /_grpc_pb\.[jt]s$/,

  // Python — protobuf
  /_pb2(_grpc)?\.py$/,
  /_pb2\.pyi$/,

  // C++ — protobuf
  /\.pb\.(cc|h)$/,

  // C# — protobuf / gRPC
  /\.g\.cs$/,
  /Grpc\.cs$/,

  // Java — protobuf / gRPC
  /OuterClass\.java$/,
  /Grpc\.java$/,

  // Swift — protobuf
  /\.pb\.swift$/,

  // Clang compatibility headers generated from Swift modules
  /-Swift\.h$/,

  // Dart — build_runner / freezed / json_serializable
  /\.g\.dart$/,
  /\.freezed\.dart$/,

  // Rust — protobuf
  /\.pb\.rs$/,
];

/**
 * 检测文件是否为生成文件 (generated code)
 * 用途: 搜索结果降权 (排最后), dominant file 检测排除, 不硬过滤 (仍在图中)
 */
export function isGeneratedFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return GENERATED_PATTERNS.some(p => p.test(normalized));
}

/**
 * 判断文件是否应该被降权处理 (生成文件或测试文件)
 */
export function shouldDegradeInSearch(filePath: string): boolean {
  return isGeneratedFile(filePath) || isTestFile(filePath);
}

/**
 * 测试文件检测 (用于搜索降权)
 */
export function isTestFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return (
    /\.test\.[jt]sx?$/.test(normalized) ||
    /\.spec\.[jt]sx?$/.test(normalized) ||
    /_test\.go$/.test(normalized) ||
    /test_.*\.py$/.test(normalized) ||
    /_spec\.rb$/.test(normalized) ||
    /\b__tests__\//.test(normalized) ||
    /\btests?\//.test(normalized) ||
    /\.test\.ts$/.test(normalized)
  );
}
