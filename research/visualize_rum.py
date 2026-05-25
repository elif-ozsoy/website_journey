# Adobe Research License Terms for Adobe Materials
# 1. You may use, reproduce, and modify, the research materials provided under this license (the "Research
# Materials") solely for noncommercial purposes. Noncommercial purposes include academic research, teaching,
# and testing, but do not include commercial licensing or distribution, development of commercial products, or any
# other activity which results in commercial gain.
# 2. The Research Materials are confidential and are owned by or licensed to Adobe. You may not publicly display or
# redistribute the Research Materials without first obtaining written permission from Adobe.
# 3. You agree to (a) comply with all laws and regulations applicable to your use of the Research Materials under this
# license, including but not limited to any import or export laws; (b) preserve any copyright or other notices from
# the Research Materials; and (c) for any Research Materials in object code, not attempt to modify, reverse
# engineer, or decompile such Research Materials except as permitted by applicable law.
# 4. THE RESEARCH MATERIALS ARE PROVIDED "AS IS," WITHOUT WARRANTY OF ANY KIND, AND YOU ASSUME ALL
# RISKS ASSOCIATED WITH THEIR USE. IN NO EVENT WILL ANYONE BE LIABLE TO YOU FOR ANY ACTUAL,
# INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES ARISING OUT OF OR IN CONNECTION WITH USE OF THE
# RESEARCH MATERIALS.


"""
RUM / OpTel Click Data Visualizations
Datasets: adobe.com, blog.adobe.com, business.adobe.com | 2023, 2024, 2025

Columns: page_url, event_time, click_source (CSS selector), click_target_url, weight
weight = sampling rate (represents that many real clicks)
"""

import os
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
from matplotlib.gridspec import GridSpec
import warnings
warnings.filterwarnings("ignore")

# ── paths ──────────────────────────────────────────────────────────────────────
BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
OUT  = os.path.join(BASE, "visualizations")
os.makedirs(OUT, exist_ok=True)

SITES = {
    "adobe-com":          "adobe.com",
    "blog-adobe-com":     "blog.adobe.com",
    "business-adobe-com": "business.adobe.com",
}
YEARS = [2023, 2024, 2025]
COLORS = {2023: "#1f77b4", 2024: "#ff7f0e", 2025: "#2ca02c"}
SITE_COLORS = {
    "adobe-com":          "#e34850",
    "blog-adobe-com":     "#2680eb",
    "business-adobe-com": "#12805c",
}

# ── helpers ────────────────────────────────────────────────────────────────────
def load(site_key, year):
    path = os.path.join(DATA, f"{site_key}-{year}.parquet")
    if not os.path.exists(path):
        return None
    df = pd.read_parquet(path)
    return df

def shorten_url(url, max_len=55):
    url = str(url)
    url = url.replace("https://", "").replace("http://", "")
    return url[:max_len] + "…" if len(url) > max_len else url

def shorten_selector(sel, max_len=50):
    if pd.isna(sel) or sel is None:
        return "(no selector)"
    sel = str(sel)
    return sel[:max_len] + "…" if len(sel) > max_len else sel

def weighted_top(df, col, n=20):
    """Top-n values by sum of weight (excluding nulls)."""
    valid = df[df[col].notna()]
    return valid.groupby(col)["weight"].sum().nlargest(n)

def fmt_count(x):
    if x >= 1e9:  return f"{x/1e9:.1f}B"
    if x >= 1e6:  return f"{x/1e6:.1f}M"
    if x >= 1e3:  return f"{x/1e3:.0f}K"
    return str(int(x))

# ══════════════════════════════════════════════════════════════════════════════
# FIG 1 – Total weighted clicks by site & year (overview)
# ══════════════════════════════════════════════════════════════════════════════
print("Figure 1: Overview – total clicks by site & year")

totals = {}
for site_key, site_name in SITES.items():
    totals[site_name] = {}
    for yr in YEARS:
        df = load(site_key, yr)
        totals[site_name][yr] = int(df["weight"].sum()) if df is not None else 0

fig, axes = plt.subplots(1, 2, figsize=(14, 6))
fig.suptitle("RUM Click Data Overview — adobe.com, blog.adobe.com, business.adobe.com",
             fontsize=14, fontweight="bold", y=1.01)

# Left: grouped bar by site×year
ax = axes[0]
site_names = list(totals.keys())
x = np.arange(len(site_names))
w = 0.25
for i, yr in enumerate(YEARS):
    vals = [totals[s][yr] for s in site_names]
    bars = ax.bar(x + i*w - w, vals, w, label=str(yr), color=COLORS[yr], edgecolor="white", linewidth=0.5)
    for bar, v in zip(bars, vals):
        if v > 0:
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() * 1.02,
                    fmt_count(v), ha="center", va="bottom", fontsize=7.5, fontweight="bold")

ax.set_xticks(x)
ax.set_xticklabels(site_names, fontsize=9)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: fmt_count(v)))
ax.set_ylabel("Total weighted clicks")
ax.set_title("Total Clicks by Site & Year")
ax.legend(title="Year")
ax.grid(axis="y", alpha=0.35)
ax.set_axisbelow(True)

# Right: stacked YoY growth for adobe.com (biggest dataset)
ax2 = axes[1]
for site_name, color in zip(site_names, SITE_COLORS.values()):
    vals = [totals[site_name][yr] for yr in YEARS]
    ax2.plot(YEARS, vals, marker="o", lw=2.5, label=site_name, color=color)
    for yr, v in zip(YEARS, vals):
        if v > 0:
            ax2.text(yr, v * 1.05, fmt_count(v), ha="center", fontsize=7.5)

ax2.set_xticks(YEARS)
ax2.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: fmt_count(v)))
ax2.set_ylabel("Total weighted clicks")
ax2.set_title("Year-over-Year Click Growth")
ax2.legend(fontsize=8)
ax2.grid(alpha=0.35)
ax2.set_axisbelow(True)

plt.tight_layout()
fig.savefig(os.path.join(OUT, "01_overview_total_clicks.png"), dpi=150, bbox_inches="tight")
plt.close(fig)
print("  saved.")

# ══════════════════════════════════════════════════════════════════════════════
# FIG 2 – Top 30 pages by clicks, per site (one figure per site, 3 years overlaid)
# ══════════════════════════════════════════════════════════════════════════════
print("Figure 2: Top pages per site")

for site_key, site_name in SITES.items():
    # Combine all years, colour by year
    fig, axes = plt.subplots(1, 3, figsize=(22, 10), sharey=False)
    fig.suptitle(f"Top 30 Most-Clicked Pages — {site_name}",
                 fontsize=13, fontweight="bold")

    for ax, yr in zip(axes, YEARS):
        df = load(site_key, yr)
        if df is None:
            ax.set_visible(False)
            continue
        top30 = df.groupby("page_url")["weight"].sum().nlargest(30).sort_values()
        labels = [shorten_url(u, 65) for u in top30.index]
        bars = ax.barh(range(len(top30)), top30.values, color=COLORS[yr], edgecolor="white", linewidth=0.4)
        ax.set_yticks(range(len(top30)))
        ax.set_yticklabels(labels, fontsize=6.5)
        ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: fmt_count(v)))
        ax.set_title(f"{yr}", fontsize=11, fontweight="bold", color=COLORS[yr])
        ax.set_xlabel("Weighted clicks")
        ax.grid(axis="x", alpha=0.3)
        ax.set_axisbelow(True)
        # annotate top 5
        for i, (bar, v) in enumerate(zip(bars, top30.values)):
            if i >= len(top30) - 5:
                ax.text(v * 1.01, bar.get_y() + bar.get_height()/2,
                        fmt_count(v), va="center", fontsize=6.5)

    plt.tight_layout()
    fname = f"02_top30_pages_{site_key}.png"
    fig.savefig(os.path.join(OUT, fname), dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"  saved {fname}")

# ══════════════════════════════════════════════════════════════════════════════
# FIG 3 – Click source (CSS selector) distribution, top 20, per site×year
# ══════════════════════════════════════════════════════════════════════════════
print("Figure 3: Click source distributions")

for site_key, site_name in SITES.items():
    fig, axes = plt.subplots(1, 3, figsize=(22, 9), sharey=False)
    fig.suptitle(f"Top 20 Click Sources (CSS Selectors) — {site_name}",
                 fontsize=13, fontweight="bold")

    for ax, yr in zip(axes, YEARS):
        df = load(site_key, yr)
        if df is None:
            ax.set_visible(False)
            continue
        top = weighted_top(df, "click_source", 20).sort_values()
        labels = [shorten_selector(s, 55) for s in top.index]
        ax.barh(range(len(top)), top.values, color=COLORS[yr], edgecolor="white", linewidth=0.4)
        ax.set_yticks(range(len(top)))
        ax.set_yticklabels(labels, fontsize=6.5)
        ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: fmt_count(v)))
        ax.set_title(f"{yr}", fontsize=11, fontweight="bold", color=COLORS[yr])
        ax.set_xlabel("Weighted clicks")
        ax.grid(axis="x", alpha=0.3)
        ax.set_axisbelow(True)

    plt.tight_layout()
    fname = f"03_click_sources_{site_key}.png"
    fig.savefig(os.path.join(OUT, fname), dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"  saved {fname}")

# ══════════════════════════════════════════════════════════════════════════════
# FIG 4 – Click target URL distribution, top 20, per site×year
# ══════════════════════════════════════════════════════════════════════════════
print("Figure 4: Click target distributions")

for site_key, site_name in SITES.items():
    fig, axes = plt.subplots(1, 3, figsize=(22, 9), sharey=False)
    fig.suptitle(f"Top 20 Click Targets (Destination URLs) — {site_name}",
                 fontsize=13, fontweight="bold")

    for ax, yr in zip(axes, YEARS):
        df = load(site_key, yr)
        if df is None:
            ax.set_visible(False)
            continue
        top = weighted_top(df, "click_target_url", 20).sort_values()
        labels = [shorten_url(u, 60) for u in top.index]
        ax.barh(range(len(top)), top.values, color=COLORS[yr], edgecolor="white", linewidth=0.4)
        ax.set_yticks(range(len(top)))
        ax.set_yticklabels(labels, fontsize=6.5)
        ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: fmt_count(v)))
        ax.set_title(f"{yr}", fontsize=11, fontweight="bold", color=COLORS[yr])
        ax.set_xlabel("Weighted clicks")
        ax.grid(axis="x", alpha=0.3)
        ax.set_axisbelow(True)

    plt.tight_layout()
    fname = f"04_click_targets_{site_key}.png"
    fig.savefig(os.path.join(OUT, fname), dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"  saved {fname}")

# ══════════════════════════════════════════════════════════════════════════════
# FIG 5 – Per-page click source distribution (like example image)
#         Top 5 pages for each site×year, top 15 selectors per page
# ══════════════════════════════════════════════════════════════════════════════
print("Figure 5: Per-page click source distributions (example-style)")

for site_key, site_name in SITES.items():
    for yr in YEARS:
        df = load(site_key, yr)
        if df is None:
            continue

        # Get top 5 pages by weighted click count (with at least some click_source data)
        df_with_src = df[df["click_source"].notna()]
        if df_with_src.empty:
            continue
        top5_pages = df_with_src.groupby("page_url")["weight"].sum().nlargest(5).index.tolist()

        n_pages = len(top5_pages)
        if n_pages == 0:
            continue

        fig, axes = plt.subplots(n_pages, 1, figsize=(14, 4 * n_pages))
        if n_pages == 1:
            axes = [axes]
        fig.suptitle(f"Click Source Distributions per Top Page — {site_name} ({yr})",
                     fontsize=12, fontweight="bold", y=1.01)

        for ax, page_url in zip(axes, top5_pages):
            page_df = df_with_src[df_with_src["page_url"] == page_url]
            top_src = page_df.groupby("click_source")["weight"].sum().nlargest(15).sort_values(ascending=False)
            total = top_src.sum()
            norm = top_src / total  # normalised

            labels = [shorten_selector(s, 45) for s in top_src.index]
            x = np.arange(len(norm))
            bars = ax.bar(x, norm.values, color=COLORS[yr], edgecolor="white", linewidth=0.4, alpha=0.85)
            ax.set_xticks(x)
            ax.set_xticklabels(labels, rotation=35, ha="right", fontsize=7)
            ax.set_ylabel("Normalised click share")
            short_url = shorten_url(page_url, 80)
            ax.set_title(f"{short_url}  |  total clicks: {fmt_count(int(page_df['weight'].sum()))}",
                         fontsize=8.5)
            ax.set_ylim(0, norm.max() * 1.2)
            ax.grid(axis="y", alpha=0.3)
            ax.set_axisbelow(True)
            for bar, v in zip(bars, norm.values):
                ax.text(bar.get_x() + bar.get_width()/2, v + norm.max()*0.02,
                        f"{v:.2f}", ha="center", va="bottom", fontsize=6.5)

        plt.tight_layout()
        fname = f"05_per_page_sources_{site_key}_{yr}.png"
        fig.savefig(os.path.join(OUT, fname), dpi=150, bbox_inches="tight")
        plt.close(fig)
        print(f"  saved {fname}")

# ══════════════════════════════════════════════════════════════════════════════
# FIG 6 – YoY click source shift: same top selectors across years (per site)
# ══════════════════════════════════════════════════════════════════════════════
print("Figure 6: YoY click source shift per site")

for site_key, site_name in SITES.items():
    # Find union of top-15 selectors across all years
    all_dfs = {yr: load(site_key, yr) for yr in YEARS}
    all_dfs = {yr: df for yr, df in all_dfs.items() if df is not None}
    if not all_dfs:
        continue

    # Build per-year normalised distributions over union of top selectors
    top_union = set()
    year_totals = {}
    year_src = {}
    for yr, df in all_dfs.items():
        s = weighted_top(df, "click_source", 15)
        top_union.update(s.index.tolist())
        year_src[yr] = df[df["click_source"].notna()].groupby("click_source")["weight"].sum()
        year_totals[yr] = year_src[yr].sum()

    selectors = sorted(top_union)
    # Matrix: rows=selectors, cols=years
    mat = {}
    for yr in all_dfs:
        mat[yr] = np.array([year_src[yr].get(s, 0) / year_totals[yr] for s in selectors])

    # Sort by mean across years
    mean_vals = np.array(list(mat.values())).mean(axis=0)
    order = np.argsort(mean_vals)[::-1][:20]  # top 20
    selectors_ord = [shorten_selector(selectors[i], 50) for i in order]

    fig, ax = plt.subplots(figsize=(14, 8))
    x = np.arange(len(selectors_ord))
    w = 0.25
    for i, (yr, df) in enumerate(all_dfs.items()):
        vals = mat[yr][order]
        bars = ax.bar(x + (i - 1)*w, vals, w, label=str(yr), color=COLORS[yr],
                      edgecolor="white", linewidth=0.4, alpha=0.9)

    ax.set_xticks(x)
    ax.set_xticklabels(selectors_ord, rotation=40, ha="right", fontsize=7)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"{v:.2%}"))
    ax.set_ylabel("Normalised click share")
    ax.set_title(f"Year-over-Year Click Source Shift — {site_name}", fontsize=12, fontweight="bold")
    ax.legend(title="Year")
    ax.grid(axis="y", alpha=0.35)
    ax.set_axisbelow(True)

    plt.tight_layout()
    fname = f"06_yoy_source_shift_{site_key}.png"
    fig.savefig(os.path.join(OUT, fname), dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"  saved {fname}")

# ══════════════════════════════════════════════════════════════════════════════
# FIG 7 – Monthly click volume heatmap (per site, all years combined)
# ══════════════════════════════════════════════════════════════════════════════
print("Figure 7: Monthly click volume heatmaps")

for site_key, site_name in SITES.items():
    frames = []
    for yr in YEARS:
        df = load(site_key, yr)
        if df is not None:
            frames.append(df[["event_time", "weight"]].copy())
    if not frames:
        continue
    combined = pd.concat(frames, ignore_index=True)
    combined["year"]  = combined["event_time"].dt.year
    combined["month"] = combined["event_time"].dt.month

    pivot = combined.groupby(["year", "month"])["weight"].sum().unstack(fill_value=0)

    fig, ax = plt.subplots(figsize=(12, 4))
    import matplotlib.colors as mcolors
    cmap = plt.cm.YlOrRd
    im = ax.imshow(pivot.values, aspect="auto", cmap=cmap, interpolation="nearest")
    plt.colorbar(im, ax=ax, label="Weighted clicks", format=mticker.FuncFormatter(lambda v, _: fmt_count(v)))
    ax.set_yticks(range(len(pivot.index)))
    ax.set_yticklabels(pivot.index.tolist())
    ax.set_xticks(range(12))
    ax.set_xticklabels(["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"])
    ax.set_ylabel("Year")
    ax.set_title(f"Monthly Click Volume Heatmap — {site_name}", fontsize=12, fontweight="bold")

    # Annotate cells
    for r, yr in enumerate(pivot.index):
        for c in range(12):
            v = pivot.iloc[r, c]
            if v > 0:
                ax.text(c, r, fmt_count(v), ha="center", va="center",
                        fontsize=6.5, color="black" if v < pivot.values.max()*0.7 else "white")

    plt.tight_layout()
    fname = f"07_monthly_heatmap_{site_key}.png"
    fig.savefig(os.path.join(OUT, fname), dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"  saved {fname}")

print("\nAll done! Visualizations saved to:", OUT)
