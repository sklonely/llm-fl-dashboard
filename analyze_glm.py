import json, os, glob
from collections import defaultdict

BASE = "/Users/zhanzheyu/llm-fl-dashboard/remote-data"
RESULTS = os.path.join(BASE, "results/glm-4.7-flash-latest")

with open(os.path.join(BASE, "ground_truths.json")) as f:
    gt = json.load(f)
with open(os.path.join(BASE, "bug_classification.json")) as f:
    classifications = {b["instance_id"]: b for b in json.load(f)}


def norm(p):
    return p.lstrip("./").lstrip("/")


def eval_stage1(preds, gt_files):
    gt_norm = [norm(f) for f in gt_files]
    hits = []
    for p in preds:
        hits.append(1 if norm(str(p)) in gt_norm else 0)
    hit1 = hits[0] if hits else 0
    any_hit1 = hit1
    any_hit3 = 1 if any(hits[:3]) else 0
    any_hit5 = 1 if any(hits[:5]) else 0
    mrr = 0
    for i, h in enumerate(hits):
        if h:
            mrr = 1.0 / (i + 1)
            break
    return {
        "hit@1": hit1,
        "any_hit@3": any_hit3,
        "any_hit@5": any_hit5,
        "mrr": mrr,
        "parse": 1,
    }


def eval_stage2(preds, gt_lines_dict):
    all_gt = set()
    for lines in gt_lines_dict.values():
        all_gt.update(lines)
    if not all_gt:
        return {"hit@1": 0, "any_hit@3": 0, "any_hit@5": 0, "mrr": 0, "parse": 1}
    hits = []
    for p in preds:
        hits.append(1 if int(p) in all_gt else 0)
    hit1 = hits[0] if hits else 0
    any_hit3 = 1 if any(hits[:3]) else 0
    any_hit5 = 1 if any(hits[:5]) else 0
    mrr = 0
    for i, h in enumerate(hits):
        if h:
            mrr = 1.0 / (i + 1)
            break
    recall1 = min(1, sum(hits[:1])) if all_gt else 0
    recall5 = len(set(preds[:5]) & all_gt) / len(all_gt) if all_gt else 0
    return {
        "hit@1": hit1,
        "any_hit@3": any_hit3,
        "any_hit@5": any_hit5,
        "mrr": mrr,
        "recall@5": round(recall5, 3),
        "parse": 1,
    }


conditions = [
    "stage1_L1",
    "stage1_L2",
    "stage1_L3",
    "stage2_L1",
    "stage2_L2",
    "stage2_L3",
]
agg = defaultdict(lambda: defaultdict(list))
bug_results = defaultdict(dict)
timing = defaultdict(list)
parse_fails = defaultdict(int)

for cond in conditions:
    stage, level = cond.split("_")
    cond_dir = os.path.join(RESULTS, cond)
    for fpath in sorted(glob.glob(os.path.join(cond_dir, "*.json"))):
        with open(fpath) as f:
            r = json.load(f)
        iid = r["instance_id"]
        preds = r["predictions"]
        ps = r.get("parse_success", True)
        dur = r.get("total_duration_ms", 0)
        timing[cond].append(dur / 1000)

        if not ps:
            parse_fails[cond] += 1
            metrics = {"hit@1": 0, "any_hit@3": 0, "any_hit@5": 0, "mrr": 0, "parse": 0}
        elif stage == "stage1":
            metrics = eval_stage1(preds, gt[iid]["files"])
        else:
            metrics = eval_stage2(preds, gt[iid]["lines"])

        for k, v in metrics.items():
            agg[cond][k].append(v)
        bug_results[iid][cond] = metrics

print("=" * 80)
print("GLM-4.7-Flash 完整分析 (300 results)")
print("=" * 80)

print("\n### 各條件平均指標")
print(
    f"{'Condition':<14} {'Hit@1':>7} {'Hit@3':>7} {'Hit@5':>7} {'MRR':>7} {'Parse%':>7} {'Avg(s)':>7}"
)
print("-" * 63)
for cond in conditions:
    d = agg[cond]
    n = len(d["hit@1"])
    h1 = sum(d["hit@1"]) / n
    h3 = sum(d["any_hit@3"]) / n
    h5 = sum(d["any_hit@5"]) / n
    mrr = sum(d["mrr"]) / n
    ps = sum(d["parse"]) / n * 100
    avg_t = sum(timing[cond]) / len(timing[cond])
    print(
        f"{cond:<14} {h1:>7.3f} {h3:>7.3f} {h5:>7.3f} {mrr:>7.3f} {ps:>6.1f}% {avg_t:>7.1f}"
    )

print("\n### Stage1 vs Stage2 整體")
for stage_name in ["stage1", "stage2"]:
    vals = {"hit@1": [], "mrr": []}
    for cond in conditions:
        if cond.startswith(stage_name):
            vals["hit@1"].extend(agg[cond]["hit@1"])
            vals["mrr"].extend(agg[cond]["mrr"])
    n = len(vals["hit@1"])
    print(
        f"  {stage_name}: Hit@1={sum(vals['hit@1']) / n:.3f}, MRR={sum(vals['mrr']) / n:.3f} (n={n})"
    )

print("\n### Context Level 影響 (L1→L2→L3)")
for stage_name in ["stage1", "stage2"]:
    print(f"  {stage_name}:")
    for level in ["L1", "L2", "L3"]:
        cond = f"{stage_name}_{level}"
        d = agg[cond]
        n = len(d["hit@1"])
        print(
            f"    {level}: Hit@1={sum(d['hit@1']) / n:.3f}, MRR={sum(d['mrr']) / n:.3f}"
        )

print("\n### Bug Type 分析")
bug_types = defaultdict(lambda: defaultdict(list))
for iid, conds in bug_results.items():
    cls = classifications.get(iid, {})
    bt = cls.get("bug_type", "UNKNOWN")
    for cond, m in conds.items():
        bug_types[bt][cond].append(m)

for bt in sorted(bug_types.keys()):
    print(f"\n  {bt}:")
    for cond in conditions:
        if cond in bug_types[bt]:
            vals = bug_types[bt][cond]
            n = len(vals)
            h1 = sum(v["hit@1"] for v in vals) / n
            mrr = sum(v["mrr"] for v in vals) / n
            print(f"    {cond:<14} Hit@1={h1:.3f} MRR={mrr:.3f} (n={n})")

print("\n### Complexity 分析")
complexities = defaultdict(lambda: defaultdict(list))
for iid, conds in bug_results.items():
    cls = classifications.get(iid, {})
    cx = cls.get("complexity", "?")
    for cond, m in conds.items():
        complexities[cx][cond].append(m)

for cx in ["S", "M", "C"]:
    label = {"S": "Simple", "M": "Medium", "C": "Complex"}[cx]
    print(f"\n  {label} (n={len(complexities[cx].get(conditions[0], []))}):")
    for cond in conditions:
        if cond in complexities[cx]:
            vals = complexities[cx][cond]
            n = len(vals)
            h1 = sum(v["hit@1"] for v in vals) / n
            mrr = sum(v["mrr"] for v in vals) / n
            print(f"    {cond:<14} Hit@1={h1:.3f} MRR={mrr:.3f}")

print("\n### 最難的 Bug (stage1 全部 miss)")
hard_bugs = []
for iid in sorted(bug_results.keys()):
    s1_hits = sum(
        bug_results[iid].get(f"stage1_{l}", {}).get("hit@1", 0)
        for l in ["L1", "L2", "L3"]
    )
    if s1_hits == 0:
        cls = classifications.get(iid, {})
        hard_bugs.append((iid, cls.get("bug_type", "?"), cls.get("complexity", "?")))

print(f"  共 {len(hard_bugs)} 個 bug 在 Stage1 全部未命中:")
for iid, bt, cx in hard_bugs:
    print(f"    {iid} ({bt}, {cx})")

print("\n### 最容易的 Bug (stage1 全部 hit@1)")
easy_bugs = []
for iid in sorted(bug_results.keys()):
    s1_hits = sum(
        bug_results[iid].get(f"stage1_{l}", {}).get("hit@1", 0)
        for l in ["L1", "L2", "L3"]
    )
    if s1_hits == 3:
        cls = classifications.get(iid, {})
        easy_bugs.append((iid, cls.get("bug_type", "?"), cls.get("complexity", "?")))

print(f"  共 {len(easy_bugs)} 個 bug 在 Stage1 三個 level 都命中:")
for iid, bt, cx in easy_bugs:
    print(f"    {iid} ({bt}, {cx})")

print("\n### Parse 失敗統計")
total_fails = sum(parse_fails.values())
if total_fails == 0:
    print("  全部 300 個結果解析成功!")
else:
    for cond in conditions:
        if parse_fails[cond]:
            print(f"  {cond}: {parse_fails[cond]} failures")

print("\n### 回應時間分佈")
for cond in conditions:
    ts = timing[cond]
    ts.sort()
    median = ts[len(ts) // 2]
    p90 = ts[int(len(ts) * 0.9)]
    print(
        f"  {cond:<14} median={median:.1f}s  p90={p90:.1f}s  max={max(ts):.1f}s  total={sum(ts) / 60:.1f}min"
    )
