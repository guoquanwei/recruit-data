#!/usr/bin/env python3
import argparse
import importlib.util
import json
import re
from pathlib import Path


APP_TITLE = "人才开发招聘运营数据看板"


def load_dashboard_module():
    script_path = Path(__file__).resolve().parent / "generate_dashboard.py"
    spec = importlib.util.spec_from_file_location("generate_dashboard", script_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_month_key(path):
    match = re.search(r"月度招聘达成进度-(\d+)月\.xlsx$", path.name)
    if not match:
        return None
    return f"2026-{int(match.group(1)):02d}"


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def write_dashboard_app(output_dir, data_by_month):
    output_dir.mkdir(parents=True, exist_ok=True)
    data_dir = output_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    months = sorted(data_by_month)
    write_json(data_dir / "months.json", months)
    for month_key, data in data_by_month.items():
        write_json(data_dir / f"{month_key}.json", data)

    (output_dir / "index.html").write_text(render_index_html(), encoding="utf-8")


def render_index_html():
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{APP_TITLE}</title>
  <style>
    :root {{
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #172033;
      --muted: #687385;
      --line: #d9dee8;
      --danger: #c0392b;
      --ok: #177245;
      --accent: #1f5eff;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, "Microsoft YaHei", sans-serif;
    }}
    main {{ max-width: 1280px; margin: 0 auto; padding: 28px; }}
    header {{ display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; margin-bottom: 20px; }}
    h1 {{ margin: 0 0 8px; font-size: 24px; }}
    h2 {{ margin: 0 0 14px; font-size: 18px; }}
    h3 {{ margin: 0 0 6px; font-size: 15px; }}
    p {{ margin: 0; color: var(--muted); }}
    section {{ background: var(--panel); border: 1px solid var(--line); padding: 18px; margin-bottom: 18px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    th, td {{ border-bottom: 1px solid var(--line); padding: 9px 8px; text-align: left; }}
    th {{ color: var(--muted); font-weight: 600; }}
    select {{ border: 1px solid var(--line); background: var(--panel); padding: 6px 8px; color: var(--text); }}
    .filters {{ display: flex; gap: 12px; align-items: center; }}
    .tabs {{ display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }}
    .tab-button {{ border: 1px solid var(--line); background: var(--panel); color: var(--muted); padding: 10px 14px; cursor: pointer; }}
    .tab-button.active {{ color: var(--accent); border-color: var(--accent); font-weight: 700; }}
    .tab-panel {{ display: none; }}
    .tab-panel.active {{ display: block; }}
    .metrics {{ display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }}
    .metric {{ background: var(--panel); border: 1px solid var(--line); padding: 16px; }}
    .metric span {{ display: block; color: var(--muted); font-size: 12px; margin-bottom: 10px; }}
    .metric strong {{ font-size: 22px; }}
    .danger {{ color: var(--danger); font-weight: 700; }}
    .ok {{ color: var(--ok); font-weight: 700; }}
    .base-group-cell {{ background: #f7f9fd; border-right: 2px solid var(--accent); font-weight: 700; vertical-align: middle; }}
    .base-group-row td {{ border-bottom-color: #e8ecf3; }}
    .rate-danger {{ color: var(--danger); font-weight: 700; }}
    .mix-grid {{ display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }}
    .mix-card {{ border: 1px solid var(--line); padding: 12px; background: #fbfcfe; }}
    .mix-card strong, .mix-card span, .mix-card em {{ display: block; }}
    .mix-card span, .mix-card em {{ color: var(--muted); font-size: 12px; font-style: normal; margin-top: 6px; }}
    .section-note {{ margin: 0 0 12px; font-size: 12px; color: var(--muted); }}
    .reason-list {{ display: grid; gap: 14px; }}
    .reason-card {{ border: 1px solid var(--line); padding: 14px; background: #fbfcfe; }}
    .reason-card > div {{ display: flex; justify-content: space-between; gap: 16px; align-items: baseline; margin-bottom: 10px; }}
    .reason-card p {{ color: var(--danger); font-weight: 700; }}
    .detail-number {{ border: 0; background: transparent; color: var(--accent); font-weight: 700; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }}
    .modal-mask {{ position: fixed; inset: 0; display: none; background: rgba(23, 32, 51, 0.45); z-index: 20; padding: 28px; }}
    .modal-mask.open {{ display: block; }}
    .modal-panel {{ width: min(1180px, 100%); max-height: calc(100vh - 56px); margin: 0 auto; background: var(--panel); border: 1px solid var(--line); display: flex; flex-direction: column; }}
    .modal-head {{ display: flex; justify-content: space-between; gap: 16px; align-items: center; border-bottom: 1px solid var(--line); padding: 16px 18px; }}
    .modal-head h2 {{ margin: 0; }}
    .modal-close {{ border: 1px solid var(--line); background: var(--panel); padding: 6px 10px; cursor: pointer; }}
    .modal-body {{ overflow: auto; padding: 14px 18px 18px; }}
    .column-filter {{ width: 100%; border: 1px solid var(--line); padding: 5px 6px; font-size: 12px; }}
    .muted {{ color: var(--muted); text-align: center; }}
    @media (max-width: 980px) {{
      main {{ padding: 18px; }}
      header {{ display: block; }}
      .metrics {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
      .mix-grid {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>{APP_TITLE}</h1>
        <p id="subtitle">加载中...</p>
      </div>
      <div class="filters">
        <label>统计口径
          <select id="scopeSelect">
            <option value="month">单月</option>
            <option value="year">全年</option>
          </select>
        </label>
        <label>年份 <select id="yearSelect"></select></label>
        <label id="monthFilterWrap">月份 <select id="monthSelect"></select></label>
      </div>
    </header>
    <nav class="tabs" aria-label="看板页签">
      <button type="button" class="tab-button active" data-tab-target="overview" onclick="switchDashboardTab('overview')">达成总览</button>
      <button type="button" class="tab-button" data-tab-target="risk" onclick="switchDashboardTab('risk')">基地风险</button>
      <button type="button" class="tab-button" data-tab-target="funnel" onclick="switchDashboardTab('funnel')">招聘漏斗归因</button>
      <button type="button" class="tab-button" data-tab-target="efficiency" onclick="switchDashboardTab('efficiency')">自主社招人效</button>
    </nav>
    <div class="tab-panel active" data-tab-panel="overview">
      <div id="metrics" class="metrics"></div>
      <section>
        <h2>全局渠道占比</h2>
        <div id="channelMix" class="mix-grid"></div>
      </section>
      <section>
        <h2>各基地渠道达成明细</h2>
        <p class="section-note">标红表示基地或渠道当前未达成。</p>
        <table>
          <thead>
            <tr>
              <th>基地</th><th>渠道</th><th>月度目标</th><th>截止目标</th><th>实际入培</th>
              <th>GAP</th><th>达成率</th><th>目标占比</th><th>达成占比</th><th>占比GAP</th>
            </tr>
          </thead>
          <tbody id="baseChannelProgress"></tbody>
        </table>
      </section>
    </div>
    <div class="tab-panel" data-tab-panel="risk">
      <section>
        <h2>基地风险</h2>
        <table>
          <thead><tr><th>基地</th><th>月度目标</th><th>截止目标</th><th>实际入培</th><th>GAP</th><th>达成率</th></tr></thead>
          <tbody id="baseRisks"></tbody>
        </table>
      </section>
      <section>
        <h2>未达成基地</h2>
        <div id="unmetReasons" class="reason-list"></div>
      </section>
    </div>
    <div class="tab-panel" data-tab-panel="funnel">
      <section>
        <h2>招聘漏斗归因</h2>
        <div id="funnelAttribution"></div>
      </section>
    </div>
    <div class="tab-panel" data-tab-panel="efficiency">
      <section>
        <h2>自主社招人效汇总</h2>
        <table>
          <thead><tr><th>统计维度</th><th>招聘规模</th><th>参培达成</th><th>参培人效</th><th>7天达成</th><th>7天人效</th></tr></thead>
          <tbody id="efficiencySummary"></tbody>
        </table>
      </section>
      <section>
        <h2>自主社招人员明细</h2>
        <table>
          <thead>
            <tr>
              <th>招聘专员姓名</th><th>伽睿工号</th><th>员工阶段</th><th>入职日期</th>
              <th>月度参培目标</th><th>截止参培目标</th><th>截止参培达成</th><th>截止参培达成率</th>
              <th>月度7天参培目标</th><th>截止7天参培目标</th><th>截止7天参培达成</th><th>截止7天参培达成率</th>
            </tr>
          </thead>
          <tbody id="recruiterDetails"></tbody>
        </table>
      </section>
    </div>
  </main>
  <div id="detailModal" class="modal-mask" onclick="closeDetail(event)">
    <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="detailModalTitle" onclick="event.stopPropagation()">
      <div class="modal-head">
        <h2 id="detailModalTitle">明细</h2>
        <button type="button" class="modal-close" onclick="closeDetail()">关闭</button>
      </div>
      <div id="detailModalBody" class="modal-body"></div>
    </div>
  </div>
  <script>
    let currentData = null;
    let availableMonths = [];
    let allMonthData = {{}};
    let detailPayload = {{}};
    const channelOrder = ['回流', '内推', '渠道社招', '渠道校招', '自主社招'];
    const employeeColumns = ['所属基地', '工号', '姓名', '手机号', '招聘渠道', '渠道名称', '入培日期', '在职状态', '离职日期', '在职天数'];
    const targetInterviewPassRate = 0.7;
    const targetPassToTrainRate = 0.4;
    const targetInterviewToTrainRate = targetInterviewPassRate * targetPassToTrainRate;

    function escapeHtml(value) {{
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({{
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }}[char]));
    }}

    async function loadMonths() {{
      availableMonths = await fetch('data/months.json').then((res) => res.json());
      await Promise.all(availableMonths.map(async (month) => {{
        allMonthData[month] = await fetch(`data/${{month}}.json`).then((res) => res.json());
      }}));
      const years = Array.from(new Set(availableMonths.map((month) => month.slice(0, 4))));
      const latestMonth = availableMonths[availableMonths.length - 1];
      const latestYear = latestMonth.slice(0, 4);

      document.getElementById('yearSelect').innerHTML = years.map((year) => `<option value="${{year}}">${{year}}</option>`).join('');
      document.getElementById('yearSelect').value = latestYear;
      renderMonthOptions(latestYear, latestMonth);

      document.getElementById('scopeSelect').addEventListener('change', applyFilters);
      document.getElementById('yearSelect').addEventListener('change', applyFilters);
      document.getElementById('monthSelect').addEventListener('change', applyFilters);
      applyFilters();
    }}

    function renderMonthOptions(year, selectedMonth = null) {{
      const months = availableMonths.filter((month) => month.startsWith(`${{year}}-`));
      const monthSelect = document.getElementById('monthSelect');
      monthSelect.innerHTML = months.map((month) => `<option value="${{month}}">${{month.slice(5)}}月</option>`).join('');
      monthSelect.value = selectedMonth && months.includes(selectedMonth) ? selectedMonth : months[months.length - 1];
    }}

    function applyFilters() {{
      const scope = document.getElementById('scopeSelect').value;
      const year = document.getElementById('yearSelect').value;
      document.getElementById('monthFilterWrap').style.display = scope === 'year' ? 'none' : '';
      renderMonthOptions(year, document.getElementById('monthSelect').value);
      if (scope === 'year') {{
        loadAnnual(year);
      }} else {{
        loadMonth(document.getElementById('monthSelect').value);
      }}
    }}

    function loadMonth(month) {{
      currentData = allMonthData[month];
      renderDashboard();
    }}

    function loadAnnual(year) {{
      const monthData = availableMonths
        .filter((month) => month.startsWith(`${{year}}-`))
        .map((month) => allMonthData[month]);
      currentData = buildAnnualData(year, monthData);
      renderDashboard();
    }}

    function toNumber(value) {{
      const num = Number(value);
      return Number.isFinite(num) ? num : 0;
    }}

    function pct(num, den) {{
      return den ? `${{(num / den * 100).toFixed(2)}}%` : '0.00%';
    }}

    function judgeFunnelAttribution(row) {{
      if (toNumber(row['招聘目标']) <= 0) return '截止目标未到期';
      if (toNumber(row['实际入培数']) >= toNumber(row['招聘目标'])) return '截止目标已达成';
      if (!row['实际到面人数']) return '漏斗数据缺失';
      if (row['实际到面人数'] < row['所需到面人数']) return '到面人数不足';
      if (toNumber(row['实际面通人数']) / toNumber(row['实际到面人数']) < targetInterviewPassRate) return '面通率偏低';
      if (toNumber(row['实际入培数']) / toNumber(row['实际面通人数']) < targetPassToTrainRate) return '面通转化差';
      return '其他原因';
    }}

    function buildAnnualFunnelAttribution(monthData) {{
      const map = new Map();
      monthData.flatMap((data) => (data.funnel_attribution || {{}}).base_rows || []).forEach((row) => {{
        const base = row['基地'];
        if (!map.has(base)) {{
          map.set(base, {{
            基地: base,
            招聘目标: 0,
            实际入培数: 0,
            实际到面人数: 0,
            实际面通人数: 0,
            推荐: 0,
            强烈推荐: 0,
            不推荐: 0,
            备选: 0,
            岗位数: 0
          }});
        }}
        const target = map.get(base);
        ['招聘目标', '实际入培数', '实际到面人数', '实际面通人数', '推荐', '强烈推荐', '不推荐', '备选', '岗位数'].forEach((field) => {{
          target[field] += toNumber(row[field]);
        }});
      }});
      const baseRows = Array.from(map.values()).map((row) => {{
        row['所需到面人数'] = Math.ceil(row['招聘目标'] / targetInterviewToTrainRate);
        row['所需面通人数'] = Math.ceil(row['招聘目标'] / targetPassToTrainRate);
        row['实际面通率'] = pct(row['实际面通人数'], row['实际到面人数']);
        row['实际面通到参培转化率'] = pct(row['实际入培数'], row['实际面通人数']);
        row['实际到面到参培综合转化率'] = pct(row['实际入培数'], row['实际到面人数']);
        row['归因判断'] = judgeFunnelAttribution(row);
        return row;
      }});
      const unmatchedMap = new Map();
      monthData.flatMap((data) => (data.funnel_attribution || {{}}).unmatched_jobs || []).forEach((row) => {{
        unmatchedMap.set(row['职位名称'], (unmatchedMap.get(row['职位名称']) || 0) + toNumber(row['记录数']));
      }});
      return {{
        rules: {{ 目标面通率: '70.00%', 目标面通到参培转化率: '40.00%', 目标到面到参培综合转化率: '28.00%', 目标口径: '截止目标' }},
        base_rows: baseRows,
        unmatched_jobs: Array.from(unmatchedMap.entries()).map(([job, count]) => ({{ 职位名称: job, 记录数: count }}))
      }};
    }}

    function aggregateRows(rows, keyField, factory) {{
      const map = new Map();
      rows.forEach((row) => {{
        const key = row[keyField];
        if (!map.has(key)) map.set(key, factory(row));
        const target = map.get(key);
        ['月度目标', '截止目标', '实际入培数', 'GAP'].forEach((field) => {{
          target[field] = toNumber(target[field]) + toNumber(row[field]);
        }});
      }});
      return Array.from(map.values());
    }}

    function buildAnnualData(year, monthData) {{
      const monthCount = monthData.length;
      const overviewTotals = monthData.reduce((acc, data) => {{
        acc.monthly += toNumber(data.overview['月度目标']);
        acc.cutoff += toNumber(data.overview['截止目标']);
        acc.actual += toNumber(data.overview['实际入培数']);
        return acc;
      }}, {{ monthly: 0, cutoff: 0, actual: 0 }});
      const channelRows = aggregateRows(
        monthData.flatMap((data) => data.channel_mix || []),
        '渠道',
        (row) => ({{
          基地: '整体',
          渠道: row['渠道'],
          月度目标: 0,
          截止目标: 0,
          实际入培数: 0,
          GAP: 0
        }})
      );
      const channelTarget = channelRows.reduce((sum, row) => sum + row['月度目标'], 0);
      const channelActual = channelRows.reduce((sum, row) => sum + row['实际入培数'], 0);
      channelRows.forEach((row) => {{
        row['达成率'] = pct(row['实际入培数'], row['月度目标']);
        row['渠道目标占比'] = pct(row['月度目标'], channelTarget);
        row['渠道达成占比'] = pct(row['实际入培数'], channelActual);
        const targetShare = channelTarget ? row['月度目标'] / channelTarget : 0;
        const actualShare = channelActual ? row['实际入培数'] / channelActual : 0;
        row['占比GAP'] = `${{((actualShare - targetShare) * 100).toFixed(2)}}%`;
      }});
      channelRows.sort((a, b) => b['实际入培数'] - a['实际入培数']);

      const baseRows = aggregateRows(
        monthData.flatMap((data) => data.base_risks || []),
        '基地',
        (row) => ({{
          基地: row['基地'],
          渠道: '合计',
          月度目标: 0,
          截止目标: 0,
          实际入培数: 0,
          GAP: 0
        }})
      ).filter((row) => row['月度目标'] || row['实际入培数']);
      baseRows.forEach((row) => {{
        row['达成率'] = pct(row['实际入培数'], row['月度目标']);
        row['风险等级'] = row['GAP'] < 0 ? '未达成' : '已达成';
      }});
      baseRows.sort((a, b) => (a['GAP'] < 0 ? 0 : 1) - (b['GAP'] < 0 ? 0 : 1) || a['GAP'] - b['GAP']);

      const baseChannelMap = new Map();
      monthData.flatMap((data) => data.base_channel_progress || []).forEach((row) => {{
        const key = `${{row['基地']}}-${{row['渠道']}}`;
        if (!baseChannelMap.has(key)) {{
          baseChannelMap.set(key, {{
            基地: row['基地'],
            渠道: row['渠道'],
            月度目标: 0,
            截止目标: 0,
            实际入培数: 0,
            GAP: 0
          }});
        }}
        const target = baseChannelMap.get(key);
        ['月度目标', '截止目标', '实际入培数', 'GAP'].forEach((field) => {{
          target[field] += toNumber(row[field]);
        }});
      }});
      const overallTotal = {{
        基地: '整体',
        月度目标: overviewTotals.monthly,
        截止目标: overviewTotals.cutoff,
        实际入培数: overviewTotals.actual,
        GAP: overviewTotals.actual - overviewTotals.monthly
      }};
      const baseTotals = new Map([overallTotal, ...baseRows].map((row) => [row['基地'], row]));
      const baseChannelRows = Array.from(baseChannelMap.values())
        .filter((row) => row['月度目标'] || row['实际入培数'])
        .map((row) => {{
          const total = baseTotals.get(row['基地']) || {{ 月度目标: 0, 实际入培数: 0, GAP: 0 }};
          const targetShare = total['月度目标'] ? row['月度目标'] / total['月度目标'] : 0;
          const actualShare = total['实际入培数'] ? row['实际入培数'] / total['实际入培数'] : 0;
          const rateValue = row['月度目标'] ? row['实际入培数'] / row['月度目标'] * 100 : 0;
          return {{
            ...row,
            达成率: pct(row['实际入培数'], row['月度目标']),
            达成率_value: rateValue,
            渠道目标占比: pct(row['月度目标'], total['月度目标']),
            渠道达成占比: pct(row['实际入培数'], total['实际入培数']),
            占比GAP: `${{((actualShare - targetShare) * 100).toFixed(2)}}%`,
            基地未达成: toNumber(total['GAP']) < 0,
            渠道未达成: rateValue < 100,
            达成率未达成: rateValue < 100
          }};
        }})
        .sort((a, b) => {{
          if (a['基地'] === '整体' && b['基地'] !== '整体') return -1;
          if (a['基地'] !== '整体' && b['基地'] === '整体') return 1;
          const aOrder = channelOrder.includes(a['渠道']) ? channelOrder.indexOf(a['渠道']) : channelOrder.length;
          const bOrder = channelOrder.includes(b['渠道']) ? channelOrder.indexOf(b['渠道']) : channelOrder.length;
          return String(a['基地']).localeCompare(String(b['基地'])) || aOrder - bOrder;
        }});

      const reasonMap = new Map();
      monthData.flatMap((data) => data.unmet_reasons || []).forEach((reason) => {{
        if (!reasonMap.has(reason['基地'])) reasonMap.set(reason['基地'], new Map());
        const channelMap = reasonMap.get(reason['基地']);
        (reason['主要缺口渠道'] || []).forEach((row) => {{
          const key = row['渠道'];
          if (!channelMap.has(key)) {{
            channelMap.set(key, {{
              渠道: key,
              月度目标: 0,
              截止目标: 0,
              实际入培数: 0,
              GAP: 0,
              明细: []
            }});
          }}
          const target = channelMap.get(key);
          ['月度目标', '截止目标', '实际入培数', 'GAP'].forEach((field) => {{
            target[field] += toNumber(row[field]);
          }});
          target['明细'].push(...(row['明细'] || []));
        }});
      }});
      const unmetReasons = Array.from(reasonMap.entries()).map(([base, channelMap]) => {{
        const channels = Array.from(channelMap.values())
          .filter((row) => row['月度目标'] || row['实际入培数'])
          .sort((a, b) => a['GAP'] - b['GAP'])
          .slice(0, 3);
        const totalTarget = channels.reduce((sum, row) => sum + row['月度目标'], 0);
        const totalActual = channels.reduce((sum, row) => sum + row['实际入培数'], 0);
        channels.forEach((row) => {{
          row['达成率'] = pct(row['实际入培数'], row['月度目标']);
          row['渠道目标占比'] = pct(row['月度目标'], totalTarget);
          row['渠道达成占比'] = pct(row['实际入培数'], totalActual);
          const targetShare = totalTarget ? row['月度目标'] / totalTarget : 0;
          const actualShare = totalActual ? row['实际入培数'] / totalActual : 0;
          row['占比GAP'] = `${{((actualShare - targetShare) * 100).toFixed(2)}}%`;
        }});
        return {{
          基地: base,
          判断: channels.some((row) => row['GAP'] < 0) ? '年度累计量不足' : '年度累计已达成',
          主要缺口渠道: channels
        }};
      }}).filter((reason) => reason['主要缺口渠道'].some((row) => row['GAP'] < 0));

      const efficiencyRows = ['试用期', '正式期', '整体'].map((stage) => {{
        const rows = monthData.flatMap((data) => data.efficiency_summary || []).filter((row) => row['统计维度'] === stage);
        const scale = rows.reduce((sum, row) => sum + toNumber(row['招聘规模']), 0);
        const train = rows.reduce((sum, row) => sum + toNumber(row['截止参培达成']), 0);
        const seven = rows.reduce((sum, row) => sum + toNumber(row['截止7天参培达成']), 0);
        return {{
          统计维度: stage,
          招聘规模: scale,
          截止参培达成: train,
          参培人效: scale ? (train / scale).toFixed(1) : '0.0',
          截止7天参培达成: seven,
          '7天人效': scale ? (seven / scale).toFixed(1) : '0.0'
        }};
      }});

      const recruiterMap = new Map();
      monthData.flatMap((data) => data.recruiter_details || []).forEach((row) => {{
        const key = `${{row['姓名']}}-${{row['伽睿工号']}}`;
        if (!recruiterMap.has(key)) {{
          recruiterMap.set(key, {{
            姓名: row['姓名'],
            伽睿工号: row['伽睿工号'],
            员工阶段: row['员工阶段'],
            入职日期: row['入职日期'],
            月度参培目标: 0,
            截止参培目标: 0,
            截止参培达成: 0,
            月度7天参培目标: 0,
            截止7天参培目标: 0,
            截止7天参培达成: 0,
            明细: []
          }});
        }}
        const target = recruiterMap.get(key);
        ['月度参培目标', '截止参培目标', '截止参培达成', '月度7天参培目标', '截止7天参培目标', '截止7天参培达成'].forEach((field) => {{
          target[field] += toNumber(row[field]);
        }});
        target['明细'].push(...(row['明细'] || []));
      }});
      const recruiterRows = Array.from(recruiterMap.values()).map((row) => ({{
        ...row,
        截止参培达成率: pct(row['截止参培达成'], row['截止参培目标']),
        截止7天参培达成率: pct(row['截止7天参培达成'], row['截止7天参培目标'])
      }})).sort((a, b) => String(a['员工阶段']).localeCompare(String(b['员工阶段'])) || String(a['姓名']).localeCompare(String(b['姓名'])));

      const autoChannel = channelRows.find((row) => row['渠道'] === '自主社招') || {{ 实际入培数: 0 }};
      return {{
        overview: {{
          统计月份: `${{year}}全年（${{monthCount}}个月）`,
          月度目标: overviewTotals.monthly,
          截止目标: overviewTotals.cutoff,
          实际入培数: overviewTotals.actual,
          GAP: overviewTotals.actual - overviewTotals.monthly,
          达成率: pct(overviewTotals.actual, overviewTotals.monthly),
          未达成基地数: baseRows.filter((row) => row['GAP'] < 0).length,
          自主社招整体人效: (efficiencyRows.find((row) => row['统计维度'] === '整体') || {{ 参培人效: '0.0' }})['参培人效'],
          自主社招占比: pct(autoChannel['实际入培数'], overviewTotals.actual)
        }},
        channel_mix: channelRows,
        base_channel_progress: baseChannelRows,
        base_risks: baseRows,
        unmet_reasons: unmetReasons,
        funnel_attribution: buildAnnualFunnelAttribution(monthData),
        efficiency_summary: efficiencyRows,
        recruiter_details: recruiterRows
      }};
    }}

    function metric(label, value, danger = false) {{
      return `<div class="metric${{danger ? ' danger' : ''}}"><span>${{escapeHtml(label)}}</span><strong>${{escapeHtml(value)}}</strong></div>`;
    }}

    function renderDashboard() {{
      detailPayload = {{}};
      const overview = currentData.overview;
      document.getElementById('subtitle').textContent = `${{overview['统计月份']}} · 展示全局基地风险、未达成原因与自主社招人效`;
      document.getElementById('metrics').innerHTML = [
        metric('整体目标', overview['月度目标']),
        metric('截止目标', overview['截止目标']),
        metric('实际入培数', overview['实际入培数']),
        metric('GAP', overview['GAP'], overview['GAP'] < 0),
        metric('达成率', overview['达成率'], parseFloat(String(overview['达成率']).replace('%', '')) < 100),
        metric('未达成基地数', overview['未达成基地数'], overview['未达成基地数'] > 0),
        metric('自主社招整体人效', overview['自主社招整体人效']),
        metric('自主社招占比', overview['自主社招占比'])
      ].join('');
      renderChannelMix();
      renderBaseChannelProgress();
      renderBaseRisks();
      renderUnmetReasons();
      renderFunnelAttribution();
      renderEfficiencySummary();
      renderRecruiterDetails();
    }}

    function renderChannelMix() {{
      document.getElementById('channelMix').innerHTML = currentData.channel_mix.map((row) => `
        <div class="mix-card">
          <strong>${{escapeHtml(row['渠道'])}}</strong>
          <span>目标 ${{row['月度目标']}} · 截止目标 ${{row['截止目标']}} · 实际 ${{row['实际入培数']}}</span>
          <div class="mix-line">
            <em>目标占比 ${{escapeHtml(row['渠道目标占比'])}}</em>
            <em>达成占比 ${{escapeHtml(row['渠道达成占比'])}}</em>
            <em>占比GAP ${{escapeHtml(row['占比GAP'])}}</em>
          </div>
        </div>
      `).join('');
    }}

    function renderBaseRisks() {{
      document.getElementById('baseRisks').innerHTML = currentData.base_risks.map((row) => `
        <tr>
          <td class="${{row['GAP'] < 0 ? 'danger' : 'ok'}}">${{escapeHtml(row['基地'])}}</td>
          <td>${{row['月度目标']}}</td>
          <td>${{row['截止目标']}}</td>
          <td>${{row['实际入培数']}}</td>
          <td class="${{row['GAP'] < 0 ? 'danger' : ''}}">${{row['GAP']}}</td>
          <td>${{escapeHtml(row['达成率'])}}</td>
        </tr>
      `).join('');
    }}

    function renderBaseChannelProgress() {{
      const groups = [];
      (currentData.base_channel_progress || []).forEach((row) => {{
        const last = groups[groups.length - 1];
        if (!last || last.base !== row['基地']) groups.push({{ base: row['基地'], rows: [] }});
        groups[groups.length - 1].rows.push(row);
      }});
      const rows = groups.map((group) => group.rows.map((row, index) => {{
        const baseName = group.base === '整体' ? '整体达成' : group.base;
        const baseCell = index === 0 ? `<td class="base-group-cell" rowspan="${{group.rows.length}}">${{escapeHtml(baseName)}}</td>` : '';
        return `
          <tr class="base-group-row">
            ${{baseCell}}
            <td>${{escapeHtml(row['渠道'])}}</td>
            <td>${{row['月度目标']}}</td>
            <td>${{row['截止目标']}}</td>
            <td>${{row['实际入培数']}}</td>
            <td>${{row['GAP']}}</td>
            <td class="${{row['达成率未达成'] ? 'rate-danger' : ''}}">${{escapeHtml(row['达成率'])}}</td>
            <td>${{escapeHtml(row['渠道目标占比'])}}</td>
            <td>${{escapeHtml(row['渠道达成占比'])}}</td>
            <td>${{escapeHtml(row['占比GAP'])}}</td>
          </tr>`;
      }}).join('')).join('');
      document.getElementById('baseChannelProgress').innerHTML = rows || '<tr><td colspan="10" class="muted">暂无基地渠道达成数据</td></tr>';
    }}

    function detailNumber(key, value) {{
      return `<button type="button" class="detail-number" onclick="openDetail('${{key}}')">${{escapeHtml(value)}}</button>`;
    }}

    function registerDetail(key, title, columns, rows) {{
      detailPayload[key] = {{ title, columns, rows }};
    }}

    function renderUnmetReasons() {{
      document.getElementById('unmetReasons').innerHTML = currentData.unmet_reasons.map((reason, reasonIndex) => {{
        const rows = reason['主要缺口渠道'].map((row, channelIndex) => {{
          const key = `unmet-${{reasonIndex}}-${{channelIndex}}`;
          registerDetail(key, `${{reason['基地']}} - ${{row['渠道']}} 推荐明细`, employeeColumns, row['明细'] || []);
          return `
            <tr>
              <td>${{escapeHtml(row['渠道'])}}</td>
              <td>${{row['月度目标']}}</td>
              <td>${{row['截止目标']}}</td>
              <td>${{detailNumber(key, row['实际入培数'])}}</td>
              <td class="danger">${{row['GAP']}}</td>
              <td>${{escapeHtml(row['达成率'])}}</td>
              <td>${{escapeHtml(row['渠道目标占比'])}}</td>
              <td>${{escapeHtml(row['渠道达成占比'])}}</td>
              <td>${{escapeHtml(row['占比GAP'])}}</td>
            </tr>`;
        }}).join('');
        return `
          <article class="reason-card">
            <div><h3>${{escapeHtml(reason['基地'])}}</h3><p>${{escapeHtml(reason['判断'])}}</p></div>
            <table>
              <thead><tr><th>渠道</th><th>月度目标</th><th>截止目标</th><th>实际入培</th><th>GAP</th><th>达成率</th><th>目标占比</th><th>达成占比</th><th>占比GAP</th></tr></thead>
              <tbody>${{rows}}</tbody>
            </table>
          </article>`;
      }}).join('');
    }}

    function renderFunnelAttribution() {{
      const attribution = currentData.funnel_attribution || {{ rules: {{}}, base_rows: [], unmatched_jobs: [] }};
      const rules = attribution.rules || {{}};
      const ruleText = `目标面通率 ${{escapeHtml(rules['目标面通率'] || '70.00%')}} · 目标面通到参培转化率 ${{escapeHtml(rules['目标面通到参培转化率'] || '40.00%')}} · 目标到面到参培综合转化率 ${{escapeHtml(rules['目标到面到参培综合转化率'] || '28.00%')}} · 目标口径 ${{escapeHtml(rules['目标口径'] || '截止目标')}}`;
      const rows = (attribution.base_rows || []).map((row) => `
        <tr>
          <td>${{escapeHtml(row['基地'])}}</td>
          <td>${{row['招聘目标']}}</td>
          <td>${{row['实际入培数']}}</td>
          <td>${{row['所需到面人数']}}</td>
          <td>${{row['实际到面人数']}}</td>
          <td>${{row['所需面通人数']}}</td>
          <td>${{row['实际面通人数']}}</td>
          <td>${{escapeHtml(row['实际面通率'])}}</td>
          <td>${{escapeHtml(row['实际面通到参培转化率'])}}</td>
          <td>${{escapeHtml(row['实际到面到参培综合转化率'])}}</td>
          <td>${{row['岗位数']}}</td>
          <td class="danger">${{escapeHtml(row['归因判断'])}}</td>
        </tr>
      `).join('') || '<tr><td colspan="12" class="muted">暂无漏斗归因数据</td></tr>';
      const unmatchedRows = (attribution.unmatched_jobs || []).slice(0, 10).map((row) => `
        <tr><td>${{escapeHtml(row['职位名称'])}}</td><td>${{row['记录数']}}</td></tr>
      `).join('');
      document.getElementById('funnelAttribution').innerHTML = `
        <p class="section-note">${{ruleText}}</p>
        <table>
          <thead><tr><th>基地</th><th>招聘目标</th><th>实际入培</th><th>所需到面</th><th>实际到面</th><th>所需面通</th><th>实际面通</th><th>实际面通率</th><th>实际面通到参培转化率</th><th>实际到面到参培综合转化率</th><th>岗位数</th><th>归因判断</th></tr></thead>
          <tbody>${{rows}}</tbody>
        </table>
        ${{unmatchedRows ? `<h3>未匹配岗位</h3><p class="section-note">以下岗位未能映射到现有基地，暂不参与基地归因。</p><table><thead><tr><th>职位名称</th><th>记录数</th></tr></thead><tbody>${{unmatchedRows}}</tbody></table>` : ''}}
      `;
    }}

    function switchDashboardTab(tab) {{
      document.querySelectorAll('[data-tab-target]').forEach((button) => {{
        button.classList.toggle('active', button.dataset.tabTarget === tab);
      }});
      document.querySelectorAll('[data-tab-panel]').forEach((panel) => {{
        panel.classList.toggle('active', panel.dataset.tabPanel === tab);
      }});
    }}

    function renderEfficiencySummary() {{
      document.getElementById('efficiencySummary').innerHTML = currentData.efficiency_summary.map((row) => `
        <tr>
          <td>${{escapeHtml(row['统计维度'])}}</td>
          <td>${{row['招聘规模']}}</td>
          <td>${{row['截止参培达成']}}</td>
          <td>${{escapeHtml(row['参培人效'])}}</td>
          <td>${{row['截止7天参培达成']}}</td>
          <td>${{escapeHtml(row['7天人效'])}}</td>
        </tr>
      `).join('');
    }}

    function renderRecruiterDetails() {{
      document.getElementById('recruiterDetails').innerHTML = currentData.recruiter_details.map((row, index) => {{
        const key = `recruiter-${{index}}`;
        registerDetail(key, `${{row['姓名']}} - 自主社招推荐明细`, employeeColumns, row['明细'] || []);
        return `
          <tr>
            <td>${{escapeHtml(row['姓名'])}}</td>
            <td>${{escapeHtml(row['伽睿工号'])}}</td>
            <td>${{escapeHtml(row['员工阶段'])}}</td>
            <td>${{escapeHtml(row['入职日期'])}}</td>
            <td>${{row['月度参培目标']}}</td>
            <td>${{row['截止参培目标']}}</td>
            <td>${{detailNumber(key, row['截止参培达成'])}}</td>
            <td>${{escapeHtml(row['截止参培达成率'])}}</td>
            <td>${{row['月度7天参培目标']}}</td>
            <td>${{row['截止7天参培目标']}}</td>
            <td>${{detailNumber(key, row['截止7天参培达成'])}}</td>
            <td>${{escapeHtml(row['截止7天参培达成率'])}}</td>
          </tr>`;
      }}).join('');
    }}

    function openDetail(key) {{
      const payload = detailPayload[key];
      const modal = document.getElementById('detailModal');
      const title = document.getElementById('detailModalTitle');
      const body = document.getElementById('detailModalBody');
      title.textContent = payload.title;
      if (!payload.rows.length) {{
        body.innerHTML = '<p class="muted">暂无匹配人员明细</p>';
      }} else {{
        const head = payload.columns.map((col) => `<th>${{escapeHtml(col)}}</th>`).join('');
        const filters = payload.columns.map((col, index) => `<th><input class="column-filter" data-filter-col="${{index}}" placeholder="筛选${{escapeHtml(col)}}"></th>`).join('');
        const rows = payload.rows.map((row) => `<tr>${{payload.columns.map((col) => `<td>${{escapeHtml(row[col])}}</td>`).join('')}}</tr>`).join('');
        body.innerHTML = `<table id="modalDetailTable"><thead><tr>${{head}}</tr><tr>${{filters}}</tr></thead><tbody>${{rows}}</tbody></table>`;
        body.querySelectorAll('[data-filter-col]').forEach((input) => input.addEventListener('input', filterModalTable));
      }}
      modal.classList.add('open');
    }}

    function filterModalTable() {{
      const table = document.getElementById('modalDetailTable');
      const filters = Array.from(table.querySelectorAll('[data-filter-col]')).map((input) => ({{
        column: Number(input.dataset.filterCol),
        value: input.value.trim().toLowerCase()
      }}));
      table.querySelectorAll('tbody tr').forEach((row) => {{
        const cells = Array.from(row.children);
        const visible = filters.every((filter) => !filter.value || cells[filter.column].textContent.toLowerCase().includes(filter.value));
        row.style.display = visible ? '' : 'none';
      }});
    }}

    function closeDetail(event) {{
      if (event && event.target.id !== 'detailModal') return;
      document.getElementById('detailModal').classList.remove('open');
    }}

    document.addEventListener('keydown', (event) => {{
      if (event.key === 'Escape') closeDetail();
    }});
    loadMonths();
  </script>
</body>
</html>
"""


def collect_data(root, active_path, leave_path, funnel_path=None):
    dashboard = load_dashboard_module()
    report_dir = root / "月度招聘达成进度"
    data_by_month = {}
    for report_path in sorted(report_dir.glob("月度招聘达成进度-*月.xlsx")):
        month_key = parse_month_key(report_path)
        if not month_key:
            continue
        year, month = month_key.split("-")
        data_by_month[month_key] = dashboard.build_dashboard_data(
            report_path,
            int(year),
            int(month),
            active_path,
            leave_path,
            funnel_path,
        )
    return data_by_month


def main():
    parser = argparse.ArgumentParser(description="Generate reusable recruitment dashboard app.")
    parser.add_argument("--root", default=".", help="项目根目录，默认当前目录")
    parser.add_argument("--active", required=True, help="在职员工信息 Excel 文件")
    parser.add_argument("--leave", required=True, help="离职员工信息 Excel 文件")
    parser.add_argument("--funnel", default=None, help="Moka 招聘漏斗 Excel 文件，用于漏斗归因")
    parser.add_argument("--output-dir", default="招聘负责人看板", help="输出目录")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    output_dir = root / args.output_dir
    data_by_month = collect_data(
        root,
        Path(args.active),
        Path(args.leave),
        Path(args.funnel) if args.funnel else None,
    )
    if not data_by_month:
        raise FileNotFoundError("未找到可生成看板的月度结果表：月度招聘达成进度/月度招聘达成进度-*月.xlsx")
    write_dashboard_app(output_dir, data_by_month)
    print({"output": str(output_dir / "index.html"), "months": sorted(data_by_month)})


if __name__ == "__main__":
    main()
