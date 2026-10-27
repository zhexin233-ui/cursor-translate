# Cursor Settings 中文补丁

为 Cursor 的标准 IDE 与独立 Agents 窗口提供简体中文设置界面，支持中文搜索、英文关键词检索及设置项跳转。

本项目通过命令行工具安装本地资源补丁。**macOS 与 Windows 均已实测通过**，已验证 Cursor **3.27.22** 和 **3.27.14**，其他版本会自动尝试结构适配。

> 本项目为非官方汉化工具，与 Cursor / Anysphere 无隶属关系。安装会修改应用资源；macOS 还会替换原应用签名并放宽动态库校验。请先阅读下方兼容性与备份说明。

## 功能

- **设置汉化**：覆盖导航、设置名称、说明、按钮、提示及相关弹窗。
- **双窗口支持**：同时适配标准 IDE 设置与独立 Agents 设置。
- **中英文搜索**：支持中文关键词、中文子串、英文原文及混合查询，保留结果跳转能力。
- **自动适配**：已验证版本优先使用固定补丁；未知版本复用现有映射，通过 AST 结构重新定位并检查搜索逻辑。
- **备份与恢复**：提供安装状态查询、重复安装检测、卸载恢复及失败回滚。

品牌名称、模型名称、配置键、命令和用户内容保留原文。汉化范围仅限 Cursor 专属设置；Customize 页面、聊天、编辑器内容、终端及标准 VS Code 设置不在范围内。部分共享导航文字和动态服务端文案仍可能显示英文。

## 兼容性

| 项目 | 支持情况 |
| --- | --- |
| 已验证 Cursor 版本 | 3.27.22、3.27.14 |
| 其他 Cursor 版本 | 自动尝试适配，确认结构与搜索依赖后安装；不保证所有版本均可识别 |
| macOS | 已完成安装、启动、设置显示、中英文搜索及跳转验证 |
| Windows | 已由用户实测，运行正常 |
| Node.js | 22 或更高版本 |
| 包管理器 | pnpm，项目使用 10.13.1 |

即使版本号相同，不同发行包的资源也可能存在差异。固定补丁只用于指纹一致的资源；其他构建会自动重新定位，成功后生成与当前资源指纹绑定的补丁。结构有变化、匹配存在歧义或译文冲突的普通文案保留原文；无法确认搜索逻辑、其依赖或完整性校验时停止安装。自动适配不等于该构建已完成实机验收。版本适配信息见 [版本配置](scripts/versions.js) 和 [补丁清单](adapters)。

## 快速开始

### 获取项目

在已安装 Git、Node.js 和 pnpm 的终端中执行：

```sh
git clone https://github.com/zhexin233-ui/cursor-translate.git
cd cursor-translate
pnpm install --frozen-lockfile
```

当前通过项目源码运行，尚未提供独立安装程序。

### 检查状态

```sh
node src/cli.js status
```

工具会自动查找常见安装目录，并显示 Cursor 版本、适配方式和补丁状态。未知版本会先在内存中尝试适配，此命令不会修改应用或保存适配缓存。首次扫描两份工作台脚本可能需要一分钟或更长时间。

### 安装汉化

**完全退出 Cursor，包括后台进程**，然后执行：

```sh
node src/cli.js install
```

安装成功后重新打开 Cursor，进入设置即可查看中文界面。

### 卸载恢复

完全退出 Cursor 后执行：

```sh
node src/cli.js uninstall
```

工具会核验当前应用与备份，再恢复对应版本的原始资源。卸载完成后保留备份，便于检查恢复结果。

## 命令与选项

| 命令或选项 | 说明 |
| --- | --- |
| `status` | 查询版本、适配情况和安装状态 |
| `install` | 校验、备份并安装汉化补丁 |
| `uninstall` | 恢复安装前的应用资源 |
| `--app-path <路径>` | 指定 Cursor 应用根目录 |
| `--state-dir <路径>` | 指定备份与操作记录目录 |
| `--json` | 输出 JSON 格式的结果 |
| `--help` | 查看帮助 |

macOS 指定 `.app` 路径：

```sh
node src/cli.js install --app-path "/Applications/Cursor.app"
```

Windows 指定包含 `Cursor.exe` 的目录，例如在 PowerShell 中执行：

```powershell
node src/cli.js install --app-path "$env:LOCALAPPDATA\Programs\cursor"
```

默认备份目录为用户主目录下的 `.cursor-settings-zh`，不同应用路径分别保存记录。使用自定义 `--state-dir` 时，安装、状态查询和卸载应使用同一个目录。

应用目录需要可写权限。工具不会自动提权；遇到权限错误时，请使用有权限的账户，或将 Cursor 安装在用户可写的位置。

## 备份、签名与更新

### 备份方式

- **Windows**：备份两份工作台脚本和 `product.json`。
- **macOS**：完整备份应用包，保留原签名及相关文件元数据，并记录完整应用树指纹。

macOS 完整备份约需一个应用包的空间；卸载暂存恢复副本时还需要额外空间。卸载后保留的原版备份和交换前应用路径，可在操作记录 `state.json` 的 `backup` 与 `restore.displaced` 字段中查看。

### macOS 签名说明

修改应用资源后，工具会使用临时签名重新签署应用，保留原有权限与 hardened runtime，并为主进程及 Helper 添加 `com.apple.security.cs.disable-library-validation`。这会放宽该应用的动态库校验，以便临时签名进程加载 Electron 库。

首次启动可能出现钥匙串访问授权，请在 macOS 系统弹窗中自行完成验证。工具不会读取或代填系统密码，也不会自动清除应用隔离属性。卸载时通过完整备份恢复原应用及其签名。

### Cursor 更新后

Cursor 更新可能覆盖补丁。更新后先执行 `status`，再完全退出 Cursor 并运行 `install`。工具会自动尝试识别新版本，无需先手动添加版本号或复用旧位置。通过结构、依赖和语法检查后，重新备份当前版本并安装；旧版本的备份与记录继续保留，不能跨版本用于卸载恢复。

自动适配发生在运行命令时，本项目不安装后台守护程序，也不会在 Cursor 更新后自行修改应用。尚未识别的新结构可通过仓库后续更新补充。安装时生成的适配数据保存在本次备份目录的 `adapter.json`；即使该缓存被删除，卸载仍可依据操作记录和原始备份恢复。

## 常见问题

### 提示 Cursor 仍在运行

关闭窗口不一定代表应用已退出。请完全退出 Cursor，并确认后台进程和更新程序已结束，再重新执行命令。

### 安装后仍显示英文

先执行 `status`，确认补丁已安装到当前使用的 Cursor 路径，然后完全退出并重新启动应用。请确认查看的是 Cursor 设置；聊天、Customize 页面和标准 VS Code 设置不在汉化范围内。

### 提示版本或资源指纹不匹配

工具会先尝试重新识别当前构建。如果搜索函数或依赖发生变化、结构无法唯一确认，或完整性校验失败，则停止安装。已安装补丁的相同构建若出现未知修改，也会拒绝覆盖。请勿手动跳过校验。反馈时提供 Cursor 版本、操作系统和错误信息即可，无需提供密钥、账户凭据或个人配置。

### 安装或卸载中断

先完全退出 Cursor，使用相同的应用路径和备份目录执行 `uninstall`。如果提示残留 `lock`，请确认没有补丁工具进程运行，再删除提示路径下的空 `lock` 目录后重试。

macOS 即使原 `.app` 路径在目录交换中暂时缺失，也可通过明确的 `--app-path` 和原 `--state-dir` 继续恢复。如果应用包含无法确认的修改，工具会拒绝自动覆盖。此时请保留当前应用和备份，使用官方对应版本安装包恢复，避免将旧脚本覆盖到新版本。

## 开发与验证

```sh
pnpm test
pnpm check
pnpm check:auto
```

- `pnpm test`：运行自动化测试，覆盖补丁范围、搜索、版本保护、安装卸载、失败回滚与中断恢复，无需安装 Cursor。
- `pnpm check`：读取已验证版本的原版资源，检查两份完整脚本的语法，并执行实际搜索函数。已安装补丁时，可使用默认备份目录中的原版备份。
- `pnpm check:auto`：对真实原版资源模拟偏移及局部变量名变化，验证自动重定位后的语法、中英文搜索、混合查询和跳转。可通过 `node scripts/check-auto.js "/path/to/resources/app"` 指定原版资源目录。

主要维护文件：

| 路径 | 用途 |
| --- | --- |
| `dictionaries/zh-CN.tsv` | 中英文映射词典 |
| `adapters/` | 已验证版本的补丁清单及自动适配结构模板 |
| `scripts/versions.js` | 已适配版本的资源指纹与定位信息 |
| `scripts/build-adapter.js` | 生成标准 IDE 设置补丁 |
| `scripts/build-glass-adapter.js` | 生成独立 Agents 设置补丁 |
| `src/` | AST 重定位、命令行、安装、签名与恢复逻辑 |
| `test/` | 自动化测试 |

词典调整后，应针对对应版本的**原版资源目录**重新生成两份补丁清单，再运行测试与资源检查：

```sh
node scripts/build-adapter.js "/path/to/resources/app"
node scripts/build-glass-adapter.js "/path/to/resources/app"
node scripts/check.js "/path/to/resources/app"
node scripts/check-glass.js "/path/to/resources/app"
pnpm test
```

词典或已验证补丁调整后，还应从对应原版资源更新自动适配模板：

```sh
node scripts/build-auto-patterns.js "/path/to/resources/app"
```

可传入多个已验证版本的原版资源目录以合并模板。新增结构仍需核验显示文案、搜索逻辑和平台兼容性。当前自动化测试共 35 项，包含未知版本安装、更新重装、依赖变化、持久化失败与中断恢复。

## 问题反馈

欢迎通过 [Issues](https://github.com/zhexin233-ui/cursor-translate/issues) 反馈遗漏翻译、兼容性问题或版本适配需求。请附上 Cursor 版本、操作系统、复现步骤，以及已隐去个人信息的截图或错误提示。

本项目仅提供汉化工具与定点补丁数据，不分发 Cursor 完整资源或安装包。Cursor 及相关商标归各自权利人所有。
