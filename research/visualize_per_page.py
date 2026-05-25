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
Per-page Click Source & Click Target distributions
For each of 3 sites: top 10 pages, 2 charts per page (source + target),
3 years overlaid as grouped bars (normalized). One PNG per site.
"""

import os
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import warnings
warnings.filterwarnings("ignore")

BASE   = os.path.dirname(os.path.abspath(__file__))
DATA   = os.path.join(BASE, "data")
OUT    = os.path.join(BASE, "visualizations")
os.makedirs(OUT, exist_ok=True)

SITES = {
    "adobe-com":          "adobe.com",
    "blog-adobe-com":     "blog.adobe.com",
    "business-adobe-com": "business.adobe.com",
}
YEARS       = [2023, 2024, 2025]
YEAR_COLORS = {2023: "#1f77b4", 2024: "#ff7f0e", 2025: "#2ca02c"}
TOP_PAGES   = 10
TOP_ITEMS   = 12   # top selectors / target URLs to show per chart

def load(site_key, year):
    p = os.path.join(DATA, f"{site_key}-{year}.parquet")
    return pd.read_parquet(p) if os.path.exists(p) else None

def shorten(s, n=48):
    if pd.isna(s) or s is None:
        return "(none)"
    s = str(s).replace("https://", "").replace("http://", "")
    return s[:n] + "…" if len(s) > n else s

def fmt(v):
    if v >= 1e6: return f"{v/1e6:.1f}M"
    if v >= 1e3: return f"{v/1e3:.0f}K"
    return str(int(v))

def grouped_bar(ax, data_by_year, title, color_map):
    """
    data_by_year: {year: pd.Series(index=label, value=weighted_count)}
    Plots normalised grouped bars, 3 years side by side.
    """
    # Union of top items across years (keep only TOP_ITEMS after ranking by total)
    combined = pd.concat(data_by_year.values()).groupby(level=0).sum()
    top_labels = combined.nlargest(TOP_ITEMS).index.tolist()

    n = len(top_labels)
    if n == 0:
        ax.set_visible(False)
        return

    x = np.arange(n)
    n_years = len(data_by_year)
    bar_w = 0.8 / n_years

    for i, (yr, series) in enumerate(data_by_year.items()):
        total = series.sum() if series.sum() > 0 else 1
        vals  = np.array([series.get(lbl, 0) / total for lbl in top_labels])
        offset = (i - (n_years - 1) / 2) * bar_w
        ax.bar(x + offset, vals, bar_w, label=str(yr),
               color=color_map[yr], edgecolor="white", linewidth=0.3, alpha=0.88)

    ax.set_xticks(x)
    ax.set_xticklabels([shorten(l, 42) for l in top_labels],
                       rotation=38, ha="right", fontsize=5.8)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"{v:.0%}"))
    ax.set_title(title, fontsize=7.2, fontweight="bold", pad=3)
    ax.grid(axis="y", alpha=0.3, linewidth=0.5)
    ax.set_axisbelow(True)
    ax.tick_params(axis="y", labelsize=6)

for site_key, site_name in SITES.items():
    print(f"Processing {site_name} …")

    # ── load all years ────────────────────────────────────────────────────────
    dfs = {yr: load(site_key, yr) for yr in YEARS}
    dfs = {yr: df for yr, df in dfs.items() if df is not None}

    # ── rank top-10 pages by total weighted clicks across all years ───────────
    all_combined = pd.concat(dfs.values(), ignore_index=True)
    top10_pages  = (all_combined.groupby("page_url")["weight"]
                                .sum().nlargest(TOP_PAGES).index.tolist())

    # ── figure: 10 rows × 2 cols ──────────────────────────────────────────────
    nrows, ncols = TOP_PAGES, 2
    fig, axes = plt.subplots(nrows, ncols,
                             figsize=(22, 4.5 * nrows),
                             constrained_layout=True)

    fig.suptitle(f"Click Source & Target Distributions — Top {TOP_PAGES} Pages\n{site_name}  |  years: 2023 · 2024 · 2025",
                 fontsize=14, fontweight="bold", y=1.005)

    # legend handles (shared)
    legend_handles = [
        plt.Rectangle((0,0),1,1, color=YEAR_COLORS[yr], label=str(yr)) for yr in YEARS
    ]

    for row, page_url in enumerate(top10_pages):
        page_rank   = row + 1
        short_page  = shorten(page_url, 70)
        total_clicks = int(all_combined[all_combined["page_url"] == page_url]["weight"].sum())

        # --- collect per-year distributions for this page ---
        src_by_year  = {}
        tgt_by_year  = {}
        for yr, df in dfs.items():
            pg = df[df["page_url"] == page_url]
            src_by_year[yr] = (pg[pg["click_source"].notna()]
                               .groupby("click_source")["weight"].sum())
            tgt_by_year[yr] = (pg[pg["click_target_url"].notna()]
                               .groupby("click_target_url")["weight"].sum())

        page_header = f"#{page_rank}  {short_page}  [{fmt(total_clicks)} total clicks]"

        # LEFT – click source
        grouped_bar(axes[row, 0], src_by_year,
                    f"{page_header}\nClick Source (CSS Selector)", YEAR_COLORS)

        # RIGHT – click target
        grouped_bar(axes[row, 1], tgt_by_year,
                    f"{page_header}\nClick Target (URL)", YEAR_COLORS)

    # shared legend at top
    fig.legend(handles=legend_handles, loc="upper right",
               fontsize=9, framealpha=0.9, title="Year", title_fontsize=9)

    fname = f"per_page_{site_key}.png"
    fpath = os.path.join(OUT, fname)
    fig.savefig(fpath, dpi=130, bbox_inches="tight")
    plt.close(fig)
    print(f"  saved {fname}")

print("\nDone — 3 PNGs in", OUT)
TrajectoryDataset