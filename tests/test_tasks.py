from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from llm247.tasks import build_default_tasks
from llm247.worker import TaskContext


class DefaultTasksTests(unittest.TestCase):
    """测试默认任务构建器的核心功能，验证在不同环境下能否生成符合预期的任务提示"""

    def test_builds_non_empty_prompts_without_git_repo(self) -> None:
        """
        测试在无Git仓库的环境下，任务构建器能否正常生成非空提示
        验证系统在缺少Git元数据时的鲁棒性，确保仍能生成有意义的任务内容
        """
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            # 创建测试用的TODO文件，用于验证任务识别逻辑
            (root / "notes.txt").write_text("TODO: improve docs\n", encoding="utf-8")
            report_dir = root / "reports"
            report_dir.mkdir(parents=True, exist_ok=True)
            (report_dir / "sample.md").write_text("historical report", encoding="utf-8")
            context = TaskContext(
                workspace_path=root,
                report_dir=report_dir,
                now=datetime(2026, 3, 4, 0, 0, tzinfo=timezone.utc),
            )

            tasks = build_default_tasks()
            prompts = [task.prompt_builder(context) for task in tasks]
            
            # 验证提示列表非空
            self.assertNotEqual(len(prompts), 0, "生成的任务提示列表不能为空")
            # 验证每个提示都是有效非空字符串
            for prompt in prompts:
                self.assertIsInstance(prompt, str, "每个任务提示必须是字符串类型")
                self.assertTrue(len(prompt.strip()) > 0, "每个任务提示内容不能为空或仅包含空白字符")
