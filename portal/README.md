# 數位員工介接平台

線上版：https://yjimmyme.github.io/agency-agents/

一個純靜態網頁：列出 **agency-agents**（283 位專家角色）與 **UniEmployee**（8 位企業數位員工）的所有員工，每位都標示**職務**和**負責工作**，可以搜尋、依部門或來源篩選。點選員工就能直接問問題，回答會用該員工的角色設定（system prompt），透過 Claude API 或你**自己架設的模型**產生。

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

## 使用自架模型（不用雲端服務）

入口可以改接你自己架的模型，任何提供 **OpenAI 相容 API**（`/v1/chat/completions`）的服務都可以：Ollama、LM Studio、vLLM、llama.cpp server、LocalAI、公司內部的模型閘道等。問題只會送到你指定的伺服器。

### 最簡單的方式：用 `serve_local.py` 一起啟動（推薦）

這支小程式只用 Python 內建模組，會同時提供網頁，並把網頁的提問轉送給模型服務，所以**不用設定 CORS**，網頁打開就自動切到自架模式。

```bash
# 1. 準備模型（以 Ollama 為例，https://ollama.com 下載安裝）
ollama pull qwen3:8b

# 2. 在 repo 根目錄啟動入口
python3 portal/scripts/serve_local.py --model qwen3:8b

# 3. 打開 http://localhost:8000
```

其他服務只要換 `--upstream`：

| 服務 | 啟動參數 |
|------|----------|
| Ollama（預設） | `--upstream http://localhost:11434/v1` |
| LM Studio | 在 LM Studio 開啟 Local Server，`--upstream http://localhost:1234/v1` |
| vLLM | `vllm serve <模型>`，`--upstream http://localhost:8000/v1 --port 8080`（避開 vLLM 的 8000 埠） |
| llama.cpp | `llama-server -m model.gguf -c 16384`，`--upstream http://localhost:8080/v1 --port 8000` |
| 別台電腦或公司閘道 | `--upstream http://<主機>:<埠>/v1`，需要金鑰時設環境變數 `LLM_API_KEY=...` |

- 想讓同事從區網使用：加 `--host 0.0.0.0`，同事用你電腦的 IP 開啟，例如 `http://192.168.1.20:8000`。
- `LLM_API_KEY` 只留在伺服器端，不會送到瀏覽器。
- 模型名稱不填的話，網頁會自動使用服務上的第一個模型；也可以到 **⚙️ 設定 → 讀取清單** 選。

### 直接連模型服務（例如從 GitHub Pages 開啟）

到 **⚙️ 設定**，把「回答的模型來源」改成 **自架模型**，填服務網址（例如 `http://localhost:11434/v1`）和模型名稱。這時是瀏覽器直接呼叫模型服務，所以服務必須允許來自網頁網址的跨網域請求（CORS）：

- **Ollama**：設定環境變數 `OLLAMA_ORIGINS=https://yjimmyme.github.io` 後重新啟動 Ollama（macOS：`launchctl setenv OLLAMA_ORIGINS "https://yjimmyme.github.io"`；Windows：在系統環境變數新增後重開 Ollama）。
- **LM Studio**：Local Server 頁面打開 **Enable CORS**。
- **vLLM**：啟動時加 `--allowed-origins '["https://yjimmyme.github.io"]'`。
- **llama.cpp server**：預設就允許跨網域。

注意：從 https 網頁連 `http://localhost` 在 Chrome、Edge、Firefox 可以，但 Safari 會擋；連區網其他電腦的 http 位址，瀏覽器通常也會擋。遇到這些情況請改用上面的 `serve_local.py`。

### 上下文長度一定要夠

角色設定本身就不短（大多數約 3,000～4,000 tokens，最長的接近 9,000，再加上對話紀錄），對話視窗下方會顯示「下一題約送出多少 tokens」。模型服務的上下文長度要大於這個數字，否則角色設定會被截掉，模型就不會照角色回答。

- **Ollama** 預設上下文通常只有 4,096。啟動前設 `OLLAMA_CONTEXT_LENGTH=16384`（或更大），或建立自訂模型：在 Modelfile 寫 `FROM qwen3:8b` 和 `PARAMETER num_ctx 32768`，再 `ollama create qwen3-32k -f Modelfile`。
- **LM Studio**：載入模型時把 Context Length 調大。
- **vLLM**：`--max-model-len 32768`。
- **llama.cpp**：`-c 32768`。

模型建議至少 7B～8B 等級且中文能力好的，例如 Qwen3、Gemma 3、Llama 3.x 中文微調版；太小的模型容易忽略角色設定。會「先思考再回答」的模型（Qwen3、DeepSeek-R1 等），思考內容會被自動隱藏，只顯示最後的回答。

## 檔案結構

| 路徑 | 用途 |
|------|------|
| `index.html`、`style.css`、`app.js` | 網頁本體，不需要建置工具 |
| `data/catalog.json` | 員工清單（職務、負責工作、部門、來源），由腳本產生 |
| `data/prompts/<部門>.json` | 每位員工的完整角色設定，開啟對話時才載入 |
| `i18n/zh-TW.tsv` | agency-agents 每個角色的繁中職務與負責工作，**可以直接改** |
| `scripts/build_data.py` | 重新產生 `data/` |
| `scripts/serve_local.py` | 自架模型用：提供網頁並轉送提問給模型服務 |
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
