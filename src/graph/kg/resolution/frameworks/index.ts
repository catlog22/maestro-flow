// src/graph/kg/resolution/frameworks/index.ts
// 24 框架解析器注册表 — 从 CodeGraph 复用
// 参考: codegraph/src/resolution/frameworks/index.ts (21 文件, 24 resolver 实例)

export interface FrameworkResolver {
  name: string;
  language: string;
  detect(files: string[]): boolean;
  resolve?(nodes: Array<{ id: string; name: string; filePath: string }>): Array<{ source: string; target: string; kind: string }>;
}

// ---------------------------------------------------------------------------
// 框架解析器注册表
// 完整版: 逐个从 CodeGraph 移植各 resolver
// 当前: 骨架 + detect 函数 (通过 package.json / 文件特征检测)
// ---------------------------------------------------------------------------

function detectByPackageJson(files: string[], deps: string[]): boolean {
  const pkgFiles = files.filter(f => f.endsWith('package.json'));
  // 简化: 有 package.json 就假设可能命中 (完整版需读取并解析)
  return pkgFiles.length > 0;
}

function detectByFilePattern(files: string[], patterns: RegExp[]): boolean {
  return files.some(f => patterns.some(p => p.test(f)));
}

// ---------------------------------------------------------------------------
// resolve() 辅助工具
// ---------------------------------------------------------------------------

type Node = { id: string; name: string; filePath: string };
type Edge = { source: string; target: string; kind: string };

/** 在同一目录或子目录中查找目标节点 */
function sameDir(a: string, b: string): boolean {
  const dirA = a.replace(/[/\\][^/\\]+$/, '');
  const dirB = b.replace(/[/\\][^/\\]+$/, '');
  return dirA === dirB;
}

/** 按文件后缀过滤节点 */
function filterByExt(nodes: Node[], exts: string[]): Node[] {
  return nodes.filter(n => exts.some(e => n.filePath.endsWith(e)));
}

/** 按名称正则匹配过滤 */
function filterByName(nodes: Node[], pattern: RegExp): Node[] {
  return nodes.filter(n => pattern.test(n.name));
}

/** 在 nodes 中找名称匹配的目标 (排除自身) */
function findByName(nodes: Node[], name: string, excludeId?: string): Node | undefined {
  return nodes.find(n => n.name === name && n.id !== excludeId);
}

const RESOLVERS: FrameworkResolver[] = [
  // --- JavaScript/TypeScript 框架 ---
  {
    name: 'express',
    language: 'javascript',
    detect: (files) => detectByPackageJson(files, ['express']),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const jsNodes = filterByExt(nodes, ['.js', '.ts', '.mjs']);
      // Connect route handlers to middleware in same file
      const routeHandlers = jsNodes.filter(n => /^(get|post|put|patch|delete|use|all|route)\b/i.test(n.name));
      const middlewares = jsNodes.filter(n => /middleware|auth|validate|logger|cors|helmet/i.test(n.name));
      for (const rh of routeHandlers) {
        for (const mw of middlewares) {
          if (sameDir(rh.filePath, mw.filePath)) {
            edges.push({ source: rh.id, target: mw.id, kind: 'calls' });
          }
        }
      }
      return edges;
    },
  },
  {
    name: 'nestjs',
    language: 'typescript',
    detect: (files) => detectByPackageJson(files, ['@nestjs/core']),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const tsNodes = filterByExt(nodes, ['.ts']);
      const controllers = tsNodes.filter(n => /Controller$/i.test(n.name) || n.filePath.includes('.controller.'));
      const services = tsNodes.filter(n => /Service$/i.test(n.name) || n.filePath.includes('.service.'));
      // Connect controllers to services via constructor injection naming convention
      for (const ctrl of controllers) {
        const prefix = ctrl.name.replace(/Controller$/i, '');
        for (const svc of services) {
          if (svc.name.startsWith(prefix) || sameDir(ctrl.filePath, svc.filePath)) {
            edges.push({ source: ctrl.id, target: svc.id, kind: 'calls' });
          }
        }
      }
      return edges;
    },
  },
  {
    name: 'react',
    language: 'javascript',
    detect: (files) => detectByPackageJson(files, ['react']),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const jsxNodes = filterByExt(nodes, ['.tsx', '.jsx', '.js', '.ts']);
      // Components: PascalCase names
      const components = jsxNodes.filter(n => /^[A-Z][a-zA-Z0-9]+$/.test(n.name));
      // Hooks: use* prefix
      const hooks = jsxNodes.filter(n => /^use[A-Z]/.test(n.name));
      for (const comp of components) {
        // Connect component → hooks in same dir (co-located hooks)
        for (const hook of hooks) {
          if (sameDir(comp.filePath, hook.filePath)) {
            edges.push({ source: comp.id, target: hook.id, kind: 'calls' });
          }
        }
        // Connect component → child components in same or child dirs
        for (const child of components) {
          if (child.id !== comp.id && sameDir(comp.filePath, child.filePath)) {
            edges.push({ source: comp.id, target: child.id, kind: 'references' });
          }
        }
      }
      return edges;
    },
  },
  {
    name: 'react-native-legacy',
    language: 'javascript',
    detect: (files) => detectByPackageJson(files, ['react-native']),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const jsNodes = filterByExt(nodes, ['.tsx', '.jsx', '.js', '.ts']);
      const nativeNodes = filterByExt(nodes, ['.java', '.kt', '.m', '.mm', '.swift']);
      // Connect NativeModules references to native implementations
      const nativeRefs = jsNodes.filter(n => /NativeModule|requireNativeComponent/i.test(n.name));
      for (const ref of nativeRefs) {
        for (const impl of nativeNodes) {
          if (impl.name.toLowerCase().includes(ref.name.replace(/NativeModule/i, '').toLowerCase())) {
            edges.push({ source: ref.id, target: impl.id, kind: 'references' });
          }
        }
      }
      return edges;
    },
  },
  {
    name: 'react-native-turbomodules',
    language: 'javascript',
    detect: (files) => detectByPackageJson(files, ['react-native']) && files.some(f => f.includes('TurboModule')),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      // TurboModule specs (JS/TS) → native implementations (C++/ObjC/Java)
      const specNodes = nodes.filter(n => /TurboModule|NativeSpec|Spec$/i.test(n.name) && /\.(ts|js|tsx)$/.test(n.filePath));
      const nativeImpls = filterByExt(nodes, ['.cpp', '.h', '.mm', '.m', '.java', '.kt']);
      for (const spec of specNodes) {
        const baseName = spec.name.replace(/(TurboModule|NativeSpec|Spec)$/i, '');
        for (const impl of nativeImpls) {
          if (impl.name.toLowerCase().includes(baseName.toLowerCase())) {
            edges.push({ source: spec.id, target: impl.id, kind: 'references' });
          }
        }
      }
      return edges;
    },
  },
  {
    name: 'expo-modules',
    language: 'typescript',
    detect: (files) => detectByPackageJson(files, ['expo']),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      // Expo module definitions → handler functions
      const moduleDefs = nodes.filter(n => /Module$|ExpoModule/i.test(n.name));
      const handlers = nodes.filter(n => /handler|Handler|onEvent|Events/i.test(n.name));
      for (const mod of moduleDefs) {
        for (const handler of handlers) {
          if (sameDir(mod.filePath, handler.filePath)) {
            edges.push({ source: mod.id, target: handler.id, kind: 'calls' });
          }
        }
      }
      return edges;
    },
  },
  {
    name: 'svelte',
    language: 'javascript',
    detect: (files) => detectByFilePattern(files, [/\.svelte$/]),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      // Connect store subscribers to reactive declarations
      const stores = nodes.filter(n => /Store$|store/i.test(n.name) && /\.(ts|js)$/.test(n.filePath));
      const svelteComponents = nodes.filter(n => n.filePath.endsWith('.svelte'));
      for (const comp of svelteComponents) {
        for (const store of stores) {
          if (sameDir(comp.filePath, store.filePath) || store.filePath.includes('/stores/')) {
            edges.push({ source: comp.id, target: store.id, kind: 'references' });
          }
        }
      }
      return edges;
    },
  },
  {
    name: 'vue',
    language: 'javascript',
    detect: (files) => detectByFilePattern(files, [/\.vue$/]),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const vueComponents = nodes.filter(n => n.filePath.endsWith('.vue'));
      // Composables: use* functions in .ts files
      const composables = nodes.filter(n => /^use[A-Z]/.test(n.name) && /\.(ts|js)$/.test(n.filePath));
      for (const comp of vueComponents) {
        // Connect setup() composables
        for (const c of composables) {
          if (sameDir(comp.filePath, c.filePath) || c.filePath.includes('/composables/')) {
            edges.push({ source: comp.id, target: c.id, kind: 'calls' });
          }
        }
        // Connect child components
        for (const child of vueComponents) {
          if (child.id !== comp.id && sameDir(comp.filePath, child.filePath)) {
            edges.push({ source: comp.id, target: child.id, kind: 'references' });
          }
        }
      }
      return edges;
    },
  },

  // --- Python 框架 ---
  {
    name: 'django',
    language: 'python',
    detect: (files) => files.some(f => f.includes('manage.py') || f.includes('settings.py')),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const pyNodes = filterByExt(nodes, ['.py']);
      const views = pyNodes.filter(n => n.filePath.includes('views.py') || n.filePath.includes('/views/'));
      const models = pyNodes.filter(n => n.filePath.includes('models.py') || n.filePath.includes('/models/'));
      const serializers = pyNodes.filter(n => n.filePath.includes('serializers.py'));
      const urls = pyNodes.filter(n => n.filePath.includes('urls.py'));
      // url patterns → view functions
      for (const url of urls) {
        for (const view of views) {
          if (sameDir(url.filePath, view.filePath)) {
            edges.push({ source: url.id, target: view.id, kind: 'calls' });
          }
        }
      }
      // model → serializer → view chain
      for (const model of models) {
        for (const ser of serializers) {
          if (sameDir(model.filePath, ser.filePath)) {
            edges.push({ source: ser.id, target: model.id, kind: 'references' });
          }
        }
      }
      for (const ser of serializers) {
        for (const view of views) {
          if (sameDir(ser.filePath, view.filePath)) {
            edges.push({ source: view.id, target: ser.id, kind: 'references' });
          }
        }
      }
      return edges;
    },
  },
  {
    name: 'flask',
    language: 'python',
    detect: (files) => files.some(f => f.includes('app.py') || f.includes('wsgi.py')),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const pyNodes = filterByExt(nodes, ['.py']);
      // @app.route decorators → handler functions (route handlers typically in same module)
      const routeFiles = pyNodes.filter(n => n.filePath.includes('routes') || n.filePath.includes('views') || n.filePath.includes('app.py'));
      const handlers = pyNodes.filter(n => /^(get|post|put|delete|index|create|update|show|list|detail)/i.test(n.name));
      for (const rf of routeFiles) {
        for (const h of handlers) {
          if (sameDir(rf.filePath, h.filePath) && rf.id !== h.id) {
            edges.push({ source: rf.id, target: h.id, kind: 'calls' });
          }
        }
      }
      return edges;
    },
  },
  {
    name: 'fastapi',
    language: 'python',
    detect: (files) => files.some(f => f.includes('main.py')),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const pyNodes = filterByExt(nodes, ['.py']);
      // @router decorators → endpoint functions
      const routers = pyNodes.filter(n => n.filePath.includes('router') || n.filePath.includes('route') || n.filePath.includes('api'));
      const endpoints = pyNodes.filter(n => /^(get|post|put|patch|delete|create|read|update|list)/i.test(n.name));
      for (const router of routers) {
        for (const ep of endpoints) {
          if (sameDir(router.filePath, ep.filePath) && router.id !== ep.id) {
            edges.push({ source: router.id, target: ep.id, kind: 'calls' });
          }
        }
      }
      return edges;
    },
  },

  // --- Ruby 框架 ---
  {
    name: 'rails',
    language: 'ruby',
    detect: (files) => files.some(f => f.includes('Gemfile') || f.includes('config/routes.rb')),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const rbNodes = filterByExt(nodes, ['.rb']);
      const routes = rbNodes.filter(n => n.filePath.includes('routes.rb'));
      const controllers = rbNodes.filter(n => n.filePath.includes('/controllers/') || /Controller$/i.test(n.name));
      const models = rbNodes.filter(n => n.filePath.includes('/models/'));
      // routes → controllers
      for (const route of routes) {
        for (const ctrl of controllers) {
          edges.push({ source: route.id, target: ctrl.id, kind: 'calls' });
        }
      }
      // controllers → models (by naming convention: UsersController → User model)
      for (const ctrl of controllers) {
        const modelName = ctrl.name.replace(/Controller$/i, '').replace(/s$/, '');
        for (const model of models) {
          if (model.name.toLowerCase() === modelName.toLowerCase()) {
            edges.push({ source: ctrl.id, target: model.id, kind: 'references' });
          }
        }
      }
      return edges;
    },
  },

  // --- Go 框架 ---
  {
    name: 'gin',
    language: 'go',
    detect: (files) => files.some(f => f.endsWith('go.mod')),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const goNodes = filterByExt(nodes, ['.go']);
      // router.Group/GET/POST → handler functions
      const routers = goNodes.filter(n => /router|route|Router|Route|Setup/i.test(n.name));
      const handlers = goNodes.filter(n => /Handler$|handler$|Controller$|controller$/i.test(n.name)
        || /^(Get|Post|Put|Delete|Create|Update|List|Show|Handle)/i.test(n.name));
      for (const router of routers) {
        for (const handler of handlers) {
          if (sameDir(router.filePath, handler.filePath) || handler.filePath.includes('/handler')) {
            edges.push({ source: router.id, target: handler.id, kind: 'calls' });
          }
        }
      }
      return edges;
    },
  },
  {
    name: 'go-standard',
    language: 'go',
    detect: (files) => files.some(f => f.endsWith('go.mod')),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const goNodes = filterByExt(nodes, ['.go']);
      // http.HandleFunc → handler functions
      const mainFiles = goNodes.filter(n => n.filePath.includes('main.go') || n.filePath.includes('server.go') || /^main$|^serve/i.test(n.name));
      const handlers = goNodes.filter(n => /Handler$|handler$|^Handle/i.test(n.name) || /^(serve|handle)[A-Z]/i.test(n.name));
      for (const main of mainFiles) {
        for (const handler of handlers) {
          if (main.id !== handler.id) {
            edges.push({ source: main.id, target: handler.id, kind: 'calls' });
          }
        }
      }
      return edges;
    },
  },

  // --- Rust 框架 ---
  {
    name: 'actix-web',
    language: 'rust',
    detect: (files) => files.some(f => f.endsWith('Cargo.toml')),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const rsNodes = filterByExt(nodes, ['.rs']);
      // #[get/post] attribute handlers → service/model functions
      const handlers = rsNodes.filter(n => /^(get|post|put|delete|create|update|index|show|list)/i.test(n.name)
        || n.filePath.includes('/handlers/') || n.filePath.includes('/routes/'));
      const services = rsNodes.filter(n => n.filePath.includes('/services/') || n.filePath.includes('/models/'));
      for (const h of handlers) {
        for (const s of services) {
          if (h.id !== s.id) {
            edges.push({ source: h.id, target: s.id, kind: 'calls' });
          }
        }
      }
      return edges;
    },
  },
  {
    name: 'axum',
    language: 'rust',
    detect: (files) => files.some(f => f.endsWith('Cargo.toml')),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const rsNodes = filterByExt(nodes, ['.rs']);
      // Router::new().route() → handler functions
      const routerFiles = rsNodes.filter(n => n.filePath.includes('router') || n.filePath.includes('main.rs') || /^router|^app/i.test(n.name));
      const handlers = rsNodes.filter(n => n.filePath.includes('/handlers/') || /handler|_handler$/i.test(n.name));
      for (const router of routerFiles) {
        for (const handler of handlers) {
          if (router.id !== handler.id) {
            edges.push({ source: router.id, target: handler.id, kind: 'calls' });
          }
        }
      }
      return edges;
    },
  },

  // --- Java 框架 ---
  {
    name: 'spring',
    language: 'java',
    detect: (files) => files.some(f => f.includes('pom.xml') || f.includes('build.gradle')),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const javaNodes = filterByExt(nodes, ['.java', '.kt']);
      const controllers = javaNodes.filter(n => /Controller$/i.test(n.name));
      const services = javaNodes.filter(n => /Service$/i.test(n.name) || /ServiceImpl$/i.test(n.name));
      const repos = javaNodes.filter(n => /Repository$/i.test(n.name) || /Repo$/i.test(n.name));
      // @RequestMapping/@GetMapping controllers → @Autowired services
      for (const ctrl of controllers) {
        const prefix = ctrl.name.replace(/Controller$/i, '');
        for (const svc of services) {
          if (svc.name.toLowerCase().includes(prefix.toLowerCase())) {
            edges.push({ source: ctrl.id, target: svc.id, kind: 'calls' });
          }
        }
      }
      // services → repositories
      for (const svc of services) {
        const prefix = svc.name.replace(/(Service|ServiceImpl)$/i, '');
        for (const repo of repos) {
          if (repo.name.toLowerCase().includes(prefix.toLowerCase())) {
            edges.push({ source: svc.id, target: repo.id, kind: 'calls' });
          }
        }
      }
      return edges;
    },
  },
  {
    name: 'play-framework',
    language: 'java',
    detect: (files) => files.some(f => f.includes('build.sbt')),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const codeNodes = filterByExt(nodes, ['.java', '.scala']);
      // routes file entries → controller actions
      const routeNodes = nodes.filter(n => n.filePath.includes('routes') || n.filePath.includes('conf/'));
      const controllers = codeNodes.filter(n => /Controller$/i.test(n.name) || n.filePath.includes('/controllers/'));
      for (const route of routeNodes) {
        for (const ctrl of controllers) {
          edges.push({ source: route.id, target: ctrl.id, kind: 'calls' });
        }
      }
      return edges;
    },
  },

  // --- PHP 框架 ---
  {
    name: 'laravel',
    language: 'php',
    detect: (files) => files.some(f => f.includes('artisan')),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const phpNodes = filterByExt(nodes, ['.php']);
      // Route::get/post → controller methods
      const routeFiles = phpNodes.filter(n => n.filePath.includes('routes/') || n.filePath.includes('web.php') || n.filePath.includes('api.php'));
      const controllers = phpNodes.filter(n => /Controller$/i.test(n.name) || n.filePath.includes('/Controllers/'));
      const models = phpNodes.filter(n => n.filePath.includes('/Models/'));
      for (const route of routeFiles) {
        for (const ctrl of controllers) {
          edges.push({ source: route.id, target: ctrl.id, kind: 'calls' });
        }
      }
      // controllers → models by naming (UserController → User model)
      for (const ctrl of controllers) {
        const modelName = ctrl.name.replace(/Controller$/i, '');
        for (const model of models) {
          if (model.name.toLowerCase() === modelName.toLowerCase()) {
            edges.push({ source: ctrl.id, target: model.id, kind: 'references' });
          }
        }
      }
      return edges;
    },
  },
  {
    name: 'drupal',
    language: 'php',
    detect: (files) => files.some(f => f.includes('core/lib/Drupal')),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const phpNodes = filterByExt(nodes, ['.php', '.module']);
      // Connect hook implementations to hook definitions
      const hookImpls = phpNodes.filter(n => /_hook_|^hook_/i.test(n.name) || n.filePath.endsWith('.module'));
      const hookDefs = phpNodes.filter(n => n.filePath.includes('core/') || /Hook$|hook_info/i.test(n.name));
      for (const impl of hookImpls) {
        for (const def of hookDefs) {
          if (def.id !== impl.id) {
            const hookName = impl.name.replace(/^.*_hook_/i, 'hook_');
            if (def.name.toLowerCase().includes(hookName.toLowerCase())) {
              edges.push({ source: impl.id, target: def.id, kind: 'references' });
            }
          }
        }
      }
      return edges;
    },
  },

  // --- C# 框架 ---
  {
    name: 'aspnet',
    language: 'csharp',
    detect: (files) => files.some(f => f.endsWith('.csproj') || f.endsWith('.sln')),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const csNodes = filterByExt(nodes, ['.cs']);
      // [HttpGet/Post] attributes → controller actions
      const controllers = csNodes.filter(n => /Controller$/i.test(n.name) || n.filePath.includes('/Controllers/'));
      const services = csNodes.filter(n => /Service$/i.test(n.name) || n.filePath.includes('/Services/'));
      const repos = csNodes.filter(n => /Repository$/i.test(n.name) || n.filePath.includes('/Repositories/'));
      for (const ctrl of controllers) {
        const prefix = ctrl.name.replace(/Controller$/i, '');
        for (const svc of services) {
          if (svc.name.toLowerCase().includes(prefix.toLowerCase())) {
            edges.push({ source: ctrl.id, target: svc.id, kind: 'calls' });
          }
        }
      }
      for (const svc of services) {
        const prefix = svc.name.replace(/Service$/i, '');
        for (const repo of repos) {
          if (repo.name.toLowerCase().includes(prefix.toLowerCase())) {
            edges.push({ source: svc.id, target: repo.id, kind: 'calls' });
          }
        }
      }
      return edges;
    },
  },

  // --- Swift 框架 ---
  {
    name: 'swiftui',
    language: 'swift',
    detect: (files) => detectByFilePattern(files, [/\.swift$/]),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const swiftNodes = filterByExt(nodes, ['.swift']);
      // @State/@Binding to View body references
      const views = swiftNodes.filter(n => /View$/i.test(n.name) || n.filePath.includes('View'));
      const viewModels = swiftNodes.filter(n => /ViewModel$/i.test(n.name) || /ObservableObject|StateObject/i.test(n.name));
      // View → ViewModel
      for (const view of views) {
        const prefix = view.name.replace(/View$/i, '');
        for (const vm of viewModels) {
          if (vm.name.toLowerCase().includes(prefix.toLowerCase())) {
            edges.push({ source: view.id, target: vm.id, kind: 'references' });
          }
        }
      }
      // View → child views in same dir
      for (const parent of views) {
        for (const child of views) {
          if (parent.id !== child.id && sameDir(parent.filePath, child.filePath)) {
            edges.push({ source: parent.id, target: child.id, kind: 'references' });
          }
        }
      }
      return edges;
    },
  },
  {
    name: 'uikit',
    language: 'swift',
    detect: (files) => detectByFilePattern(files, [/\.swift$/]),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const swiftNodes = filterByExt(nodes, ['.swift']);
      const storyboards = filterByExt(nodes, ['.storyboard', '.xib']);
      // @IBAction/@IBOutlet → storyboard references
      const viewControllers = swiftNodes.filter(n => /ViewController$/i.test(n.name) || n.filePath.includes('ViewController'));
      const actions = swiftNodes.filter(n => /Action$|^action|^handle|^on[A-Z]/i.test(n.name));
      // ViewController → storyboard
      for (const vc of viewControllers) {
        for (const sb of storyboards) {
          if (sameDir(vc.filePath, sb.filePath)) {
            edges.push({ source: vc.id, target: sb.id, kind: 'references' });
          }
        }
      }
      // ViewController → actions in same file
      for (const vc of viewControllers) {
        for (const action of actions) {
          if (sameDir(vc.filePath, action.filePath) && vc.id !== action.id) {
            edges.push({ source: vc.id, target: action.id, kind: 'calls' });
          }
        }
      }
      return edges;
    },
  },
  {
    name: 'vapor',
    language: 'swift',
    detect: (files) => files.some(f => f.includes('Package.swift')),
    resolve: (nodes) => {
      const edges: Edge[] = [];
      const swiftNodes = filterByExt(nodes, ['.swift']);
      // app.get/post route closures → handler functions
      const routeFiles = swiftNodes.filter(n => n.filePath.includes('routes') || n.filePath.includes('Routes') || /^routes$|^configure$/i.test(n.name));
      const controllers = swiftNodes.filter(n => /Controller$/i.test(n.name) || n.filePath.includes('/Controllers/'));
      const handlers = swiftNodes.filter(n => /handler|Handler|^(get|post|create|update|delete|index|show)/i.test(n.name));
      for (const route of routeFiles) {
        for (const ctrl of controllers) {
          edges.push({ source: route.id, target: ctrl.id, kind: 'calls' });
        }
        for (const handler of handlers) {
          if (route.id !== handler.id && sameDir(route.filePath, handler.filePath)) {
            edges.push({ source: route.id, target: handler.id, kind: 'calls' });
          }
        }
      }
      return edges;
    },
  },
];

// ---------------------------------------------------------------------------
// 查询 API
// ---------------------------------------------------------------------------

export function getRegisteredFrameworks(): FrameworkResolver[] {
  return RESOLVERS;
}

export function detectFrameworks(files: string[]): string[] {
  return RESOLVERS.filter(r => r.detect(files)).map(r => r.name);
}

export function getFrameworkResolver(name: string): FrameworkResolver | null {
  return RESOLVERS.find(r => r.name === name) ?? null;
}