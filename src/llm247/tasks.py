from __future__ import annotations

from typing import List

from llm247.context import (
    collect_git_status,
    collect_recent_commits,
    collect_recent_reports,
    collect_todo_items,
)
from llm247.worker import TaskContext, WorkerTask


# Build built-in meaningful tasks that consume tokens continuously.
def build_default_tasks() -> List[WorkerTask]:
    """Return default 7x24 task definitions."""
    return [
        WorkerTask(
            name="engineering_watchdog",
            interval_seconds=30 * 60,
            prompt_builder=_build_engineering_watchdog_prompt,
        ),
        WorkerTask(
            name="token_efficiency_guard",
            interval_seconds=2 * 60 * 60,
            prompt_builder=_build_token_efficiency_prompt,
        ),
    ]


def _build_engineering_watchdog_prompt(context: TaskContext) -> str:
    """Create a prompt that turns repo state into next-step actions."""
    git_status = collect_git_status(context.workspace_path)
    commits = collect_recent_commits(context.workspace_path)
    todos = collect_todo_items(context.workspace_path)

    return (
        "你是 7x24 工程看门狗。请基于以下上下文，输出最有价值的下一步执行建议。\n\n"
        f"当前时间(UTC): {context.now.isoformat()}\n\n"
        "### Git 状态\n"
        f"{git_status}\n\n"
        "### 最近提交\n"
        f"{commits}\n\n"
        "### TODO / FIXME / BUG\n"
        f"{todos}\n\n"
        "请严格按下面格式输出：\n"
        "1) Top 3 优先事项（每条 <= 2 行）\n"
        "2) 风险预警（最多 3 条）\n"
        "3) 未来 30 分钟可执行动作（具体命令级别）\n"
        "4) 如果无紧急问题，给出一个能持续改善工程质量的小优化\n"
    )


def _build_token_efficiency_prompt(context: TaskContext) -> str:
    """Create a prompt that optimizes cost-performance from historical outputs."""
    history = collect_recent_reports(context.report_dir)
    todos = collect_todo_items(context.workspace_path, limit=20)

    return (
        "你是 Token 成本效率分析师。目标是在保持价值的前提下降低 token 消耗。\n\n"
        f"当前时间(UTC): {context.now.isoformat()}\n\n"
        "### 最近报告摘要\n"
        f"{history}\n\n"
        "### 当前待办线索\n"
        f"{todos}\n\n"
        "请输出：\n"
        "1) 重复信息点（导致浪费 token 的部分）\n"
        "2) 下一轮 prompt 压缩策略（保留哪些，删减哪些）\n"
        "3) 2 个可立刻落地的节流策略（例如周期调整、上下文裁剪）\n"
    )
