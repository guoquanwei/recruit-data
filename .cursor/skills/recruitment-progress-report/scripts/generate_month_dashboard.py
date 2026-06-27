#!/usr/bin/env python3
import argparse
import re
import subprocess
import sys
from pathlib import Path


def latest_match(root, pattern, label):
    matches = sorted(root.glob(pattern))
    if not matches:
        raise FileNotFoundError(f"未找到{label}：{pattern}")
    return matches[-1]


def resolve_month_files(root, month):
    archive_dir = root / "人才开发目标拆解归档"
    target = latest_match(archive_dir, f"人才开发目标拆解-{month}月-*.xlsx", f"人才开发目标拆解-{month}月")
    active = latest_match(root, "在职员工信息_*.xlsx", "在职员工信息")
    leave = latest_match(root, "离职员工信息_*.xlsx", "离职员工信息")
    return {
        "target": target,
        "active": active,
        "leave": leave,
        "report": root / "月度招聘达成进度" / f"月度招聘达成进度-{month}月.xlsx",
        "dashboard": root / "招聘负责人看板" / f"招聘负责人看板-{month}月.html",
    }


def run_command(command, root):
    subprocess.run(command, cwd=root, check=True)


def parse_report_month(path):
    match = re.search(r"月度招聘达成进度-(\d+)月\.xlsx$", path.name)
    return int(match.group(1)) if match else None


def iter_month_reports(report_dir):
    reports = []
    for path in sorted(report_dir.glob("月度招聘达成进度-*月.xlsx")):
        month = parse_report_month(path)
        if month is not None:
            reports.append((month, path))
    return reports


def generate_month_dashboard(root, year, month, cutoff_day=None, funnel_path=None):
    files = resolve_month_files(root, month)
    script_dir = Path(__file__).resolve().parent
    report_script = script_dir / "generate_report.py"
    dashboard_script = script_dir / "generate_dashboard.py"
    app_script = script_dir / "generate_dashboard_app.py"

    report_cmd = [
        sys.executable,
        str(report_script),
        "--target",
        str(files["target"]),
        "--active",
        str(files["active"]),
        "--leave",
        str(files["leave"]),
        "--year",
        str(year),
        "--month",
        str(month),
        "--output",
        str(files["report"]),
    ]
    if cutoff_day is not None:
        report_cmd.extend(["--cutoff-day", str(cutoff_day)])

    run_command(report_cmd, root)
    for report_month, report_path in iter_month_reports(files["report"].parent):
        dashboard_cmd = [
            sys.executable,
            str(dashboard_script),
            "--report",
            str(report_path),
            "--active",
            str(files["active"]),
            "--leave",
            str(files["leave"]),
            "--year",
            str(year),
            "--month",
            str(report_month),
            "--output",
            str(root / "招聘负责人看板" / f"招聘负责人看板-{report_month}月.html"),
        ]
        if funnel_path is not None:
            dashboard_cmd.extend(["--funnel", str(funnel_path)])
        run_command(dashboard_cmd, root)

    app_cmd = [
        sys.executable,
        str(app_script),
        "--active",
        str(files["active"]),
        "--leave",
        str(files["leave"]),
    ]
    if funnel_path is not None:
        app_cmd.extend(["--funnel", str(funnel_path)])
    run_command(app_cmd, root)
    return files


def main():
    parser = argparse.ArgumentParser(description="按固定目录一键生成月度招聘结果表和负责人看板。")
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--month", type=int, required=True)
    parser.add_argument("--cutoff-day", type=int, default=None)
    parser.add_argument("--funnel", default=None, help="Moka 招聘漏斗 Excel 文件，用于漏斗归因")
    parser.add_argument("--root", default=".", help="项目根目录，默认当前目录")
    args = parser.parse_args()

    files = generate_month_dashboard(
        Path(args.root).resolve(),
        args.year,
        args.month,
        args.cutoff_day,
        Path(args.funnel).resolve() if args.funnel else None,
    )
    print(
        {
            "report": str(files["report"]),
            "dashboard": str(files["dashboard"]),
            "target": str(files["target"]),
            "active": str(files["active"]),
            "leave": str(files["leave"]),
        }
    )


if __name__ == "__main__":
    main()
