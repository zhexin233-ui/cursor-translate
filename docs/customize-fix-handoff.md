# Customize 剩余英文修复交接

## 当前任务与状态

用户要求先总结、提交并推送本轮工作，再在新会话修复两处英文遗漏，以避免旧会话上下文过长。这个文件随本轮提交保存，新会话从推送后的 main 继续。

项目路径：`/Users/zhexin/github/cursor-translate`。前端包管理器使用 pnpm，回复、注释和提交信息使用简体中文。用户全局 AGENTS.md 要求子代理只做探索与核验；派生时用 default 角色、显式 fork_turns=none，多个探索并发派发后主代理等待全部结果，代码修改与最终验证由主代理负责。

## 本轮已完成

- 将 Customize 主界面、分类、浏览与管理、插件详情、市场导入及团队市场设置纳入汉化。
- 增加共享控件及未命名编译区的显示节点补丁，覆盖新建命名表单、错误校验、MCP 状态、视图菜单、市场作用范围、成员范围、IDE 标签标题及迁移横幅。
- 支持显示表达式的 AST 绑定编码/解码；详情分组仅在渲染时翻译，内部英文类型不变，避免打开源码回调失效。
- 生成 3.27.14 / 3.27.22 的 desktop、glass 固定清单与合并自动适配模板。
- 45 项测试通过；两版本四份完整资源语法、真实搜索、偏移及局部变量改名后的自动适配检查均通过。
- 已在 `/Applications/Cursor.app` 安装修正版（3.27.22，共 3464 处修改），两次钥匙串授权均由用户自行完成。
- 已实测新建表单、中文校验、中文/英文搜索和四类非空工作区文档源码跳转，详见 `docs/customize-acceptance-2026-10-28.md`。

## 必须修复并复验的两处遗漏

1. **Agents 壳层侧栏的 Customize 按钮**仍显示英文。页面内部、IDE 窗口和编辑器标签已显示“自定义”。
2. **本地市场导入的系统文件夹选择框**，标题 `Select a local marketplace folder`、确认按钮 `Select Folder` 仍为英文。复现路径：Agents → Customize → 浏览插件市场 → 添加插件市场 → 从磁盘导入。只打开/取消，不实际导入市场。

不要把“已经添加翻译字典/命中旧函数”当成修复完成；必须观察真实正在使用的界面变成中文。

## 已尝试路径及重要陷阱

- `scripts/customize-standalone.js` 已翻译传统入口函数中的 `name:"Customize"`（22 desktop BFw / glass vKx，含 source:"agent_layout_browse_button"），但实机 Agents 壳层侧栏依旧英文。**这不是实际壳层入口已覆盖的证据**，需继续追踪当前渲染路径。是否来自 molten 独立产物、持久化侧栏模型或其他模块，尚未确认，不要把猜测当结论。
- 原版资源还有 molten/dist/renderer/assets 下的独立 renderer 文件（22 view-C7l0Um3Q.js，14 view-ytuq9TIb.js），前轮探索只发现命名弹窗副本，没有确认侧栏调用链。
- 文件夹选择框的标题和按钮实际来源尚未定位；不要只修改未被调用的导入表单。
- 当前固定适配器加载方式主要面向 desktop、glass 两份工作台脚本。若需要新增目标资源，应先理解 `src/patch.js`、`src/installer.js`、`src/adaptive.js` 及 `scripts/build-auto-patterns.js`，保留备份、校验、回滚和未知版本安全适配能力。特别注意自动适配目前对每份模板检查核心搜索补丁，不能直接把无搜索模块的第三份资源塞进去。
- 字符串 label 可能兼作技术类型。前轮曾直接翻译 PluginDetailView.helpers.js 的分组 label，导致 onOpenComponentSource 英文类型比较失败；已改成只翻译最终渲染表达式，不要回退这项修复。
- Customize 业务组件声明常在命名模块初始化器之前。只扫描初始化器会漏文案；同一顶层语句可能含多个模块，必须落实具体模块边界。
- 命令和工作区规则命名提示使用 NLS 调用，现有修复限定业务函数，将具体显示调用替换为字符串，不修改用户内容模板和技术标识。

## 关键维护文件

- `scripts/customize.js`、`dictionaries/customize-approved.json`：命名模块白名单与 AST 节点收集。
- `scripts/customize-standalone.js`：独立函数/类的显示节点、新建模板、NLS 显示调用。
- `scripts/build-adapter.js`、`scripts/build-glass-adapter.js`：固定清单构建。
- `scripts/verify-customize.js`：真实分组技术类型与中文渲染核验。
- `test/customize.test.js`、`test/customize-standalone.test.js`：本轮新增回归测试。
- `dictionaries/zh-CN.tsv`、`adapters/`：翻译与生成数据。
- `docs/customize-acceptance-2026-10-28.md`：逐项实机结果、两处未通过项和未执行流程，完成后更新。

## 本机可用原版资源

22：
`/Users/zhexin/.cursor-settings-zh/68615b0344708911b1b6aa6d/backup-1793073643357-f8aa86ac-3637-41b0-9dcd-a74406079504/Cursor.app/Contents/Resources/app`

14：
`/tmp/cursor-zh-acceptance.tr5O0B/state/28180cc1cd8364c661eb7db2/backup-1793073298355-e4896b76-702b-4023-abcc-a8b0eb448333/Cursor.app/Contents/Resources/app`

两者已核验与 scripts/versions.js 指纹一致，内含两份工作台原文。14 位于临时目录，新会话先确认仍存在。**当前 /Applications/Cursor.app 已打补丁，不能作为原版输入。** 安装记录在 `~/.cursor-settings-zh/68615b0344708911b1b6aa6d/state.json`；后续安装也创建了新的完整备份，读取当前记录确认，不要猜目录。

## 构建、检查与安装

词典/脚本改动后，从两个版本原版目录分别运行 build-adapter.js、build-glass-adapter.js、check.js、check-glass.js；再传入两个原版目录运行 build-auto-patterns.js，并分别运行 check-auto.js。另运行 pnpm test 和 git diff --check。

当前安装器会将相同版本已安装补丁视为无需重复安装，因此更新补丁应在正常退出 Cursor 后先执行 uninstall，再 install，随后 status 确认。不要绕过运行进程检查、指纹检查或应用树保护，不要直接裸写应用资源来规避备份/签名流程。

启动后可能因新的临时签名再次触发 macOS 钥匙串授权。前轮表现为 Cursor 主进程存在但没有 renderer/主窗口，CUA 超时；sample 诊断停在 SecItemCopyMatching。需要用户自行完成系统弹窗，不读取或代填密码。重新安装与必要的复验已由用户授权，不需重复请求一般操作许可。

## UI 验证与收尾

原会话用 cua_repl 控制本机 Cursor；新会话先按工具要求获取文档与应用。使用完整路径 `/Applications/Cursor.app`，bundle ID 可能因安装器保留的 displaced 应用存在歧义。所有 UI 动作走 cua_repl，不用 AppleScript 或 shell 模拟 UI。

临时项目 `/var/folders/x5/s776s1nd1wsbcxdskf5ftb400000gn/T/cursor-zh-ui-acceptance-7ahk09cn` 仅含验收文档，已关闭，未运行命令或发起聊天。Cursor 最后停在原有 Agents 窗口的 MCP 管理页。不要修改用户规则、插件正文或现有 MCP 配置；不实际创建市场、不安装/卸载插件、不发布、不授权第三方服务。

新会话应完成两处代码修复、必要回归检查、本机重新安装及这两个真实界面复验，然后更新验收记录。不要只汇报发现问题或把未通过项写成通过。
