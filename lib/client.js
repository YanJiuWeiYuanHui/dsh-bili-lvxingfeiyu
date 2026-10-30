/**
 * dsh-bili-lvxingfeiyu —— 客户端半边：DSH「设置 → 旅行肥鱼」
 *
 * 数据流：section ⇄ /dsh-bili-lvxingfeiyu/api/* ⇄ ~/.dsh/lvxingfeiyu.config.json + daka/ 下的文件
 * 密钥只写不回显；所有慢操作（拉模型/生成/发布）都交给 CLI，界面只轮询结果。
 */
window.__ModuleLoader__.load({
  id: "dsh-bili-lvxingfeiyu",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const { createElement: h, useCallback, useEffect, useState } = React;

    const API = "/dsh-bili-lvxingfeiyu/api";
    const CSS_TAG = "dsh-bili-lvxingfeiyu/section.css";
    const CSS = [
      ".dk{max-width:820px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:6px}",
      ".dk-title{margin:0;font-size:16px;font-weight:500;line-height:24px}",
      ".dk-intro{color:var(--dsw-alias-label-tertiary);margin:0 0 4px;font-size:13px;line-height:20px}",
      ".dk-group{margin-top:16px;font-size:13px;font-weight:600;line-height:20px}",
      ".dk-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px 18px;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);flex-wrap:wrap}",
      ".dk-row:last-child{border-bottom:none}",
      ".dk-row>div:first-child{flex:1;min-width:180px}",
      ".dk-label{font-size:13px;line-height:19px}",
      ".dk-hint{color:var(--dsw-alias-label-tertiary);margin-top:3px;font-size:11.5px;line-height:17px}",
      ".dk-input,.dk-select{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;height:28px;padding:0 8px;min-width:180px;outline:none}",
      ".dk-input:focus-visible,.dk-select:focus-visible{border-color:var(--dsw-alias-brand-primary)}",
      ".dk-wide{min-width:300px}",
      ".dk-btn{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff);border:none;border-radius:6px;font-size:12.5px;height:30px;padding:0 12px;cursor:pointer}",
      ".dk-btn:disabled{opacity:.5;cursor:default}",
      ".dk-btn2{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}",
      ".dk-out{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);background:rgba(127,127,127,.08);border-radius:8px;padding:10px 12px;max-height:220px;overflow:auto;margin-top:10px}",
      ".dk-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin-top:8px;white-space:pre-line}",
      ".dk-badge{display:inline-block;font-size:11px;line-height:16px;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-secondary);margin-left:6px}",
      ".dk-badge.ok{background:rgba(52,199,89,.16)}",
      ".dk-badge.bad{background:rgba(255,69,58,.16)}",
      ".dk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px;margin-top:10px}",
      ".dk-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;display:flex;flex-direction:column}",
      ".dk-card img{width:100%;height:92px;object-fit:cover;display:block;background:#8882}",
      ".dk-card .dk-cap{font-size:11px;line-height:15px;padding:6px 7px;color:var(--dsw-alias-label-secondary);word-break:break-all}",
      ".dk-thumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}",
      ".dk-thumbs img{width:112px;height:74px;object-fit:cover;border-radius:6px;border:1px solid var(--dsw-alias-border-l2)}",
      ".dk-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;padding-top:12px;border-top:.5px solid var(--dsw-alias-border-l2)}",
      ".dk-chk{display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:12.5px;cursor:pointer}",
      // ── 旅游日记：米白底 + 衬线字 ──
      ".dk-head{display:flex;align-items:center;justify-content:space-between;gap:12px}",
      ".dk-diary{background:#faf6ee;color:#3b342b;border-radius:14px;padding:26px 30px;margin-top:12px;border:1px solid #e8dfd0}",
      ".dk-diary *{font-family:'Songti SC','Noto Serif SC','Source Han Serif SC',Georgia,'Times New Roman',serif}",
      ".dk-diary-title{font-size:22px;letter-spacing:.14em;color:#7a6a52;margin:0 0 4px}",
      ".dk-diary-sub{font-size:12px;color:#a08d72;letter-spacing:.08em;margin-bottom:22px}",
      ".dk-day{margin:26px 0 10px;padding-bottom:8px;border-bottom:1px solid #e6dbc7}",
      ".dk-day-date{font-size:17px;color:#6d5b42;letter-spacing:.06em}",
      ".dk-day-week{font-size:12px;color:#b09a7c;margin-left:8px}",
      ".dk-entry{display:flex;gap:16px;padding:16px 0;border-bottom:1px dashed #e9e0d0}",
      ".dk-entry:last-child{border-bottom:none}",
      ".dk-entry img{width:220px;height:auto;border-radius:8px;object-fit:cover;box-shadow:0 2px 10px rgba(120,100,70,.14);flex-shrink:0}",
      ".dk-entry-body{flex:1;min-width:0}",
      ".dk-entry-line{font-size:14.5px;line-height:1.95;color:#4b4133}",
      ".dk-entry-line::before{content:'「';color:#c0a888}",
      ".dk-entry-line::after{content:'」';color:#c0a888}",
      ".dk-entry-act{font-size:13px;line-height:1.9;color:#7d6c55;margin-top:8px}",
      ".dk-entry-meta{font-size:11.5px;color:#a8977d;letter-spacing:.04em;margin-top:10px}",
      ".dk-entry-meta a{color:#9a7f56;text-decoration:none;border-bottom:1px dotted #c9b79c}",
      ".dk-diary-empty{color:#a8977d;font-size:13px;padding:40px 0;text-align:center;line-height:2}",
      ".dk-essay{display:flex;flex-direction:column;gap:12px;padding:18px 0;border-bottom:1px dashed #e9e0d0}",
      ".dk-essay:last-child{border-bottom:none}",
      ".dk-essay img{width:100%;max-height:400px;object-fit:cover;border-radius:10px;box-shadow:0 3px 14px rgba(120,100,70,.16)}",
      ".dk-essay p{margin:0 0 15px;text-indent:2em;font-size:15px;line-height:2.1;color:#463c2f;letter-spacing:.02em}",
      ".dk-essay p:last-child{margin-bottom:0}",
      ".dk-essay-meta{font-size:11.5px;color:#a8977d;letter-spacing:.04em;padding-top:2px}",
      ".dk-essay-meta a{color:#9a7f56;text-decoration:none;border-bottom:1px dotted #c9b79c}",
      ".dk-pending{font-size:12.5px;color:#b09a7c;font-style:italic}",
      ".dk-essay-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;border-bottom:1px solid #e6dbc7;padding-bottom:10px}",
      ".dk-essay-title{font-size:19px;color:#5f4f38;letter-spacing:.06em}",
      ".dk-essay-foot{font-size:11.5px;color:#a8977d;letter-spacing:.04em;margin-top:6px}",
      ".dk-essay-foot a{color:#9a7f56;text-decoration:none;border-bottom:1px dotted #c9b79c}",
      ".dk-pager{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;padding-top:14px;border-top:1px solid #e6dbc7}",
      ".dk-pager-n{font-size:12px;color:#a8977d;letter-spacing:.1em}",
      ".dk-persona{width:100%;min-height:140px;font-size:12.5px;line-height:1.8;resize:vertical;margin-top:6px}",
      ".dk-ver{font-size:11px;font-weight:400;color:var(--dsw-alias-label-secondary);margin-left:8px;letter-spacing:.04em}",
      ".dk-close{background:transparent;border:1px solid #d8cab4;color:#7a6a52;border-radius:6px;height:28px;padding:0 12px;font-size:12.5px;cursor:pointer}",
    ].join("");

    function useStyleOnce() {
      useEffect(() => {
        if (typeof document === "undefined") return;
        if (!document.getElementById(CSS_TAG)) {
          const el = document.createElement("style");
          el.id = CSS_TAG; el.textContent = CSS;
          document.head.appendChild(el);
        }
      }, []);
    }

    const fileUrl = (kind, p) => `${API}/file/${kind}/${encodeURIComponent(String(p || "").split(/[\\/]/).pop())}`;

    function Badge({ ok, children }) {
      return h("span", { className: "dk-badge" + (ok === true ? " ok" : ok === false ? " bad" : "") }, children);
    }

    const PLUGIN_VERSION = "1.0.0"   // 与 package.json 保持一致

    function DakaSection() {
      useStyleOnce();
      const [st, setSt] = useState(null);
      const [cfg, setCfg] = useState(null);
      const [key, setKey] = useState("");
      const [models, setModels] = useState([]);
      const [busy, setBusy] = useState("");
      const [msg, setMsg] = useState("");
      const [err, setErr] = useState("");
      const [out, setOut] = useState("");
      const [dirty, setDirty] = useState(false);
      const [pilgrimUrl, setPilgrimUrl] = useState("");
      const [pilgrimMsg, setPilgrimMsg] = useState("");
      const [view, setView] = useState("daka");          // 主页 | 日记
      const [diary, setDiary] = useState(null);
      const [diaryDate, setDiaryDate] = useState("");
      const [page, setPage] = useState(0);
      const [showJD, setShowJD] = useState(false);
      const [persona, setPersona] = useState("");
      const [personaInfo, setPersonaInfo] = useState(null);
      const [cleanSel, setCleanSel] = useState({ videos: true, albums: false, tmp: true });
      const [cleanMsg, setCleanMsg] = useState("");

      const call = useCallback(async (path, body, method) => {
        const r = await fetch(API + path, {
          method: method || (body === undefined ? "GET" : "POST"),
          headers: body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        return j;
      }, []);

      const load = useCallback(async () => {
        setErr("");
        try {
          const j = await call("/state");
          setSt(j); setCfg(j.config); setDirty(false);
        } catch (e) { setErr("读取失败：" + e.message); }
      }, [call]);
      useEffect(() => { load(); }, [load]);

      const set = (pathArr, value) => {
        setCfg((c) => {
          const next = JSON.parse(JSON.stringify(c ?? {}));
          let cur = next;
          for (let i = 0; i < pathArr.length - 1; i += 1) {
            const k = pathArr[i];
            if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
            cur = cur[k];
          }
          cur[pathArr[pathArr.length - 1]] = value;
          return next;
        });
        setDirty(true);
      };

      const save = async () => {
        setBusy("save"); setErr(""); setMsg("");
        try {
          const j = await call("/config", { config: cfg });
          setCfg(j.config); setDirty(false); setMsg("✓ 已保存");
          await load();
        } catch (e) { setErr("保存失败：" + e.message); } finally { setBusy(""); }
      };

      const saveKey = async () => {
        setBusy("key"); setErr(""); setMsg("");
        try {
          await call("/secret", { apiKey: key });
          setKey(""); setMsg("✓ 密钥已保存（不回显）");
          await load();
        } catch (e) { setErr("保存密钥失败：" + e.message); } finally { setBusy(""); }
      };

      const fetchModels = async () => {
        setBusy("models"); setErr(""); setOut("正在读取模型列表…");
        try {
          const j = await call("/models");
          if (!j.ok) throw new Error(j.raw || j.error || "读取失败");
          setModels(j.models || []);
          setOut("✓ 可用模型 " + (j.models || []).length + " 个：\n" + (j.models || []).join("\n"));
        } catch (e) { setErr("拉取模型失败：" + e.message); setOut(""); } finally { setBusy(""); }
      };

      const attach = async (action) => {
        setBusy("rules"); setErr(""); setOut("");
        try {
          const j = await call("/rules", { action });
          if (!j.ok) throw new Error(j.error || "操作失败");
          setOut(action === "attach"
            ? "✓ 已接入父插件\n守则写入：" + j.path + "\n命令：" + j.command + (j.replaced ? "\n（替换了旧版本）" : "")
            : "✓ 已卸载守则");
          await load();
        } catch (e) { setErr("接入失败：" + e.message); } finally { setBusy(""); }
      };

      const selftest = async () => {
        setBusy("test"); setErr(""); setOut("体检中…");
        try {
          const j = await call("/selftest");
          const lines = (j.items || []).map((i) => `${i.ok ? "✓" : "✗"} ${i.name} — ${i.detail ?? ""}`);
          setOut(lines.join("\n") + "\n\n" + (j.ok ? "全部可用 ✓" : "有项不可用 ✗"));
        } catch (e) { setErr("体检失败：" + e.message); setOut(""); } finally { setBusy(""); }
      };

      const submitPilgrim = async () => {
        const url = pilgrimUrl.trim();
        if (!url) return;
        setBusy("pilgrim"); setErr(""); setPilgrimMsg("");
        try {
          const j = await call("/pilgrimage", { url });
          setPilgrimMsg(j.delivered
            ? `✓ 已交给她去看（${j.bv}）—— 她会自己判断值不值得去，看完回来告诉你`
            : `⚠ 请求已排队（${j.bv}）：${j.reason ?? "暂时联系不上她的会话"}`);
          if (j.delivered) setPilgrimUrl("");
          await load();
        } catch (e) { setErr("提交失败：" + e.message); } finally { setBusy(""); }
      };

      // 打开数据目录（资源管理器里手动删）
      const openPath = async (target) => {
        setBusy("open" + target); setCleanMsg("");
        try {
          const j = await call("/open", { target });
          setCleanMsg(j.ok ? "✓ 已打开：" + j.dir : "✗ " + (j.error || "打不开"));
        } catch (e) { setCleanMsg("✗ " + friendly(e)); } finally { setBusy(""); }
      };

      // 一键清除：勾了几类就清几类
      const runClean = async (dry) => {
        const only = Object.entries(cleanSel).filter(([, v]) => v).map(([k]) => k);
        if (!only.length) { setCleanMsg("先勾选要清除的类别"); return; }
        setBusy("clean"); setCleanMsg(dry ? "预演中…" : "清除中…");
        try {
          const j = await call("/clean", { only, dry, all: true });
          if (!j.ok) throw new Error(j.error || "失败");
          setCleanMsg(dry
            ? `预演：会删 ${j.files} 个文件，释放 ${j.mb}MB（${Object.entries(j.breakdown || {}).map(([k, v]) => k + " " + v).join(" · ") || "无"}）`
            : `✓ 已清除 ${j.files} 个文件，释放 ${j.freedMB}MB`);
          if (!dry) await load();
        } catch (e) { setCleanMsg("✗ " + e.message); } finally { setBusy(""); }
      };

      const friendly = (e) => String(e && e.message || e).includes("404") ? "宿主还没重新加载这段代码 —— 完全退出 DSH 再打开一次" : String(e && e.message || e);

      const loadPersona = async () => {
        try { const j = await call("/persona"); setPersona(j.text || ""); setPersonaInfo(j); } catch (e) { setErr("读人设失败：" + friendly(e)); }
      };
      const savePersona = async () => {
        setBusy("persona");
        try { const j = await call("/persona", { text: persona }); setPersonaInfo(j); setMsg(j.ok ? "人设已保存（" + (j.chars || 0) + " 字）" : "保存失败"); }
        catch (e) { setErr("存人设失败：" + friendly(e)); } finally { setBusy(""); }
      };

      const openDiary = async () => {
        setView("diary"); setErr(""); setBusy("diary");
        try { const j = await call("/diary?days=60"); setDiary(j); setDiaryDate((j.days && j.days[0] && j.days[0].date) || ""); setPage(0); await loadPersona(); }
        catch (e) { setErr("读取日记失败：" + e.message); } finally { setBusy(""); }
      };

      // 让 DSH 自己的 agent 写这篇（不需要外部文本模型）
      const autoWrite = async (id) => {
        setBusy("j" + id); setErr("");
        try {
          const j = await call("/journal/auto", { id });
          if (!j.delivered) throw new Error(j.reason || "投递失败");
          for (let k = 0; k < 20; k += 1) {
            await new Promise((r) => setTimeout(r, 5000));
            const d = await call("/diary?days=60");
            setDiary(d);
            const hit = (d.days || []).flatMap((x) => x.entries).find((e) => e.id === id);
            if (hit && hit.journal) break;
          }
        } catch (e) { setErr("写作失败：" + friendly(e)); } finally { setBusy(""); }
      };

      const uploadRef = (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          setBusy("ref"); setErr("");
          try { await call("/refs", { op: "upload", dataUrl: reader.result, note: file.name }); await load(); }
          catch (e) { setErr("添加参考图失败：" + e.message); } finally { setBusy(""); }
        };
        reader.readAsDataURL(file);
      };

      const refOp = async (op, file, note) => {
        setBusy("ref" + file); setErr("");
        try { await call("/refs", { op, file, note }); await load(); }
        catch (e) { setErr("操作失败：" + e.message); } finally { setBusy(""); }
      };

      const queueOp = async (action, id) => {
        setBusy("q" + id); setErr(""); setOut("");
        try {
          const j = await call("/queue", { action, id });
          setOut(JSON.stringify(j, null, 2).slice(0, 2000));
          await load();
        } catch (e) { setErr("操作失败：" + e.message); } finally { setBusy(""); }
      };

      const publish = async (id, dry) => {
        setBusy("p" + id); setErr(""); setOut("");
        try {
          const j = await call("/publish", { id, dry });
          setOut(JSON.stringify(j, null, 2).slice(0, 3000));
        } catch (e) { setErr("发布失败：" + e.message); } finally { setBusy(""); }
      };

      if (!st || !cfg) {
        return h("div", { className: "dk" },
          h("h3", { className: "dk-title" }, "旅行肥鱼", h("span", { className: "dk-ver" }, "v" + PLUGIN_VERSION)),
          err ? h("div", { className: "dk-err" }, err) : h("div", { className: "dk-hint" }, "读取中…"));
      }

      // ── 旅游日记：一天多篇，每篇一条视频，可翻页，带标题 ──
      if (view === "diary") {
        const days = diary?.days || [];
        const dayIdx = Math.max(0, days.findIndex((d) => d.date === diaryDate));
        const day = days[dayIdx] || { date: "", weekday: "", entries: [] };
        const entries = day.entries || [];
        const pageNo = Math.min(Math.max(0, page), Math.max(0, entries.length - 1));
        const cur = entries[pageNo];
        const split = (md) => {
          const raw = String(md || "");
          const m = /^#\s+(.+)$/m.exec(raw);
          const title = m ? m[1].trim() : "";
          const body = m ? raw.replace(m[0], "").trim() : raw;
          return { title, body, paras: body.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean) };
        };
        const curMd = split(cur && cur.journal);
        const go = (d, pg) => { setDiaryDate(d); setPage(pg); };
        return h("div", { className: "dk" },
          h("div", { className: "dk-head" },
            h("h3", { className: "dk-title" }, "旅游日记"),
            h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
              h("select", {
                className: "dk-select", style: { minWidth: "150px" }, value: day.date || "",
                onChange: (e) => go(e.target.value, 0),
              }, days.length === 0
                ? h("option", { value: "" }, "（还没有）")
                : days.map((d) => h("option", { key: d.date, value: d.date },
                    d.date + " 周" + d.weekday + " · " + d.entries.length + " 篇"))),
              h("button", { className: "dk-close", onClick: () => setShowJD((v) => !v) }, "设置"),
              h("button", { className: "dk-close", onClick: () => setView("daka") }, "← 返回"))),
          showJD ? h("div", { className: "dk-rows", style: { marginTop: "8px" } },
            h("div", { className: "dk-row" },
              h("div", null,
                h("div", { className: "dk-label" }, "写日记时记得几天"),
                h("div", { className: "dk-hint" }, "她写新的一篇时，会带上这几天去过的地方（避免重复、能顺口提一句）")),
              h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
                h("input", {
                  className: "dk-input", type: "number", min: 0, max: 30,
                  style: { width: "70px", minWidth: "70px" },
                  value: cfg.journal?.contextDays ?? 3,
                  onChange: (e) => set(["journal", "contextDays"], Number(e.target.value)),
                }), h("span", { className: "dk-hint" }, "天"),
                h("button", { className: "dk-btn", disabled: !!busy, onClick: save }, "保存"))),
            h("div", { className: "dk-row", style: { alignItems: "flex-start" } },
              h("div", { style: { flex: 1 } },
                h("div", { className: "dk-label" }, "人设"),
                h("div", { className: "dk-hint" },
                  personaInfo
                    ? (personaInfo.source === "parent"
                        ? "正在用父插件那份（" + personaInfo.from + "）——不用再写一遍"
                        : personaInfo.source === "own"
                          ? "正在用旅行肥鱼自己这份（" + personaInfo.from + "）"
                          : "还没有人设：下面写一份，她的日记才会有「她」的口吻")
                    : "读不到人设"),
                h("textarea", {
                  className: "dk-input dk-persona", rows: 8,
                  placeholder: "只装旅行肥鱼的人在这里写人设。装了 dsh-bili-whale 的话会自动共用它的 persona.md，这里留空即可。",
                  value: persona,
                  onChange: (e) => setPersona(e.target.value),
                }),
                h("div", { style: { marginTop: "8px", display: "flex", gap: "8px" } },
                  h("button", { className: "dk-btn", disabled: !!busy, onClick: savePersona }, busy === "persona" ? "保存中…" : "保存人设"),
                  h("button", { className: "dk-btn dk-btn2", disabled: !!busy, onClick: loadPersona }, "重新读取"))))) : null,
          h("div", { className: "dk-diary" },
            h("div", { className: "dk-diary-title" }, "旅 途 记 事"),
            h("div", { className: "dk-diary-sub" },
              busy === "diary" ? "翻开中…"
                : (day.date
                  ? day.date + " · 星期" + day.weekday + " · 第 " + (entries.length ? pageNo + 1 : 0) + " / " + entries.length + " 篇"
                  : "还没有旅行记录")),
            err ? h("div", { className: "dk-err" }, err) : null,
            !cur
              ? h("div", { className: "dk-diary-empty" }, "这一天没有出发。", h("br"), "换个日期看看。")
              : h("div", { className: "dk-essay" },
                  cur.out ? h("img", { src: fileUrl("album", cur.out), alt: cur.id }) : null,
                  h("div", { className: "dk-essay-head" },
                    h("span", { className: "dk-essay-title" }, curMd.title || (cur.card && cur.card.why) || "无题"),
                    h("span", { className: "dk-essay-meta" }, cur.t || "")),
                  curMd.paras.length
                    ? curMd.paras.map((s, k) => h("p", { key: k }, s))
                    : h("div", { className: "dk-pending" },
                        "（这一篇还没写）",
                        h("button", {
                          className: "dk-close", style: { marginLeft: "10px", height: "24px", padding: "0 9px", fontSize: "11.5px" },
                          disabled: !!busy, onClick: () => autoWrite(cur.id),
                        }, busy === "j" + cur.id ? "写中…" : "让 DSH 写")),
                  h("div", { className: "dk-essay-foot" },
                    h("a", { href: "https://www.bilibili.com/video/" + cur.bv + "/", target: "_blank", rel: "noreferrer" }, cur.bv),
                    cur.score != null ? " · 评分 " + cur.score : "",
                    cur.size ? " · " + cur.size : "")),
            entries.length > 1
              ? h("div", { className: "dk-pager" },
                  h("button", { className: "dk-close", disabled: pageNo <= 0, onClick: () => setPage(pageNo - 1) }, "← 上一篇"),
                  h("span", { className: "dk-pager-n" }, (pageNo + 1) + " / " + entries.length),
                  h("button", { className: "dk-close", disabled: pageNo >= entries.length - 1, onClick: () => setPage(pageNo + 1) }, "下一篇 →"))
              : null),
          h("div", { className: "dk-hint", style: { marginTop: "10px" } },
            "每篇由她自己写（第一人称、按人设、500 字起）。没写的点「让 DSH 写」，或 " ,
            h("code", null, "feiyu.mjs journal write --id <相册ID>"),
            "。"));
      }
      const F = cfg.api || {};
      const rules = st.rules || {};
      const dests = ["album", "dynamic", "comment", "dm", "dm-image", "desktop"];
      const destLabel = { album: "本地相册", dynamic: "图文动态", comment: "评论区 @", dm: "私信（纯文字）", "dm-image": "私信（带图）", desktop: "桌面通知" };
      const dest = Array.isArray(cfg.publish?.dest) ? cfg.publish.dest : ["album"];

      return h("div", { className: "dk" },
        h("div", { className: "dk-head" },
          h("h3", { className: "dk-title" }, "旅行肥鱼", h("span", { className: "dk-ver" }, "v" + PLUGIN_VERSION)),
          h("button", { className: "dk-close", onClick: openDiary }, "旅游日记 →")),
        h("p", { className: "dk-intro" },
          "旅行肥鱼：她看完视频，挑一个自己站得进去的地方，把角色参考图和那一帧一起送进生图模型。",
          "只读本机已有的视频帧，不连 B 站；发布才调用父插件。"),

        // ── 状态 ──
        h("div", { className: "dk-group" }, "状态"),
        h("div", { className: "dk-rows" },
          h("div", { className: "dk-row" },
            h("div", null,
              h("div", { className: "dk-label" }, "父插件与守则"),
              h("div", { className: "dk-hint" }, "守则写进 AGENTS.md，父插件的 agent 每次会话都会读到；只对 bili-whale 会话生效")),
            h("div", null,
              h(Badge, { ok: rules.attached }, rules.attached ? "守则已接入 " + (rules.version || "") : "守则未接入"),
              h("button", { className: "dk-btn", style: { marginLeft: "8px" }, disabled: !!busy, onClick: () => attach("attach") }, busy === "rules" ? "写入中…" : "接入父插件"),
              h("button", { className: "dk-btn dk-btn2", style: { marginLeft: "8px" }, disabled: !!busy, onClick: () => attach("detach") }, "卸载守则"))),
          h("div", { className: "dk-row" },
            h("div", null,
              h("div", { className: "dk-label" }, "今日"),
              h("div", { className: "dk-hint" }, "每天最多去几个地方，由代码强制")),
            h("div", null,
              h(Badge, { ok: st.today.remaining > 0 }, `已出发 ${st.today.used}/${cfg.daily} · 剩余 ${st.today.remaining}`)))),

        // ── 赛博旅游 ──
        h("div", { className: "dk-group" }, "赛博旅游"),
        h("div", { className: "dk-hint", style: { marginTop: "2px" } },
          "丢一个视频地址给她：她自己下载、看懂、挑一个能站进去的地方；判断不值得就直说，不会凑数。"),
        h("div", { className: "dk-row" },
          h("div", null,
            h("div", { className: "dk-label" }, "视频地址"),
            h("div", { className: "dk-hint" }, "支持 https://www.bilibili.com/video/BV… 或直接贴 BV 号；b23.tv 短链要先在浏览器里展开")),
          h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
            h("input", {
              className: "dk-input dk-wide", style: { minWidth: "320px" },
              placeholder: "https://www.bilibili.com/video/BV1xxxxxxxxx",
              value: pilgrimUrl, onChange: (e) => setPilgrimUrl(e.target.value),
            }),
            h("button", { className: "dk-btn", disabled: !!busy || !pilgrimUrl.trim(), onClick: submitPilgrim },
              busy === "pilgrim" ? "提交中…" : "交给她去看"))),
        pilgrimMsg ? h("div", { className: "dk-hint", style: { marginTop: "6px" } }, pilgrimMsg) : null,
        (st.pilgrim || []).length
          ? h("div", { className: "dk-rows", style: { marginTop: "4px" } },
              st.pilgrim.map((p) => h("div", { className: "dk-row", key: p.id },
                h("div", null,
                  h("div", { className: "dk-label" },
                    p.bv,
                    h(Badge, { ok: p.status === "sent" }, p.status === "sent" ? "已投递" : "排队中")),
                  h("div", { className: "dk-hint" }, String(p.at).slice(5, 16).replace("T", " "), " · ", p.note || "")))))
          : null,

        // ── 开关与配额 ──
        h("div", { className: "dk-group" }, "开关与配额"),
        h("div", { className: "dk-rows" },
          h("div", { className: "dk-row" },
            h("div", null, h("div", { className: "dk-label" }, "启用旅行肥鱼")),
            h("input", { type: "checkbox", checked: cfg.enabled !== false, onChange: (e) => set(["enabled"], e.target.checked) })),
          h("div", { className: "dk-row" },
            h("div", null,
              h("div", { className: "dk-label" }, "生成模式"),
              h("div", { className: "dk-hint" }, "人工审图 = 先入队，你点生成才花钱；自动 = 直接出图")),
            h("select", { className: "dk-select", value: cfg.mode, onChange: (e) => set(["mode"], e.target.value) },
              h("option", { value: "manual" }, "人工审图"),
              h("option", { value: "auto" }, "自动生图"))),
          h("div", { className: "dk-row" },
            h("div", null, h("div", { className: "dk-label" }, "每天最多")),
            h("input", { className: "dk-input", type: "number", min: 0, max: 10, style: { width: "80px", minWidth: "80px" }, value: cfg.daily, onChange: (e) => set(["daily"], Number(e.target.value)) })),
          h("div", { className: "dk-row" },
            h("div", null, h("div", { className: "dk-label" }, "同一视频最多")),
            h("input", { className: "dk-input", type: "number", min: 1, max: 5, style: { width: "80px", minWidth: "80px" }, value: cfg.perVideo, onChange: (e) => set(["perVideo"], Number(e.target.value)) })) ),

        // ── API ──
        h("div", { className: "dk-group" }, "API"),
        h("div", { className: "dk-rows" },
          h("div", { className: "dk-row" },
            h("div", null,
              h("div", { className: "dk-label" }, "端点"),
              h("div", { className: "dk-hint" }, "OpenAI 兼容即可：/images/generations 与 /images/edits")),
            h("input", { className: "dk-input dk-wide", value: F.endpoint ?? "", onChange: (e) => set(["api", "endpoint"], e.target.value) })),
          h("div", { className: "dk-row" },
            h("div", null,
              h("div", { className: "dk-label" }, "模型" + (st.secret.present ? "" : "（先存密钥才能拉列表）")),
              h("div", { className: "dk-hint" }, "点「获取模型」从端点读，选完记得保存")),
            h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
              models.length
                ? h("select", { className: "dk-select", value: F.model ?? "", onChange: (e) => set(["api", "model"], e.target.value) },
                    models.map((m) => h("option", { key: m, value: m }, m)))
                : h("input", { className: "dk-input", style: { minWidth: "200px" }, value: F.model ?? "", onChange: (e) => set(["api", "model"], e.target.value) }),
              h("button", { className: "dk-btn dk-btn2", disabled: !!busy, onClick: fetchModels }, busy === "models" ? "读取中…" : "获取模型"))),
          h("div", { className: "dk-row" },
            h("div", null,
              h("div", { className: "dk-label" }, "密钥"),
              h("div", { className: "dk-hint" }, st.secret.present ? "已保存 ✓ 永不回显；重填会覆盖" : "还没填")),
            h("div", { style: { display: "flex", gap: "8px" } },
              h("input", { className: "dk-input dk-wide", type: "password", autoComplete: "off", placeholder: "sk-…", value: key, onChange: (e) => setKey(e.target.value) }),
              h("button", { className: "dk-btn", disabled: !!busy || key.length < 8, onClick: saveKey }, busy === "key" ? "保存中…" : "保存密钥"))),
          h("div", { className: "dk-row" },
            h("div", null,
              h("div", { className: "dk-label" }, "输出尺寸"),
              h("div", { className: "dk-hint" }, "跟随截图 = 按视频帧的宽高比选最接近的档位")),
            h("select", { className: "dk-select", value: F.size ?? "follow", onChange: (e) => set(["api", "size"], e.target.value) },
              h("option", { value: "follow" }, "跟随截图"),
              h("option", { value: "1536x1024" }, "1536×1024（横）"),
              h("option", { value: "1024x1024" }, "1024×1024（方）"),
              h("option", { value: "1024x1536" }, "1024×1536（竖）")))),

        // ── 参考图 ──
        h("div", { className: "dk-group" }, "参考图（图 + 注释）"),
        h("div", { className: "dk-hint" }, "顺序就是发给模型的顺序：第一张通常是角色本体。注释会拼进提示词，也用于报错时定位是哪张被拒。"),
        h("div", { className: "dk-row" },
          h("div", null,
            h("div", { className: "dk-label" }, "人物外观（写进每条提示词）"),
            h("div", { className: "dk-hint" }, "留空则用参考图的注释拼。写死发色/瞳色/服装/配饰/尾巴，一致性会明显变好")),
          h("input", {
            className: "dk-input dk-wide", style: { minWidth: "360px" },
            value: cfg.character?.note ?? "",
            placeholder: "例如：蓝发蓝瞳，深蓝女仆长裙配白色围裙，女仆头饰，鲸鱼尾巴",
            onChange: (e) => set(["character", "note"], e.target.value),
          })),
        h("div", { className: "dk-grid" },
          (st.refs || []).map((r) => h("div", { className: "dk-card", key: r.file },
            h("img", { src: fileUrl("refs", r.file), alt: r.note || r.file }),
            h("div", { className: "dk-cap" },
              h("div", null, r.note || r.file, h(Badge, { ok: r.enabled !== false }, r.enabled !== false ? "启用" : "停用")),
              h("div", { style: { display: "flex", gap: "4px", marginTop: "6px", flexWrap: "wrap" } },
                h("button", { className: "dk-btn dk-btn2", style: { height: "24px", padding: "0 6px", fontSize: "11px" }, onClick: () => {
                  const next = prompt("注释（这张图是什么）", r.note || "");
                  if (next !== null) refOp("note", r.file, next);
                } }, "改注释"),
                h("button", { className: "dk-btn dk-btn2", style: { height: "24px", padding: "0 6px", fontSize: "11px" }, onClick: () => refOp("toggle", r.file) }, r.enabled !== false ? "停用" : "启用"),
                h("button", { className: "dk-btn dk-btn2", style: { height: "24px", padding: "0 6px", fontSize: "11px" }, onClick: () => refOp("remove", r.file) }, "删"))))),
          h("label", { className: "dk-card", style: { alignItems: "center", justifyContent: "center", minHeight: "128px", cursor: "pointer" } },
            h("div", { className: "dk-cap", style: { textAlign: "center" } }, busy === "ref" ? "上传中…" : "+ 添加图片"),
            h("input", { type: "file", accept: "image/*", style: { display: "none" }, onChange: (e) => uploadRef(e.target.files && e.target.files[0]) }))),

        // ── 发布 ──
        h("div", { className: "dk-group" }, "发布"),
        h("div", { className: "dk-rows" },
          h("div", { className: "dk-row" },
            h("div", null,
              h("div", { className: "dk-label" }, "发到哪里（可多选）"),
              h("div", { className: "dk-hint" }, "只有「图文动态」能把图本身发出去；评论区/私信/桌面只能带文字")),
            h("div", null, dests.map((d) => h("label", { className: "dk-chk", key: d },
              h("input", { type: "checkbox", checked: dest.includes(d), onChange: (e) => {
                const next = e.target.checked ? [...dest, d] : dest.filter((x) => x !== d);
                set(["publish", "dest"], next.length ? next : ["album"]);
              } }), destLabel[d])))),
          h("div", { className: "dk-row" },
            h("div", null,
              h("div", { className: "dk-label" }, "发布时机"),
              h("div", { className: "dk-hint" }, "人工 = 出图后进相册，等你点发布；自动 = 生成后立刻按上面发")),
            h("select", { className: "dk-select", value: cfg.publish?.mode ?? "manual", onChange: (e) => set(["publish", "mode"], e.target.value) },
              h("option", { value: "manual" }, "人工确认"),
              h("option", { value: "auto-if-good" }, "达标才自动发"),
              h("option", { value: "auto" }, "生成后直接发"))),
          h("div", { className: "dk-row" },
            h("div", null,
              h("div", { className: "dk-label" }, "正文模板"),
              h("div", { className: "dk-hint" }, "可用占位：{line} {bv} {time}")),
            h("input", { className: "dk-input dk-wide", value: cfg.publish?.textTemplate ?? "", onChange: (e) => set(["publish", "textTemplate"], e.target.value) }))),

        // ── 待出发 ──
        h("div", { className: "dk-group" }, "待出发" + ((st.queue || []).length ? `（${st.queue.length}）` : "")),
        (st.queue || []).length === 0
          ? h("div", { className: "dk-hint", style: { padding: "6px 0" } }, "（队列是空的）")
          : h("div", null, st.queue.map((q) => h("div", { className: "dk-row", key: q.id },
              h("div", null,
                h("div", { className: "dk-label" }, `${q.bv} · ${q.t}`, h(Badge, null, q.id)),
                h("div", { className: "dk-hint" }, String(q.card?.why ?? "").slice(0, 100)),
                q.prompt ? h("div", { className: "dk-hint", style: { marginTop: "4px" } }, String(q.prompt).slice(0, 220)) : null,
                q.frame ? h("div", { className: "dk-thumbs" }, h("img", { src: fileUrl("frames", q.frame), alt: "frame" })) : null),
              h("div", { style: { display: "flex", gap: "6px" } },
                h("button", { className: "dk-btn", disabled: !!busy, onClick: () => queueOp("render", q.id) }, busy === "q" + q.id ? "生成中…" : "生成"),
                h("button", { className: "dk-btn dk-btn2", disabled: !!busy, onClick: () => queueOp("drop", q.id) }, "跳过"))))),

        // ── 清理（原片最占地方）──
        h("div", { className: "dk-group" }, "清理"),
        h("div", { className: "dk-hint", style: { marginTop: "2px" } },
          "原片一晚能占几百 MB。「自动」= 每次出图后顺手清；「清除」= 现在按勾选立刻删。旅行图默认不自动删（那是作品）。"),
        h("div", { className: "dk-rows" },
          [["videos", "原片（mp4）", "最占地方；删了下次要看会重新下"],
           ["albums", "旅行图（png）", "删了相册和旅游日记里也会消失"],
           ["tmp", "选景缩略图", "随时能重建，放心删"]].map(([k, label, hint]) =>
            h("div", { className: "dk-row", key: k },
              h("div", null,
                h("div", { className: "dk-label" }, label),
                h("div", { className: "dk-hint" }, hint)),
              h("div", { style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
                h("label", { className: "dk-chk" },
                  h("input", {
                    type: "checkbox", checked: cfg.clean?.[k]?.auto === true,
                    onChange: (e) => set(["clean", k, "auto"], e.target.checked),
                  }), "自动"),
                h("span", { className: "dk-hint" }, "保留"),
                h("input", {
                  className: "dk-input", type: "number", min: 0, max: 365,
                  style: { width: "64px", minWidth: "64px" },
                  value: cfg.clean?.[k]?.days ?? 0,
                  onChange: (e) => set(["clean", k, "days"], Number(e.target.value)),
                }),
                h("span", { className: "dk-hint" }, "天"),
                h("label", { className: "dk-chk", style: { marginLeft: "6px" } },
                  h("input", {
                    type: "checkbox", checked: !!cleanSel[k],
                    onChange: (e) => setCleanSel((s) => ({ ...s, [k]: e.target.checked })),
                  }), "清除"),
                h("button", {
                  className: "dk-btn dk-btn2", style: { height: "26px", padding: "0 8px", fontSize: "11.5px" },
                  disabled: !!busy, onClick: () => openPath(k),
                }, "打开文件夹")))),
          h("div", { className: "dk-row" },
            h("div", null,
              h("div", { className: "dk-label" }, "天数 0 = 该类的自动清理永不触发"),
              h("div", { className: "dk-hint" }, "改完记得点下面的「保存设置」；「一键清除」按勾选的类别立即执行")),
            h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
              h("button", { className: "dk-btn dk-btn2", disabled: !!busy, onClick: () => runClean(true) }, "预演"),
              h("button", { className: "dk-btn", disabled: !!busy, onClick: () => runClean(false) }, busy === "clean" ? "清除中…" : "一键清除")))),
        cleanMsg ? h("div", { className: "dk-hint", style: { marginTop: "6px" } }, cleanMsg) : null,

        // ── 相册 ──
        h("div", { className: "dk-group" }, "相册"),
        (st.album || []).length === 0
          ? h("div", { className: "dk-hint", style: { padding: "6px 0" } }, "（还没有旅行图）")
          : h("div", { className: "dk-grid" }, st.album.map((a) => h("div", { className: "dk-card", key: a.id },
              h("img", { src: fileUrl("album", a.out), alt: a.id }),
              h("div", { className: "dk-cap" },
                h("div", null, `${a.bv || "-"} · ${a.t || "-"}`),
                h("div", { className: "dk-hint" }, a.ok ? `${a.sizeActual || a.sizeRequested || ""}` : "失败：" + String(a.error || "").slice(0, 40)),
                h("div", { style: { display: "flex", gap: "4px", marginTop: "6px", flexWrap: "wrap" } },
                  h("button", { className: "dk-btn dk-btn2", style: { height: "24px", padding: "0 6px", fontSize: "11px" }, disabled: !!busy || !a.ok, onClick: () => publish(a.id, true) }, "预演发布"),
                  h("button", { className: "dk-btn", style: { height: "24px", padding: "0 6px", fontSize: "11px" }, disabled: !!busy || !a.ok, onClick: () => publish(a.id, false) }, busy === "p" + a.id ? "发布中…" : "发布")))))),

        // ── 底栏 ──
        h("div", { className: "dk-actions" },
          h("button", { className: "dk-btn", disabled: !!busy, onClick: save }, busy === "save" ? "保存中…" : "保存设置"),
          h("button", { className: "dk-btn dk-btn2", disabled: !!busy, onClick: selftest }, busy === "test" ? "体检中…" : "体检"),
          h("button", { className: "dk-btn dk-btn2", disabled: !!busy, onClick: load }, "重新读取"),
          dirty ? h("span", { style: { marginLeft: "10px", color: "#ffb020", fontSize: "12.5px" } }, "● 有改动还没保存") : null),

        msg ? h("div", { className: "dk-hint" }, msg) : null,
        err ? h("div", { className: "dk-err" }, err) : null,
        out ? h("div", { className: "dk-out" }, out) : null,
        h("div", { className: "dk-hint" }, "数据在 " + st.paths.root + "：配置 / 密钥（不回显）/ 参考图 / 相册 / 队列，全是普通文件。"));
    }

    function apply(ctx) {
      ctx.effect(
        () => ctx.slots.inject("settings.section", () =>
          ctx.slots.register({ name: "settings.section", id: "bili-lvxingfeiyu", order: 7, label: () => "旅行肥鱼" }, DakaSection),
          "dsh-bili-lvxingfeiyu: settings section"),
        "dsh-bili-lvxingfeiyu: settings section",
      );
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    exports.DakaSection = DakaSection;
    return module.exports;
  },
});
