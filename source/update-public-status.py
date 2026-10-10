"""Update the existing shared Pages from one public, reviewed source.

First run: --repo REPO --bootstrap LEGACY. Later: --repo REPO.
No gateway, owner config, experience page, ledger, production or Git mutations.
"""
from __future__ import annotations
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

BASELINE_TIME = '2026-10-10T13:50:58+08:00'
MODULE_IDS = ['meituan', 'douyin', 'templates', 'memory', 'reviews', 'reviewpolicy',
              'approval', 'dishes', 'routines', 'employeeux', 'opsux', 'model',
              'designsystem', 'dingtalk', 'capabilitypublication', 'opsrolep0']
PRIVATE_PATTERN = re.compile(r'(?:(?<![A-Za-z0-9])[A-Za-z]:[/\\]|file://|127\.0\.0\.1|localhost|Bearer\s|gh[pousr]_|github_pat_|tenantId|deploymentId|credentialReference|appSecret)', re.I)

OVERLAYS = {
 'douyin': {
  'currentnode': '独立报表候选已完成本地审阅，待正式启用和真实导出',
  'doing': '独立报表沿用兼容的取数1.0.1来源；Excel包含全部明细行，月份随实际查询期间变化。',
  'blocker': '真实平台取数、门店确认和正常客户下载尚未运行。',
  'next': '正常发布后，以真实账号查询任意可查询月份，取得正式来源和可下载报表。',
  'evidenceLevel': 'LOCAL_REVIEW_CANDIDATE', 'sourceRevision': '8e474cdf',
  'evidenceSummary': '40个文件的最终候选；不是平台取数或生产下载证明。'},
 'memory': {
  'currentnode': '当前授权核对与主聊天记忆读取已完成代码整合验证',
  'doing': '记忆1.1.0与定时整合已核对当前授权；主聊天按当前本人身份读取已确认偏好。',
  'blocker': '首次从正常员工保存到真实PostgreSQL仍须正常发布；客户首次保存未验收。',
  'next': '正式启用后，当前本人在聊天确认格式，再核对持久保存、替换、忘记与下一期复用。',
  'evidenceLevel': 'CODE_INTEGRATION_VALIDATED', 'sourceRevision': '1a2ba0f1',
  'evidenceSummary': '当前授权100／110与主聊天读取已整合；69项与29项聚焦检查有重叠，不能相加；不代表客户生产验收。'},
 'routines': {
  'currentnode': '当前授权与主聊天同一记录已完成整合验证',
  'doing': '计划沿用已确认模板；聊天读取、修改确认和暂停继续共享同一份记录。',
  'blocker': '生产真实模型、到点报告、正常成果下载与外部送达仍待验收。',
  'next': '正常发布后，用当前本人确认计划并核对到点成果和真实送达。',
  'evidenceLevel': 'CODE_INTEGRATION_VALIDATED', 'sourceRevision': '1a2ba0f1',
  'evidenceSummary': '保留已有本地真实链证明；Recording模型仍是工程替身。'},
 'reviews': {
  'currentnode': '正常准备入口已在真实数据库验证，封存待人工审阅',
  'doing': '评论准备入口返回201，计划入口返回200；资料与工作计划进入正常持久化路径。',
  'blocker': '封存状态为PENDING_REVIEW；尚未激活，真实评论读取和回复未验收。',
  'next': '沿正常发布与启用流程，让员工读取真实评论并生成可追溯回复草稿。',
  'evidenceLevel': 'REAL_PG_PENDING_REVIEW', 'sourceRevision': 'ea85d64a',
  'evidenceSummary': '248个真实PostgreSQL检查通过；不是运营员工激活或真实平台动作。'},
 'dishes': {
  'currentnode': '正常准备入口与计划已在真实数据库验证，待正常发布',
  'doing': '已确认套餐资料可沿正常准备入口生成计划，审阅材料已封存。',
  'blocker': '尚未激活；预览不等于已上架，真实提交与回执未验收。',
  'next': '正常发布后，先取得真实套餐预览，再按确认授权提交并核对平台读回。',
  'evidenceLevel': 'REAL_PG_PENDING_REVIEW', 'sourceRevision': 'ea85d64a',
  'evidenceSummary': '与评论准备共用248项数据库证据，不重复累计。'},
 'dingtalk': {
  'currentnode': '正式扫码与同员工链路候选已交付，正式接入尚未验收',
  'doing': '正常应用、正式回调、本人绑定与当前员工读取已形成完整可审阅候选。',
  'blocker': '仍缺两项正常迁移的数据库实证、正式回调发布、官方企业配置及真人扫码与收发。',
  'next': '完成正常迁移与正式配置后，真人扫码并核对当前本人、当前员工的真实欢迎和回复回执。',
  'evidenceLevel': 'FOUNDATION_RELEASE_CANDIDATE', 'sourceRevision': '684d603a',
  'evidenceSummary': '175个唯一聚焦检查及正常构建通过；尚未部署、迁移或完成正式接入验收。'},
 'templates': {
  'currentnode': '原模板部分报表已有证明；1.0.9继续保留完整性边界',
  'doing': '原模板结构、五张表和十二个公式的既有证明保留；1.0.9并非首单前置。',
  'blocker': '原模板证明仍是部分报表；完整客户报表、正常下载和自然修改未验收。',
  'next': '沿既有首单正常发布路线，以真实月份来源生成、下载并修改原模板。',
  'evidenceLevel': 'PARTIAL_TEMPLATE_PROOF', 'sourceRevision': 'Office1.0.9',
  'evidenceSummary': '保留原有部分模板证明，不改写为完整客户验收。'}
}

def read_utf8(path: Path) -> str:
    return path.read_bytes().decode('utf-8-sig', errors='strict')

def write_utf8(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8', newline='\n')

def public_model(legacy: Path) -> dict:
    original = json.loads(read_utf8(legacy / 'product-state.json'))
    assert [m['id'] for m in original['modules']] == MODULE_IDS
    modules = []
    for item in original['modules']:
        m = {k: item[k] for k in ('id', 'name', 'group', 'status', 'currentnode', 'doing', 'blocker', 'next')}
        m.update(lastVerifiedAt=BASELINE_TIME, evidenceLevel='BASELINE_LAST_VERIFIED', evidenceSummary='保留13:50核验记录，本次未重新检查生产。')
        if m['id'] in OVERLAYS:
            m.update(OVERLAYS[m['id']])
            m['lastVerifiedAt'] = '2026-10-10'
            m['verificationBoundary'] = '今日交接与已运行证据；本次未重新运行产品验证'
        modules.append(m)
    return {
      'schemaVersion': 1, 'revision': 82, 'experienceReviewRevision': 80,
      'updatedAt': '2026-10-10', 'baselineLastVerifiedAt': BASELINE_TIME,
      'headline': '首单等待正常发布；共享能力已有新证据，完整客户验收仍未通过',
      'customerAcceptance': {'passed': 0, 'total': 2, 'lastVerifiedAt': BASELINE_TIME},
      'firstReport': {'lastVerifiedAt': BASELINE_TIME, 'freshVerification': False,
        'summary': '13:50最后核验：首单三项候选可读但仍材料待复核；报表员工仍1.0.1，内部诊断等待阻塞升级。',
        'next': '由首单责任方继续正常发布、员工1.0.2升级，再验任意月份真实原模板下载与修改。'},
      'ownerControl': {'pageRevision': 80, 'status': 'PUBLIC_GATEWAY_SETUP_REQUIRED',
        'verification': '公网连接已恢复，健康读回HTTP200。登录预检与部署覆盖问题已修复，持久启动钩子的真实主机恢复和幂等检查通过。',
        'limitation': '首次GitHub连接尚未完成；Owner仍须首次创建应用、选定仓库安装和正常OAuth。真实反馈与Actions尚未验收。'},
      'modules': modules,
      'links': {'delivery': './index.html', 'controlTower': './control-tower.html', 'experienceReview': './product-experience-review.html'}
    }

def validate_model(model: dict) -> None:
    assert model['schemaVersion'] == 1 and model['revision'] >= 82
    assert isinstance(model['experienceReviewRevision'], int) and model['experienceReviewRevision'] > 0
    assert [m['id'] for m in model['modules']] == MODULE_IDS
    assert isinstance(model['firstReport']['freshVerification'], bool)
    acceptance = model['customerAcceptance']
    assert isinstance(acceptance['passed'], int) and isinstance(acceptance['total'], int)
    assert 0 <= acceptance['passed'] <= acceptance['total'] and acceptance['lastVerifiedAt']
    assert model['ownerControl']['pageRevision'] == model['experienceReviewRevision']
    if PRIVATE_PATTERN.search(json.dumps(model, ensure_ascii=False)):
        raise ValueError('PUBLIC_MODEL_PRIVATE_FIELD_OR_PATH')

def replace_panel(draft: str, panel_id: str, text: str) -> str:
    pattern = re.compile(r'^## ' + panel_id + r' .*?(?=^## [A-Z] |\Z)', re.M | re.S)
    result, count = pattern.subn(lambda _: text.rstrip() + '\n\n', draft)
    assert count == 1, f'PANEL_NOT_FOUND:{panel_id}'
    return result

def module_copy(modules: list[dict], ids: list[str]) -> str:
    lookup = {m['id']: m for m in modules}
    blocks = []
    for module_id in ids:
        m = lookup[module_id]
        verified = '13:50最后核验，本次未重验' if m['evidenceLevel'] == 'BASELINE_LAST_VERIFIED' else '今日交接证据；仍受下列验收边界限制'
        blocks.append(f"### {m['name']}\n\n{m['currentnode']}。\n\n{m['doing']}\n\n**尚缺：** {m['blocker']}\n\n**下一可见成果：** {m['next']}\n\n*{verified}。*\n")
        if m.get('reviewUrl'):
            blocks[-1] += '\n[查看当前发布评审稿](' + m['reviewUrl'] + ')\n'
    return '\n'.join(blocks)

def bootstrap_sources(repo: Path, legacy: Path) -> None:
    source = repo / 'source'
    model = public_model(legacy)
    manifest_path = repo / 'board-version.json'
    current_revision = json.loads(read_utf8(manifest_path)).get('revision', 0) if manifest_path.exists() else 0
    model['revision'] = max(current_revision + 1, 82)
    validate_model(model)
    draft = read_utf8(legacy / 'delivery-baseline.md')
    draft = draft.replace('2026年10月10日13:50核对 · 北京时间 · 第78版', '2026年10月10日交接更新 · 全局第81版 · 首单最后核验13:50')
    draft = replace_panel(draft, 'A', '''## A Owner先看结论 {span=2}
```callout warn 完整客户业务验收仍为 0／2
首单仍由原责任方推进正常发布与员工升级。本次保留13:50最后核验事实，没有重新检查生产，也没有变更首单实现。
记忆、定时、运营准备、抖音与钉钉已有新的交接证据。代码通过、本地数据库通过、封存待审与客户可用继续分开记录。
```

**首单最后核验：2026年10月10日13:50。** 三项候选可读但仍材料待复核，报表员工仍1.0.1，内部诊断等待阻塞升级。

**下一次改变首单状态的证据：** 正常发布三能力，完成员工1.0.2评测升级。
再取得任意可查询月份的真实原模板下载与一次自然修改。

10月11日20:00保留为既有目标；旧工时估算继续停用。新的剩余估算尚未由责任方核定。''')
    draft = draft.replace('## B 12:00后生产现场复核 {span=2}', '## B 首单生产记录：13:50最后核验 {span=2}\n**这是保留的既有生产记录，本次未重新检查。**')
    draft = replace_panel(draft, 'C', '## C 报表员工：下一次可验收什么 {span=2}\n\n' + module_copy(model['modules'], ['meituan', 'templates', 'douyin']) + '\n**首单不等待：** Office1.0.9、Memory110、定时、钉钉和抖音。')
    ops = module_copy(model['modules'], ['reviews', 'reviewpolicy', 'dishes', 'approval'])
    draft = replace_panel(draft, 'D', '## D 运营员工：评论与套餐线 {span=2}\n\n' + ops + '\n普通回复沿已确认政策处理；高风险例外保留审阅。待审、回复草稿和套餐预览都不能写成已回复或已上架。\n\n![餐饮运营准备入口：真实组件、本地示例数据，非线上验收](assets/operations-preparation-1440.png)')
    shared = module_copy(model['modules'], ['memory', 'routines', 'employeeux', 'opsux', 'model', 'designsystem', 'dingtalk', 'capabilitypublication', 'opsrolep0'])
    draft = replace_panel(draft, 'E', '## E 共享能力与员工体验 {span=2}\n\n' + shared + '\n![模板偏好确认：真实组件、本地工程示例；不代表生产员工已启用](assets/template-preference-390.png)\n\n![计划模板选择：真实组件、本地工程示例；不代表已创建生产计划](assets/template-schedule-390.png)')
    draft = draft.replace('## F 目标日期、剩余估算与风险 {span=2}', '## F 保留的目标日期与风险 {span=2}\n**排期与估算保留13:50基准；本次未重新预测或改期。**')
    draft = replace_panel(draft, 'G', '''## G 怎样区分进展与客户完成 {span=2}
| 证据状态 | 可以判断什么 | 仍不能判断什么 |
| --- | --- | --- |
| 代码整合验证 | 当前授权、聊天读取与相应回归通过 | 正常生产已发布或客户首次保存通过 |
| 真实本地数据库、封存待审 | 运营准备和计划有真实持久化证据 | 员工已激活、真实评论已回复或套餐已上架 |
| 最终本地审阅候选 | 抖音与钉钉候选可审阅、可进入正常发布 | 正式平台取数、扫码收发或正常客户下载已通过 |
| 部分原模板证明 | 既有模板结构与部分字段得到核对 | 完整客户报表与下载修改已验收 |
| 客户业务验收 | 当前账号、员工、真实来源与可核对结果均通过 | 当前仍为0／2；不能用候选或测试数量代替 |

记忆与定时的69项、29项检查有重叠。运营准备的248项属于同一数据库证据，不在多个模块重复累计。

截图保留原有本地示例标记，不作为本次生产或客户验收证明。''')
    draft = replace_panel(draft, 'H', '''## H Owner现在看什么与怎样反馈 {span=2}
**首单：** 继续等待正常三能力发布与员工1.0.2升级的真实回执。已登录事实保留13:50记录；本页不要求重复登录。

**钉钉：** 正式回调、正常迁移与官方配置完成后，再安排真人扫码和当前员工收发验收。

**运营：** 正常发布后，先验真实评论草稿和套餐预览，再按经营规则与授权验证真实动作。

**GitHub Owner反馈：** 公网连接已恢复，等待首次GitHub连接。健康读回HTTP200。
登录预检与部署覆盖问题已修复。持久启动钩子的真实主机恢复与幂等检查通过。
Owner仍须首次创建应用、选定仓库安装与正常OAuth；真实反馈和Actions尚未验收。

体验共创仍为第80版。全局产品状态为第81版。提交反馈不会把候选变成上线，也不会把未核验事实改为完成。

[产品控制塔：Control、架构与落地状态](./control-tower.html)

[生产真实体验共创：截图、用户故事与产品定调](./product-experience-review.html)''')
    tower = read_utf8(legacy / 'control-tower.md')
    tower = tower.replace('生产现场截至 2026-10-10 13:45', '全局第81版 · 首单生产事实最后核验2026-10-10 13:50')
    tower = tower.replace('## A 现在是否跑在正轨上 {span=2}', '## A 现在是否跑在正轨上 {span=2}\n**首单事实保留13:50最后核验。本次更新共享证据，不重新核验生产，也不改变Control方向。**')
    tower = tower.replace('## D 核心产品原语落地热力图 {span=2}', '## D 核心产品原语与本次证据边界 {span=2}\n**以下既有生产观察保留13:50核验时间；本次共享证据见下文。**')
    tower = tower.replace('## G 现在应该看到的下一批成果 {span=2}', '## G 下一批真实用户成果 {span=2}\n**首单顺序保留13:50记录；没有新的生产成功声明。**')
    tower = tower.replace('格式保存独立包已部署', '已有格式保存独立包证明；当前授权和主聊天读取已通过代码整合验证')
    tower = tower.replace('warn 定时本地已证明，钉钉与完整业务尚未证明', 'warn 记忆与定时整合已验证；生产到点、钉钉与完整业务未验收')
    tower = tower.replace('同员工绑定候选已有', '正式回调与本人绑定完整候选已交付；尚未部署及验证两项迁移')
    tower = tower.replace('当前只完成三项首单能力的正常发布，不扩1.0.9/Memory110', '首单继续三项能力正常发布；独立候选进展不改变首单前置')
    tower += '''
### 本次共享进展如何影响产品判断

- 记忆与定时：当前授权与主聊天读取已整合验证；首次正常保存、生产到点与送达仍待验收。
- 运营准备：真实数据库检查通过，材料封存PENDING_REVIEW；正常发布后才验真实评论与套餐。
- 抖音：最终本地审阅候选可进入正常发布；真实平台取数与客户下载尚未运行。
- 钉钉：完整正式接入候选已交付；两项正常迁移、官方配置、真人扫码与回复仍是正式验收边界。
- Office1.0.9：保留原模板部分证明；没有完整客户报表验收。
- GitHub Owner反馈：公网连接已恢复，登录与部署覆盖修复已验证；首次授权、真实反馈与Actions尚未验收。

[查看全部16个模块的同一公开状态](./source/product-state.json)
'''
    assets = {
      'operations-preparation-1440.png': Path('D:/Codex/visual-proofs/operations-preparation-20261010/1440-prepared.png'),
      'template-preference-390.png': Path('D:/Codex/visual-proofs/template-preference-panel-20261010/390-confirmation.png'),
      'template-schedule-390.png': Path('D:/Codex/visual-proofs/confirmed-template-schedule-20261010/390-selection.png')}
    for name, path in assets.items():
        if not path.is_file():
            raise ValueError(f'EXISTING_PUBLIC_SCREENSHOT_MISSING:{name}')
        (source / 'assets').mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, source / 'assets' / name)
    for name, text in [('delivery-baseline.md', draft), ('control-tower.md', tower)]:
        text = text.replace('第81版', f"第{model['revision']}版")
        if PRIVATE_PATTERN.search(text):
            raise ValueError(f'PUBLIC_DRAFT_PRIVATE_FIELD_OR_PATH:{name}')
        write_utf8(source / name, text)
    write_utf8(source / 'product-state.json', json.dumps(model, ensure_ascii=False, indent=2) + '\n')

def render(repo: Path, cli: Path) -> None:
    source = repo / 'source'
    model = json.loads(read_utf8(source / 'product-state.json'))
    validate_model(model)
    for draft_name, output_name in [('delivery-baseline.md', 'index.html'), ('control-tower.md', 'control-tower.html')]:
        draft = read_utf8(source / draft_name)
        accepted = model['customerAcceptance']
        draft = re.sub(r'完整客户(?:业务)?验收仍为\s*\d+[／/]\d+', '完整客户业务验收：' + str(accepted['passed']) + '／' + str(accepted['total']), draft)
        if draft_name == 'delivery-baseline.md':
            draft = replace_panel(draft, 'C', '## C 报表员工：下一次可验收什么 {span=2}\n\n' + module_copy(model['modules'], ['meituan','templates','douyin']) + '\n**首单不等待：** Office1.0.9、Memory110、定时、钉钉和抖音。')
            draft = replace_panel(draft, 'D', '## D 运营员工：评论与套餐线 {span=2}\n\n' + module_copy(model['modules'], ['reviews','reviewpolicy','dishes','approval']) + '\n普通回复沿已确认政策处理；高风险例外保留审阅。\n\n![运营准备：本地示例，未生产验收](assets/operations-preparation-1440.png)')
            draft = replace_panel(draft, 'E', '## E 共享能力与员工体验 {span=2}\n\n' + module_copy(model['modules'], ['memory','routines','employeeux','opsux','model','designsystem','dingtalk','capabilitypublication','opsrolep0']) + '\n![模板偏好确认：本地示例](assets/template-preference-390.png)\n\n![计划模板选择：本地示例](assets/template-schedule-390.png)')
        # Shared Owner integration facts are rendered from the same model on both pages.
        owner_text = model['ownerControl']['verification'] + '\n\n' + model['ownerControl']['limitation']
        draft = re.sub(r'\*\*GitHub Owner反馈：\*\*[\s\S]*?(?=\n\n体验共创)', '**GitHub Owner反馈：** ' + owner_text, draft)
        draft = re.sub(r'- GitHub Owner反馈：[^\n]+', '- GitHub Owner反馈：' + model['ownerControl']['verification'] + ' ' + model['ownerControl']['limitation'], draft)
        write_utf8(source / draft_name, draft)
        if PRIVATE_PATTERN.search(draft):
            raise ValueError(f'PUBLIC_DRAFT_PRIVATE_FIELD_OR_PATH:{draft_name}')
        next_output = repo / (output_name + '.next')
        result = subprocess.run(['node', str(cli), 'render', '-', '-o', str(next_output), '--no-open'],
                                input=draft, encoding='utf-8', capture_output=True, cwd=source)
        print(result.stdout, end=''); print(result.stderr, end='')
        if result.returncode:
            raise RuntimeError(f'ANSWER_HTML_RENDER_FAILED:{output_name}')
        html = read_utf8(next_output)
        html = html.replace('</head>', '<style>[data-am="reply"],.am-comment-btn,.am-comment,.am-reply{display:none!important}</style></head>', 1)
        assert 'am-source' in html and '<html' in html
        assert re.findall(r'<section[^>]+id="panel-([A-H])"', html) == list('ABCDEFGH')
        # Bundled CLI has a harmless file:// storage-policy comment.
        if re.search(r'(?:(?<![A-Za-z0-9])[A-Za-z]:[/\\]|(?:href|src)=["\'](?:file:|https?://(?:127\.0\.0\.1|localhost))|Bearer\s|gh[pousr]_|github_pat_|tenantId|deploymentId|credentialReference|appSecret)', html, re.I):
            raise ValueError(f'PUBLIC_RENDER_PRIVATE_FIELD_OR_PATH:{output_name}')
        try:
            write_utf8(next_output, html)
            next_output.replace(repo / output_name)
        except PermissionError:
            # A viewer can retain a non-delete-sharing handle on Windows.
            # The complete validated replacement is written in one pass.
            write_utf8(repo / output_name, html)
    manifest_path = repo / 'board-version.json'
    manifest = json.loads(read_utf8(manifest_path)) if manifest_path.exists() else {}
    if manifest.get('revision', 0) > model['revision']:
        raise ValueError('MANIFEST_REVISION_WOULD_REGRESS')
    if manifest.get('experienceReviewRevision', model['experienceReviewRevision']) > model['experienceReviewRevision']:
        raise ValueError('EXPERIENCE_REVIEW_REVISION_CHANGED')
    manifest.update(revision=model['revision'], controlVersion='4.2', updatedAt=model['updatedAt'],
                    controlTower='control-tower.html', experienceReviewRevision=model['experienceReviewRevision'])
    write_utf8(manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f"PUBLIC_STATUS_READY revision={model['revision']} experienceReviewRevision=80 modules=16")

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--bootstrap', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    repo = args.repo.resolve(strict=True)
    if args.check:
        validate_model(json.loads(read_utf8(repo / 'source/product-state.json')))
        print('PUBLIC_MODEL_VALID modules=16')
        return
    cli = Path(os.environ.get('ANSWER_HTML_CLI', str(Path.home() / '.codex/skills/answer-me-with-html/scripts/am.mjs')))
    if not cli.is_file():
        raise ValueError('ANSWER_HTML_SKILL_NOT_INSTALLED')
    if args.bootstrap:
        if (repo / 'source/product-state.json').exists():
            raise ValueError('PUBLIC_SOURCE_EXISTS_NO_LEGACY_OVERWRITE')
        bootstrap_sources(repo, args.bootstrap.resolve(strict=True))
    render(repo, cli)

if __name__ == '__main__':
    main()
