# 升级踩坑记录

这份文档记录本仓库从 0.7.8 移植到 0.7.9 期间真实踩过的每一个坑。
目的是让下一次上游发版时，**在自动化流程里提前拦住这些问题**，而不是等装到机器上才发现。

每个问题都写明：现象 → 根因 → 怎么修 → 自动化里怎么防。

---

## 一、安装后插件整个失效，模型列表里没有 WorkBuddy

### 现象

插件页显示「1 已停用」，模型选择器里找不到 WorkBuddy 分组。Host 侧其实正常
（状态接口能返回账号和模型），但前端完全不工作。

### 根因

`node_modules/dsh-workbuddy-connect/package.json` 的 **`name` 字段被改成了
`dsh-workbuddy-connect-accounts`**（本仓库的 fork 名），和目录名、profile 的
`bundles` 声明、客户端常量 `BUNDLE_NAME` 全都不一致。

宿主有三处按包名匹配：

| 位置 | 作用 |
|---|---|
| `dsh.profile.bundles` 里的 `dsh-workbuddy-connect` | Node 通过 `node_modules/<name>/` 解析 |
| 客户端 `const BUNDLE_NAME = "dsh-workbuddy-connect"` | 设置卡片注册到这个 key |
| 插件页 `configured = ledger.bundles.has(pkg.name)` | 决定要不要渲染配置区 |

任何一处不一致，卡片就不渲染；名称整体错位时，组件直接不加载。

### 怎么修

安装脚本强制 `name = basename(插件目录)`：

```js
const INSTALLED_NAME = path.basename(PLUGIN_DIR);
const nextPkg = { ...installed, name: INSTALLED_NAME, ... };
```

### 自动化怎么防

`tools/audit-install.mjs` / `tools/check-installed.mjs` 校验四处名称一致：

```
directory name  == package name == BUNDLE_NAME == profile bundles entry
```

不一致就退出码 1，流程中止。

---

## 二、版本号显示 0.7.8，但代码是 0.7.9

### 现象

插件页「代码来源」显示 `@0.7.8`，实际运行的却是 0.7.9 的代码。

### 根因

插件页显示的版本来自 **profile 的 `dependencies` 声明**，不是安装包里的 `version`。
当时只覆盖了 `node_modules` 里的文件，没动声明。

后来我试过把声明改成 0.7.9，结果 `package.json` 和 `pnpm-lock.yaml` 对不上，
担心启动失败又改回了 0.7.8 —— **这是个错误的权衡**：插件是复制文件安装的，
pnpm 根本不会重新解析，声明和锁文件只要彼此一致就行。

### 怎么修

四处一起改，全部对齐：

```
profile dependencies[dsh-workbuddy-connect]
pnpm-lock.yaml  importers specifier
pnpm-lock.yaml  importers resolved version
pnpm-lock.yaml  包条目（name@version、integrity、peer 变体）
```

锁文件的 integrity 必须用 **npm registry 的官方值**，不能自己算。

### 自动化怎么防

`tools/set-version.mjs <x.y.z>` 一次改完四处，自动取官方 integrity，改完验证
`specifier == 包条目 == profile == 安装包` 全部相等才退出 0。

**注意**：安装包的 `version` 不能简单取构建版本。`tools/install-local.mjs` 里
写的是「取 lock 文件 pin 住的版本」，否则升级后会破坏下一次启动的依赖校验。

---

## 三、点开账号卡片，整个卡片消失了

### 现象

插件页能看到账号卡片，**点展开后卡片直接不见了**，没有任何报错。

### 根因

React 在子树抛错时会卸载最近的错误边界；没有边界就卸载整棵子树 —— 用户看到的就是「消失了」。

真正的抛出点是两个：

1. **`formatTime()`** 对非法日期抛 `RangeError: Invalid time value`

   ```js
   function formatTime(ms) {
     return new Intl.DateTimeFormat(...).format(new Date(ms));  // new Date(undefined) → Invalid Date
   }
   ```

   实测：`undefined` 和 `NaN` 都会抛，`null` 和 `0` 不会（变成 1970-01-01）。

2. **`ExpiryNotice`** 直接解构到期数据：

   ```js
   const { within24h, within7d } = expiry;   // expiry 缺失时抛
   ```

### 怎么修

```js
// formatTime 降级成破折号，而不是抛错
const date = new Date(ms);
if (Number.isNaN(date.getTime())) return "—";
return new Intl.DateTimeFormat(...).format(date);

// ExpiryNotice 容忍缺失
const within24h = expiry?.within24h ?? { total: 0, packages: 0 };
const within7d = expiry?.within7d ?? { total: 0, packages: 0 };
```

并且给卡片包一层错误边界，把异常**显示在页面上**而不是让它继续消失：

```
WorkBuddyPluginCard      ← 边界 + 渲染错误
  └ WorkBuddyPluginCardBody  ← 原来的组件
```

这个错误边界价值极大：**正是因为加了它，下一个 bug 才被立刻定位出来**（见下一条）。

### 自动化怎么防

`tools/harden-render.mjs` 应用这三处修改。脚本用「重命名原组件 + 外包一层」的方式，
**不做括号手术**，避免改坏压缩后的代码结构。

---

## 四、`ReferenceError: switchAccount is not defined`

### 现象

加上错误边界后，展开卡片显示：

```
WorkBuddy card render error
ReferenceError: switchAccount is not defined
  at WorkBuddyPluginCardBody (...client.js?rev=6f6c0a80f3e8:1751:19)
```

### 根因

移植时把 `account-actions` 片段插到了**错误的锚点位置**。

锚点是 `}, [control]);`，用的 `position: 'before'`，结果片段落进了
`confirmDetect` 回调**内部**：

```js
const confirmDetect = useCallback((modelId) => {
    control({ action: "probe", model: modelId });
    // ← 片段插在这里，confirmDetect 还没闭合
    const accountAction = ...
    const switchAccount = ...     // 变成了 confirmDetect 的局部变量
    const removeAccount = ...
}, [control]);                    // confirmDetect 在这里才闭合
```

渲染体在卡片作用域引用 `switchAccount`，自然找不到。

### 怎么修

锚点方向改为 `position: 'after'`，让片段落在 `confirmDetect` 闭合之后。

### 自动化怎么防

1. 移植规则本身已修正（`tools/port-patch.mjs`）
2. `tools/fix-account-handlers.mjs` 能修复已经错位的构建
3. **移植后必须跑的作用域检查**：确认三个 handler 声明在 `confirmDetect` 结束之后

> **教训**：`}, [control]);` 这种锚点太短，前后可能出现在多个函数收尾处。
> 移植规则应该优先用**更长的、唯一的**锚点。

---

## 五、账号面板显示成一堆英文 key

### 现象

卡片里显示 `accountListHeading`、`accountSwitch`、`accountRemove`、`keepaliveHeading`……
而不是「已记住的账号」「切换到此账号」。

### 根因

`t("accountListHeading")` 找不到对应的翻译条目时，直接把 key 原样返回。

两个语言表（`en` 和 `zh`）里**都没有这 24 个新键**；另外有 4 个键虽然加进了中文表，
但值还是英文原文。

### 怎么修

两个表都补齐 28 个键，中文表给出真正的中文。

### 自动化怎么防

移植后跑一个检查：**把新组件里所有 `t("...")` 的 key 提取出来，逐一到两个语言表里找**，
缺失就报错。这个检查应该成为 `verify-render.mjs` 的一部分。

> **踩坑细节**：两个语言表的最后一条**都没有结尾逗号**，直接 append 会拼出
> `"…" "key": "…"`，在插入点报语法错误。必须先给最后一条补逗号。

---

## 六、`scan-secrets.mjs` 误报：含真实账号的行

### 现象

发布前扫描报：

```
tools\_status.json: contains .workbuddy-accounts-workbuddy.json:nickname
```

### 根因

排查 bug 时为了用真实数据复现，我把线上状态接口的返回**存成了文件**做测试夹具。
里面是真实的账号昵称、uid、到期时间。

### 怎么修

删除该文件，并把所有临时诊断脚本清理掉。

### 自动化怎么防

1. **永远不要**把真实状态文档写成文件做夹具 —— 用构造的最小数据
2. 测试断言用 `uid-a:` / `uid-b:` 这类占位，不要写真实昵称
3. 每次推送前强制跑 `node tools/scan-secrets.mjs .`，必须输出 `CLEAN`

> 这条坑非常危险：如果不是扫描器拦住，真实账号数据就进 Git 历史了。

---

## 七、账号档案差点被旧备份覆盖

### 现象

误触「跟随 App」后账号显示未登录，第一反应是「用备份覆盖回去」。

### 根因

备份是几小时前的，而**保活已经把这几个账号的 token 续期过了** ——
用旧备份覆盖等于把新 token 换回旧的。

### 怎么修

只改 `selected` 这一个字段指向目标账号，不覆盖整份档案。

### 自动化怎么防

安装/升级流程**永远不写账号档案**。`tools/install-local.mjs` 和
`release/install.mjs` 都会在前后比对档案指纹（size + mtime）并报告「未改动」。

> 档案路径在插件目录**之外**：`$DSH_HOME/.workbuddy-accounts-<variant>.json`，
> 所以覆盖插件代码不会碰到它。

---

## 八、改了文件但界面没变（进程只读一次）

### 现象

手工改完 `client.js`，刷新页面、强制刷新都没用，界面还是旧的。

### 根因

两层缓存：

1. **Host 侧**：`WorkBuddyAccountVault.load()` 里有 `if (this.loaded) return;`，
   档案只在进程启动时读一次
2. **浏览器侧**：客户端 bundle 用 `rev` 作缓存键

### 怎么修

**必须完全重启 DSH** —— 不是关窗口，是托盘右键退出，或任务管理器结束
所有 `DeepSeek Harness` 进程。

### 自动化怎么防

自动化**不能自己重启 DSH**（会杀掉正在跑的会话）。所有产出都必须明确告知用户：

> 「已生成，请完全退出 DSH 再重新打开测试」

---

## 九、「跟随 App」选项坑了整个插件

### 现象

点了一下「跟随 WorkBuddy App 当前登录」，账号面板变成未登录，模型只剩内置的一个。

### 根因

那个选项不是「选某个账号」，而是**清空 `selected`**，然后去读桌面 App 当前登录的状态。
App 一旦退出登录，整个插件跟着失效。

```js
onSwitch("")   // selected 清空 → 回落读 App 登录态
```

### 怎么修

从三个入口全部移除（卡片按钮、标题旁标签、下拉选项），并删掉 8 条相关文案。

### 自动化怎么防

移植后检查：`t("accountFollowApp")` / `t("accountFollowing")` 不应该有任何 UI 引用。
`verify-render.mjs` 现在断言下拉菜单是 **2 项**（只有账号，没有 follow-app）。

---

## 十、PowerShell 转义把排查拖垮

### 现象

`node -e "..."` 里写正则、写 `??`、写引号，反复报 `ParserError`，
一个简单的检查要试四五次。

### 根因

PowerShell 5 不支持 `??`；双引号里的 `/regex/`、`$`、反斜杠会被 PowerShell 先解析一遍。

### 怎么修

**所有多行逻辑都写成 `.mjs` 文件再跑**，不要在命令行里内联。

### 自动化怎么防

自动化脚本里不用 `node -e`；检查逻辑一律落成 `tools/*.mjs` 文件。

---

## 十一、脚本里的 `process.exit()` 在 finally 里

### 现象

自动化任务跑完报 `exit=-1073740791`（Node abort）。

### 根因

在 `finally` 块里调 `process.exit()`，Node 清理阶段崩溃。

### 怎么修

改成返回退出码，在最后**只设置一次** `process.exitCode`。

---

## 十二、`fetch` 未关闭导致进程退出时报 libuv 断言

### 现象

`node tools/set-version.mjs 0.7.9` 明明成功了，但最后报：

```
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)
```

### 根因

`await fetch(...)` 用完没有关连接，进程退出时 libuv 断言失败。

### 怎么修

功能不受影响（退出码可能是 1）。要彻底干净可用 `AbortController` 或读完 body 后手动释放。

**当前状态**：已知问题，不影响结果，暂未修。

---

## 十三、自动化脚本自身的路径坑

### 现象

`install.mjs` 报 `ENOENT: .../work-space/%E5%85%AC%E5%85%B1/...`

### 根因

用 `new URL(import.meta.url).pathname` 取路径，中文目录名被 URL 转义成 `%E5%85%AC%E5%85%B1`。

### 怎么修

```js
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
```

### 自动化怎么防

所有脚本统一用 `fileURLToPath`，不用 `.pathname`。

---

## 升级检查清单

上游发版后，按顺序执行，任何一步失败就停下：

### 1. 移植前

- [ ] 下载上游 tgz，解包到 `.upstream/package`
- [ ] 确认 DSH 内核版本（插件 `peerDependencies` 里写着）
- [ ] **备份当前本地插件**（这次是 `plugin-0.7.8-patched-<时间戳>/`）
- [ ] 备份账号档案

### 2. 移植

- [ ] `node tools/port-patch.mjs --stage <目录>`（锚点对不上就一个文件都不改）
- [ ] 检查 `account-actions` 片段的**作用域**（不能落在 `confirmDetect` 里）
- [ ] 检查新 UI 的 `t("...")` key 在两个语言表里都存在
- [ ] 确认两个语言表最后一条的**结尾逗号**

### 3. 验证

- [ ] `node tools/verify-logic.mjs` → ALL LOGIC CHECKS PASSED
- [ ] `node tools/verify-render.mjs` → RENDER CHECKS PASSED
- [ ] `node tools/verify-keepalive.mjs` → KEEPALIVE CHECKS PASSED
- [ ] `node tools/audit-install.mjs` → names agree + versions agree
- [ ] 所有 js 文件 `node --check` 通过

### 4. 安装到本地测试

- [ ] 备份账号档案指纹
- [ ] 安装
- [ ] 确认档案指纹**未变**
- [ ] 确认 `formatTime` 对 `undefined`/`NaN` 不抛错

### 5. 用户测试（必须）

- [ ] 告知用户**完全重启 DSH**
- [ ] 等用户确认：卡片能展开、4 个账号都在、能切换、模型可选
- [ ] **用户确认没问题之前，绝不推送**

### 6. 发布

- [ ] `node tools/scan-secrets.mjs .` → CLEAN
- [ ] `node tools/set-version.mjs <新版本>`
- [ ] `node tools/install-local.mjs`
- [ ] `node tools/build-release.mjs`
- [ ] 提交并推送
- [ ] 打 GitHub Release（zip 附件）

---

## 一句话总结

**这个项目的失败模式几乎全是「静默失败」**：名称不匹配 → 卡片不渲染；
锚点错位 → 变量找不到；文案缺 key → 显示 key 名；日期非法 → 整张卡片消失。
用户看到的永远是「不工作了」，而不是「哪里错了」。

所以错误边界、一致性审计、key 完整性检查这三件事，不是nice-to-have，
它们是把「玄学」变成「可定位」的唯一手段。
