"""Reference run of the G1 walking policy in Python MuJoCo.

Produces tests/fixtures/g1_golden.json, which the TypeScript unit tests use to check that
the browser policy (src/robots/g1/policy.ts) gives the same actions as PyTorch, and prints
a small locomotion test battery so controller changes can be compared against the original.

Usage:
    python3 tools/g1_reference.py path/to/motion.pt [--torque-limits]
"""
import argparse
import json
from pathlib import Path

import mujoco
import numpy as np
import torch

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "public" / "models" / "g1"

# Values from unitree_rl_gym deploy/deploy_mujoco/configs/g1.yaml
KP = np.array([100, 100, 100, 150, 40, 40, 100, 100, 100, 150, 40, 40], dtype=np.float64)
KD = np.array([2, 2, 2, 4, 2, 2, 2, 2, 2, 4, 2, 2], dtype=np.float64)
DEFAULT = np.array([-0.1, 0, 0, 0.3, -0.2, 0, -0.1, 0, 0, 0.3, -0.2, 0], dtype=np.float64)
# Joint effort limits (N·m) from Unitree's g1_12dof.urdf
TORQUE_LIMIT = np.array([88, 139, 88, 139, 50, 50, 88, 139, 88, 139, 50, 50], dtype=np.float64)
SIM_DT, DECIMATION, GAIT_PERIOD = 0.002, 10, 0.8

SCENE = """<mujoco model="g1 reference">
  <include file="g1_12dof.xml"/>
  <worldbody><geom name="floor" size="0 0 0.05" type="plane"/></worldbody>
</mujoco>"""


def gravity_orientation(q):
    qw, qx, qy, qz = q
    return np.array([2 * (-qz * qx + qw * qy), -2 * (qz * qy + qw * qx), 1 - 2 * (qw * qw + qz * qz)])


def load_model():
    scene = MODEL_DIR / "_reference_scene.xml"
    scene.write_text(SCENE)
    try:
        m = mujoco.MjModel.from_xml_path(str(scene))
    finally:
        scene.unlink()
    m.opt.timestep = SIM_DT
    return m


def run(m, policy, cmd_fn, seconds, torque_limits, record=None):
    d = mujoco.MjData(m)
    policy.hidden_state.zero_()
    policy.cell_state.zero_()
    action = np.zeros(12, dtype=np.float32)
    target = DEFAULT.copy()
    obs = np.zeros(47, dtype=np.float32)
    counter, min_z = 0, 10.0
    while d.time < seconds:
        tau = (target - d.qpos[7:]) * KP - d.qvel[6:] * KD
        if torque_limits:
            tau = np.clip(tau, -TORQUE_LIMIT, TORQUE_LIMIT)
        d.ctrl[:] = tau
        mujoco.mj_step(m, d)
        counter += 1
        if counter % DECIMATION == 0:
            cmd = cmd_fn(d.time)
            phase = (counter * SIM_DT) % GAIT_PERIOD / GAIT_PERIOD
            obs[0:3] = d.qvel[3:6] * 0.25
            obs[3:6] = gravity_orientation(d.qpos[3:7])
            obs[6:9] = cmd * np.array([2.0, 2.0, 0.25])
            obs[9:21] = d.qpos[7:] - DEFAULT
            obs[21:33] = d.qvel[6:] * 0.05
            obs[33:45] = action
            obs[45:47] = [np.sin(2 * np.pi * phase), np.cos(2 * np.pi * phase)]
            with torch.no_grad():
                action = policy(torch.from_numpy(obs).unsqueeze(0)).numpy().squeeze().astype(np.float32)
            if record is not None and len(record) < 100:
                record.append({"obs": obs.astype(float).round(7).tolist(), "action": action.astype(float).round(7).tolist()})
            target = action * 0.25 + DEFAULT
        min_z = min(min_z, d.qpos[2])
    return d.qpos[:3].copy(), min_z


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("policy")
    ap.add_argument("--torque-limits", action="store_true")
    args = ap.parse_args()
    m = load_model()
    policy = torch.jit.load(args.policy)

    record = []
    run(m, policy, lambda t: np.array([0.5, 0.0, 0.0]), 3.0, args.torque_limits, record)
    fixture = ROOT / "tests" / "fixtures" / "g1_golden.json"
    fixture.write_text(json.dumps({"steps": record}))
    print(f"wrote {fixture} with {len(record)} obs/action pairs")

    battery = {
        "stand": lambda t: np.array([0.0, 0.0, 0.0]),
        "forward 0.5": lambda t: np.array([0.5, 0.0, 0.0]),
        "forward 1.0": lambda t: np.array([1.0, 0.0, 0.0]),
        "backward 0.4": lambda t: np.array([-0.4, 0.0, 0.0]),
        "sidestep 0.4": lambda t: np.array([0.0, 0.4, 0.0]),
        "turn": lambda t: np.array([0.3, 0.0, 0.8]),
    }
    for name, fn in battery.items():
        pos, min_z = run(m, policy, fn, 10.0, args.torque_limits)
        print(f"{name:14s} final xy=({pos[0]:6.2f},{pos[1]:6.2f})  min pelvis z={min_z:.3f}  {'FELL' if min_z < 0.5 else 'ok'}")


if __name__ == "__main__":
    main()
