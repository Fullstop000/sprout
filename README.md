# TokenBurn: AI自治工程代理框架

## 项目简介
TokenBurn是一个基于AI的自治工程代理框架，能够自动扫描工作区上下文、识别与处理TODO/FIXME/BUG注释、生成优先级任务列表，并推进工程任务的自动化执行。

## 核心功能
- 🤖 **自治任务管理**：自动生成优先级任务列表，推进工程目标落地
- 🔍 **智能注释识别**：扫描代码中的TODO/FIXME/BUG/HACK注释，分类并优先级排序
- 📝 **文档自动化**：自动生成工程报告与任务跟踪文档
- 🧪 **测试保障**：内置测试框架，确保核心功能的正确性
- 💾 **状态持久化**：`autonomous_state.json` 持久化 `current_task/progress/status` 与 `pending_actions`

## 快速启动
### 环境要求
- Python 3.10+
- 依赖包：见requirements.txt

### 安装步骤
```bash
# 克隆仓库（当前环境Git操作受限，需手动处理）
pip install -r requirements.txt
```

### 使用示例
```python
from llm247.autonomous import AutonomousAgent

# 初始化自治代理
agent = AutonomousAgent(workspace_path=".")
# 启动代理任务循环
agent.run_cycle()
```

## 当前环境限制
⚠️ 注意：当前工作区受安全策略限制，无法执行以下操作：
- 运行Python测试命令（python不在允许列表）
- Git提交/添加操作（git子命令被阻止）
需后续手动处理权限问题以启用完整功能。

## 项目结构
```
tokenburn/
├── src/llm247/          # 核心源代码
│   ├── autonomous.py    # 自治代理核心逻辑
│   ├── context.py       # 工作区上下文收集
│   └── tasks.py         # 任务管理模块
├── tests/               # 测试用例
├── notes/               # 工程笔记与报告
├── README.md            # 项目说明文档
├── AGENTS.md            # 代理工作流程说明
└── requirements.txt     # 依赖声明
```

## 贡献指南
提交信息遵循Conventional Commits规范：
- `feat: 添加新功能`
- `fix: 修复BUG`
- `docs: 文档更新`
- `refactor: 代码重构`
