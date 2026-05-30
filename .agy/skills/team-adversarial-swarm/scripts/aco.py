"""ACO controller CLI - the script side of team-swarm.

Subcommands: init | select | update | converged | report
Spec: ../specs/swarm-protocol.md (script <-> coordinator contract)

All commands:
  - read state from --session <path>
  - emit JSON to stdout
  - exit 0 success, 1 runtime error, 2 config invalid

Invoked by team-swarm coordinator via Bash. No prose output, no interactive prompts.
"""
from __future__ import annotations

import argparse
import glob
import json
import random
import sys
import time
from pathlib import Path
from typing import List, Optional

# Local imports (script directory)
sys.path.insert(0, str(Path(__file__).parent))
from pheromone import PheromoneState  # noqa: E402
from scoring import (  # noqa: E402
    FallbackScorer,
    ScriptScorer,
    hallucination_check,
    load_verified_scores,
    resolve_score,
)

VERSION = "1.0"


# ---------------------------------------------------------------------------
# Session paths
# ---------------------------------------------------------------------------

class SessionPaths:
    def __init__(self, session: Path):
        self.session = session
        self.config = session / "swarm-config.json"
        self.pheromone_dir = session / "pheromone"
        self.pheromone_current = self.pheromone_dir / "current.json"
        self.pheromone_init = self.pheromone_dir / "init.json"
        self.pheromone_history = self.pheromone_dir / "history"
        self.task_space = session / "task-space.json"
        self.trails = session / "trails"
        self.artifacts = session / "artifacts"
        self.scores = session / "scores"
        self.best = session / "best.json"

    def ensure_dirs(self) -> None:
        for d in [self.pheromone_dir, self.pheromone_history, self.trails, self.artifacts, self.scores]:
            d.mkdir(parents=True, exist_ok=True)


def _emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def _fail(code: int, msg: str):
    _emit({"status": "error", "message": msg})
    sys.exit(code)


# ---------------------------------------------------------------------------
# init
# ---------------------------------------------------------------------------

def _discover_nodes(spec: dict) -> List[str]:
    """Resolve task_space.nodes — supports explicit list or auto_discover_from glob."""
    if isinstance(spec.get("nodes"), list):
        return [str(n) for n in spec["nodes"]]
    if "auto_discover_from" in spec:
        pattern = spec["auto_discover_from"]
        # Glob relative to cwd (workspace root), not session
        matches = sorted(glob.glob(pattern, recursive=True))
        if not matches:
            raise ValueError(f"auto_discover_from '{pattern}' matched no files")
        return matches
    raise ValueError("task_space requires either 'nodes' list or 'auto_discover_from' glob")


def cmd_init(args: argparse.Namespace) -> None:
    paths = SessionPaths(Path(args.session))
    if not paths.config.exists():
        _fail(2, f"config not found: {paths.config}")
    config = json.loads(paths.config.read_text())

    paths.ensure_dirs()

    try:
        nodes = _discover_nodes(config.get("task_space", {}))
    except ValueError as e:
        _fail(2, str(e))
        return  # unreachable, satisfies type checker

    # Write task-space.json
    task_space = {
        "nodes": nodes,
        "n_nodes": len(nodes),
        "max_path_length": config.get("task_space", {}).get("max_path_length", 5),
        "start_nodes": config.get("task_space", {}).get("start_nodes", "any"),
        "edges": config.get("task_space", {}).get("edges", "complete"),
    }
    paths.task_space.write_text(json.dumps(task_space, indent=2, ensure_ascii=False))

    # Initialize pheromone
    aco_cfg = config.get("aco", {})
    state = PheromoneState.initialize(nodes, aco_cfg)
    state.save(paths.pheromone_current)
    state.save(paths.pheromone_init)

    _emit({
        "status": "ok",
        "command": "init",
        "session": str(paths.session),
        "pheromone_path": str(paths.pheromone_current),
        "task_space_path": str(paths.task_space),
        "n_nodes": len(nodes),
        "n_edges": len(state.tau),
    })


# ---------------------------------------------------------------------------
# select
# ---------------------------------------------------------------------------

def _pick_start_node(nodes: List[str], state: PheromoneState, mode: str) -> str:
    if mode == "weighted":
        weights = [state.node_tau.get(n, 1.0) for n in nodes]
        total = sum(weights)
        if total == 0:
            return random.choice(nodes)
        r = random.uniform(0, total)
        acc = 0.0
        for n, w in zip(nodes, weights):
            acc += w
            if acc >= r:
                return n
        return nodes[-1]
    return random.choice(nodes)


def cmd_select(args: argparse.Namespace) -> None:
    paths = SessionPaths(Path(args.session))
    config = json.loads(paths.config.read_text())
    state = PheromoneState.load(paths.pheromone_current)
    task_space = json.loads(paths.task_space.read_text())

    n_ants = config.get("swarm", {}).get("n_ants", 5)
    nodes = task_space["nodes"]
    max_len = task_space.get("max_path_length", 5)
    start_mode = task_space.get("start_nodes", "any")

    assignments = []
    for i in range(1, n_ants + 1):
        start = _pick_start_node(nodes, state, "weighted" if start_mode == "weighted" else "uniform")
        edge_prefs = state.select_neighbors(start, nodes)
        # Keep top-k edges to reduce noise
        top_k = sorted(edge_prefs.items(), key=lambda x: -x[1])[:8]
        assignments.append({
            "ant_id": f"ANT-{args.iter}-{i}",
            "start_node": start,
            "edge_preferences": {f"{start}::{b}": w for b, w in top_k},
            "max_path_length": max_len,
            "iteration": args.iter,
        })

    _emit({
        "status": "ok",
        "command": "select",
        "iteration": args.iter,
        "n_assignments": len(assignments),
        "assignments": assignments,
    })


# ---------------------------------------------------------------------------
# update
# ---------------------------------------------------------------------------

def _load_iteration_artifacts(paths: SessionPaths, iteration: int) -> List[dict]:
    pattern = str(paths.artifacts / f"ant-{iteration}-*.json")
    files = sorted(glob.glob(pattern))
    artifacts = []
    for f in files:
        try:
            artifacts.append(json.loads(Path(f).read_text()))
        except json.JSONDecodeError as e:
            print(f"warning: skipped malformed artifact {f}: {e}", file=sys.stderr)
    return artifacts


def _validate_artifact(art: dict, valid_nodes: set) -> Optional[str]:
    required = ["schema_version", "ant_id", "iteration", "path", "self_score", "self_confidence"]
    for f in required:
        if f not in art:
            return f"missing field: {f}"
    if not isinstance(art["path"], list) or not art["path"]:
        return "path must be non-empty list"
    for n in art["path"]:
        if n not in valid_nodes:
            return f"path node '{n}' not in task_space"
    if not 0.0 <= art["self_score"] <= 1.0:
        return "self_score out of [0,1]"
    return None


def cmd_update(args: argparse.Namespace) -> None:
    paths = SessionPaths(Path(args.session))
    config = json.loads(paths.config.read_text())
    state = PheromoneState.load(paths.pheromone_current)
    task_space = json.loads(paths.task_space.read_text())
    valid_nodes = set(task_space["nodes"])

    artifacts = _load_iteration_artifacts(paths, args.iter)
    if not artifacts:
        _fail(1, f"no artifacts found for iteration {args.iter}")

    # Resolve scorers
    scoring_cfg = config.get("scoring", {})
    script_scorer = None
    if scoring_cfg.get("mode") in ("script", "hybrid"):
        rule_path = scoring_cfg.get("script_path")
        if rule_path:
            full = Path(args.session).parent.parent / rule_path if not Path(rule_path).is_absolute() else Path(rule_path)
            if full.exists():
                script_scorer = ScriptScorer(full)
    fallback = FallbackScorer(scoring_cfg.get("self_score_discount", 0.5))
    verified_scores = load_verified_scores(paths.scores / f"iter-{args.iter}-scores.json")

    # Evaporate first
    state.evaporate()

    # Process each ant
    trail_log = []
    hallucinations = []
    scored = []
    for art in artifacts:
        err = _validate_artifact(art, valid_nodes)
        if err:
            print(f"warning: invalid artifact {art.get('ant_id', '?')}: {err}", file=sys.stderr)
            continue
        score, src = resolve_score(art, verified_scores, script_scorer, fallback)
        scored.append({"ant_id": art["ant_id"], "score": score, "source": src})

        if src == "verified_llm":
            if hallucination_check(art["self_score"], score):
                hallucinations.append(art["ant_id"])
                score *= 0.5

        state.deposit(art["path"], score)
        trail_log.append({
            "ant_id": art["ant_id"],
            "path": art["path"],
            "self_score": art["self_score"],
            "verified_score": score,
            "source": src,
        })

    # Elitist: re-load best history, deposit extra on best path
    best_data = None
    if paths.best.exists():
        best_data = json.loads(paths.best.read_text())
    current_best = max(scored, key=lambda x: x["score"]) if scored else None
    if current_best:
        best_art = next(a for a in artifacts if a["ant_id"] == current_best["ant_id"])
        if best_data is None or current_best["score"] > best_data.get("score", -1):
            best_data = {
                "ant_id": current_best["ant_id"],
                "iteration": args.iter,
                "path": best_art["path"],
                "score": current_best["score"],
                "self_score": best_art["self_score"],
                "candidate_solution": best_art.get("candidate_solution"),
                "evidence": best_art.get("evidence", []),
                "updated_at": time.time(),
            }
            paths.best.write_text(json.dumps(best_data, indent=2, ensure_ascii=False))
        # Elite deposit
        state.deposit(best_data["path"], best_data["score"])

    state.clip()
    state.iteration = args.iter
    state.save(paths.pheromone_current)
    state.save(paths.pheromone_history / f"{args.iter}.json")

    # Persist trails
    trails_file = paths.trails / f"{args.iter}.jsonl"
    trails_file.write_text("\n".join(json.dumps(t, ensure_ascii=False) for t in trail_log))

    mean_score = sum(s["score"] for s in scored) / len(scored) if scored else 0.0
    best_score = best_data["score"] if best_data else 0.0
    prev_best = 0.0
    history_files = sorted(paths.pheromone_history.glob("*.json"))
    if len(history_files) >= 2:
        prev = json.loads(history_files[-2].read_text())
        prev_best = prev.get("stats", {}).get("best_known", best_score)
    delta = best_score - prev_best

    _emit({
        "status": "ok",
        "command": "update",
        "iteration": args.iter,
        "n_ants_processed": len(scored),
        "mean_score": round(mean_score, 4),
        "best_score": round(best_score, 4),
        "delta": round(delta, 4),
        "elite_updated": current_best is not None and (best_data is None or current_best["ant_id"] == best_data["ant_id"]),
        "hallucinations_flagged": hallucinations,
        "stats": state.stats(),
    })


# ---------------------------------------------------------------------------
# converged
# ---------------------------------------------------------------------------

def cmd_converged(args: argparse.Namespace) -> None:
    paths = SessionPaths(Path(args.session))
    config = json.loads(paths.config.read_text())
    cv = config.get("convergence", {})

    state = PheromoneState.load(paths.pheromone_current)
    iteration = state.iteration

    triggered = []
    metrics = {
        "iteration": iteration,
        "entropy": state.stats()["entropy"],
        "best_score": 0.0,
        "mean_score": 0.0,
        "iterations_since_best_change": 0,
    }

    if paths.best.exists():
        metrics["best_score"] = json.loads(paths.best.read_text()).get("score", 0.0)

    # max_iterations
    max_iter = cv.get("max_iterations", 5)
    if iteration >= max_iter:
        triggered.append("max_iterations")

    # entropy_floor
    ef = cv.get("entropy_floor", {})
    if ef.get("enabled", True) and metrics["entropy"] < ef.get("threshold", 0.5):
        triggered.append("entropy_floor")

    # target_score
    ts = cv.get("target_score", {})
    if ts.get("enabled", True) and metrics["best_score"] >= ts.get("value", 0.95):
        triggered.append("target_score")

    # stagnation
    st = cv.get("stagnation", {})
    if st.get("enabled", True):
        patience = st.get("patience", 2)
        min_delta = st.get("min_delta", 0.01)
        # Use trails to compute per-iter best
        trail_files = sorted(paths.trails.glob("*.jsonl"))
        per_iter_best = []
        for tf in trail_files:
            lines = [json.loads(l) for l in tf.read_text().splitlines() if l.strip()]
            if lines:
                per_iter_best.append(max(l.get("verified_score", 0) for l in lines))
        if len(per_iter_best) > patience:
            recent = per_iter_best[-patience - 1:]
            deltas = [abs(recent[i] - recent[i - 1]) for i in range(1, len(recent))]
            metrics["iterations_since_best_change"] = sum(1 for d in deltas if d < min_delta)
            if all(d < min_delta for d in deltas):
                triggered.append("stagnation")

    _emit({
        "status": "ok",
        "command": "converged",
        "converged": len(triggered) > 0,
        "iteration": iteration,
        "triggered_by": triggered,
        "reason": triggered[0] if triggered else "in_progress",
        "metrics": metrics,
        "recommendation": "ready for report" if triggered else f"continue to iteration {iteration + 1}",
    })


# ---------------------------------------------------------------------------
# report
# ---------------------------------------------------------------------------

def cmd_report(args: argparse.Namespace) -> None:
    paths = SessionPaths(Path(args.session))
    state = PheromoneState.load(paths.pheromone_current)

    best = None
    if paths.best.exists():
        best = json.loads(paths.best.read_text())

    # Top-K trails across all iterations
    all_trails = []
    for tf in sorted(paths.trails.glob("*.jsonl")):
        for line in tf.read_text().splitlines():
            if line.strip():
                all_trails.append(json.loads(line))
    top_k = sorted(all_trails, key=lambda x: -x.get("verified_score", 0))[:5]

    # Convergence curve
    curve = []
    for hf in sorted(paths.pheromone_history.glob("*.json"), key=lambda p: int(p.stem)):
        snap = json.loads(hf.read_text())
        curve.append({
            "iteration": snap["iteration"],
            "entropy": snap["stats"]["entropy"],
            "tau_max": snap["stats"]["max"],
            "tau_mean": snap["stats"]["mean"],
        })

    _emit({
        "status": "ok",
        "command": "report",
        "best": best,
        "top_k": top_k,
        "convergence_curve": curve,
        "final_pheromone_stats": state.stats(),
        "iterations_completed": state.iteration,
    })


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="aco", description=f"ACO controller v{VERSION}")
    p.add_argument("--session", required=True, help="path to session folder")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="initialize pheromone + task-space from config")

    s_select = sub.add_parser("select", help="produce N ant assignments for iteration k")
    s_select.add_argument("--iter", type=int, required=True)

    s_update = sub.add_parser("update", help="update pheromone from iteration artifacts")
    s_update.add_argument("--iter", type=int, required=True)

    sub.add_parser("converged", help="check convergence criteria")
    sub.add_parser("report", help="emit full result report")

    return p


def main(argv: Optional[List[str]] = None) -> None:
    args = build_parser().parse_args(argv)
    handlers = {
        "init": cmd_init,
        "select": cmd_select,
        "update": cmd_update,
        "converged": cmd_converged,
        "report": cmd_report,
    }
    try:
        handlers[args.command](args)
    except SystemExit:
        raise
    except Exception as e:
        _fail(1, f"{type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
