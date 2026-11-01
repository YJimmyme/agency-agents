# 數位員工介接平台

線上版：https://yjimmyme.github.io/agency-agents/

一個純靜態網頁：列出 **agency-agents**（283 位專家角色）與 **UniEmployee**（8 位企業數位員工）的所有員工，每位都標示**職務**和**負責工作**，可以搜尋、依部門或來源篩選。點選員工就能直接問問題，回答會用該員工的角色設定（system prompt），透過 Claude API 產生。

## 使用方式

### 方式一：GitHub Pages（推薦）

1. 把這個 PR 合併到 `main`。
2. 到 repo 的 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
3. 等 Actions 裡的「Deploy employee portal」跑完，網址會是 `https://<你的帳號>.github.io/agency-agents/`。

### 方式二：在自己電腦上跑

```bash
cd portal
python3 -m http.server 8000
# 打開 http://localhost:8000
```

（直接雙擊 `index.html` 不行，因為瀏覽器不允許 `file://` 頁面讀取資料檔。）

### 設定 API Key

第一次問問題前，按右上角 **⚙️ 設定**，貼上 Anthropic API Key（到 [Anthropic Console](https://console.anthropic.com/settings/keys) 申請）並選模型。

- Key 只存在你自己瀏覽器的 localStorage，由瀏覽器直接呼叫 `api.anthropic.com`，不經過任何其他伺服器，也不會被 commit 進 repo。
- 沒有 Key 也可以用：在員工對話視窗按 **複製角色設定**，貼到 claude.ai 的新對話裡，再接著問問題。
- 對話紀錄存在瀏覽器裡（每位員工最近 40 則），按「清除對話」可刪除。

## 檔案結構

| 路徑 | 用途 |
|------|------|
| `index.html`、`style.css`、`app.js` | 網頁本體，不需要建置工具 |
| `data/catalog.json` | 員工清單（職務、負責工作、部門、來源），由腳本產生 |
| `data/prompts/<部門>.json` | 每位員工的完整角色設定，開啟對話時才載入 |
| `i18n/zh-TW.tsv` | agency-agents 每個角色的繁中職務與負責工作，**可以直接改** |
| `scripts/build_data.py` | 重新產生 `data/` |
| `vendor/` | Markdown 顯示用的 marked 與 DOMPurify |

## 新增或修改員工後重新產生資料

```bash
# 需要 UniEmployee 的本機 clone（預設在 ../uniemployee），以及 PyYAML
pip install pyyaml
git clone https://github.com/YJimmyme/UniEmployee ../uniemployee   # 第一次才需要
python3 portal/scripts/build_data.py --uniemployee ../uniemployee
```

- 新增 agency-agents 角色：照原本方式在部門資料夾加 `.md`，再到 `i18n/zh-TW.tsv` 加一行 `檔名<TAB>職務<TAB>負責工作`。沒填的話會先顯示英文名稱與描述，腳本也會列出缺漏。
- UniEmployee 員工的繁中職務寫在 `scripts/build_data.py` 的 `UNI_ZH`。它們原本依賴內部知識庫、SQL、CRM 等工具，在這裡只能純對話，所以腳本會把技能規程（SKILL.md）全文附進角色設定，並提醒模型不要假裝查過資料。
- 所有角色都會附加「請用繁體中文回答」的指示。
