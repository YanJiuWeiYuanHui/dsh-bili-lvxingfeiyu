# 打包清单（还没开始打包，先记需求）

> 现在**不要打包**。这份文件只是把要求固定下来，等要发的时候照着做。

## 要带的

| 项 | 说明 |
|---|---|
| 代码 | `lib/` `tools/` `prompts/` `cordis.patch.yml` `package.json` |
| 文档 | `README.md` `ADAPTER.md` |
| **鲸鱼娘的参考图** | **要作为默认角色图随包发布**（见下面的"怎么带"）|

## 不带的（本人的创作与配置）

| 项 | 位置 | 为什么 |
|---|---|---|
| 打卡图（相册）| `~/.dsh/lvxingfeiyu/album/` | 是作品 |
| 旅游日记（小作文）| `~/.dsh/lvxingfeiyu/journal/` | 是作品 |
| 相册账本 | `~/.dsh/lvxingfeiyu/album.jsonl` | 含我的打卡记录 |
| 配置 | `~/.dsh/lvxingfeiyu.config.json` | 含我的模型选择、口味、作息 |
| 密钥 | `~/.dsh/lvxingfeiyu/secret.json` | **绝对不能带** |
| 人设 | `~/.dsh/lvxingfeiyu/persona.md` | 我的角色设定 |
| 原片 / 帧 / 缩略图 | `~/.dsh/shots/`、`~/.dsh/lvxingfeiyu/{frames,tmp}` | 体积大且无关 |
| 父插件数据 | `~/.bili-ai/` | 别人的账号 |
| 会话、日志 | `~/.dsh/sessions/` | 隐私 |

## 怎么「带那张图」

参考图现在**不在插件目录里**，它在数据目录：

```
~/.dsh/lvxingfeiyu/refs/her.png      ← 运行时用的
~/.dsh/lvxingfeiyu/refs/refs.json    ← 图 + 注释
```

所以直接打包代码，新用户装上之后**是没有参考图的**（`node tools/feiyu.mjs doctor` 会报「参考图：可用 0 张」）。

要让它成为默认，打包时要加两件东西：

1. **把图放进包里**：`assets/default-refs/her.png`（+ 一份 `refs.json` 的注释）
2. **加一个 seed 步骤**：插件启动（或 `ensureDirs`）时，如果数据目录里的 `refs/` 是空的，
   就把 `assets/default-refs/` 复制进去，写进 `refs.json`，**只做一次**
   （用 `refs.json` 是否存在来判断，不要每次都覆盖用户自己加的图）

伪代码：

```js
// core.mjs 的 ensureDirs 里
const seeded = path.join(P.refs, 'refs.json')
if (!fs.existsSync(seeded)) {
  fs.cpSync(path.join(ROOT, 'assets', 'default-refs'), P.refs, { recursive: true })
}
```

⚠️ 注意：`npm pack` 默认会把 `assets/` 带上（只要在 `files` 里加一行）；
但**不要**把 `~/.dsh/lvxingfeiyu/refs/` 一起打进去——那是运行时的。

## 发布前检查

- [ ] `package.json` 的 `files` 加上 `"assets"` 和 `"ADAPTER.md"`、`"tools/install.mjs"`（`tools` 已覆盖）
- [ ] 确认 `assets/default-refs/` 里只有那张角色图，没有别的
- [ ] `grep -r "C:\\Users" .` 确认没有残留的本机绝对路径
- [ ] `node tools/feiyu.mjs doctor` 在一台干净机器上跑一遍
