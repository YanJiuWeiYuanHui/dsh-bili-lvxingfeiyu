# 旅行肥鱼 v1.0.0（dsh-bili-lvxingfeiyu）

> 她看完一条视频，挑一个**自己站得进去的地方**，把角色参考图和那一帧一起送进生图模型，
> 得到一张「她去过那里」的图。可以存相册，也可以发成图文动态、私信、评论区 @。

这不是「给视频配图」，是**去一个地方**——今天没有值得去的地方，就一条都不出。

---

## 第一次用（5 步）

```bash
# ① 装进 profile（改 3 处接线，幂等，不动别的插件）
node tools/install.mjs

# ② 体检：它会列出"还缺什么、怎么补"
node tools/feiyu.mjs doctor
```

装完 **完全退出 DSH 再打开**（不是关窗口），设置里才会出现「旅行肥鱼」。

| # | 在哪做 | 做什么 | 必须吗 |
|---|---|---|---|
| ③ | 设置 → 旅行肥鱼 → **API** | 填 endpoint + 密钥 + 模型（要支持**多图 edits**）| 必须 |
| ④ | 同页 → **参考图** | 包里自带一张默认角色图，换成你自己的角色 | 必须 |
| ⑤ | 同页 → **接入插件** | 把「守则」写进 AGENTS.md，让她知道出图后要做什么 | 必须 |
| ⑥ | 先装 [dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale) | 她才能"自己刷视频"；只装本插件也能用，但要**手动给 BV** | 推荐 |

全部就绪后跑一次 `doctor`，看到「全部通过」就说明她下次看完视频会自己挑地方、出图、
发私信、写小作文了。

---

---

## 上游插件（推荐一起装）

「自己刷视频」这件事不是本插件做的，是 **dsh-bili-whale** 做的 —— 它按作息自己刷 B 站、
下载原片、读字幕、写日记、发私信/动态。

> ### ⬇️ 推荐下载：[Alterssss/dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale)

装上它，旅行肥鱼才会**自己挑片**；不装也能用，但你得自己给 BV 号。

**两者怎么分工：**

| | dsh-bili-whale（上游）| 旅行肥鱼（本插件）|
|---|---|---|
| 干什么 | 发现视频、下载、读字幕、写日记、发私信/动态 | 挑一帧、判定、生图、写成旅行日记 |
| 必须吗 | 推荐（不装就手动给 BV）| — |

**本插件不修改上游的任何代码**：只调用它的命令行（`bili.mjs`），
接口位置固定在 `tools/lib/parent.mjs` 的 `ADAPTER` 对象里，换上游只改那一处（见 [ADAPTER.md](./ADAPTER.md)）。

## 边界（很重要）

| 做 | 不做 |
|---|---|
| 优先读**父插件已经下到本地**的 `mp4` / 字幕；没有时**自己下一条**（`tools/lib/fetch.mjs`）| ❌ 不批量抓、不爬全站 |
| 调生图 API（主要的外部网络）| ❌ 不改父插件代码 |
| 写自己的账本、队列、`AGENTS.md` 标记块 | ❌ 发布动作都由你显式选择 |
| **私信发图**（`tools/commands/dm-image.mjs`）| ❌ 除了这一个文件，其余不碰 B 站接口 |

**只有一处 B 站代码**：`tools/commands/dm-image.mjs`。
父插件的私信只能发文字，而图是本插件生成的——要把图发进私信，只能自己走
`upload_bfs` + `send_msg(msg_type=2)`。这是**唯一**的例外，其余部分（pick / frame /
render / album）只读本地素材；素材缺一条时由 `fetch.mjs` 自己补，用完就走。

不含 B 站接口文档，也不打包 ffmpeg。

---

## 装

两种方式，**推荐一键脚本**。

### 方式 A：一键脚本（推荐）

```bash
# 1) 把插件目录放到任意位置，然后：
node tools/install.mjs

# 装到别的 profile：
node tools/install.mjs --profile web

# 不想用链接、想复制一份：
node tools/install.mjs --copy
```

它做的三件事，和手工接线完全等价（不碰任何已有插件）：

1. 在 `<DSH_HOME>/profiles/<profile>/node_modules` 下建链接
2. 往该 profile 的 `package.json` 加 `dependencies["dsh-bili-lvxingfeiyu"] = "link:…"`
3. 把 `dsh-bili-lvxingfeiyu` 加进 `dsh.profile.bundles`

**然后完全退出 DSH 再打开**（不是关窗口）。

### 方式 B：手工接线

```bash
# 1) 链接进 profile
#    Windows:
mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-bili-lvxingfeiyu" "<插件绝对路径>"
#    macOS / Linux:
ln -s "<插件绝对路径>" ~/.dsh/profiles/desktop/node_modules/dsh-bili-lvxingfeiyu
```

然后编辑 `~/.dsh/profiles/desktop/package.json`：

```jsonc
{
  "dependencies": { "dsh-bili-lvxingfeiyu": "link:C:/path/to/dsh-bili-lvxingfeiyu" },
  "dsh": { "profile": { "bundles": [ …, "dsh-bili-lvxingfeiyu" ] } }
}
```

### ⚠️ 关于 `dsh plugin add`

`dsh plugin --profile <名字> add <包>` 只是转调 pnpm，**装完还得手工把包名加进
`dsh.profile.bundles`**，否则不会加载。

而 **desktop profile 被 Electron 应用独占**，`dsh plugin --profile desktop …` 会直接拒绝
（"managed exclusively by the Electron application"）——所以桌面版用户只能走上面的 A 或 B。

### 上游插件（可选但推荐）

```bash
# 她负责"自己刷视频"，daka 负责"打卡出图"
# 装 dsh-bili-whale 到同一个 profile，然后在设置页点「接入父插件」
```

只装 daka 也能用：**手动给 BV 号**即可（`daka render --bv … --at … --card …`），
只是不会自己挑片。

```bash
# 1) 父插件（她负责看视频）
dsh plugin --profile desktop add "link:C:\path\to\dsh-bili-whale"

# 2) 本插件
dsh plugin --profile desktop add "link:C:\Users\<你>\Desktop\dsh-bili-lvxingfeiyu"

# 3) 重启一次 DSH（bundle 层要重新组装）
```

重启后「设置」里会出现 **养鱼** 和 **打卡** 两栏。

> 本插件只声明 `inject: ['webServer']`，不需要 `sessionController`，
> 所以它在任何带 Web 界面的 profile 里都能起来。

---

## 三步上手

### 1) 配 API

「设置 → 打卡 → API」：

- **端点**：OpenAI 兼容即可（要支持 `/images/generations` 与 `/images/edits`）
- **模型**：点「获取模型」从端点读，然后在下拉里选
- **密钥**：填完点「保存密钥」，之后**永不回显**

### 2) 加参考图

「参考图」区点「+ 添加图片」，每张图都能写**注释**：

- 顺序就是发给模型的顺序，**第一张通常是角色本体**
- 注释会拼进提示词，也用于报错时定位是哪张被拒

### 3) 接入父插件

点「接入父插件」——它只做一件事：把一段**带作用域标记**的「打卡守则」写进
`~/.dsh/AGENTS.md`，让父插件的 agent 每次会话都能读到。

- 只对会话 id 含 `bili-whale` 的会话生效，别的会话会忽略
- 幂等：重装只替换块内内容；「卸载守则」会把块摘掉（文件因此变空时会自动删除）

---

## 一条视频是怎么变成一张图的

```
父插件深读视频（它自己下 mp4 + 字幕）
        ↓
daka pick <BV>            出 2–3 个候选段，每段若干缩略图 + 精确时刻 + 那段字幕
        ↓
模型看图，按 prompts/rubric.md 写「判定卡」
        ↓
daka render --bv <BV> --at 03:24 --card card.json
        ↓
取全分辨率帧 → 拼提示词 → POST /images/edits（帧 + 参考图）
        ↓
~/.dsh/lvxingfeiyu/album/<日期>-<BV>-<时刻>.png  +  album.jsonl 记一笔
        ↓
按设置发布：相册 / 图文动态 / 评论区 / 私信 / 桌面通知
```

**时间戳从哪来**：字幕（`[mm:ss]`）给时刻，缩略图给空间。两件事分开，
所以不用从九宫格里猜「这是第几秒」。

### 提示词骨架（代码写死的那部分）

`render` 拼提示词时，把三件事**固定在代码里**，不指望模型每次都想起来：

1. **场景不动**：第一张图必须保留构图、建筑、透视、材质、光线
2. **人物一致**：外观取自「设置 → 打卡 → 人物外观」（留空则用参考图注释），
   要求发色/瞳色/发饰/服装/围裙/尾巴与参考图一致、正常人体比例
3. **结构稳定**：正好两条手臂两只手、每只手五个手指、一条尾巴，头颈躯干连接自然；
   默认负向词覆盖多余肢体、双头、头胸融合、肢体粘连、断指、比例失调等

还有一条是为了**不出现站桩图**：

> 动作必须由这个场景的内容决定（画面里正在发生什么，就回应什么），
> **不要默认提裙摆** —— 提裙摆只在场景明显需要时才行。

所以判定卡里 `action` 是必填的，而且要写具体。`facing` 也会被翻成人话
（`back` → 「背对镜头，不要回头正对镜头」），否则模型一律画成正脸。

---

## 命令

```bash
node tools/feiyu.mjs status                 # 额度/密钥/参考图/父插件/守则
node tools/feiyu.mjs models                 # 拉模型列表
node tools/feiyu.mjs refs list|add|rm|note|toggle
node tools/feiyu.mjs pick <BV> [--around mm:ss] [--segments 3] [--burst 7]
node tools/feiyu.mjs frame <BV> --at mm:ss  # 取一张原分辨率帧
node tools/feiyu.mjs render --bv <BV> --at mm:ss --card card.json [--dry] [--force]
node tools/feiyu.mjs render --draft <id>    # 从待打卡队列生成
node tools/feiyu.mjs draft list|show|drop
node tools/feiyu.mjs album [--n 12]
node tools/feiyu.mjs publish --id <相册ID> [--dry]
node tools/feiyu.mjs push --bv <BV> [--note "…"] [--dry]   # 只推视频链接，不产图
node tools/feiyu.mjs rules status|attach|detach
node tools/feiyu.mjs selftest
node tools/feiyu.mjs config show
node tools/feiyu.mjs config set --key api.model --value gpt-image-2
```

`pick` / `render` 只输出 JSON，模型可以直接读。

---

## 数据在哪

```
~/.dsh/lvxingfeiyu.config.json        设置（不含密钥）
~/.dsh/lvxingfeiyu/secret.json        密钥（0600 / Windows ACL 收紧，永不回显）
~/.dsh/lvxingfeiyu/refs/              参考图 + refs.json
~/.dsh/lvxingfeiyu/album/             生成的图
~/.dsh/lvxingfeiyu/album.jsonl        主账本（含失败记录与 API 原始报错）
~/.dsh/lvxingfeiyu/frames/            从视频里取出来的帧
~/.dsh/lvxingfeiyu/draft.json         待打卡队列
~/.dsh/lvxingfeiyu/tmp/               选景缩略图（2 天自动清）
~/.dsh/shots/video/            ← 只读：父插件下的原片
~/.dsh/shots/subs/             ← 只读：父插件的字幕 txt
```

---

## 发布目标

| dest | 能带图吗 | 前提 |
|---|---|---|
| `album` | ✅ | 无（永远执行）|
| `dynamic` | ✅ 图文动态 | 父插件 + cookie（`dynamic-image` 还要求凭据里有 `buvid3`）|
| `comment` | ❌ 文字 @ | 需要 oid；**会占掉父插件当天 3 条分享额度之一** |
| `dm` | ❌ 文字（+ 动态链接）| **第二个 B 站号 + 双方互关** |
| `dm-image` | ✅ **私信里直接看到图** | 同上；还需 `optional/dm-image.mjs`（见下）|
| `desktop` | ❌ 提示去看相册 | Windows 桌面通知 |

发布时机三档：`manual`（默认）/ `auto-if-good`（判定卡分数达标才发）/ `auto`。

### `push`：只推视频，不产图

判定卡 `can:false` 只说明「没有她能站的地方」，**不代表视频没价值**。
遇到后者，走 `push`：纯文字私信 + 视频链接，不花生图额度、不占打卡额度。

```bash
node tools/feiyu.mjs push --bv BV1xxxxxxx --note "讲了什么、为什么值得看"
```

### `dm-image`：私信带图

父插件的私信**只能发文字**（`msg_type=1`）。要在私信里直接看到图，需要两条 B 站接口：

1. `x/dynamic/feed/draw/upload_bfs` —— 先把图传到 B 站图床，拿 `image_url`
2. `web_im/v1/web_im/send_msg` —— `msg_type=2`，content 里带 `url/width/height/imageType`

实现在 **`tools/commands/dm-image.mjs`**，是本项目里唯一直接操作 B 站接口的文件。

```bash
node tools/commands/dm-image.mjs --image <png> --msg "附言" --dry
node tools/commands/dm-image.mjs --image <png> --msg "附言" --go
# 或者
node tools/feiyu.mjs dm-image --image <png> --msg "附言" --go
```

三道闸与父插件一致：一天只锁定一个收信人 · 只发给 `owner.mid` · 必须互关。
请求仍然过父插件的请求闸（预算 / 冷却 / 412 暂停 / 防重复）。

> ⚠️ 被**防重复**闸影响的两条实测行为：
> - 同一张图（字节完全相同）24 小时内只能上传一次，第二次会报「相同操作已提交」；
> - 同一段文字 + 同一张图不能重复发，改文案或换图即可。
>
> 这是父插件保护账号的机制，不是 bug。每次打卡产出的是新图，正常用不会撞上。

---

## 三条硬规矩

1. **密钥不进模型、不进命令行、不进日志**。没有 `--key` 参数；`render` 只返回文件路径。
2. **失败原样透传**。API 报什么就显示什么（含 HTTP 状态与原始 body），**不降级、不静默重试**。
3. **额度由代码卡**，不靠自觉：每天 `daily` 张、同一视频 `perVideo` 张。

---

## 已知限制

- 需要父插件**已经深读过**那条视频（本地要有 mp4）。没有就明确报错，不会自己去下载。
- 一次只能发一张图（B 站图文动态的 `pics` 结构限制）。
- B 站图文动态只收 `png / jpg / gif`；生图返回 webp 时要先转码。
- `dm` 在单号模式下用不了（B 站不能给自己发私信）。
- 桌面通知是 best-effort，弹不出来不影响其它环节。

---

## 许可

MIT。

**关于 B 站接口：** 只有一个文件直接调用 B 站接口 —— `tools/commands/dm-image.mjs`，
用它把图上传到 B 站图床再发一条 `msg_type=2` 的私信。原因是父插件的私信只能发文字，
要在私信里直接看到图，绕不开这两条接口（`upload_bfs` + `web_im/send_msg`）。

- 不启用「私信带图」时，这个文件**不会被加载**，插件运行期间不碰任何 B 站接口
- 本仓库**不包含**任何 B 站接口文档、抓包产物或第三方接口仓库的拷贝
- 其余的读视频、发文字私信、发动态，全部通过调用**父插件的命令**完成，daka 自己不实现

如果你的分发场景要求「零 B 站接口代码」，删掉 `tools/commands/dm-image.mjs` 并在
`lib/index.js` 里去掉 `dm-image` 这个发布目标即可 —— 其余功能不受影响。

## 换上游插件？

daka 只从上游插件要「能不能用」和「视频」。要接到别的刷 B 站插件上，
**只改 `tools/lib/parent.mjs` 顶部的 `ADAPTER` 对象**（或者直接在设置页填「父插件路径」）。

看 [ADAPTER.md](./ADAPTER.md) —— 里面写了三种情况怎么改，还有一段可以直接丢给 AI 助手的指令。
