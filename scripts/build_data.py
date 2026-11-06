"""把 content/ 裡的內容檔合併成網站讀取的 data/site.json。

用法：python scripts/build_data.py
部署時 GitHub Actions 會自動執行，平常不用手動跑。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
OUTPUT = ROOT / "data" / "site.json"
EXCERPT_LENGTH = 90

# 部門的顯示順序與英文名稱。新增部門時，這裡和 admin/config.yml 都要加。
DEPARTMENTS = {
    "指導老師": "Supervisor",
    "正副會長": "President & Vice President",
    "執行長": "Chief Executive Officer",
    "顧問": "Consultant",
    "秘書處": "Secretary Department",
    "企劃部": "Planning Department",
    "廣宣部": "Advertising Department",
    "公關部": "PR Department",
    "財務部": "Finance Department",
    "器材部": "Equipment Department",
}


def load_entries(folder):
    entries = []
    for path in sorted((CONTENT / folder).glob("*.json")):
        try:
            entry = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            # 一個壞掉的檔案不該讓整個網站發布失敗。
            print(f"略過 {path.name}：{error}", file=sys.stderr)
            continue
        entry["id"] = path.stem
        entries.append(entry)
    return entries


def asset_path(value):
    """後台存的是 /assets/...，改成相對路徑，網站放在子路徑時才找得到。"""
    value = str(value or "").strip()
    return value[1:] if value.startswith("/assets/") else value


def body_paths(body):
    text = re.sub(r"(\]\(|src=\")/assets/", r"\1assets/", str(body or ""))
    # 編輯器可能留下沒有文字的小標題，顯示出來會是一段空白。
    return re.sub(r"^#{1,6}[ \t]*$\n?", "", text, flags=re.MULTILINE)


def photo_groups(photos):
    """照片組：幾張照片搭一段說明。"""
    groups = []
    for group in photos or []:
        images = [asset_path(image) for image in group.get("images") or []]
        if images:
            groups.append({"images": images, "caption": str(group.get("caption") or "").strip()})
    return groups


def excerpt_from(body):
    for block in re.split(r"\n\s*\n", str(body or "")):
        text = block.strip()
        if not text or text.startswith("#"):
            continue
        text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
        text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
        text = re.sub(r"[*_`>]", "", text)
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            return text[:EXCERPT_LENGTH] + ("…" if len(text) > EXCERPT_LENGTH else "")
    return ""


def build_news():
    news = []
    for entry in load_entries("news"):
        visibility = entry.get("visibility") or ("draft" if entry.get("published") is False else "public")
        if visibility == "draft":
            continue
        if not entry.get("title") or not entry.get("date"):
            print(f"略過新聞 {entry['id']}：缺少標題或日期", file=sys.stderr)
            continue
        body = body_paths(entry.get("body"))
        news.append({
            "id": entry["id"],
            "date": entry["date"],
            "title": entry["title"],
            "author": entry.get("author", ""),
            "excerpt": entry.get("excerpt") or excerpt_from(body),
            "body": body,
            "cover": asset_path(entry.get("cover")),
            "photos": photo_groups(entry.get("photos")),
            "sourceUrl": entry.get("sourceUrl", ""),
            "unlisted": visibility == "unlisted",
        })
    return sorted(news, key=lambda item: item["date"], reverse=True)


def build_events():
    events = []
    for entry in load_entries("events"):
        if not entry.get("title") or not entry.get("date"):
            print(f"略過活動 {entry['id']}：缺少名稱或日期", file=sys.stderr)
            continue
        events.append({
            "title": entry["title"],
            "date": entry["date"],
            "endDate": entry.get("endDate", ""),
            "place": entry.get("place", ""),
            "link": entry.get("link", ""),
        })
    return events


def build_members():
    departments = list(DEPARTMENTS)
    members = []
    for entry in load_entries("members"):
        if not entry.get("name") or not entry.get("term"):
            print(f"略過幹部 {entry['id']}：缺少姓名或屆數", file=sys.stderr)
            continue
        dept = entry.get("dept", "")
        members.append({
            "id": entry["id"],
            "term": int(entry["term"]),
            "dept": dept,
            "deptEn": DEPARTMENTS.get(dept, ""),
            "name": entry["name"],
            "title": entry.get("title", ""),
            "order": entry.get("order", 1),
            "history": [line.strip() for line in str(entry.get("history", "")).splitlines() if line.strip()],
            "photo": asset_path(entry.get("photo")),
        })
    members.sort(key=lambda m: (
        -m["term"],
        departments.index(m["dept"]) if m["dept"] in departments else len(departments),
        m["order"],
    ))
    return members


def build_documents():
    categories = ["組織章程", "財務部", "器材部", "其他"]
    documents = []
    for entry in load_entries("documents"):
        if not entry.get("title") or not entry.get("file"):
            print(f"略過文件 {entry['id']}：缺少名稱或檔案", file=sys.stderr)
            continue
        documents.append({
            "category": entry.get("category", "其他"),
            "name": entry["title"],
            "url": asset_path(entry["file"]),
            "order": entry.get("order", 1),
        })
    documents.sort(key=lambda d: (
        categories.index(d["category"]) if d["category"] in categories else len(categories),
        d["order"],
        d["name"],
    ))
    return documents


def main():
    site = {
        "news": build_news(),
        "events": build_events(),
        "members": build_members(),
        "documents": build_documents(),
    }
    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_text(json.dumps(site, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    counts = "、".join(f"{key} {len(value)} 筆" for key, value in site.items())
    print(f"已產生 {OUTPUT.relative_to(ROOT)}：{counts}")


if __name__ == "__main__":
    main()
