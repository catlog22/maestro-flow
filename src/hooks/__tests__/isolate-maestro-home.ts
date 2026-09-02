/**
 * 测试隔离辅助 — 必须作为测试文件的**第一个 import** 引入（ESM 按序求值）。
 *
 * 在被测模块（经 config/paths.js 计算全局路径）加载前，把 MAESTRO_HOME 指到
 * 临时目录，防止本机全局 specs（~/.maestro/specs）泄漏进断言：
 * loadSpecs 会合并 Global Specs，本机有全局 specs 时
 * 「无项目 specs 目录 → inject:false」之类的用例会假失败。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 无条件新建临时目录:继承的 MAESTRO_HOME 可能指向真实 home,
// 下面的 specs 占位写入会对真实目录抛 EISDIR,不存在则抛 ENOENT
const home = mkdtempSync(join(tmpdir(), 'maestro-test-home-'));
process.env.MAESTRO_HOME = home;

// loadSpecs 的全局层（paths.specs）无条件包含且 auto-seed 覆盖全部 category——
// 只要全局目录可写，任何「无 specs」断言都会注入种子内容。
// 把 specs 路径占位为一个普通文件：autoInitSeeds 写入抛异常被吞、loadFromDir
// readdir 失败返回空，全局层在所有机器上确定性地为空。
writeFileSync(join(home, 'specs'), 'blocked-for-test-isolation', 'utf-8');
