# 适配层：怎么把 daka 接到任意「刷 B 站插件」

> 这份文档是给**要换上游插件的人**和**帮用户改的 AI 助手**看的。
> 正常使用（装 `dsh-bili-whale`）不需要读——点「接入父插件」就行。

---

## 一句话

daka 只从上游要**两件事**：**能不能用**、**能不能下到视频**。
其余（挑帧、判定、生图、相册、图片私信、小作文、旅游日记）全在 daka 自己身上。

**换上游，只改一个对象。**

---

## 唯一要改的地方：`tools/lib/parent.mjs` 顶部的 `ADAPTER`

```js
export const ADAPTER = {
  name: 'dsh-bili-whale',          // 对方的 npm 包名
  entry: ['tools', 'bili.mjs'],    // 包内到命令行的相对路径
  configFile: 'bili-whale.config.json',  // 对方的配置文件名（只判断装没装好）
  commands: {
    debrief: ['debrief', '<BV>'],                              // 看视频（可选）
    dm: ['dm', '--msg', '<TEXT>', '--go'],                     // 纯文字私信
    dynamicImage: ['dynamic-image', '--image', '<FILE>', '--text', '<TEXT>', '--go'],  // 图文动态（可选）
    diaryLog: ['diary', 'log', 'drive'],                       // 事件流（可选）
  },
}
```

### 三种情况，三种改法

| 对方的情况 | 要改什么 |
|---|---|
| **有命令行，但包名/路径不同** | 改 `name` / `entry` / `configFile` 三个字段 |
| **有命令行，但子命令名字不同**（比如它叫 `inspect` 不叫 `debrief`） | 改 `commands` 里对应那一行 |
| **没有命令行** | **什么都不用改**——`fetch.mjs` 会自己下视频 |

> `<BV>` `<TEXT>` `<FILE>` 是占位符，daka 会把真实参数填进去。

---

## 为什么"没有命令行也能用"

`tools/lib/fetch.mjs` 是**第二个适配层**，它让 daka 自带取片能力：

```
view(bv)        →  cid / 时长 / 标题      （x/web-interface/view）
playurl(bv,cid) →  直链，qn=80 通常 720P   （x/player/playurl）
fetchSubs(...)  →  官方字幕 → 存成 [mm:ss]  （WBI 签名 + player/wbi/v2）
```

所以上层插件哪怕只会"读文字、挑视频"，daka 也能出图。
**上游退化成一个"选题器"**——这是刻意的设计。

---

## 改完之后怎么验证

```bash
node tools/feiyu.mjs selftest
```

看这两项：

| 项 | 通过长什么样 |
|---|---|
| `父插件 bili.mjs` | 显示你填的那个绝对路径 |
| `AGENTS.md 守则` | 显示 `v8` |

再点设置页的「接入父插件」，然后看守则里的作用域：

```
本节只适用于这些插件的会话：`对方的会话关键词`
```

作用域是**自动检测**的：扫 `~/.dsh/profiles/*/node_modules/dsh-bili-*`，装了几个写几个。
包名不是 `dsh-bili-*` 的话，在 `tools/lib/rules.mjs` 里加一行：

```js
const KEYWORD_HINT = {
  'dsh-bili-whale': 'bili-whale',
  '你的包名': '它会话 id 里会出现的那个词',
}
```

---

## 不用改代码的捷径

设置页有「父插件路径」一栏（配置项 `parent.bili`）。填一个绝对路径，
`ADAPTER` 的猜测就全部被绕过——**对方只要有命令行，连代码都不用碰**。

```
优先级：parent.bili > profiles/*/node_modules/<name>/<entry> > plugins/<name>/<entry>
```

---

## 给 AI 助手的指令（可以直接复制）

> 我要把 dsh-bili-lvxingfeiyu 这个旅行肥鱼接到另一个刷 B 站的插件上。
>
> 1. 先看 `tools/lib/parent.mjs` 顶部的 `ADAPTER` 对象——这是唯一的适配点。
> 2. 确认对方插件有没有命令行入口（`package.json` 的 `bin`，或包里的 `tools/*.mjs`）。
>    - **有**：改 `ADAPTER.name` / `entry` / `configFile`，把 `commands` 里用不到的项删掉；
>      或者干脆在设置页「父插件路径」里填绝对路径，代码一行都不用改。
>    - **没有**：**不要改代码**。daka 的 `tools/lib/fetch.mjs` 会自己下视频和字幕，
>      对方只负责"选题"。此时把 `ADAPTER.commands` 里除 `dm` 以外的项删掉即可。
> 3. 改完跑 `node tools/feiyu.mjs selftest`，要看到「父插件 bili.mjs ✓」。
> 4. 点设置页「接入父插件」，确认守则作用域里出现了对方的会话关键词。
>
> 不要动 `fetch.mjs` 以外的地方——挑帧、判定、生图、私信、日记都跟上游无关。

---

## 边界（刻意划的）

| daka 负责 | 上游负责 |
|---|---|
| 下载/取帧/拼提示词/调生图 | 发现视频（选题、推荐、搜索） |
| 相册、额度、去重、清理 | 它自己的登录态与账号 |
| 图片私信（图床 + msg_type=2） | 纯文字私信、图文动态（可选）|
| 小作文、旅游日记 | 它自己的人设/日记（如果有）|

**daka 永远不读上游的 cookie、不碰上游的代码、不改上游的配置。**
找不到就明说找不到，不猜、不静默降级。
