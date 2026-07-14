"""Pheromone matrix module - state representation, update, evaporation.

Format spec: ../specs/pheromone-schema.md
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional


def edge_key(a: str, b: str) -> str:
    """Lexically-ordered edge key (undirected)."""
    return f"{a}::{b}" if a <= b else f"{b}::{a}"


@dataclass
class PheromoneState:
    iteration: int = 0
    n_nodes: int = 0
    matrix_type: str = "edge_weighted_sparse"
    tau: Dict[str, float] = field(default_factory=dict)
    node_tau: Dict[str, float] = field(default_factory=dict)
    metadata: Dict[str, float] = field(default_factory=dict)

    @classmethod
    def initialize(cls, nodes: List[str], aco_config: dict) -> "PheromoneState":
        tau_init = aco_config.get("tau_init", 1.0)
        tau = {}
        for i, a in enumerate(nodes):
            for b in nodes[i + 1:]:
                tau[edge_key(a, b)] = tau_init
        return cls(
            iteration=0,
            n_nodes=len(nodes),
            tau=tau,
            node_tau={n: tau_init for n in nodes},
            metadata={
                "alpha": aco_config.get("alpha", 1.0),
                "beta": aco_config.get("beta", 2.0),
                "rho": aco_config.get("rho", 0.2),
                "q": aco_config.get("q", 1.0),
                "tau_init": tau_init,
                "tau_min": aco_config.get("tau_min", 0.01),
                "tau_max": aco_config.get("tau_max", 10.0),
            },
        )

    def evaporate(self) -> None:
        rho = self.metadata["rho"]
        for k in list(self.tau.keys()):
            self.tau[k] = max(self.metadata["tau_min"], (1 - rho) * self.tau[k])

    def deposit(self, path: List[str], score: float) -> None:
        q = self.metadata["q"]
        delta = q * score
        for a, b in zip(path[:-1], path[1:]):
            k = edge_key(a, b)
            self.tau[k] = self.tau.get(k, self.metadata["tau_init"]) + delta
        for node in path:
            self.node_tau[node] = self.node_tau.get(node, self.metadata["tau_init"]) + delta * 0.5

    def clip(self) -> None:
        lo, hi = self.metadata["tau_min"], self.metadata["tau_max"]
        for k in self.tau:
            self.tau[k] = max(lo, min(hi, self.tau[k]))
        for n in self.node_tau:
            self.node_tau[n] = max(lo, min(hi, self.node_tau[n]))

    def stats(self) -> Dict[str, float]:
        if not self.tau:
            return {"mean": 0.0, "max": 0.0, "min": 0.0, "entropy": 0.0, "n_edges_active": 0}
        vals = list(self.tau.values())
        total = sum(vals)
        active = [v for v in vals if v > self.metadata["tau_min"] * 1.01]
        entropy = 0.0
        if total > 0:
            for v in vals:
                p = v / total
                if p > 0:
                    entropy -= p * math.log2(p)
        return {
            "mean": sum(vals) / len(vals),
            "max": max(vals),
            "min": min(vals),
            "entropy": entropy,
            "n_edges_active": len(active),
        }

    def to_dict(self) -> dict:
        return {
            "version": "1.0",
            "iteration": self.iteration,
            "n_nodes": self.n_nodes,
            "matrix_type": self.matrix_type,
            "tau": self.tau,
            "node_tau": self.node_tau,
            "metadata": self.metadata,
            "stats": self.stats(),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "PheromoneState":
        return cls(
            iteration=d["iteration"],
            n_nodes=d["n_nodes"],
            matrix_type=d.get("matrix_type", "edge_weighted_sparse"),
            tau=d.get("tau", {}),
            node_tau=d.get("node_tau", {}),
            metadata=d["metadata"],
        )

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> "PheromoneState":
        return cls.from_dict(json.loads(path.read_text(encoding="utf-8")))

    def select_neighbors(
        self,
        current: str,
        candidates: List[str],
        heuristic: Optional[Dict[str, float]] = None,
    ) -> Dict[str, float]:
        """Return probability distribution over candidates given current node."""
        alpha = self.metadata["alpha"]
        beta = self.metadata["beta"]
        heuristic = heuristic or {}
        weights = {}
        for c in candidates:
            if c == current:
                continue
            tau_val = self.tau.get(edge_key(current, c), self.metadata["tau_init"])
            eta = heuristic.get(c, 1.0)
            weights[c] = (tau_val ** alpha) * (eta ** beta)
        total = sum(weights.values())
        if total == 0:
            n = len(weights)
            return {c: 1.0 / n for c in weights} if n else {}
        return {c: w / total for c, w in weights.items()}
