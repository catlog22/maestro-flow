"""Pluggable scoring module.

Two scorer types:
- ScriptScorer: runs user-defined Python rule on ant artifacts (deterministic)
- FallbackScorer: derives effective_score from self_score * self_confidence

LLM scorer is handled by the scorer worker role, not this script.
This module is invoked by aco.py when scoring.mode = "script" or as fallback.

Spec: ../specs/ant-output-schema.md (two-layer scoring)
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Dict, Optional


class BaseScorer:
    def score(self, ant_artifact: dict) -> Optional[float]:  # noqa: ARG002
        raise NotImplementedError


class FallbackScorer(BaseScorer):
    """Used when no verified_scores file exists.

    effective_score = self_score * self_confidence * discount
    """

    def __init__(self, discount: float = 0.5):
        self.discount = discount

    def score(self, ant_artifact: dict) -> float:
        s = ant_artifact.get("self_score", 0.0)
        c = ant_artifact.get("self_confidence", 0.5)
        return s * c * self.discount


class ScriptScorer(BaseScorer):
    """Loads user-defined scoring rule from a Python file.

    The rule file must define: `def score(ant_artifact: dict) -> float`
    Returns a value in [0.0, 1.0].
    """

    def __init__(self, rule_path: Path):
        spec = importlib.util.spec_from_file_location("user_score_rule", rule_path)
        if spec is None or spec.loader is None:
            raise ValueError(f"cannot load scoring rule from {rule_path}")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        if not hasattr(self.module, "score"):
            raise ValueError(f"{rule_path} must define `score(ant_artifact) -> float`")

    def score(self, ant_artifact: dict) -> float:
        v = self.module.score(ant_artifact)
        return max(0.0, min(1.0, float(v)))


def load_verified_scores(scores_file: Path) -> Dict[str, float]:
    """Load pre-computed verified_scores from scorer role output (if exists)."""
    if not scores_file.exists():
        return {}
    data = json.loads(scores_file.read_text(encoding="utf-8"))
    return {
        ant_id: entry["verified_score"]
        for ant_id, entry in data.get("scores", {}).items()
    }


def resolve_score(
    ant_artifact: dict,
    verified_scores: Dict[str, float],
    script_scorer: Optional[ScriptScorer],
    fallback: FallbackScorer,
) -> tuple[float, str]:
    """Return (score, source) using priority: verified > script > fallback."""
    ant_id = ant_artifact.get("ant_id", "")
    if ant_id in verified_scores:
        return verified_scores[ant_id], "verified_llm"
    if script_scorer is not None:
        try:
            return script_scorer.score(ant_artifact), "verified_script"
        except Exception as e:
            print(f"warning: script scorer failed for {ant_id}: {e}")
    return fallback.score(ant_artifact), "fallback_self"


def hallucination_check(self_score: float, verified_score: float, threshold: float = 0.4) -> bool:
    """True if self vs verified divergence exceeds threshold."""
    return abs(self_score - verified_score) > threshold
