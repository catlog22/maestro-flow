"""End-to-end tests for team-swarm scripts.

Runs each scenario in a clean tmp directory and asserts on outputs.
No external test framework — runnable as `python test_aco.py`.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

SCRIPT_DIR = Path(__file__).parent
ACO = SCRIPT_DIR / "aco.py"

# Import modules directly for unit-level tests
sys.path.insert(0, str(SCRIPT_DIR))
from pheromone import PheromoneState, edge_key  # noqa: E402
from scoring import FallbackScorer, ScriptScorer, hallucination_check, resolve_score  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PASS = 0
FAIL = 0
FAILED_NAMES = []


def run_aco(session: Path, *args, expect_exit: int = 0) -> dict:
    """Invoke aco.py CLI, return parsed stdout JSON."""
    cmd = [sys.executable, str(ACO), "--session", str(session), *args]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != expect_exit:
        raise AssertionError(
            f"exit={proc.returncode} (expected {expect_exit})\n"
            f"cmd: {' '.join(cmd)}\nstdout: {proc.stdout}\nstderr: {proc.stderr}"
        )
    if not proc.stdout.strip():
        return {}
    return json.loads(proc.stdout.strip().splitlines()[-1])


def check(name: str, cond: bool, detail: str = ""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        FAILED_NAMES.append(name)
        print(f"  FAIL  {name}  {detail}")


def section(title: str):
    print(f"\n=== {title} ===")


def write_config(session: Path, overrides: Optional[dict] = None) -> dict:
    cfg = {
        "swarm": {"n_ants": 3, "max_iterations": 3, "elite_keep": 2},
        "aco": {"alpha": 1.0, "beta": 2.0, "rho": 0.2, "q": 1.0,
                "tau_init": 1.0, "tau_min": 0.01, "tau_max": 10.0},
        "task_space": {"type": "graph",
                       "nodes": ["a", "b", "c", "d", "e"],
                       "max_path_length": 3,
                       "start_nodes": "any",
                       "edges": "complete"},
        "scoring": {"mode": "fallback", "self_score_discount": 0.5},
        "ant_prompt": {"objective": "test", "evidence_requirements": []},
        "convergence": {
            "max_iterations": 3,
            "stagnation": {"enabled": True, "patience": 2, "min_delta": 0.01},
            "entropy_floor": {"enabled": True, "threshold": 0.1},
            "target_score": {"enabled": True, "value": 0.95},
        },
    }
    if overrides:
        _deep_merge(cfg, overrides)
    session.mkdir(parents=True, exist_ok=True)
    (session / "swarm-config.json").write_text(json.dumps(cfg))
    return cfg


def _deep_merge(base: dict, overrides: dict):
    for k, v in overrides.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v


def write_ant(session: Path, iteration: int, ant_idx: int,
              path: list, self_score: float = 0.6, self_confidence: float = 0.7) -> Path:
    artifacts = session / "artifacts"
    artifacts.mkdir(exist_ok=True)
    decisions = [
        {"from": path[i], "to": path[i + 1], "rationale": "r",
         "guided_by": "pheromone", "deviation_from_hint": False}
        for i in range(len(path) - 1)
    ]
    art = {
        "schema_version": "1.0",
        "ant_id": f"ANT-{iteration}-{ant_idx}",
        "iteration": iteration,
        "assignment": {"start_node": path[0], "max_path_length": 3},
        "path": path,
        "path_decisions": decisions,
        "self_score": self_score,
        "self_confidence": self_confidence,
        "evidence": [f"src/{path[-1]}.ts:{ant_idx}"],
        "candidate_solution": {"type": "string", "summary": f"sol-{ant_idx}",
                               "content": str(path)},
    }
    p = artifacts / f"ant-{iteration}-{ant_idx}.json"
    p.write_text(json.dumps(art))
    return p


# ---------------------------------------------------------------------------
# Unit tests — pheromone.py
# ---------------------------------------------------------------------------

def test_pheromone_unit():
    section("pheromone.py unit")

    s = PheromoneState.initialize(["a", "b", "c"], {})
    check("init creates n*(n-1)/2 edges", len(s.tau) == 3, f"got {len(s.tau)}")
    check("init uses default alpha=1.0", s.metadata["alpha"] == 1.0)
    check("init uses default rho=0.2", s.metadata["rho"] == 0.2)
    check("init all tau equal", len(set(s.tau.values())) == 1)

    s.evaporate()
    check("evaporate reduces by rho", abs(s.tau[edge_key("a", "b")] - 0.8) < 1e-9,
          f"got {s.tau[edge_key('a', 'b')]}")

    s.deposit(["a", "b", "c"], 0.5)
    expected_ab = 0.8 + 0.5 * 1.0
    check("deposit adds q*score per edge",
          abs(s.tau[edge_key("a", "b")] - expected_ab) < 1e-9,
          f"got {s.tau[edge_key('a', 'b')]}, expected {expected_ab}")

    s.metadata["tau_max"] = 2.0
    s.tau[edge_key("a", "b")] = 100.0
    s.clip()
    check("clip enforces tau_max", s.tau[edge_key("a", "b")] == 2.0)
    check("clip enforces tau_min on small values",
          all(v >= s.metadata["tau_min"] for v in s.tau.values()))

    stats = s.stats()
    check("stats has entropy field", "entropy" in stats)
    check("stats entropy is positive", stats["entropy"] > 0)

    probs = s.select_neighbors("a", ["a", "b", "c"])
    check("select_neighbors excludes current node", "a" not in probs)
    check("select_neighbors probs sum to 1",
          abs(sum(probs.values()) - 1.0) < 1e-9, f"got {sum(probs.values())}")

    empty = PheromoneState.initialize(["a"], {})
    check("single-node init produces 0 edges", len(empty.tau) == 0)
    check("empty stats handles 0-edge case", empty.stats()["entropy"] == 0.0)

    s2 = PheromoneState.initialize(["a", "b", "c"], {})
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "p.json"
        s2.save(p)
        s3 = PheromoneState.load(p)
        check("save/load roundtrip preserves tau", s2.tau == s3.tau)
        check("save/load preserves metadata", s2.metadata == s3.metadata)


# ---------------------------------------------------------------------------
# Unit tests — scoring.py
# ---------------------------------------------------------------------------

def test_scoring_unit():
    section("scoring.py unit")

    fb = FallbackScorer(discount=0.5)
    artifact = {"self_score": 0.8, "self_confidence": 0.6}
    expected = 0.8 * 0.6 * 0.5
    check("FallbackScorer = self * conf * discount",
          abs(fb.score(artifact) - expected) < 1e-9)

    artifact_missing = {}
    check("FallbackScorer handles missing fields",
          fb.score(artifact_missing) == 0.0)

    with tempfile.TemporaryDirectory() as td:
        rule = Path(td) / "rule.py"
        rule.write_text("def score(ant_artifact):\n    return ant_artifact.get('self_score', 0) * 2\n")
        ss = ScriptScorer(rule)
        check("ScriptScorer loads user rule", ss.score({"self_score": 0.3}) == 0.6)
        check("ScriptScorer clamps > 1.0", ss.score({"self_score": 0.9}) == 1.0)
        check("ScriptScorer clamps < 0.0", ss.score({"self_score": -0.5}) == 0.0)

    check("hallucination_check true at diff > 0.4",
          hallucination_check(0.9, 0.4) is True)
    check("hallucination_check false at diff < 0.4",
          hallucination_check(0.5, 0.4) is False)

    artifact_v = {"ant_id": "X", "self_score": 0.5, "self_confidence": 0.5}
    score, src = resolve_score(artifact_v, {"X": 0.9}, None, fb)
    check("resolve_score prefers verified", score == 0.9 and src == "verified_llm")

    score, src = resolve_score(artifact_v, {}, None, fb)
    check("resolve_score falls back when no verified",
          src == "fallback_self")


# ---------------------------------------------------------------------------
# CLI integration — full pipeline (3 iterations, fallback scoring)
# ---------------------------------------------------------------------------

def test_full_pipeline_3_iterations():
    section("aco.py — full 3-iteration pipeline (fallback scoring)")

    with tempfile.TemporaryDirectory() as td:
        session = Path(td)
        write_config(session)

        r = run_aco(session, "init")
        check("init: status ok", r["status"] == "ok")
        check("init: 5 nodes -> 10 edges", r["n_edges"] == 10)
        check("init: pheromone file exists",
              (session / "pheromone" / "current.json").exists())
        check("init: task-space file exists",
              (session / "task-space.json").exists())
        check("init: init.json frozen",
              (session / "pheromone" / "init.json").exists())

        best_history = []
        entropy_history = []

        for k in range(1, 4):
            sel = run_aco(session, "select", "--iter", str(k))
            check(f"iter{k} select: 3 assignments", len(sel["assignments"]) == 3)
            check(f"iter{k} select: ant_ids correct",
                  all(a["ant_id"] == f"ANT-{k}-{i+1}" for i, a in enumerate(sel["assignments"])))
            check(f"iter{k} select: edge_preferences not empty",
                  all(a["edge_preferences"] for a in sel["assignments"]))

            paths_by_quality = [
                (["a", "b", "c"], 0.9, 0.9),
                (["b", "d", "e"], 0.6, 0.7),
                (["c", "e", "a"], 0.4, 0.5),
            ]
            for i, (path, ss, sc) in enumerate(paths_by_quality, 1):
                write_ant(session, k, i, path, ss, sc)

            up = run_aco(session, "update", "--iter", str(k))
            check(f"iter{k} update: 3 ants processed", up["n_ants_processed"] == 3)
            check(f"iter{k} update: best_score > 0", up["best_score"] > 0)
            check(f"iter{k} update: stats has entropy", "entropy" in up["stats"])

            best_history.append(up["best_score"])
            entropy_history.append(up["stats"]["entropy"])

            check(f"iter{k} history snapshot exists",
                  (session / "pheromone" / "history" / f"{k}.json").exists())
            check(f"iter{k} trails written",
                  (session / "trails" / f"{k}.jsonl").exists())

        check("best_score stable after iter1 (same ants each iter)",
              best_history[0] == best_history[-1])
        check("entropy decreases over iterations (concentration)",
              entropy_history[0] >= entropy_history[-1],
              f"start={entropy_history[0]:.3f} end={entropy_history[-1]:.3f}")

        cv = run_aco(session, "converged")
        check("converged: returns triggered_by list", isinstance(cv["triggered_by"], list))
        check("converged: triggers stagnation (best unchanged)",
              "stagnation" in cv["triggered_by"])
        check("converged: also triggers max_iterations",
              "max_iterations" in cv["triggered_by"])
        check("converged: true after triggers", cv["converged"] is True)

        rep = run_aco(session, "report")
        check("report: has best", rep["best"] is not None)
        check("report: top_k present", len(rep["top_k"]) > 0)
        check("report: convergence curve len == iters",
              len(rep["convergence_curve"]) == 3)
        check("report: iterations_completed == 3", rep["iterations_completed"] == 3)


# ---------------------------------------------------------------------------
# CLI integration — target_score convergence
# ---------------------------------------------------------------------------

def test_target_score_convergence():
    section("aco.py — target_score triggers early convergence")

    with tempfile.TemporaryDirectory() as td:
        session = Path(td)
        write_config(session, {
            "convergence": {"target_score": {"enabled": True, "value": 0.30}},
        })
        run_aco(session, "init")
        run_aco(session, "select", "--iter", "1")
        write_ant(session, 1, 1, ["a", "b"], 0.9, 0.9)
        write_ant(session, 1, 2, ["b", "c"], 0.6, 0.6)
        write_ant(session, 1, 3, ["c", "d"], 0.4, 0.4)
        up = run_aco(session, "update", "--iter", "1")

        check("best_score above target", up["best_score"] >= 0.30)
        cv = run_aco(session, "converged")
        check("converged after 1 iter (target hit)",
              cv["converged"] is True and "target_score" in cv["triggered_by"])


# ---------------------------------------------------------------------------
# CLI integration — hallucination detection (verified scores file)
# ---------------------------------------------------------------------------

def test_hallucination_flagging():
    section("aco.py — hallucination flagging with verified scores")

    with tempfile.TemporaryDirectory() as td:
        session = Path(td)
        write_config(session)
        run_aco(session, "init")
        run_aco(session, "select", "--iter", "1")

        write_ant(session, 1, 1, ["a", "b"], self_score=0.95, self_confidence=0.9)
        write_ant(session, 1, 2, ["b", "c"], self_score=0.85, self_confidence=0.8)
        write_ant(session, 1, 3, ["c", "d"], self_score=0.7,  self_confidence=0.7)

        scores_dir = session / "scores"
        scores_dir.mkdir(exist_ok=True)
        (scores_dir / "iter-1-scores.json").write_text(json.dumps({
            "iteration": 1, "scorer_type": "llm",
            "scores": {
                "ANT-1-1": {"verified_score": 0.20, "rationale": "weak"},
                "ANT-1-2": {"verified_score": 0.80, "rationale": "ok"},
                "ANT-1-3": {"verified_score": 0.65, "rationale": "ok"},
            },
        }))

        up = run_aco(session, "update", "--iter", "1")
        check("ANT-1-1 flagged as hallucination (|0.95-0.20|=0.75 > 0.4)",
              "ANT-1-1" in up["hallucinations_flagged"])
        check("ANT-1-2 NOT flagged (|0.85-0.80|=0.05 < 0.4)",
              "ANT-1-2" not in up["hallucinations_flagged"])
        check("ANT-1-3 NOT flagged (|0.7-0.65|=0.05 < 0.4)",
              "ANT-1-3" not in up["hallucinations_flagged"])


# ---------------------------------------------------------------------------
# CLI integration — invalid artifact handling
# ---------------------------------------------------------------------------

def test_invalid_artifacts():
    section("aco.py — invalid artifacts handled gracefully")

    with tempfile.TemporaryDirectory() as td:
        session = Path(td)
        write_config(session)
        run_aco(session, "init")
        run_aco(session, "select", "--iter", "1")

        write_ant(session, 1, 1, ["a", "b"])

        artifacts = session / "artifacts"
        (artifacts / "ant-1-2.json").write_text(json.dumps({
            "schema_version": "1.0", "ant_id": "ANT-1-2", "iteration": 1,
            "path": ["a", "ZZZ_NOT_A_NODE"],
            "path_decisions": [{"from": "a", "to": "ZZZ_NOT_A_NODE", "rationale": "x",
                                "guided_by": "x", "deviation_from_hint": False}],
            "self_score": 0.5, "self_confidence": 0.5,
            "evidence": ["x"], "candidate_solution": {"summary": "x"},
        }))

        (artifacts / "ant-1-3.json").write_text("{ malformed json")

        up = run_aco(session, "update", "--iter", "1")
        check("only 1 valid ant processed (2 rejected)",
              up["n_ants_processed"] == 1, f"got {up['n_ants_processed']}")


def test_config_validation():
    section("aco.py — config validation error paths")

    with tempfile.TemporaryDirectory() as td:
        session = Path(td)
        session.mkdir(exist_ok=True)
        (session / "swarm-config.json").write_text(json.dumps({"task_space": {}, "aco": {}}))
        r = run_aco(session, "init", expect_exit=2)
        check("missing nodes -> exit 2", r["status"] == "error")
        check("error message mentions nodes",
              "nodes" in r["message"] or "auto_discover" in r["message"])

    with tempfile.TemporaryDirectory() as td:
        session = Path(td)
        session.mkdir(exist_ok=True)
        r = run_aco(session, "init", expect_exit=2)
        check("missing config -> exit 2", r["status"] == "error")


def test_idempotent_update():
    section("aco.py — update is idempotent (re-running same iter is safe)")

    with tempfile.TemporaryDirectory() as td:
        session = Path(td)
        write_config(session, {"aco": {"rho": 0.0}})
        run_aco(session, "init")
        run_aco(session, "select", "--iter", "1")
        write_ant(session, 1, 1, ["a", "b"], 0.8, 0.8)
        write_ant(session, 1, 2, ["b", "c"], 0.6, 0.7)
        write_ant(session, 1, 3, ["c", "d"], 0.4, 0.5)

        up1 = run_aco(session, "update", "--iter", "1")
        up2 = run_aco(session, "update", "--iter", "1")
        check("update re-run keeps n_ants_processed stable",
              up1["n_ants_processed"] == up2["n_ants_processed"])
        check("update re-run keeps best ant stable",
              up1["best_score"] == up2["best_score"])


def test_auto_discover_from_glob():
    section("aco.py — auto_discover_from glob")

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        for name in ["alpha.txt", "beta.txt", "gamma.txt"]:
            (td_path / name).write_text("data")

        session = td_path / "session"
        session.mkdir()
        (session / "swarm-config.json").write_text(json.dumps({
            "swarm": {"n_ants": 2}, "aco": {},
            "task_space": {"auto_discover_from": str(td_path / "*.txt"),
                           "max_path_length": 2},
            "scoring": {"mode": "fallback"},
            "ant_prompt": {"objective": "x"},
            "convergence": {"max_iterations": 1},
        }))
        r = run_aco(session, "init")
        check("auto_discover finds 3 files", r["n_nodes"] == 3,
              f"got {r['n_nodes']}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("team-swarm scripts test suite")
    print("=" * 60)

    test_pheromone_unit()
    test_scoring_unit()
    test_full_pipeline_3_iterations()
    test_target_score_convergence()
    test_hallucination_flagging()
    test_invalid_artifacts()
    test_config_validation()
    test_idempotent_update()
    test_auto_discover_from_glob()

    print("\n" + "=" * 60)
    print(f"Results: {PASS} passed, {FAIL} failed")
    if FAILED_NAMES:
        print("\nFailed tests:")
        for name in FAILED_NAMES:
            print(f"  - {name}")
    print("=" * 60)
    sys.exit(0 if FAIL == 0 else 1)


if __name__ == "__main__":
    main()
