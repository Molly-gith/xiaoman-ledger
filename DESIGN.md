---
name: "小满 / Xiaoman"
description: "原创森林乐园中的工资周期账本 / A salary-cycle ledger in an original forest park"
colors:
  ink: "#303e2c"
  muted: "#63705a"
  green: "#3c6440"
  paper: "#faf9f2"
  line: "#e2e6d5"
  primary-fill: "#597744"
  primary-hover: "#496837"
  primary-text: "#fffdf1"
  card-sage: "#f0f2e4"
  quick-sand: "#f1e5cb"
  quick-hover: "#ebdcbc"
  field-paper: "#fffffa"
  field-line: "#d9dfc7"
  focus-clay: "#a15a29"
typography:
  display:
    fontFamily: '"Microsoft YaHei UI", "PingFang SC", sans-serif'
    fontSize: "38px"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "-.025em"
  headline:
    fontFamily: '"Microsoft YaHei UI", "PingFang SC", sans-serif'
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1.5
    letterSpacing: ".08em"
  title:
    fontFamily: '"Microsoft YaHei UI", "PingFang SC", sans-serif'
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.5
  body:
    fontFamily: '"Microsoft YaHei UI", "PingFang SC", sans-serif'
    fontSize: "13px"
    lineHeight: 1.5
  label:
    fontFamily: '"Microsoft YaHei UI", "PingFang SC", sans-serif'
    fontSize: "12px"
    lineHeight: 1.5
rounded:
  field: "13px"
  primary: "16px"
  quick: "21px"
  card: "23px"
  sheet: "28px"
  balance: "30px 30px 22px 22px"
  desktop-shell: "32px"
  pill: "999px"
spacing:
  compact: "8px"
  control-gap: "12px"
  field-gap: "18px"
  mobile-gutter: "22px"
  section-gap: "26px"
  desktop-gutter: "42px"
components:
  button-primary:
    backgroundColor: "{colors.primary-fill}"
    textColor: "{colors.primary-text}"
    rounded: "{rounded.primary}"
    height: "52px"
    width: "100%"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  quick-entry:
    backgroundColor: "{colors.quick-sand}"
    rounded: "{rounded.quick}"
    padding: "16px 18px"
  quick-entry-hover:
    backgroundColor: "{colors.quick-hover}"
  input:
    backgroundColor: "{colors.field-paper}"
    rounded: "{rounded.field}"
    height: "51px"
    padding: "0 14px"
  card:
    backgroundColor: "{colors.card-sage}"
    rounded: "{rounded.card}"
    padding: "22px"
---

# Design System: 小满 / Xiaoman

## Overview

**Creative North Star: "森林里的小满账本 / Xiaoman's Forest Ledger"**

小满把工资周期记账放进一座原创森林乐园：暖杏色种子伙伴、苔绿文字、奶油纸面与柔和日光共同营造治愈的童话氛围。金额、输入和确认动作保持清晰直接。
Xiaoman places salary-cycle bookkeeping inside an original forest park: an apricot seed companion, moss-colored text, cream paper and soft daylight create a comforting storybook atmosphere. Amounts, fields and confirmation actions remain clear.

本文记录已实现的视觉系统。样式顺序为 `app/globals.css` → `app/interactions.css` → `app/storybook.css`；最后一层定义本轮世界，未覆盖的结构和状态沿用前两层。实现使用 React 19、vinext 与 Pages；这不是组件库迁移规范。
This documents the built visual system. Styles load in the order above; the storybook layer defines the current world while earlier layers retain structure and remaining states. The implementation uses React 19, vinext and Pages.

**Key Characteristics:**

- 原创种子伙伴与森林场景 / Original seed companion and forest setting
- 中文优先、系统字体、清楚的金额层级 / Chinese-first system type and clear financial hierarchy
- 柔软圆角、轻阴影、明确操作状态 / Soft corners, gentle shadows and explicit interaction states

## Colors

### Primary

森林绿用于链接和导航；更柔和的叶绿用于表单主按钮。颜色名称与数值以页首标记为准。
Forest green serves links and navigation; softer leaf green serves primary form buttons. The frontmatter owns color values.

### Secondary

沙杏色承载记一笔入口和录音区域；陶土色提示焦点与需要注意的状态。暖色同时有装饰和状态用途，含义必须由文案说明。
Sandy apricot supports entry and recording surfaces; clay highlights focus and attention states. Warm color has both decorative and state roles, so text must explain its meaning.

### Neutral

奶油纸面承载操作，浅鼠尾草色区分信息分组；深苔色正文与更淡的说明文字形成层级，细浅线分隔数据。
Cream paper carries controls, pale sage groups information, moss text establishes hierarchy, and fine pale borders separate data.

## Typography

统一使用中文系统无衬线字体，优先保证日常操作可读性。品牌标题、余额、分区标题、明细正文和标签的代表值见页首；这是观察到的层级，不是固定比例字阶。
Use one Chinese system sans-serif stack for legible daily operation. Frontmatter records representative brand, balance, section, row and label roles, not a fixed modular scale.

余额采用等宽数字特性；桌面放大到（48px），窄于等于（380px）时降至（33px）。表单输入（16px），弹窗标题（21px），辅助文案多为（11–12px），少量说明（10px）。长金额允许换行。
Balances use tabular numerals: desktop (48px), at or below (380px) (33px). Fields use (16px), dialog titles (21px), most secondary copy (11–12px), and minor notes (10px). Long amounts may wrap.

## Layout

以日常操作为核心。已检查（390px）手机与（1280px）桌面截图。手机主容器最大（600px），左右留白（22px），底部预留（125px）；主体纵向排列，导航固定在视口底部并照顾安全区。
This is an operation-focused interface, checked at mobile (390px) and desktop (1280px). Mobile content is capped at (600px), with (22px) side gutters and (125px) bottom padding. Sections stack vertically; navigation stays at the viewport bottom with safe-area padding.

从（850px）起，主容器最大（1040px）、左右留白（42px），预算和消费性质并排为两列，间距（38px）；导航变为（480px）宽的浮动底栏，离底（20px）。更早的主容器外边距规则已被最终样式覆盖。
At (850px), content grows to (1040px) with (42px) gutters, and the budget and expense-nature sections use two columns with a (38px) gap. Navigation becomes a floating (480px) bar, (20px) from the bottom. The final stylesheet overrides earlier shell-margin rules.

弹窗居中，最大宽（520px），距视口边缘至少（16px），高度限制为视口减（32px），内容可滚动。手机窄屏补丁从（380px）及以下生效。
Dialogs are centered, capped at (520px), inset at least (16px), and scroll within viewport height minus (32px). Compact adjustments apply at or below (380px).

## Elevation & Depth

深度主要来自插画的空间、浅色分层和低强度柔影；表单弹窗使用更强的投影与（6px）背景模糊。导航本身不做背景模糊。具体阴影在 `.impeccable/design.json`，不在色彩标记中重复。
Depth comes from the scene, pale surface layers and soft shadows. Dialogs use stronger elevation and (6px) backdrop blur. Navigation has no backdrop blur. Exact shadows live in the sidecar.

## Shapes

圆角大小随用途变化：输入框和按钮紧凑，信息卡与弹窗更柔软；余额画面上角比下角更圆。进度条为胶囊形；空状态标记和加载印章使用不对称圆角。
Corners vary by role: fields and buttons are compact, cards and dialogs softer, and the illustrated balance has rounder upper corners. Progress tracks are pills; the empty-state mark and loading seal use asymmetric corners.

原创 SVG 图标采用（24 × 24）画布、（1.8）线宽、圆端与圆连接；常用显示尺寸为（18–28px）。图标与文字标签搭配，装饰性 SVG 对辅助技术隐藏。
Original SVG icons use a (24 × 24) viewBox, (1.8) stroke and round caps/joins, usually displayed at (18–28px). Labels convey meaning; decorative SVGs are hidden from assistive technology.

## Components

### Buttons

表单主按钮使用页首标记；弹窗外主按钮沿用（50px）高度与森林绿色。轻按反馈为向下（1px），默认状态过渡（180ms ease-out）；禁用透明度（0.55）。入口采用沙杏色横条、书本图标和加号，不是录音按钮。
Form primary buttons use frontmatter tokens; primary actions outside dialogs retain (50px) height and forest green. Pressed feedback moves down (1px), default transitions use (180ms ease-out), and disabled opacity is (0.55). The sandy entry strip pairs a book with a plus; it opens entry.

### Inputs / Fields

常规弹窗输入框通过绿色边框与（3px）浅绿光圈表达焦点；继承的字段规则取消其外轮廓。按钮、链接和摘要使用陶土色（3px）轮廓、偏移（4px）。消费来源单选整行另有焦点轮廓；备份导入标签保留原浅绿色焦点框。
Standard dialog fields show focus through a green border and (3px) pale green ring; inherited field styles suppress their outline. Buttons, links and summaries use a clay (3px) outline offset by (4px). Expense-source radio rows have their own focus outline; the backup-import label retains its earlier pale green ring.

### Chips / Cards / Navigation

分类选项使用三列网格，选中时浅绿底、绿边框与加粗文字；顶部筛选使用奶油色选中块。信息卡以浅鼠尾草底与细边框分组。底部五格导航将加号置于中央；当前页图标填充浅绿，并保留文字。
Category choices form three columns; selection adds a pale green fill, green border and bold text. Filters use a cream selected segment. Sage cards group information with a fine border. Five-slot navigation centers the add action; the active page keeps a label and gains a pale green icon fill.

### Voice control

麦克风、说明文字和音量条共同组成语音入口。录音时图标变为停止方块，音量条按（0.8s ease-in-out）上下缩放；处理时按钮禁用、音量条变淡。所有动态在减少动态效果偏好下关闭。弹窗无入场动画；提示条与初始加载仍保留各自的短动画。
The voice control combines a microphone, copy and bars. Recording replaces the icon with a stop square and scales bars over (0.8s ease-in-out); processing disables the button and fades the bars. Reduced-motion preference disables all motion. Dialog entrance is static; toast and initial loading retain their own animations.

### Forest scene

唯一主场景为 `public/art/xiaoman-forest.png`，生成来源在同名 `.png.json`。保留原创暖杏色种子伙伴、绿色围巾、记事本和橡果小屋；这是当前世界的资产，不是财务状态动画。
The main scene is `public/art/xiaoman-forest.png`, with provenance in its adjacent `.png.json`. Preserve the original apricot seed companion, green scarf, notebook and acorn cottage; this is environment artwork, not a financial-state animation.

余额图采用 cover：手机右侧居中，桌面中心（59%）；工资设置页插图裁切到中心（70%），初始设置与桌面外背景复用场景。外背景有浅色覆盖层；图片不包含 UI 文字。场景更新须同时检查左侧金额可读性、右侧伙伴和来源记录。
The balance uses cover, right-center on mobile and center (59%) on desktop. The cycle-form crop is center (70%); setup and desktop outer backgrounds reuse the scene. The outer background has a pale overlay. Artwork contains no UI text. Replacements require checking left-side amount legibility, the right-side companion and provenance.

## Do's and Don'ts

### Do:

- **Do** 保持主要金额在场景左侧明亮留白处，并在手机与桌面检查裁切。 / Keep the main amount in the bright left clearing and check both crops.
- **Do** 用文字说明预算和消费状态，图标与颜色辅助理解。 / Explain financial states in words; use icons and color as support.
- **Do** 保留录音状态、处理状态和减少动态效果设置。 / Preserve recording, processing and reduced-motion states.

### Don't:

- **Don't** 用已有影视角色替换原创种子伙伴。 / Replace the original seed companion with an existing franchise character.
- **Don't** 把装饰字体、插画文字或持续环境动画加入日常记账控件。 / Add decorative type, text baked into artwork or continuous ambient animation to bookkeeping controls.
- **Don't** 把未实现的着色器、养成奖励或游戏机制写成当前能力。 / Describe unimplemented shaders, progression rewards or game mechanics as current features.
