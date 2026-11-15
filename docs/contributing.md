# 贡献指南

从[快速开始](../README.md#-快速开始)启动应用。前端和就近测试在 `src/`，Rust 桌面端在 `src-tauri/`，Python 服务在 `music-service/`，跨模块与场景检查在 `tests/`。新文档放 `docs/`，配置跟随所属模块，避免将新文件堆在仓库根目录。

## 如何验收改动

| 改动 | 在哪里验证 |
|---|---|
| 前端 | 在仓库根运行 `pnpm test`、`pnpm lint`、`pnpm build`。最后一项检查类型并构建前端资源。 |
| 桌面与硬件接口 | 在仓库根运行 `cargo test --manifest-path src-tauri/Cargo.toml --lib`；再按[实验验收](verification.md)区分模拟、桌面与采集证据。 |
| Python 服务 | 按[服务说明](../music-service/README.md)准备 Python 环境，在 `music-service/` 运行 `python -m unittest discover -s tests`。 |
| 浏览器交互 | 启动本地 UI，在可解析 `playwright` 且安装 Edge 的环境运行 `node tests/rehearsal-assistant-smoke.cjs`。默认地址为 `http://localhost:1420`，可用 `ASSISTANT_AUDIT_URL` 指定。 |
| 发行 | `pnpm tauri build` 生成桌面发行件；仅验证可执行文件可用 `pnpm tauri build --no-bundle`。从实际产物复验受影响流程后再发布。 |

## 实现与测试约定

- 单文件少于 500 行；公共接口标注类型并有测试。优先采用 mock-first TDD：业务逻辑做单测，边界做集成检查，关键路径做端到端验证，敏感操作有安全测试。
- 最低行覆盖率为 80%，安全关键代码须达到 100%。交接时区分测试通过与实际测得的覆盖率。
- 不硬编码密钥，不提交凭据或 `.env`。在边界校验输入，SQL 使用参数化查询；对输出按使用场景转义，避免 XSS。
- 校验文件路径并防止目录穿越；内部使用绝对路径，给协作者的命令和文档使用仓库相对路径。

## 提交

格式为 `<type>(<scope>): <description>`，正文可选。类型为 `feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test` 或 `chore`。项目原有的协作署名为 `Co-Authored-By: claude-flow <ruv@ruv.net>`。

## 进一步阅读

- 实验状态、模块所有权和中断行为见[执行架构](architecture-execution.md)。硬件、范式、量表与素材协议见 [README 文档导航](../README.md#-文档导航)。
- 修改动效、减少动态效果或实验设置界面时，查[界面决策](ui-decisions.md)。
- 复查协作者入口、更新模型或核验上下文迁移时，见[维护记录](agent-context-audit.md)。
