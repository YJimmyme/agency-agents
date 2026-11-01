#!/usr/bin/env python3
"""Build the employee catalog for the portal.

Reads every agent in this repo (agency-agents) plus the digital employees in a
local clone of UniEmployee, and writes:

  portal/data/catalog.json            list of employees (no prompts, small)
  portal/data/prompts/<group>.json    {employee_id: system_prompt}, loaded on demand

Usage:
  python3 portal/scripts/build_data.py [--uniemployee ../uniemployee]

The UniEmployee clone is optional; without it only agency-agents employees are
built. Reading UniEmployee needs PyYAML (pip install pyyaml).
"""
import argparse
import json
import re
import sys
from pathlib import Path

PORTAL = Path(__file__).resolve().parent.parent
REPO = PORTAL.parent
DATA = PORTAL / "data"

DIVISION_ZH = {
    "academic": "學術研究",
    "design": "設計",
    "engineering": "工程開發",
    "finance": "財務",
    "game-development": "遊戲開發",
    "gis": "地理資訊（GIS）",
    "healthcare": "醫療健康",
    "marketing": "行銷",
    "paid-media": "付費廣告",
    "product": "產品",
    "project-management": "專案管理",
    "research": "研究",
    "sales": "業務銷售",
    "security": "資訊安全",
    "spatial-computing": "空間運算",
    "specialized": "專業顧問",
    "support": "營運支援",
    "testing": "測試品保",
}

# Traditional Chinese title and duties for the UniEmployee seed employees.
UNI_ZH = {
    "biz-analyzer": ("小經", "經營分析與決策顧問", "盤點整體經營狀況與核心 KPI，針對營收下滑、成本上升做歸因，並提出附量化測算與風險的決策建議"),
    "hrbp": ("HR 小智", "綜合人力專員", "解答入職、考勤、薪酬福利、休假、績效、離職等人事制度問題，協助登記人事工單"),
    "insurance-analyst": ("小保析", "保險經營分析師", "分析保費收入、賠付率、續保率、通路貢獻與產品結構，找出機構經營異常並提出管理建議"),
    "market-intel": ("小察", "產業深度研究員", "研究具身智慧、AI 前沿、政策與智慧硬體產業鏈，產出有證據鏈的產業研究、每日市場快報與競品分析"),
    "net-ops": ("小網", "算網營運專家", "做網路故障影響分析、營運指標分析、資源容量分析，並依 SOP 執行維運流程"),
    "unicom-presale": ("小聯", "電信售前客服", "解答電信資費與業務諮詢、依預算與用量推薦方案、說明辦理流程"),
    "xiaoshu": ("小數", "資料分析專家", "用 SQL 取數、驗證資料、做指標歸因分析，並產出資料分析報告"),
    "xiaoxiao": ("小小", "客戶經理（解決方案顧問）", "負責政企客戶簽約前的拜訪與解決方案，以及簽約後的客戶 360 畫像、續約掃描與客訴處理"),
}

LANG_SUFFIX = (
    "\n\n---\n"
    "【回覆語言】請一律使用繁體中文（台灣用語）回答，專有名詞可保留英文。"
)

UNI_SUFFIX = (
    "\n\n---\n"
    "【執行環境說明】你目前在一個純對話的介接平台中運作，沒有任何工具可以呼叫"
    "（例如 kb_search、run_python、SQL、CRM、read_file、聯網搜尋都無法使用），"
    "也讀不到公司內部的知識庫或資料檔。上方技能規程已直接附上全文供你參考。"
    "需要資料時，請向使用者說明需要哪些資料、請對方提供，"
    "或明確標示哪些內容是一般性建議、需要再查證；不要假裝已經查過資料，也不要編造數字。"
)


def parse_frontmatter(text):
    if not text.startswith("---"):
        return None, text
    end = text.find("\n---", 3)
    if end == -1:
        return None, text
    fm_text = text[3:end]
    body = text[end + 4 :].lstrip("\n")
    fm = {}
    lines = fm_text.splitlines()
    i = 0
    while i < len(lines):
        m = re.match(r"^([A-Za-z_]+):\s*(.*)$", lines[i])
        if m:
            key, val = m.group(1), m.group(2).strip()
            # folded / literal scalars
            if val in (">", "|", ">-", "|-"):
                parts = []
                i += 1
                while i < len(lines) and (lines[i].startswith(" ") or not lines[i].strip()):
                    parts.append(lines[i].strip())
                    i += 1
                fm[key] = " ".join(p for p in parts if p)
                continue
            if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
                val = val[1:-1]
            fm[key] = val
        i += 1
    return fm, body


def core_missions(body):
    """Return the ### headings under the 'Core Mission' section (English)."""
    m = re.search(r"^##\s.*Core Mission.*$", body, re.M)
    if not m:
        return []
    rest = body[m.end() :]
    nxt = re.search(r"^##\s", rest, re.M)
    section = rest[: nxt.start()] if nxt else rest
    heads = re.findall(r"^###\s+(.+?)\s*$", section, re.M)
    return [h.strip("* ") for h in heads][:8]


def load_zh_tsv():
    table = {}
    path = PORTAL / "i18n" / "zh-TW.tsv"
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        slug, title, duties = line.split("\t")
        table[slug] = (title, duties)
    return table


def build_agency(zh):
    divisions = json.loads((REPO / "divisions.json").read_text(encoding="utf-8"))["divisions"]
    employees, prompts, missing = [], {}, []
    for div, meta in divisions.items():
        prompts[div] = {}
        for f in sorted((REPO / div).rglob("*.md")):
            fm, body = parse_frontmatter(f.read_text(encoding="utf-8"))
            if not fm or "name" not in fm:
                continue
            slug = f.stem
            title, duties = zh.get(slug, (None, None))
            if title is None:
                missing.append(slug)
            eid = f"agency/{slug}"
            employees.append({
                "id": eid,
                "source": "agency-agents",
                "group": div,
                "division": div,
                "divisionLabel": DIVISION_ZH.get(div, meta["label"]),
                "color": meta.get("color", "#64748B"),
                "emoji": fm.get("emoji", "🤖"),
                "name": fm["name"],
                "title": title or fm["name"],
                "duties": duties or fm.get("description", ""),
                "description": fm.get("description", ""),
                "vibe": fm.get("vibe", ""),
                "missions": core_missions(body),
                "skills": [],
                "path": str(f.relative_to(REPO)),
            })
            prompts[div][eid] = body.strip() + LANG_SUFFIX
    return employees, prompts, missing


def build_uniemployee(root):
    import yaml  # only needed for UniEmployee

    backend = root / "backend"
    employees, prompts = [], {}
    for f in sorted((backend / "employees").glob("*.yaml")):
        d = yaml.safe_load(f.read_text(encoding="utf-8"))
        eid = d["id"]
        nick, title, duties = UNI_ZH.get(eid, (d.get("name"), d.get("role"), ""))
        skills = d.get("skills") or []
        skill_docs = []
        skill_meta = []
        for s in skills:
            p = backend / "skills" / s / "SKILL.md"
            if p.exists():
                fm, sbody = parse_frontmatter(p.read_text(encoding="utf-8"))
                skill_meta.append({"name": s, "description": (fm or {}).get("description", "")})
                skill_docs.append(f"## 技能規程：{s}\n\n{sbody.strip()}")
        prompt = d["persona"].strip()
        if skill_docs:
            prompt += "\n\n---\n# 附錄：技能規程全文\n\n" + "\n\n".join(skill_docs)
        prompt += UNI_SUFFIX + LANG_SUFFIX
        full_id = f"uniemployee/{eid}"
        employees.append({
            "id": full_id,
            "source": "UniEmployee",
            "group": "uniemployee",
            "division": "uniemployee",
            "divisionLabel": "企業數位員工",
            "color": "#E11D48",
            "emoji": "🧑‍💼",
            "name": d.get("name") if d.get("name") == d.get("role") else f"{d.get('name')}（{d.get('role', '')}）",
            "title": f"{nick}・{title}",
            "duties": duties,
            "description": d.get("role", ""),
            "vibe": "",
            "missions": [],
            "skills": skill_meta,
            "path": str(f.relative_to(root)),
        })
        prompts[full_id] = prompt
    return employees, {"uniemployee": prompts}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uniemployee", default=str(REPO.parent / "uniemployee"),
                    help="path to a local clone of UniEmployee (default: ../uniemployee)")
    args = ap.parse_args()

    zh = load_zh_tsv()
    employees, prompts, missing = build_agency(zh)

    uni_root = Path(args.uniemployee)
    if (uni_root / "backend" / "employees").is_dir():
        u_emp, u_prompts = build_uniemployee(uni_root)
        employees = u_emp + employees
        prompts.update(u_prompts)
    else:
        print(f"! UniEmployee not found at {uni_root}; skipping", file=sys.stderr)

    (DATA / "prompts").mkdir(parents=True, exist_ok=True)
    for old in (DATA / "prompts").glob("*.json"):
        old.unlink()
    for group, items in prompts.items():
        (DATA / "prompts" / f"{group}.json").write_text(
            json.dumps(items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (DATA / "catalog.json").write_text(
        json.dumps(employees, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"built {len(employees)} employees into {DATA.relative_to(REPO)}")
    if missing:
        print(f"! {len(missing)} without a zh-TW title in i18n/zh-TW.tsv: {', '.join(missing)}",
              file=sys.stderr)


if __name__ == "__main__":
    main()
