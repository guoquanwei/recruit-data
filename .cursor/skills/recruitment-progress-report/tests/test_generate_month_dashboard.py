import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "generate_month_dashboard.py"
)


def load_module():
    spec = importlib.util.spec_from_file_location("generate_month_dashboard", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GenerateMonthDashboardTest(unittest.TestCase):
    def test_resolve_month_files_uses_fixed_directories_and_latest_employee_files(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / "人才开发目标拆解归档"
            archive.mkdir()
            target = archive / "人才开发目标拆解-7月-0701.xlsx"
            target.write_text("", encoding="utf-8")
            older_active = root / "在职员工信息_20260701.xlsx"
            latest_active = root / "在职员工信息_20260720.xlsx"
            leave = root / "离职员工信息_20260720.xlsx"
            older_active.write_text("", encoding="utf-8")
            latest_active.write_text("", encoding="utf-8")
            leave.write_text("", encoding="utf-8")

            files = module.resolve_month_files(root, 7)

        self.assertEqual(files["target"], target)
        self.assertEqual(files["active"], latest_active)
        self.assertEqual(files["leave"], leave)
        self.assertEqual(files["report"], root / "月度招聘达成进度" / "月度招聘达成进度-7月.xlsx")
        self.assertEqual(files["dashboard"], root / "招聘负责人看板" / "招聘负责人看板-7月.html")

    def test_resolve_month_files_reports_missing_fixed_inputs(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "人才开发目标拆解归档").mkdir()

            with self.assertRaises(FileNotFoundError) as error:
                module.resolve_month_files(root, 7)

        self.assertIn("人才开发目标拆解-7月", str(error.exception))


if __name__ == "__main__":
    unittest.main()
