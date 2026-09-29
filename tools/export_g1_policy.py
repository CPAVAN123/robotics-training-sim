"""Export Unitree's pretrained G1 walking policy (TorchScript) to plain JSON weights.

The policy is an LSTM (47 -> 64) followed by an MLP (64 -> 32 -> ELU -> 12). The browser
runs it with a tiny hand-written forward pass (src/robots/g1/policy.ts), so no ML runtime
is needed on the web page.

Usage:
    python3 tools/export_g1_policy.py path/to/unitree_rl_gym/deploy/pre_train/g1/motion.pt
"""
import json
import sys
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parent.parent


def main(src: str) -> None:
    policy = torch.jit.load(src)
    sd = {k: v.detach().cpu().numpy() for k, v in policy.state_dict().items()}
    out = {
        "source": "unitreerobotics/unitree_rl_gym deploy/pre_train/g1/motion.pt (BSD-3-Clause)",
        "architecture": "LSTM(47->64, gates i,f,g,o) + Linear(64->32) + ELU + Linear(32->12)",
        "num_obs": 47,
        "num_actions": 12,
        "hidden": 64,
        "lstm": {
            "weight_ih": sd["memory.weight_ih_l0"].round(7).tolist(),
            "weight_hh": sd["memory.weight_hh_l0"].round(7).tolist(),
            "bias_ih": sd["memory.bias_ih_l0"].round(7).tolist(),
            "bias_hh": sd["memory.bias_hh_l0"].round(7).tolist(),
        },
        "actor": [
            {"weight": sd["actor.0.weight"].round(7).tolist(), "bias": sd["actor.0.bias"].round(7).tolist()},
            {"weight": sd["actor.2.weight"].round(7).tolist(), "bias": sd["actor.2.bias"].round(7).tolist()},
        ],
    }
    dst = ROOT / "public" / "policies" / "g1_walk.json"
    dst.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {dst} ({dst.stat().st_size / 1024:.0f} KiB)")


if __name__ == "__main__":
    main(sys.argv[1])
