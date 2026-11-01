/* 數位員工介接平台 — static app, no build step.
 * Data: data/catalog.json (list) + data/prompts/<group>.json (system prompts, loaded on demand).
 * Chat: browser calls the Anthropic Messages API directly with the user's own key.
 */
(() => {
  "use strict";

  const API_URL = "https://api.anthropic.com/v1/messages";
  const MAX_TOKENS = 8192;
  const LS = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  };

  const $ = (id) => document.getElementById(id);
  const state = {
    all: [],
    division: "",
    source: "",
    query: "",
    current: null,
    promptCache: {},
    histories: {},
    busy: false,
    abort: null,
    sample: null,   // claude.ai artifact runtime: answers on the viewer's own Claude account
  };

  // ---------- catalog ----------
  async function loadCatalog() {
    const res = await fetch("data/catalog.json");
    if (!res.ok) throw new Error(`讀取員工清單失敗（HTTP ${res.status}）`);
    state.all = await res.json();
    $("count").textContent = state.all.length;
    buildChips();
    applyHash();
    render();
  }

  function divisions() {
    const map = new Map();
    for (const e of state.all) {
      if (state.source && e.source !== state.source) continue;
      const d = map.get(e.division) || { key: e.division, label: e.divisionLabel, color: e.color, n: 0 };
      d.n++;
      map.set(e.division, d);
    }
    return [...map.values()];
  }

  function buildChips() {
    const chips = $("chips");
    chips.textContent = "";
    const total = state.all.filter((e) => !state.source || e.source === state.source).length;
    const mk = (key, label, n, color) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(state.division === key));
      if (color) {
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = color;
        b.append(dot);
      }
      b.append(label + " ");
      const c = document.createElement("span");
      c.className = "n";
      c.textContent = n;
      b.append(c);
      b.onclick = () => { state.division = key; buildChips(); render(); };
      chips.append(b);
    };
    mk("", "全部部門", total, null);
    const divs = divisions();
    if (state.division && !divs.some((d) => d.key === state.division)) state.division = "";
    for (const d of divs) mk(d.key, d.label, d.n, d.color);
  }

  function haystack(e) {
    return [e.title, e.duties, e.name, e.description, e.vibe, e.divisionLabel,
      ...(e.missions || []), ...(e.skills || []).map((s) => s.name + " " + s.description)]
      .join(" ").toLowerCase();
  }

  function filtered() {
    const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    return state.all.filter((e) => {
      if (state.source && e.source !== state.source) return false;
      if (state.division && e.division !== state.division) return false;
      if (!terms.length) return true;
      e._h = e._h || haystack(e);
      return terms.every((t) => e._h.includes(t));
    });
  }

  function render() {
    const grid = $("grid");
    const list = filtered();
    $("resultCount").textContent = `顯示 ${list.length} 位`;
    grid.textContent = "";
    if (!list.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "找不到符合的員工，換個關鍵字試試看。";
      grid.append(p);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const e of list) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card";
      card.style.setProperty("--c", e.color);
      card.innerHTML = `
        <div class="head"><span class="emoji"></span>
          <div><div class="title"></div><div class="en"></div></div></div>
        <div class="duties"></div>
        <div class="tag"></div>`;
      card.querySelector(".emoji").textContent = e.emoji;
      card.querySelector(".title").textContent = e.title;
      card.querySelector(".en").textContent = e.name;
      card.querySelector(".duties").textContent = e.duties;
      card.querySelector(".tag").textContent = `${e.divisionLabel}・${e.source}`;
      card.onclick = () => openEmployee(e);
      frag.append(card);
    }
    grid.append(frag);
  }

  // ---------- drawer ----------
  function openEmployee(e) {
    state.current = e;
    if (location.hash !== "#" + encodeURIComponent(e.id)) {
      history.replaceState(null, "", "#" + encodeURIComponent(e.id));
    }
    $("dEmoji").textContent = e.emoji;
    $("dTitle").textContent = e.title;
    $("dName").textContent = `${e.name}・${e.divisionLabel}`;
    const info = $("dInfoBody");
    info.textContent = "";
    const add = (tag, text, cls) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      el.textContent = text;
      info.append(el);
      return el;
    };
    add("p", "負責工作：" + e.duties);
    if (e.description && e.description !== e.duties) add("p", e.description, "muted small");
    if (e.missions && e.missions.length) {
      add("p", "核心任務（原文）：", "small");
      const ul = document.createElement("ul");
      for (const m of e.missions) { const li = document.createElement("li"); li.textContent = m; ul.append(li); }
      info.append(ul);
    }
    if (e.skills && e.skills.length) {
      add("p", "技能：", "small");
      const ul = document.createElement("ul");
      for (const s of e.skills) { const li = document.createElement("li"); li.textContent = `${s.name}：${s.description}`; ul.append(li); }
      info.append(ul);
    }
    add("p", "來源檔案：" + e.source + " / " + e.path, "muted small");

    renderMessages();
    $("drawer").classList.add("open");
    $("drawer").setAttribute("aria-hidden", "false");
    $("scrim").hidden = false;
    setTimeout(() => $("question").focus(), 50);
  }

  function closeDrawer() {
    if (state.abort) state.abort.abort();
    $("drawer").classList.remove("open");
    $("drawer").setAttribute("aria-hidden", "true");
    $("scrim").hidden = true;
    state.current = null;
    history.replaceState(null, "", location.pathname + location.search);
  }

  function applyHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    const e = state.all.find((x) => x.id === id);
    if (e) openEmployee(e);
  }

  function history_(id) {
    if (!state.histories[id]) {
      let saved = [];
      try { saved = JSON.parse(LS.get("chat:" + id, "[]")) || []; } catch { saved = []; }
      state.histories[id] = saved;
    }
    return state.histories[id];
  }
  function saveHistory(id) {
    LS.set("chat:" + id, JSON.stringify(state.histories[id].slice(-40)));
  }

  function mdToHtml(text) {
    if (window.marked && window.DOMPurify) {
      return DOMPurify.sanitize(marked.parse(text, { breaks: true, gfm: true }));
    }
    const div = document.createElement("div");
    div.textContent = text;
    return `<p style="white-space:pre-wrap">${div.innerHTML}</p>`;
  }

  function msgEl(role, text) {
    const el = document.createElement("div");
    el.className = "msg " + role;
    if (role === "assistant") el.innerHTML = mdToHtml(text);
    else el.textContent = text;
    return el;
  }

  function renderMessages() {
    const box = $("messages");
    box.textContent = "";
    const e = state.current;
    const h = history_(e.id);
    if (!h.length) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = canChat()
        ? `直接問「${e.title}」問題吧。它會用自己的角色設定回答你。`
        : "還沒設定 API Key：請按右上角「⚙️ 設定」貼上 Anthropic API Key。也可以先按「複製角色設定」，貼到 claude.ai 的對話裡使用。";
      box.append(p);
    }
    for (const m of h) box.append(msgEl(m.role, m.content));
    box.scrollTop = box.scrollHeight;
    renderNextCost();
  }

  async function getPrompt(e) {
    if (!state.promptCache[e.group]) {
      const res = await fetch(`data/prompts/${encodeURIComponent(e.group)}.json`);
      if (!res.ok) throw new Error(`讀取角色設定失敗（HTTP ${res.status}）`);
      state.promptCache[e.group] = await res.json();
    }
    const p = state.promptCache[e.group][e.id];
    if (!p) throw new Error("找不到這位員工的角色設定");
    return p;
  }


  // ---------- usage meter (estimate) ----------
  // The page cannot read the real subscription quota, so it keeps its own
  // estimate of what it has sent and received, per day and per month, in this browser.
  function estTokens(str) {
    let ascii = 0, other = 0;
    for (const ch of str) { if (ch.charCodeAt(0) < 128) ascii++; else other++; }
    return Math.round(ascii / 4 + other * 1.1);
  }
  const dayKey = () => new Date().toLocaleDateString("sv-SE");          // YYYY-MM-DD, local time
  const monthKey = () => dayKey().slice(0, 7);
  function readUsage(key) {
    try { return JSON.parse(LS.get(key, "")) || { q: 0, inTok: 0, outTok: 0 }; } catch { return { q: 0, inTok: 0, outTok: 0 }; }
  }
  function recordUsage(inTok, outTok) {
    for (const key of ["usage:" + dayKey(), "usage:" + monthKey()]) {
      const u = readUsage(key);
      u.q += 1; u.inTok += inTok; u.outTok += outTok;
      LS.set(key, JSON.stringify(u));
    }
    renderUsage();
  }
  const fmtTok = (n) => n >= 10000 ? (n / 10000).toFixed(1) + " 萬" : n.toLocaleString("zh-TW");
  function renderUsage() {
    const d = readUsage("usage:" + dayKey());
    const m = readUsage("usage:" + monthKey());
    $("usageToday").textContent = `今天 ${d.q} 題・約 ${fmtTok(d.inTok + d.outTok)} tokens`;
    $("usageMonth").textContent = `本月 ${m.q} 題・約 ${fmtTok(m.inTok + m.outTok)} tokens`;
  }
  async function renderNextCost() {
    const e = state.current;
    const el = $("nextCost");
    if (!e) return;
    try {
      const sys = await getPrompt(e);
      if (state.current !== e) return;
      const hist = history_(e.id).reduce((n, m) => n + estTokens(m.content), 0);
      const n = estTokens(sys) + hist;
      el.textContent = `下一題約送出 ${fmtTok(n)} tokens（角色設定 ${fmtTok(estTokens(sys))} ＋ 對話紀錄 ${fmtTok(hist)}）`;
    } catch { el.textContent = ""; }
  }

  // ---------- chat ----------
  const hasKey = () => !!LS.get("anthropic_api_key");
  const canChat = () => !!state.sample || hasKey();

  async function send(question) {
    const e = state.current;
    if (!e || state.busy) return;
    if (!canChat()) { openSettings(); return; }
    const h = history_(e.id);
    h.push({ role: "user", content: question });
    saveHistory(e.id);
    renderMessages();

    const box = $("messages");
    const out = msgEl("assistant", "…");
    box.append(out);
    box.scrollTop = box.scrollHeight;
    setBusy(true);

    let text = "";
    try {
      const system = await getPrompt(e);
      state.abort = new AbortController();
      if (state.sample) {
        const sent = estTokens(system) + h.reduce((n, m) => n + estTokens(m.content), 0);
        text = await askViaClaudeAi(system, h, out, box);
        h.push({ role: "assistant", content: text });
        saveHistory(e.id);
        recordUsage(sent, estTokens(text));
        return;
      }
      const res = await fetch(API_URL, {
        method: "POST",
        signal: state.abort.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": LS.get("anthropic_api_key"),
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: LS.get("anthropic_model", "claude-sonnet-5-5"),
          max_tokens: MAX_TOKENS,
          stream: true,
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          messages: h.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) {
        let detail = "";
        try { const j = await res.json(); detail = j.error?.message || ""; } catch { /* not json */ }
        throw new Error(apiErrorText(res.status, detail));
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let stop = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let ev;
          try { ev = JSON.parse(line.slice(5)); } catch { continue; }
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
            text += ev.delta.text;
            out.innerHTML = mdToHtml(text);
            box.scrollTop = box.scrollHeight;
          } else if (ev.type === "message_delta" && ev.delta?.stop_reason) {
            stop = ev.delta.stop_reason;
          } else if (ev.type === "error") {
            throw new Error(ev.error?.message || "串流中斷");
          }
        }
      }
      if (stop === "max_tokens") text += "\n\n_（回答太長被截斷，可以請它「繼續」）_";
      if (stop === "refusal") text += "\n\n_（模型拒絕回答這個問題）_";
      if (!text) text = "_（沒有收到回覆內容）_";
      out.innerHTML = mdToHtml(text);
      recordUsage(estTokens(system) + h.reduce((n, m) => n + estTokens(m.content), 0), estTokens(text));
      h.push({ role: "assistant", content: text });
      saveHistory(e.id);
    } catch (err) {
      out.remove();
      if (text) { h.push({ role: "assistant", content: text + "\n\n_（回覆中斷）_" }); }
      else { h.pop(); }  // drop the unanswered question so history stays alternating
      saveHistory(e.id);
      renderMessages();
      if (err.name !== "AbortError") {
        const el = document.createElement("div");
        el.className = "msg error";
        el.textContent = err.message || String(err);
        $("messages").append(el);
        if (!text) $("question").value = question;
      }
    } finally {
      state.abort = null;
      setBusy(false);
    }
  }

  // Inside claude.ai: the `sample` capability answers on the viewer's own account.
  // It has no system prompt, so the role prompt goes in a leading user turn.
  async function askViaClaudeAi(system, h, out, box) {
    const rules = "以下是你這次要扮演的角色設定。請完全以這個角色的身分、專業與工作方法回答後面的問題，"
      + "不要提到你在扮演角色。\n\n<role>\n" + system + "\n</role>";
    const turns = h.slice(-20).map((m) => ({ role: m.role, content: m.content }));
    while (turns.length && turns[0].role !== "user") turns.shift();
    try {
      const res = await state.sample([{ role: "user", content: rules }, ...turns], {
        cache: false,
        signal: state.abort.signal,
        onText: ({ text }) => { out.innerHTML = mdToHtml(text); box.scrollTop = box.scrollHeight; },
      });
      let text = res.text;
      if (res.truncated) text += "\n\n_（回答太長被截斷，可以請它「繼續」）_";
      out.innerHTML = mdToHtml(text);
      return text;
    } catch (err) {
      const map = {
        cancelled: "已停止",
        not_granted: "你沒有允許這個網頁使用 Claude。重新整理頁面後，在跳出的視窗按允許即可。",
        sampling_disabled: "這個帳號目前無法在網頁中使用 Claude。",
        rate_limited: "使用太頻繁或已達用量上限，請稍後再試。",
        session_expired: "登入已過期，請重新登入 claude.ai。",
        refused: "Claude 拒絕回答這個問題，換個問法試試看。",
        prompt_too_large: "對話太長了，請按「清除對話」後再問。",
      };
      const e = new Error(map[err?.code] || ("呼叫 Claude 失敗：" + (err?.message || err?.code || "未知錯誤")));
      if (err?.code === "cancelled") e.name = "AbortError";
      throw e;
    }
  }

  function apiErrorText(status, detail) {
    const map = {
      400: "請求格式有誤",
      401: "API Key 無效，請到「⚙️ 設定」確認",
      403: "這把 API Key 沒有權限使用此模型",
      404: "找不到模型，請到「⚙️ 設定」換一個模型",
      429: "請求太頻繁或額度用完，請稍後再試",
      529: "Anthropic 伺服器忙碌中，請稍後再試",
    };
    return `${map[status] || "呼叫 API 失敗"}（HTTP ${status}）${detail ? "：" + detail : ""}`;
  }

  function setBusy(b) {
    state.busy = b;
    $("sendBtn").disabled = false;
    $("sendBtn").textContent = b ? "停止" : "送出";
  }

  // ---------- settings ----------
  function openSettings() {
    $("apiKey").value = LS.get("anthropic_api_key", "");
    $("model").value = LS.get("anthropic_model", "claude-sonnet-5-5");
    $("settings").showModal();
  }

  // ---------- wiring ----------
  function wire() {
    let t;
    $("search").addEventListener("input", (ev) => {
      clearTimeout(t);
      t = setTimeout(() => { state.query = ev.target.value.trim(); render(); }, 120);
    });
    $("sourceFilter").addEventListener("change", (ev) => {
      state.source = ev.target.value;
      buildChips();
      render();
    });
    $("closeDrawer").onclick = closeDrawer;
    $("scrim").onclick = closeDrawer;
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && state.current && !$("settings").open) closeDrawer();
    });
    $("askForm").addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (state.busy) { state.abort?.abort(); return; }
      const q = $("question").value.trim();
      if (!q) return;
      $("question").value = "";
      send(q);
    });
    $("question").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        $("askForm").requestSubmit();
      }
    });
    $("clearChat").onclick = () => {
      if (!state.current) return;
      state.histories[state.current.id] = [];
      LS.del("chat:" + state.current.id);
      renderMessages();
    };
    $("copyPrompt").onclick = async () => {
      const btn = $("copyPrompt");
      try {
        await navigator.clipboard.writeText(await getPrompt(state.current));
        btn.textContent = "已複製 ✓";
      } catch {
        btn.textContent = "複製失敗";
      }
      setTimeout(() => { btn.textContent = "複製角色設定"; }, 1500);
    };
    $("settingsBtn").onclick = openSettings;
    $("settings").addEventListener("close", () => {
      if ($("settings").returnValue !== "ok") return;
      const key = $("apiKey").value.trim();
      if (key) LS.set("anthropic_api_key", key);
      LS.set("anthropic_model", $("model").value);
      if (state.current) renderMessages();
    });
    $("clearKey").onclick = () => {
      LS.del("anthropic_api_key");
      $("apiKey").value = "";
      if (state.current) renderMessages();
    };
    window.addEventListener("hashchange", applyHash);
  }

  wire();
  renderUsage();
  if (window.claude && typeof window.claude.use === "function") {
    window.claude.use("sample").then((fn) => {
      if (!fn) return;
      state.sample = fn;
      $("settingsBtn").hidden = true;
      if (state.current) renderMessages();
    }).catch(() => {});
  }
  loadCatalog().catch((err) => {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = err.message + "。如果你是直接雙擊打開 index.html，請改用 README 裡的方式啟動本機伺服器。";
    $("grid").append(p);
  });
})();
