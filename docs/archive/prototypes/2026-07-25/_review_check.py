import os, re, glob

base = r"C:\Users\杨楠\Documents\vscode-svn\docs\SVN工作台原型-07-25"
gao = os.path.join(base, "高保真原型")

files = sorted(glob.glob(os.path.join(gao, "*.html")))
files.append(os.path.join(base, "原型总览.html"))

def find_root_ranges(html):
    ranges = []
    idx = 0
    while True:
        i = html.find(":root", idx)
        if i == -1: break
        j = html.find("{", i)
        if j == -1: break
        depth = 0; k = j
        while k < len(html):
            if html[k] == "{": depth += 1
            elif html[k] == "}":
                depth -= 1
                if depth == 0: break
            k += 1
        ranges.append((j, k))
        idx = k + 1
    return ranges

def in_any_range(pos, ranges):
    return any(a <= pos <= b for a, b in ranges)

report = []
for f in files:
    with open(f, encoding="utf-8") as fh:
        html = fh.read()
    name = os.path.basename(f)

    sym_ids = set(re.findall(r'<symbol\b[^>]*?\bid="([^"]+)"', html))
    use_refs = re.findall(r'<use\b[^>]*?\b(?:xlink:href|href)="#([^"]+)"', html)
    missing = sorted(set(u for u in use_refs if u not in sym_ids))

    # icon modifier class defs vs usages
    css_mods = set(re.findall(r'\.icon--([a-zA-Z]+)', html))
    html_mods = set(re.findall(r'class="[^"]*?\bicon--([a-zA-Z]+)', html))
    orphan_defs = sorted(css_mods - html_mods)
    missing_defs = sorted(html_mods - css_mods)

    # red lines
    ic_res = len(re.findall(r'ic--', html))
    iconon = len(re.findall(r'iconon', html))
    icon_btn_wrong = len(re.findall(r'icon--btn', html))
    prefers = len(re.findall(r'prefers-color-scheme', html))
    innerhtml_assign = len(re.findall(r'\.innerHTML\s*=', html))
    # actual innerHTML assignment counts (non comment) - rough: count lines with `.innerHTML =`
    inner_assign_lines = [l.strip() for l in html.splitlines() if re.search(r'\.innerHTML\s*=', l)]

    # external links
    ext_links = re.findall(r'(?:src|href)="(https?:[^"]+)"', html)
    link_tags = re.findall(r'<link\b', html)
    script_src = re.findall(r'<script[^>]*\bsrc=', html)
    ext = ext_links + (["<link>"]*len(link_tags)) + (["<script src>"]*len(script_src))

    # bare hex outside :root
    ranges = find_root_ranges(html)
    hex_matches = list(re.finditer(r'#([0-9a-fA-F]{3,8})\b', html))
    bare_hex = []
    for m in hex_matches:
        if not in_any_range(m.start(), ranges):
            # capture surrounding context
            s = max(0, m.start()-30); e = min(len(html), m.end()+10)
            bare_hex.append(html[s:e].replace("\n", " "))
    # inside :root but is it the OFFLINE fallback (with hex) or token block (no hex)?
    # Heuristic: count hexes inside root ranges vs total; token :root has 0 hex, offline has many.
    hex_in_root = sum(1 for m in hex_matches if in_any_range(m.start(), ranges))
    root_blocks_hex = []
    for (a,b) in ranges:
        block = html[a:b]
        cnt = len(re.findall(r'#[0-9a-fA-F]{3,8}\b', block))
        root_blocks_hex.append(cnt)

    # success color unification
    success_fg = len(re.findall(r'--color-success-fg', html))
    success_other = len(re.findall(r'--color-success(?!-fg)', html))  # matches --color-success but not -fg
    # also any hard success hex like #89d185 used outside root
    # gate cards
    has_svn = "gate-card--svn" in html
    has_ai = "gate-card--ai" in html
    svn_count = html.count('gate-card--svn')
    ai_count = html.count('gate-card--ai')

    report.append({
        "name": name,
        "missing_symbols": missing,
        "use_count": len(use_refs),
        "sym_count": len(sym_ids),
        "orphan_icon_defs": orphan_defs,
        "missing_icon_defs": missing_defs,
        "ic_res": ic_res,
        "iconon": iconon,
        "icon_btn_wrong": icon_btn_wrong,
        "prefers": prefers,
        "innerhtml_assign": innerhtml_assign,
        "inner_assign_lines": inner_assign_lines,
        "ext": ext,
        "bare_hex": bare_hex,
        "hex_in_root": hex_in_root,
        "root_blocks_hex": root_blocks_hex,
        "success_fg": success_fg,
        "success_other": success_other,
        "has_svn": has_svn,
        "has_ai": has_ai,
        "svn_count": svn_count,
        "ai_count": ai_count,
    })

for r in report:
    print("="*70)
    print("FILE:", r["name"])
    print("  use_refs:", r["use_count"], " symbol_defs:", r["sym_count"])
    if r["missing_symbols"]:
        print("  [BROKEN IMG] missing symbols:", r["missing_symbols"])
    else:
        print("  [OK] use ⊆ defs (no broken images)")
    if r["orphan_icon_defs"]:
        print("  [ORPHAN CSS] icon modifier defs unused in HTML:", r["orphan_icon_defs"])
    if r["missing_icon_defs"]:
        print("  [MISSING CSS] icon modifier used in HTML but undefined:", r["missing_icon_defs"])
    if r["ic_res"]: print("  [WARN ic-- residue]:", r["ic_res"])
    if r["iconon"]: print("  [WARN iconon residue]:", r["iconon"])
    if r["icon_btn_wrong"]: print("  [WARN icon--btn wrong class]:", r["icon_btn_wrong"])
    if r["prefers"]: print("  [RED prefers-color-scheme]:", r["prefers"])
    if r["innerhtml_assign"]:
        print("  [RED .innerHTML = assignment]:", r["innerhtml_assign"], r["inner_assign_lines"])
    else:
        print("  [OK] no .innerHTML = assignment")
    if r["ext"]:
        print("  [RED external resource]:", r["ext"])
    else:
        print("  [OK] self-contained (no external links/scripts)")
    if r["bare_hex"]:
        print("  [RED bare hex OUTSIDE :root]:")
        for h in r["bare_hex"]:
            print("     ...", h, "...")
    else:
        print("  [OK] no bare hex outside :root (hex_in_root=%d, root_blocks_hex=%s)" % (r["hex_in_root"], r["root_blocks_hex"]))
    if r["success_other"]:
        print("  [WARN success color not -fg]:", r["success_other"])
    print("  success-fg refs:", r["success_fg"], " other success:", r["success_other"])
    print("  gate-card--svn:", r["svn_count"], " gate-card--ai:", r["ai_count"])
