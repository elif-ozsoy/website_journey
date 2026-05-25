"""
Reconstruct synthetic training sessions from Adobe parquet click data.

Since the raw data has no session IDs, we build a weighted transition graph
from observed (page → click → next_page) triples, then generate synthetic
sessions via weighted random walks.

Output: sessions/pretrain_sessions.jsonl
Each line is a JSON session dict compatible with SessionDataset.

Usage:
    conda run -n xaiml python scripts/reconstruct_sessions.py
    conda run -n xaiml python scripts/reconstruct_sessions.py --n-sessions 200000 --max-len 15
"""
import os
import json
import argparse
import random
from collections import defaultdict
from typing import Dict, List, Tuple

import pandas as pd
import numpy as np
from tqdm import tqdm

from ingestion.feature_extractor import abstract_adobe_row
from model.config import DEFAULT_TRAIN

# ── Config ─────────────────────────────────────────────────────────────────────

SITES = ["adobe-com", "blog-adobe-com", "business-adobe-com"]
YEARS = [2023, 2024, 2025]

# ── Helpers ────────────────────────────────────────────────────────────────────

def step_key(step: dict) -> Tuple:
    """Hashable representation of a step (used as graph node/edge key)."""
    return (step["page_type"], step["page_depth"])


def build_transition_graph(parquet_paths: List[str]) -> Dict:
    """
    Build a weighted directed graph of page transitions.

    Graph structure:
        node: (page_type, depth) tuple
        edges[node] = list of (weight, next_node, element_role, dest_type)

    Only rows with a click_target_url are used (these are real navigations).
    """
    print("Building transition graph from parquet files…")

    # edges[src_node][(role, dest, tgt_node)] += weight
    edge_counts: Dict = defaultdict(lambda: defaultdict(int))
    node_traffic: Dict = defaultdict(int)

    for path in parquet_paths:
        if not os.path.exists(path):
            continue
        print(f"  Loading {os.path.basename(path)}…")
        df = pd.read_parquet(path,
                             columns=["page_url", "click_source",
                                      "click_target_url", "weight"])
        # Only rows with a navigation target
        df = df[df["click_target_url"].notna()].copy()

        for _, row in tqdm(df.iterrows(), total=len(df), leave=False):
            try:
                src_step = abstract_adobe_row(
                    row["page_url"], row["click_source"], row["click_target_url"]
                )
                # For the next node, abstract the target URL
                tgt_step = abstract_adobe_row(
                    row["click_target_url"], None, None
                )
            except Exception:
                continue

            src_node = step_key(src_step)
            tgt_node = step_key(tgt_step)
            edge_key  = (src_step["element_role"], src_step["dest_type"], tgt_node)
            w = int(row["weight"])

            edge_counts[src_node][edge_key] += w
            node_traffic[src_node] += w

    # Convert to lists for sampling
    graph: Dict[Tuple, List] = {}
    for src_node, edges in edge_counts.items():
        edge_list = []
        for (role, dest, tgt_node), w in edges.items():
            edge_list.append((w, tgt_node, role, dest))
        graph[src_node] = edge_list

    return graph, node_traffic


def weighted_sample(items, weights):
    """Sample one item from items proportionally to weights."""
    total = sum(weights)
    r = random.random() * total
    cumulative = 0
    for item, w in zip(items, weights):
        cumulative += w
        if r <= cumulative:
            return item
    return items[-1]


def random_walk(graph: Dict, start_node: Tuple,
                min_len: int, max_len: int) -> List[dict]:
    """
    Perform one random walk starting from start_node.
    Returns a list of abstract step dicts.
    """
    steps = []
    current = start_node

    for _ in range(max_len):
        if current not in graph or not graph[current]:
            break

        edges = graph[current]
        weights = [e[0] for e in edges]
        chosen  = weighted_sample(edges, weights)
        _, tgt_node, role, dest = chosen

        steps.append({
            "page_type":    current[0],
            "page_depth":   current[1],
            "element_role": role,
            "dest_type":    dest,
        })

        if dest == "external_exit":
            break
        current = tgt_node

    return steps if len(steps) >= min_len else []


def generate_sessions(graph: Dict, node_traffic: Dict,
                      n_sessions: int, min_len: int, max_len: int,
                      seed: int = 42) -> List[dict]:
    """
    Generate n_sessions synthetic sessions via random walks.
    Start nodes are sampled proportionally to observed traffic.
    """
    random.seed(seed)
    np.random.seed(seed)

    nodes   = list(node_traffic.keys())
    weights = [node_traffic[n] for n in nodes]

    sessions = []
    attempts = 0
    max_attempts = n_sessions * 5

    pbar = tqdm(total=n_sessions, desc="Generating sessions")
    while len(sessions) < n_sessions and attempts < max_attempts:
        attempts += 1
        start = weighted_sample(nodes, weights)
        steps = random_walk(graph, start, min_len, max_len)
        if steps:
            sessions.append({
                "session_id": f"synth_{len(sessions):07d}",
                "task":       "generic",
                "steps":      steps,
                "completed":  steps[-1]["dest_type"] != "external_exit",
            })
            pbar.update(1)
    pbar.close()

    print(f"Generated {len(sessions)} sessions in {attempts} attempts.")
    return sessions


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Reconstruct synthetic sessions from Adobe data")
    parser.add_argument("--data-dir",    default="ETH-IML-Course-Datasets")
    parser.add_argument("--output-dir",  default="sessions")
    parser.add_argument("--n-sessions",  type=int,   default=DEFAULT_TRAIN.n_synthetic_sessions)
    parser.add_argument("--min-len",     type=int,   default=DEFAULT_TRAIN.min_session_len)
    parser.add_argument("--max-len",     type=int,   default=DEFAULT_TRAIN.max_session_len)
    parser.add_argument("--seed",        type=int,   default=42)
    parser.add_argument("--sites",       nargs="+",  default=SITES)
    parser.add_argument("--years",       nargs="+",  type=int, default=YEARS)
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    # Collect parquet paths
    paths = []
    for site in args.sites:
        for yr in args.years:
            p = os.path.join(args.data_dir, f"{site}-{yr}.parquet")
            if os.path.exists(p):
                paths.append(p)
    print(f"Found {len(paths)} parquet files.")

    graph, node_traffic = build_transition_graph(paths)
    print(f"Graph: {len(graph)} nodes, "
          f"{sum(len(v) for v in graph.values())} edges.")

    sessions = generate_sessions(
        graph, node_traffic,
        n_sessions=args.n_sessions,
        min_len=args.min_len,
        max_len=args.max_len,
        seed=args.seed,
    )

    # ── Split train / val ─────────────────────────────────────────────────────
    random.shuffle(sessions)
    split = int(0.95 * len(sessions))
    train_sess = sessions[:split]
    val_sess   = sessions[split:]

    train_path = os.path.join(args.output_dir, "pretrain_train.jsonl")
    val_path   = os.path.join(args.output_dir, "pretrain_val.jsonl")

    for path, data in [(train_path, train_sess), (val_path, val_sess)]:
        with open(path, "w") as f:
            for sess in data:
                f.write(json.dumps(sess) + "\n")
        print(f"Saved {len(data)} sessions → {path}")


if __name__ == "__main__":
    main()
