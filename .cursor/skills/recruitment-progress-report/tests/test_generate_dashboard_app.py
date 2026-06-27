import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "generate_dashboard_app.py"
)


def load_module():
    spec = importlib.util.spec_from_file_location("generate_dashboard_app", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GenerateDashboardAppTest(unittest.TestCase):
    def test_write_dashboard_app_creates_fixed_entry_and_month_data(self):
        module = load_module()
        data_by_month = {
            "2026-05": {
                "overview": {"统计月份": "2026-05", "月度目标": 100},
                "channel_mix": [],
                "base_channel_progress": [],
                "base_risks": [],
                "unmet_reasons": [],
                "funnel_attribution": {"rules": {}, "base_rows": [], "unmatched_jobs": []},
                "efficiency_summary": [],
                "recruiter_details": [],
            },
            "2026-06": {
                "overview": {"统计月份": "2026-06", "月度目标": 120},
                "channel_mix": [],
                "base_channel_progress": [
                    {
                        "基地": "A基地",
                        "渠道": "自主社招",
                        "月度目标": 20,
                        "截止目标": 10,
                        "实际入培数": 5,
                        "GAP": -15,
                        "达成率": "25.00%",
                        "渠道目标占比": "100.00%",
                        "渠道达成占比": "100.00%",
                        "占比GAP": "0.00%",
                        "达成率_value": 25.0,
                        "达成率未达成": True,
                    }
                ],
                "base_risks": [],
                "unmet_reasons": [],
                "funnel_attribution": {
                    "rules": {"目标面通率": "70.00%"},
                    "base_rows": [{"基地": "A基地", "归因判断": "到面人数不足"}],
                    "unmatched_jobs": [],
                },
                "efficiency_summary": [],
                "recruiter_details": [],
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "招聘负责人看板"

            module.write_dashboard_app(output_dir, data_by_month)

            html = (output_dir / "index.html").read_text(encoding="utf-8")
            months = json.loads((output_dir / "data" / "months.json").read_text(encoding="utf-8"))
            june = json.loads((output_dir / "data" / "2026-06.json").read_text(encoding="utf-8"))

        self.assertIn("人才开发招聘运营数据看板", html)
        self.assertIn("loadMonth", html)
        self.assertIn("scopeSelect", html)
        self.assertIn("年度", html)
        self.assertIn("data-tab-target=\"funnel\"", html)
        self.assertIn("招聘漏斗归因", html)
        self.assertIn("各基地渠道达成明细", html)
        self.assertIn("整体达成", html)
        self.assertIn("rowspan", html)
        self.assertIn("rate-danger", html)
        self.assertIn("renderBaseChannelProgress", html)
        self.assertIn("renderFunnelAttribution", html)
        self.assertIn("buildAnnualData", html)
        self.assertIn("loadAnnual", html)
        self.assertEqual(months, ["2026-05", "2026-06"])
        self.assertEqual(june["overview"]["月度目标"], 120)


if __name__ == "__main__":
    unittest.main()
