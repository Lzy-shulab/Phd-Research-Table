---
name: PhD 科研工作台 v0.8.19
description: 几何研究手记，壁纸联动的玻璃外壳与清晰工作表面
colors:
  app-background: "#e4e9ec"
  accent: "#405663"
  accent-hover: "#36454f"
  on-accent: "#fcfcfd"
  action-companion: "#376251"
  on-companion: "#fcfdfd"
  action-warm: "#6d5431"
  on-warm: "#fdfdfb"
  action-positive: "#38614f"
  on-positive: "#fcfdfd"
  surface-solid: "#f9fafa"
  surface-workspace: "#f1f3f4"
  surface-raised: "#fcfdfd"
  surface-inset: "#e5e9eb"
  surface-feature: "#f6f8f9"
  surface-companion: "#f5f9f8"
  surface-warm: "#faf8f4"
  text-primary: "#26292c"
  text-secondary: "#535b60"
  text-muted: "#586064"
  border-default: "#545b5f38"
  glass-highlight: "#ffffffb8"
  glass-shade: "#343f4618"
  shadow-ink: "#30373c"
typography:
  body:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  title:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, -apple-system, sans-serif"
    fontSize: "2.142857rem"
    fontWeight: 610
    lineHeight: 1.25
    letterSpacing: "-0.035em"
  control:
    fontSize: "0.928571rem"
    fontWeight: 570
    lineHeight: 1.25
  summary-title:
    fontSize: "1.2rem"
    fontWeight: 650
    lineHeight: 1.55
  summary-body:
    fontSize: "0.94rem"
    fontWeight: 400
    lineHeight: 1.9
rounded:
  control: "10px"
  segment: "12px"
  card: "14px"
  summary-panel: "15px"
  overview: "22px"
  capsule: "999px"
spacing:
  workspace-inset: "clamp(20px, 2vw, 32px)"
  panel-inset: "24px"
  compact-inset: "16px"
  section-gap: "24px"
  control-gap: "8px"
  summary-gap: "18px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "7px 11px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.on-accent}"
  button-companion:
    backgroundColor: "{colors.surface-companion}"
    textColor: "{colors.action-companion}"
    rounded: "{rounded.control}"
    padding: "7px 11px"
  button-warm:
    backgroundColor: "{colors.surface-warm}"
    textColor: "{colors.action-warm}"
    rounded: "{rounded.control}"
    padding: "7px 11px"
  button-positive:
    textColor: "{colors.action-positive}"
    rounded: "{rounded.control}"
    padding: "7px 11px"
  input-search:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.segment}"
    padding: "10px 12px"
  nav-dock:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.capsule}"
    padding: "6px"
  chip-period:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.segment}"
  card-raised:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.card}"
    padding: "{spacing.panel-inset}"
  summary-panel:
    textColor: "{colors.text-primary}"
    rounded: "{rounded.summary-panel}"
    padding: "24px"
  calendar-day:
    textColor: "{colors.text-primary}"
    height: "54px"
---

# Design System: PhD 科研工作台 v0.8.19

## Overview

**Creative North Star: "几何研究手记"**

工作台使用“几何研究手记”：壁纸联动的低饱和玻璃外壳包围清晰的研究内容。光边、内暗边与外投影建立层级，抬高的正文表面承载长时间操作和阅读；系统字体与用户显示偏好决定实际密度。

v0.8.19 从当前代码提取规范，参考图用于玻璃材质方向。研究计划、文献阅读、科研成果、论文投稿、研究报表和设置共享同一外壳、颜色角色与几何节奏。v0.8.18 的悬浮胶囊 Dock 和四类批注继续保留；v0.8.17 的阅读器随手记入口、v0.8.14–0.8.15 的多主题描述属于历史实现，均不作为当前规范。

**Key Characteristics:**

- 壁纸决定强调色与表面色，辅助动作有稳定的阅读、AI 和完成语义。
- 标题、工具栏与正文共享横向边距，宽屏和紧凑模式保持对齐。
- 玻璃集中在外壳与操作层，正文、文字和 PDF 保持清晰。
- 入场与译文就绪使用短提示，减少动态效果时跳过相应 timeline。

## Colors

前置令牌记录默认背景的浅色值；运行时以 `src/shared/palette.ts` 的 `interfacePalette` 为配色依据，深色值和角色映射见 `.impeccable/design.json`。十种内置背景及自定义壁纸分别派生表面、正文、强调色与光影，不把默认预览色固定到所有背景。

- **Primary — 壁纸强调色：**主要提交、中英摘要入口与 Dock 选中底板使用 accent / on-accent，悬停使用 accent-hover。
- **Secondary — 伴随冷色：**阅读原文、日期调整和部分信息反馈成对使用 surface-companion / action-companion；自定义背景的伴随色由其色相派生。
- **Tertiary — 温和暖色与完成绿：**AI、暂缓与需要处理的摘要状态使用 surface-warm / action-warm；完成操作与译文就绪图标使用 action-positive 与相应文字、淡底色。
- **Neutral — 工作表面与光影：**surface-workspace 承载内容区，surface-raised 承载卡片，surface-inset 承载工具槽；三级正文色保留阅读层级。glass-highlight、glass-shade 和 shadow-ink 从同一背景配色派生。

**The Semantic Action Rule.** 强调色用于主要动作；伴随冷色用于阅读与日期操作，暖色用于 AI 与暂缓，绿色用于完成。每个角色同时使用自己的表面色与文字色。

**The Paper and Ink Rule.** 壁纸与玻璃材质作用于工作台界面；PDF 正文保持原始色彩、字体和独立缩放。

## Typography

全界面沿用前置令牌中的系统字体栈，基础字号默认（14px），用户可选择（13／14／16／18px）。各层级用 rem 跟随设置；PDF 使用阅读器独立缩放。常规页面标题采用 title，全部任务的概览标题收为（1.75rem）；中英摘要弹窗标题为（1.5rem），正文标题和长摘要分别使用 summary-title 与 summary-body。数字数量使用等宽数字，长标题与摘要允许换行。

## Layout

标题、正文和工具栏共用 workspace-inset；区块间距与面板内边距使用前置令牌，紧凑模式将面板内边距和区块间距收为 compact-inset。标题保持全宽，1920 宽屏与正文左缘对齐。18px 字号且展开侧栏时列宽为（248px）；文件夹行依次留出（14px）展开位、弹性名称位和两个（25px）操作位，数量独立保留（24px）并右对齐。

中英摘要采用顶部状态、正文滚动区和页脚操作三层。两栏间距读取 summary-gap，弹窗宽度为 `min(1180px, calc(100vw - 64px))`，最大高度为 `calc(100dvh - 64px)`；1250px 以下收紧边距，820px 以下正文改为单栏，780px 以下窗口高度缩小外边距。项目卡片固定三条任务可见，更多任务在卡片内滚动。每日短句以窗口中心定位，宽度随内容与可用空间收缩，长句可打开全文；按压保持相同中心坐标。

**The Shared Inset Rule.** 页面标题、工具栏与正文都读取同一个工作区边距；宽屏不再单独居中或缩进标题。

## Elevation & Depth

玻璃由同色系光边、内暗边、斜向高光和外投影共同形成。侧栏与 Dock 使用透光外壳；主区域保持（90%）工作表面底色，内容卡片使用抬高表面。侧栏、主区域、Dock 的模糊分别为（26／24／30px），饱和度分别为（125／115／150%）；弹窗使用（20px）模糊和（92%）工具表面。精确阴影、背景混合与透明度回退记录在 sidecar extensions；增强对比度或减少透明度时外壳使用实色并取消模糊。

**The Clear Content Rule.** 透明度调节周边面板，正文与卡片保留足够底色；文字和图标不随容器降低不透明度。

## Shapes

圆角按功能层级使用前置令牌：按钮用 control，分段槽用 segment，卡片用 card，摘要内容栏用 summary-panel，摘要弹窗用 overview，Dock 与每日短句用 capsule。玻璃边缘与卡片边缘采用细线；项目身份色继续作为任务卡片左缘标识，选中态使用颜色、轮廓和文本共同表达。

## Components

- **Buttons：**主要动作使用实色强调，辅助动作使用语义淡表面；悬停调整明暗，按压缩为（.975），禁用时取消缩放。键盘焦点保持（2px）明确轮廓。光影与完整状态样式见 sidecar 的可独立渲染片段。
- **Cards / Inputs：**卡片以抬高表面和细光边承载正文；快速添加聚焦时增加强调色边与淡色外环。搜索、表单和设置保持真实输入、选择与自动保存路径。
- **Navigation / Chips：**六个入口保持同一悬浮胶囊 Dock。选中底板平滑移动，窗口及字号改变后重新对齐；自动隐藏继续响应底缘鼠标与键盘焦点。分段选择使用内凹槽和抬高选中项。
- **Planner：**快速录入处于主要层级，逾期待处理使用暖色区块，任务行保持清晰抬高表面；完成、改到今天、暂缓到明天保留各自语义颜色。入场 timeline 依次显示标题、录入和范围／逾期反馈（260ms，4–6px，power2.out）。
- **Bilingual overview：**顶部显示读取、翻译、就绪、缺少原文或具体失败原因；英文和当前中文保留可读，长正文独立滚动。页脚提供阅读／关闭、重试／重译，失败时可打开 AI 设置。入场 timeline 为（280ms，4–7px，60ms 栏间错峰），译文就绪图标和文字分别为（240／320ms）。减少动态效果时跳过这些 timeline。
- **Calendar / Reader：**报表保持真实来源明细和独立周期，日历用“法／休／班”标明已收录安排；调休上班日纳入研究目标。阅读器只保留重点、方法、证据、疑问四类纵向折叠批注，定位时短暂提亮原句。

## Do's and Don'ts

### Do:

- **Do** 延续系统字体、用户字号、背景、透明度、深浅显示、密度、侧栏与 Dock 偏好。
- **Do** 通过真实状态、图标和文字说明动作，配色作为辅助层级。
- **Do** 保持摘要顶部反馈与页脚可见，让长正文在中间区域滚动。
- **Do** 在重新翻译失败时保留当前译文，并提供具体原因、AI 设置与重试。

### Don't:

- **Don't** 在宽屏为标题增加独立的居中容器或额外左缩进。
- **Don't** 将玻璃透光效果施加到 PDF 正文、文字或图标整体。
- **Don't** 将已移除主题或阅读器随手记入口记录为当前功能。
- **Don't** 将隔离界面成功状态视为真实外部 API 已成功连接。
