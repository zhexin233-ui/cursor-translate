# Cursor 设置简体中文补丁

支持 **Cursor 3.27.22 和 3.27.14** 的定点资源汉化工具。使用本机原版设置模块生成 AST 节点清单，不做全局字符串替换，不注入 DOM 脚本。

## 支持范围

- 标准 IDE 窗口及独立 Agents 窗口的设置：导航、设置标题和说明、按钮、提示、可访问性标签及模块内相关弹窗。
- 中文子串搜索、英文关键词和混合查询；保留原搜索别名，兼容原英文标签跳转。
- 保留品牌、模型名、配置键、命令、示例路径及用户内容。Customize 只翻译导航入口，不翻译页面。Agents/Glass 窗口仅翻译设置，聊天、终端、编辑器内容和标准 VS Code 设置不在本版范围。
- macOS 资源已核验；Windows 路径、进程检测、安装和恢复流程已实现并通过模拟测试，但**尚无真实 Windows 安装包与系统运行验收**。只接受与已核验资源完全相同的指纹，不据版本号放行。

适配版本：

| 版本 | commit | IDE 原始 SHA-256 |
| --- | --- | --- |
| 3.27.22 | `b1aa50cb6db84fd3e8c808259cb172ea73425c10` | `fd9ac3ed70ddcfa975f357187152488abcc8a4d183d776442593d5967b9821b6` |
| 3.27.14 | `69b724ebc67ec522c1b5d287a5025f7a7e81be90` | `5197ce48a203b89b28c2e1ec0c8eefd393ea40ecb7d37c5e33cc594629ed771b` |

Glass 资源独立核验指纹，与 IDE 一同备份、安装和恢复。

## 使用

需要 Node.js 22 或更高版本、pnpm。先在此项目目录安装依赖：

```sh
pnpm install --frozen-lockfile
node src/cli.js status
```

完全退出 Cursor 后安装，重新打开应用查看中文设置：

```sh
node src/cli.js install
```

卸载同样需要完全退出 Cursor：

```sh
node src/cli.js uninstall
```

非默认安装位置可指定应用根目录，macOS 为 `.app`，Windows 为包含 `Cursor.exe` 的目录：

```sh
node src/cli.js status --app-path '/Applications/Cursor.app'
node src/cli.js install --app-path 'C:\Users\你的用户名\AppData\Local\Programs\cursor'
```

`--json` 输出结构化结果；`--state-dir 路径` 更改备份位置。安装和卸载必须使用同一个备份目录。默认位置为 `~/.cursor-settings-zh/`，按安装路径隔离。

可写的用户安装不需要管理员权限。若预检提示目录无写入权限，请使用有权限的账户或在用户可写位置安装应用；工具不会自动提权。

## 备份、签名与更新

安装前核验版本、commit、整个目标脚本指纹和原版完整性校验清单。所有补丁在内存生成、验证语法后才写入；同步更新目标资源的 SHA-256 完整性校验值。重复安装不叠加补丁。

Windows 备份两份脚本和 `product.json`。macOS 使用 `ditto --rsrc --extattr --acl` 完整备份应用并验证原签名，随后以临时签名重新签署修改后的应用，保留各进程原有 entitlements、flags、runtime 元数据，并为主进程和 Helper 添加 `com.apple.security.cs.disable-library-validation`，允许没有 Team ID 的临时签名进程加载 Electron 库；不清除隔离属性。这会放宽该应用的动态库校验，hardened runtime 仍保留。macOS 的原 Developer ID 签名在安装补丁期间被替换，卸载通过完整备份恢复。首次启动可能停在钥匙串访问授权，请本人在系统弹窗完成验证，工具不会读取或代填系统密码。

macOS 记录完整应用树指纹，检测额外文件、符号链接和内容变化。完整备份通常约占一个应用的磁盘空间；卸载暂存恢复副本还需要一个应用的空间。卸载后保留原备份以及交换前的应用目录，路径位于 `state.json` 的 `backup` 和 `restore.displaced`，确认恢复正常后可以自行删除。

Cursor 更新会覆盖补丁。更新后先运行 `status`，新版本需要重新适配。工具拒绝把旧版本备份覆盖到新应用，也拒绝覆盖第三方未知修改。不要在 Cursor 运行期间执行安装或卸载，首版不安装守护程序。

## 中断恢复

安装失败会尝试回滚。未完成事务会保留备份和阶段记录；先完全退出 Cursor，然后运行同一 `uninstall` 命令。若存在残留 `lock`，确认没有补丁工具进程后，删除提示路径下的空 `lock` 目录再重试。

macOS 目录交换路径在操作前写入日志；即使原 `.app` 路径暂时缺失，也可使用明确的 `--app-path` 和原 `--state-dir` 重试卸载。若签名中断后的应用树无法证明属于本次补丁，工具将拒绝自动覆盖，并给出完整原版备份位置。此时保留当前应用和备份，用官方对应版本安装包恢复应用；不要手动将旧脚本覆盖到新版本。

## 开发与验证

```sh
pnpm test
pnpm check
```

`test` 不需要安装 Cursor；检查事务、回滚、进程保护、搜索与映射。`check` 只读本机原版资源（已安装时使用默认备份目录中的完整原版备份），在临时目录验证完整补丁脚本语法，并执行实际设置搜索函数，结束后删除临时脚本。可通过 `pnpm check /完整路径/Resources/app` 指定资源目录。

维护词典位于 `dictionaries/zh-CN.tsv`。`adapters/<版本>.json` 和 `<版本>-glass.json` 分别记录两套设置的原文、译文、位置、分类和预期命中数；`dictionaries/approved-extra.json` 是逐项审查的局部显示常量。维护者修改词典后运行：

```sh
node scripts/build-adapter.js
node scripts/build-glass-adapter.js
pnpm test
pnpm check
```

生成器只读原版应用，不修改应用；更换版本必须重新审查资源边界、AST、搜索函数、平台包指纹和可显示文案。`dictionaries/pending.json` 和 `glass-pending.json` 记录候选遗漏项，技术标识经审查后明确保留。未知动态或服务端文案保持英文。

本项目不分发 Cursor 完整资源或安装包；补丁清单仅包含定点修改所需片段。

## 本机验收记录

2026 年 10 月 27 日：正式 `/Applications/Cursor.app` 的 3.27.22 已完成安装、签名校验及启动验收。登录后的 Agents 设置导航、通用页和模型页显示中文；搜索“模型”及“Task Models”均返回正确结果，点击“任务模型”后成功跳转。模型名称保留原文，模型页面排版正常。

自动化测试共 20 项通过，两份完整工作台脚本的语法及真实搜索函数验证通过。Windows 未完成实机验收；部分共享导航文字（例如 Back）及动态服务端文案保留英文。
