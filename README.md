# DSH WorkBuddy 多账号版

把 WorkBuddy 桌面 App 的模型接进 DeepSeek Harness，并支持**记住多个账号、随时切换**。

原版一次只能用一个 WorkBuddy 账号：切走之后旧账号的令牌就丢了，想切回去只能重新登录。
这个版本把登录过的账号都记下来，随时切回，不用重新扫码。

---

## 装之前先确认

| 要求 | 说明 |
|---|---|
| DeepSeek Harness | 内核版本 **0.2.1-rc.2** |
| Node.js | **22 或更高** |
| 网络 | 需要能访问 npm（装一个依赖 `@earendil-works/pi-ai`） |
| WorkBuddy | 已登录过至少一次（插件复用它的登录态） |

> 不确定自己的版本？装完在 DSH 的 **设置 → 插件** 里能看到版本号。

---

## 安装

打开 PowerShell，粘贴这一行：

```powershell
dsh plugin --profile desktop add github:kuanaha1228-gif/dsh-workbuddy-connect-accounts
```

> `desktop` 是你的 profile 名。不确定的话，看 DSH **设置 → 插件** 页顶部的 profile 名字。

装完**完全退出 DSH 再打开** —— 不是关窗口，是右键托盘图标选「退出」，或者在任务管理器里结束
所有 `DeepSeek Harness` 进程。

### 如果上面那条装不上

改用本地包方式，更稳：

```powershell
# 1. 下载并解压
git clone https://github.com/kuanaha1228-gif/dsh-workbuddy-connect-accounts.git
cd dsh-workbuddy-connect-accounts

# 2. 打包成 tgz
npm pack

# 3. 装
dsh plugin --profile desktop add "file:./kuanaha1228-gif-dsh-workbuddy-connect-accounts-0.7.9.tgz"
```

---

## 怎么用

### 登录账号

设置 → 插件 → 展开卡片，点登录按钮，跳到 WorkBuddy 网页登录。
**登录过的账号会自动进档案**，不用额外操作。

想加第二个账号，在同一步再登录一次另一个账号即可 —— 两个都会留在档案里。

### 切换账号

两个地方都能切，改的是同一份状态：

| 位置 | 适合 |
|---|---|
| **输入框右侧的下拉框** | 日常快速切换，和选模型并排，向上弹出 |
| **设置 → 插件 → 账号列表** | 管理账号，可切换、可移除 |

下拉框只在你登录了 **2 个以上账号**时才出现；只有一个账号时自动隐藏，不占位置。

### 移除账号

设置 → 插件 → 账号列表，点对应账号的「移除」。
移除只删本地档案，不影响 WorkBuddy 桌面 App 自己的登录。

---

## 常见问题

**账号会丢吗？**

不会。账号档案存在 `~/.dsh/.workbuddy-accounts-workbuddy.json`，**不在插件目录里**，
所以升级、重装、覆盖代码都不影响它。

**能同时用多个账号的模型吗？**

不能。同一时间只有一个账号生效，但这个账号可以随时换。

**装完插件页没有账号卡片？**

按顺序检查：

1. 是否**完全退出**了 DSH 再开（关窗口不算）
2. 设置 → 插件里，`dsh-workbuddy-switchaccount` 的开关是否为「运行中」
3. 如果之前装过 `dsh-workbuddy-connect`，**必须先禁用它** —— 两者注册相同的 provider id，不能同时开

**和原版 dsh-workbuddy-connect 能一起用吗？**

不能。本插件是它的多账号分支，注册的是同一组 provider id（`workbuddy`、`workbuddy-ai`）。
在 profile 的 `cordis.patch.yml` 里把原版设成 `disabled: true`，或者直接卸载原版。

**升级 DSH 之后不能用了？**

本插件针对内核 **0.2.1-rc.2** 构建。DSH 内核升级后如果 API 变了，等本仓库更新。
可以先用 `npm view @deepseek-ai/dsh-llm version` 看内核包版本是否还匹配。

---

## 数据与隐私

- 账号档案存在本机，权限 0600，**不会上传到任何地方**
- 插件只把 WorkBuddy 的令牌存在本地，用来调用它自己的接口
- 状态接口只返回昵称、uid、到期时间，**从不返回令牌本身**
- 切换账号不会改动 WorkBuddy 桌面 App 自己的登录文件

---

## 设置项

| 环境变量 | 作用 |
|---|---|
| `DSH_WORKBUDDY_HOME` | 覆盖 DSH 配置目录（默认 `~/.dsh`） |

---

## 它是怎么做的

| 文件 | 作用 |
|---|---|
| `lib/index.js` | Host 侧：注册模型提供方、处理账号档案、提供状态与切换接口 |
| `lib/client.js` | 浏览器侧：设置卡片、工作台账号下拉框、推理档位探测 |
| `cordis.patch.yml` | 向 profile 注册插件入口 |
| `lib/version-resolve-*.js` | 内联的版本兼容层 |

`lib/` 是构建产物，直接提交进仓库 —— 这样 `dsh plugin add github:…` 不需要在你的机器上跑构建工具。

---

## 致谢

- [corrinehu/dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect) —— 原始插件
- [Sliverkiss/workbuddy2api](https://github.com/Sliverkiss/workbuddy2api) —— 协议参考

## 许可证

MIT。`LICENSE` 与 `THIRD_PARTY_NOTICES.txt` 保留自上游。
