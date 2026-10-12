---
title: AstraStaff 产品控制塔
subtitle: 2026年10月12日 11:30 · 看方向有没有偏 · Control v4.2
template: sheet
theme: blueprint
lang: zh
cols: 2
style: 80
mode: light
---

## A 结论：Control 没走偏，实现也没有架构性走偏 {span=2}
```callout warn 方向对，落地速度快，但“真实客户结果”仍落后于代码进度
Employee-first、Conversation-first、Outcome-first、Agent-first 这些核心原则仍然成立。今天现场的自然月份、保存模板、成果下载、Routine、钉钉自助绑定，也都在往这些原则靠。
当前不是架构走错，而是“实现和候选很多，首个客户 Outcome 还没闭环”。
```

```kv cols=3
Control方向: ✅ 正常
核心架构: ✅ 正常
生产健康: ✅ 正常
首单Outcome: 🔴 未完成
客户验收: 🔴 0／2
需要Owner纠偏: 🟡 有两项治理风险，不阻塞主线
```

## B 六条最重要的 Control {span=2}
| Control | 通俗解释 | 当前 |
| --- | --- | --- |
| **Employee first** | 用户雇的是员工，不是 Task/Workflow | ✅ 没偏 |
| **Conversation first** | 大部分事情一句话交办，不让用户配流程 | ✅ 方向对，完整业务仍待验收 |
| **Responsibility > Schedule** | “每月给我报”是职责，时间只是触发条件 | ✅ 今天 Routine 也在向这个方向整合 |
| **Outcome > Artifact** | Excel/PPT 是成果载体，不是“工作完成”的定义 | 🟡 代码支持越来越多，客户 Outcome 仍为 0 |
| **Agent first** | 普通工作让 Agent 自由执行，平台管权限和边界 | ✅ 没回到 Temporal/Task 默认前置 |
| **Policy > approval spam** | 常规事情自动做，真的例外才找人 | ✅ 默认上岗去审核方向已确认；真实业务动作仍待验收 |

**最重要的一条：** 正常能力发布、评测、员工小版本切换，不应该成为 Owner 日常审批事项。

## C 目标架构仍然是这一条链 {span=2}
```flow TB
老板 -> *数字员工: 一句话交办
*数字员工 -> Responsibility: 长期职责
*数字员工 -> Work: 这一次具体工作
Responsibility -> Work: 手动 / 定时 / 事件触发
Work -> Agent Runtime: 自主执行
Agent Runtime -> Skills / Tools: 取数 / 浏览器 / Office / 通知
Skills / Tools -> 外部系统: 美团 / 抖音 / 钉钉
Work -> *Outcome: 真实业务结果
*Outcome -> Artifact: Excel / PPT / 预览 / 附件
*数字员工 -> Memory: 记住门店、口径、模板和偏好
*数字员工 -> Connection: 账号与授权范围
```

**Provider 都可以换：** 模型、Browser、Office、Temporal 都只是底层能力。不能让产品层重新围绕这些技术名词组织。

## D 实现有没有走偏 {span=2}
| 观察 | 我的判断 | 原因 |
| --- | --- | --- |
| 今天继续做自然月份 + 保存模板 + 真实来源 + 下载 | ✅ 对 | 直接靠近“老板一句话拿到月报” |
| Routine 按当前 Employee 版本组合，而不是独立做配置中心 | ✅ 对 | 符合 Responsibility-first |
| 钉钉继续做“同一员工”的自助绑定 | ✅ 对 | 符合 One Truth，不是另造一个钉钉机器人产品 |
| Memory 进入“下次用同一模板” | ✅ 对 | 变成员工长期能力，不只是 KV 存储 |
| 多条线并行 | ✅ 本身不偏 | 并行资源不是问题，只要不把旁线变成首单前置 |
| 一个集成分支开始带上多个领域改动 | 🟡 注意 | 发布边界可以组合，但功能开发边界要继续清楚，否则问题定位会变慢 |
| 客户验收仍 0／2 | 🔴 必须盯 | 这是唯一不能被“代码很多”掩盖的事实 |

## E 生产现场到底是什么状态 {span=2}
**最新明确生产证明：2026-10-12 02:41，发布结果 PASS。**

| 生产层 | 状态 | 通俗解释 |
| --- | --- | --- |
| Control API | 🟢 healthy | 后端主控制服务健康 |
| Web | 🟢 healthy | 继续使用前一版已验证 Web，没有为了新修复强行全量升级 |
| 持久浏览器 | 🟢 healthy | 最新浏览器修复已进入生产 |
| Browser Workspace | 🟢 ACTIVE | 持久会话工作区仍在线 |
| Spreadsheet / PPT | 🟢 healthy | Office 相关服务保持各自已验证版本 |
| 最新上午候选 | 🟡 未全部生产验收 | 报表、Office、Routine、钉钉还在继续组合 |

**这不是“版本乱”。** 当前生产是刻意的多服务精确 pin：哪个服务需要改就升级哪个，没必要把 8 个镜像一起重建。这符合我们之前“CICD 做薄、产品优先”的方向。

## F 真正需要防的偏航 {span=2}
| 偏航信号 | 现在是否出现 | Control 动作 |
| --- | --- | --- |
| 把发布/评测当产品成果 | 🟡 页面表达曾经出现 | Pages 改成“候选 / 生产 / 客户验收”三层 |
| 把 Owner 变成正常发布审批员 | 🟡 页面曾经出现 | 取消；只把 Control、范围、高风险授权抛给 Owner |
| 旁线成为首单前置 | 🟡 有风险但尚未构成事实 | Memory/Routine/钉钉/抖音继续并行，不阻塞首份月报 |
| Browser/CI 无限扩张 | 🟢 当前控制住了 | 只做直接解除 E2E 阻塞的最小修复 |
| Task/Temporal 重新成为产品中心 | 🟢 没出现 | 继续只作为特殊持久工作/审批等底层机制 |
| 页面/计划文档落后真实现场 | 🔴 已出现 | 公共控制面改成现场真值；旧细节退到 Git 历史与证据层 |

## G 两个治理问题需要修，但不要停主线 {span=2}
### 1. Control / 执行事实源需要收敛
当前现场推进速度明显快于旧执行计划，公开页也因此出现过互相矛盾的状态。**这不是产品 Control 方向错，而是 Control 的“事实承载方式”需要变简单。**

建议：Control 文档只保留稳定原则；生产状态由真实读回更新；实施中的细节留给 PR / evidence，不再复制到 Owner 页。

### 2. 集成边界需要继续保持“小步”
今天的某些生产集成分支已经同时带有报表、Office、钉钉等祖先改动。组合发布可以这样做，但不要因此让每个功能分支变成“大一统分支”。

建议：**功能独立验证 → root/integration 串行组合 → 精确服务发布 → 生产 E2E**。这与当前 Control/Free 模式一致。

## H Owner 什么时候需要介入 {span=2}
```flow LR
新进展 -> {改变产品Control?}
{改变产品Control?} -> *需要Owner: 是
{改变产品Control?} -> {改变首单范围/承诺?}: 否
{改变首单范围/承诺?} -> *需要Owner: 是
{改变首单范围/承诺?} -> {新增高风险真实业务授权?}: 否
{新增高风险真实业务授权?} -> *需要Owner: 是
{新增高风险真实业务授权?} -> 团队自行推进: 否
```

**当前判断：Owner 无阻塞动作。** 当前研发应该继续把首份真实月报打穿，同时让 Routine / Memory / 钉钉 / 抖音并行前进。

**下一次应该把你叫回来的时刻：** 不是“170/170 通过了”，而是出现一个真正需要改变产品方向、承诺或授权边界的问题。

[看今天的落地进度](./) · [看生产体验并直接评论](./product-experience-review.html)
