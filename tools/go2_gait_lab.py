"""Go2 trot-gait lab: the Python twin of src/robots/go2 (same algorithm, same gains).

MuJoCo in Python runs about 40x faster than real time, so the gait is tuned here first and
then ported line by line to TypeScript. The acceptance battery printed by this script is the
reference the TypeScript tests (tests/unit/go2Gait.test.ts) are compared against.

Usage:
    python3 tools/go2_gait_lab.py                  # acceptance battery (10 s runs)
    python3 tools/go2_gait_lab.py --only fwd,turn  # some scenarios
    python3 tools/go2_gait_lab.py --pushes         # strongest survivable 0.1 s push per direction
    python3 tools/go2_gait_lab.py --fuzz 24        # random full-stick driving, 20 s per seed
    python3 tools/go2_gait_lab.py --set "kv=5, period=0.3"   # try other gains
"""
import argparse
import math
from dataclasses import dataclass
from multiprocessing import Pool
from pathlib import Path

import mujoco
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MJCF = ROOT / "public" / "models" / "go2" / "go2.xml"
SIM_DT = 0.002

# ---- Robot constants (go2.xml) --------------------------------------------------------------
# Hip (abduction) joint positions in the base frame, legs in actuator order FL, FR, RL, RR.
HIP_POS = np.array([[0.1934, 0.0465, 0], [0.1934, -0.0465, 0], [-0.1934, 0.0465, 0], [-0.1934, -0.0465, 0]])
SIDE = np.array([1.0, -1.0, 1.0, -1.0])  # +1 for left legs
HIP_LEN, THIGH_LEN, CALF_LEN, FOOT_RADIUS = 0.0955, 0.213, 0.213, 0.022
MASS = 15.2  # whole robot, kg
COM = np.array([-0.002, 0.0, -0.021])  # whole-robot centre of mass in the base frame (standing)
INERTIA = np.array([0.17, 0.48, 0.54])  # about the CoM, standing (kg·m²)
TORQUE_LIMIT = np.tile([23.7, 23.7, 45.43], 4)
KNEE_RANGE = (-2.7, -0.85)
G = 9.81
# Pair A = FL + RR, pair B = FR + RL (diagonal trot).
LEG_OFFSET = np.array([0.0, 0.5, 0.5, 0.0])

# Uniform sensor-noise half-widths per unit of knobs.sensorNoise (src/robots/noise.ts), plus the velocity estimator.
NOISE_GYRO, NOISE_GRAVITY, NOISE_Q, NOISE_QD, NOISE_VEL = 0.2, 0.05, 0.01, 1.5, 0.1


@dataclass
class Gains:
    period: float = 0.36
    duty: float = 0.5
    height: float = 0.30  # base origin above the ground
    clearance: float = 0.07
    raibert_k: float = 0.12  # s: extra step per m/s of velocity error
    max_step: tuple = (0.16, 0.12)  # |foot offset| from the shoulder, m
    kp_swing: tuple = (40.0, 40.0, 40.0)
    kd_swing: tuple = (1.0, 1.0, 1.0)
    kp_stance: tuple = (20.0, 20.0, 20.0)
    kd_stance: tuple = (0.8, 0.8, 0.8)
    kp_height: float = 150.0  # 1/s²
    kd_height: float = 20.0  # 1/s
    kp_att: float = 300.0  # 1/s²
    kd_att: float = 30.0  # 1/s
    kd_yaw: float = 40.0  # 1/s
    kv: float = 3.0  # horizontal velocity tracking, 1/s
    mu: float = 0.4  # friction the balance controller assumes
    accel: tuple = (1.0, 0.7, 1.5)  # command slew limits: m/s², m/s², rad/s²
    att_tau: float = 0.05  # IMU complementary-filter time constant, s
    vel_tau: float = 0.03  # velocity-estimate low-pass, s
    touchdown_depth: float = 0.01  # swing aims this far below the expected ground
    step_trigger: float = 0.25  # m/s of unexpected velocity that makes a standing robot step
    motor_damping: float = 2.0  # N·m·s/rad of gearbox drag the controller feeds forward
    lean: float = 1.0  # fraction of the centripetal lean h·a/g applied to foot placement
    hip_speed: float = 1.6  # fastest a shoulder may move over the ground at full motor strength, m/s


# ---- Kinematics -----------------------------------------------------------------------------
def leg_fk(q, side):
    """Foot centre relative to the hip joint, base frame."""
    q0, q1, q2 = q
    x = -THIGH_LEN * math.sin(q1) - CALF_LEN * math.sin(q1 + q2)
    z = -THIGH_LEN * math.cos(q1) - CALF_LEN * math.cos(q1 + q2)
    y = side * HIP_LEN
    c, s = math.cos(q0), math.sin(q0)
    return np.array([x, y * c - z * s, y * s + z * c])


def leg_jacobian(q, side):
    q0, q1, q2 = q
    x = -THIGH_LEN * math.sin(q1) - CALF_LEN * math.sin(q1 + q2)
    z = -THIGH_LEN * math.cos(q1) - CALF_LEN * math.cos(q1 + q2)
    y = side * HIP_LEN
    c, s = math.cos(q0), math.sin(q0)
    dx2, dz2 = -CALF_LEN * math.cos(q1 + q2), CALF_LEN * math.sin(q1 + q2)
    return np.array([
        [0.0, z, dx2],
        [-(y * s + z * c), -s * -x, -s * dz2],
        [y * c - z * s, c * -x, c * dz2],
    ])


def leg_ik(p, side):
    px, py, pz = p
    zl = -math.sqrt(max(py * py + pz * pz - HIP_LEN * HIP_LEN, 1e-6))
    q0 = math.atan2(pz, py) - math.atan2(zl, side * HIP_LEN)
    q0 = (q0 + math.pi) % (2 * math.pi) - math.pi
    c2 = (px * px + zl * zl - THIGH_LEN ** 2 - CALF_LEN ** 2) / (2 * THIGH_LEN * CALF_LEN)
    q2 = min(max(-math.acos(min(max(c2, -1.0), 1.0)), KNEE_RANGE[0]), KNEE_RANGE[1])
    q1 = math.atan2(-px, -zl) - math.atan2(CALF_LEN * math.sin(q2), THIGH_LEN + CALF_LEN * math.cos(q2))
    return np.array([q0, q1, q2])


def level_rotation(g):
    """Rotation from the base frame to the level heading frame, from the measured gravity direction."""
    pitch = math.asin(min(max(g[0], -1.0), 1.0))
    roll = math.atan2(-g[1], -g[2])
    cr, sr, cp, sp = math.cos(roll), math.sin(roll), math.cos(pitch), math.sin(pitch)
    ry = np.array([[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]])
    rx = np.array([[1, 0, 0], [0, cr, -sr], [0, sr, cr]])
    return ry @ rx, roll, pitch


def skew(r):
    return np.array([[0, -r[2], r[1]], [r[2], 0, -r[0]], [-r[1], r[0], 0]])


# ---- Controller -----------------------------------------------------------------------------
class Go2Controller:
    def __init__(self, gains=None):
        self.k = gains or Gains()
        self.reset()

    def reset(self):
        k = self.k
        self.g = np.array([0.0, 0.0, -1.0])
        self.v = np.zeros(3)
        self.cmd = np.zeros(3)
        self.stepping = False
        self.phase = 0.0
        self.quiet = 0.0
        self.in_swing = np.zeros(4, dtype=bool)
        self.landed = np.zeros(4, dtype=bool)  # foot touched down before its swing time ran out
        self.swing_start = np.zeros((4, 3))
        self.swing_travel = np.zeros((4, 2))  # how far each shoulder moved since lift-off
        shoulder = HIP_POS + np.outer(SIDE, [0, HIP_LEN, 0])
        self.stance_ref = shoulder.copy()
        self.stance_ref[:, 2] = -(k.height - FOOT_RADIUS)
        self.torque = np.zeros(12)

    def step(self, sensors, command, strength):
        k, dt = self.k, SIM_DT
        gyro, g_meas, v_meas, q, qd, contact = sensors

        # IMU attitude: integrate the gyro, pull slowly towards the measured gravity direction.
        self.g = self.g - dt * np.cross(gyro, self.g)
        self.g += (dt / k.att_tau) * (g_meas / np.linalg.norm(g_meas) - self.g)
        self.g /= np.linalg.norm(self.g)
        R, roll, pitch = level_rotation(self.g)
        self.v += (dt / k.vel_tau) * (v_meas - self.v)
        v = R @ self.v
        w = R @ gyro

        # Speed governor: swing feet move at about twice the shoulder speed, and weaker motors
        # can't swing them as fast, so scale the whole command down if a shoulder would be too quick.
        shoulder_b = HIP_POS + np.outer(SIDE, [0, HIP_LEN, 0])
        fastest = max(math.hypot(command[0] - command[2] * y, command[1] + command[2] * x) for x, y, _ in shoulder_b)
        scale = min(1.0, k.hip_speed * strength / fastest) if fastest > 0 else 1.0
        for i in range(3):
            lim = k.accel[i] * dt
            self.cmd[i] += min(max(command[i] * scale - self.cmd[i], -lim), lim)
        cmd = self.cmd
        v_cmd = np.array([cmd[0], cmd[1], 0.0])
        w_cmd = np.array([0.0, 0.0, cmd[2]])

        # Gait scheduler: trot while asked to move or knocked off balance; stand still otherwise.
        moving = abs(cmd[0]) > 0.02 or abs(cmd[1]) > 0.02 or abs(cmd[2]) > 0.05
        disturbed = np.linalg.norm(v[:2] - v_cmd[:2]) > k.step_trigger or abs(roll) + abs(pitch) > 0.25
        if not self.stepping and (moving or disturbed):
            self.stepping = True
            self.phase = k.duty  # pair A lifts first
            self.quiet = 0.0
        swing_s = np.zeros(4)
        stance = np.ones(4, dtype=bool)
        if self.stepping:
            calm = not moving and np.linalg.norm(v[:2]) < 0.1 and abs(w[2]) < 0.2
            self.quiet = self.quiet + dt if calm else 0.0
            prev = self.phase
            self.phase = (self.phase + dt / k.period) % 1.0
            crossed = (prev < k.duty <= self.phase) or self.phase < prev
            if self.quiet > 0.5 and crossed:
                self.stepping = False
        for i in range(4):
            psi = (self.phase + LEG_OFFSET[i]) % 1.0
            if not self.stepping or psi < k.duty:
                self.landed[i] = False
                continue
            swing_s[i] = (psi - k.duty) / (1.0 - k.duty)
            # A foot that meets the ground on its way down is treated as landed straight away.
            self.landed[i] |= contact[i] and swing_s[i] > 0.5
            stance[i] = self.landed[i]

        t_stance = k.period * k.duty
        t_swing = k.period - t_stance

        # Feet in the level heading frame (origin at the base, x forward, z up).
        qs = q.reshape(4, 3)
        feet_b = np.array([HIP_POS[i] + leg_fk(qs[i], SIDE[i]) for i in range(4)])
        feet = feet_b @ R.T
        jac = [leg_jacobian(qs[i], SIDE[i]) for i in range(4)]
        shoulder = (HIP_POS + np.outer(SIDE, [0, HIP_LEN, 0])) @ R.T
        ground_z = -(k.height - FOOT_RADIUS)

        # Leg phase transitions.
        for i in range(4):
            if not stance[i] and not self.in_swing[i]:
                self.swing_start[i] = feet[i]
                self.swing_travel[i] = 0.0
            if stance[i] and self.in_swing[i]:
                self.stance_ref[i] = feet[i]
            self.in_swing[i] = not stance[i]

        # Balance: desired force and moment on the body, shared among stance feet.
        idx = [i for i in range(4) if stance[i]]
        height = FOOT_RADIUS - np.mean(feet[idx, 2])
        # Turning while moving needs a sideways (centripetal) push: a = ω × v.
        force = MASS * np.array([
            k.kv * (cmd[0] - v[0]) - cmd[2] * cmd[1],
            k.kv * (cmd[1] - v[1]) + cmd[2] * cmd[0],
            G + k.kp_height * (k.height - height) - k.kd_height * v[2],
        ])
        moment = INERTIA * np.array([
            -k.kp_att * roll - k.kd_att * w[0],
            -k.kp_att * pitch - k.kd_att * w[1],
            k.kd_yaw * (cmd[2] - w[2]),
        ])
        grf = self.distribute(feet[idx] - R @ COM, force, moment)

        tau = np.zeros(12)
        for n, i in enumerate(idx + [i for i in range(4) if not stance[i]]):
            sl = slice(3 * i, 3 * i + 3)
            if stance[i]:
                ref_vel = -(v_cmd + np.cross(w_cmd, self.stance_ref[i]))
                self.stance_ref[i] += ref_vel * dt
                target = np.array([self.stance_ref[i][0], self.stance_ref[i][1], ground_z])
                target_vel = np.array([ref_vel[0], ref_vel[1], 0.0])
                kp, kd = np.array(k.kp_stance), np.array(k.kd_stance)
            else:
                # Raibert: land half a stance ahead of the shoulder's motion, plus a correction
                # proportional to the velocity error so steps catch the body.
                hip_v = v + np.cross([0.0, 0.0, w[2]], shoulder[i])
                hip_v_cmd = v_cmd + np.cross(w_cmd, shoulder[i])
                step = hip_v[:2] * t_stance / 2 + k.raibert_k * (hip_v[:2] - hip_v_cmd[:2])
                # ...and lean into turns: land on the outside so the legs can push the body inwards.
                step += k.lean * k.height / G * cmd[2] * np.array([v[1], -v[0]])
                step = np.clip(step, -np.array(k.max_step), k.max_step)
                # The swing curve is planned on the ground (lift-off spot to landing spot) so the
                # foot leaves and lands with zero speed relative to the floor, not to the body.
                s = swing_s[i]
                self.swing_travel[i] += hip_v[:2] * dt
                start = self.swing_start[i]
                end = np.array([
                    shoulder[i][0] + step[0] + self.swing_travel[i][0] + hip_v[0] * (1 - s) * t_swing,
                    shoulder[i][1] + step[1] + self.swing_travel[i][1] + hip_v[1] * (1 - s) * t_swing,
                    ground_z - k.touchdown_depth,
                ])
                cyc = s - math.sin(2 * math.pi * s) / (2 * math.pi)
                dcyc = (1 - math.cos(2 * math.pi * s)) / t_swing
                target = start + (end - start) * cyc
                target[:2] -= self.swing_travel[i]
                target[2] += k.clearance * (1 - math.cos(2 * math.pi * s)) / 2
                target_vel = (end - start) * dcyc
                target_vel[:2] -= hip_v[:2]
                target_vel[2] += k.clearance * math.pi * math.sin(2 * math.pi * s) / t_swing
                kp, kd = np.array(k.kp_swing), np.array(k.kd_swing)
            q_des = leg_ik(R.T @ target - HIP_POS[i], SIDE[i])
            J = jac[i]
            qd_des = np.linalg.solve(J, R.T @ target_vel) if abs(np.linalg.det(J)) > 1e-5 else np.zeros(3)
            tau[sl] = kp * strength * (q_des - qs[i]) + kd * (qd_des - qd[sl]) + k.motor_damping * qd_des
            if stance[i]:
                tau[sl] -= J.T @ (R.T @ grf[n])
        limit = TORQUE_LIMIT * strength
        self.torque = np.clip(tau, -limit, limit)
        return self.torque

    def distribute(self, r, force, moment):
        """Smallest ground forces at the stance feet (positions r from the CoM) that give the
        wanted total force and moment on the body."""
        n = len(r)
        if n == 2:
            # Two feet can't twist the body about the line joining them: that moment is fixed
            # by the total force, so ask only for what is physically possible.
            u = (r[0] - r[1]) / np.linalg.norm(r[0] - r[1])
            moment = moment + (np.dot(np.cross(u, r[0]), force) - np.dot(moment, u)) * u
        A = np.zeros((6, 3 * n))
        for j in range(n):
            A[0:3, 3 * j:3 * j + 3] = np.eye(3)
            A[3:6, 3 * j:3 * j + 3] = skew(r[j])
        y = np.linalg.solve(A @ A.T + 1e-4 * np.eye(6), np.concatenate([force, moment]))
        f = (A.T @ y).reshape(n, 3)
        for j in range(n):
            f[j, 2] = max(f[j, 2], 0.0)
            t = np.linalg.norm(f[j, :2])
            if t > self.k.mu * f[j, 2]:
                f[j, :2] *= self.k.mu * f[j, 2] / t
        return f


# ---- Simulation harness ---------------------------------------------------------------------
@dataclass
class Knobs:
    friction: float = 1.0
    payload: float = 0.0
    strength: float = 1.0
    noise: float = 0.0


def build_model(knobs):
    spec = mujoco.MjSpec.from_file(str(MJCF))
    floor = spec.worldbody.add_geom()
    floor.name, floor.type, floor.size = "floor", mujoco.mjtGeom.mjGEOM_PLANE, [0, 0, 0.05]
    m = spec.compile()
    m.opt.timestep = SIM_DT
    m.geom_friction[:, 0] = knobs.friction
    base = m.body("base").id
    if knobs.payload:
        scale = (m.body_mass[base] + knobs.payload) / m.body_mass[base]
        m.body_mass[base] += knobs.payload
        m.body_inertia[base] *= scale
    # Same as the browser Simulation: refresh mass-derived constants after changing the payload.
    mujoco.mj_setConst(m, mujoco.MjData(m))
    return m


def quat_to_mat(qw):
    R = np.zeros(9)
    mujoco.mju_quat2Mat(R, qw)
    return R.reshape(3, 3)


def run(cmd_fn, seconds, knobs=Knobs(), pushes=(), gains=None, seed=0, trace=None):
    """Steps the controller on a flat floor from the "home" keyframe.

    pushes: [(t_start, force_N, direction_rad_world, duration_s)].
    trace: optional list that gets (t, x, y, z, tilt, stepping, v_forward, v_left) every 50 ms.
    """
    m = build_model(knobs)
    d = mujoco.MjData(m)
    mujoco.mj_resetDataKeyframe(m, d, 0)
    mujoco.mj_forward(m, d)
    base = m.body("base").id
    feet = [m.geom(n).id for n in ("FL", "FR", "RL", "RR")]
    ctrl = Go2Controller(gains)
    rng = np.random.default_rng(seed)

    def noise(amplitude: float, n: int) -> np.ndarray:
        return rng.uniform(-amplitude, amplitude, n)

    prev_yaw = yaw_of(d.qpos[3:7])
    heading, min_z, max_tilt, fell_at = 0.0, 10.0, 0.0, None
    while d.time < seconds - 1e-9:
        R = quat_to_mat(d.qpos[3:7])
        k = knobs.noise
        sensors = (
            d.qvel[3:6] + noise(NOISE_GYRO * k, 3),
            R.T @ np.array([0, 0, -1.0]) + noise(NOISE_GRAVITY * k, 3),
            R.T @ d.qvel[0:3] + noise(NOISE_VEL * k, 3),
            d.qpos[7:] + noise(NOISE_Q * k, 12),
            d.qvel[6:] + noise(NOISE_QD * k, 12),
            foot_contacts(d, feet),
        )
        d.ctrl[:] = ctrl.step(sensors, cmd_fn(d.time), knobs.strength)
        d.xfrc_applied[base, :] = 0
        for t0, f, a, dur in pushes:
            if t0 <= d.time < t0 + dur:
                d.xfrc_applied[base, 0:3] = [f * math.cos(a), f * math.sin(a), 0]
        mujoco.mj_step(m, d)
        yaw = yaw_of(d.qpos[3:7])
        heading += (yaw - prev_yaw + math.pi) % (2 * math.pi) - math.pi
        prev_yaw = yaw
        tilt = math.acos(min(1.0, quat_to_mat(d.qpos[3:7])[2, 2]))
        min_z, max_tilt = min(min_z, d.qpos[2]), max(max_tilt, tilt)
        if fell_at is None and (d.qpos[2] < FALL_HEIGHT or tilt > FALL_TILT):
            fell_at = d.time
        if trace is not None and round(d.time / SIM_DT) % 25 == 0:
            trace.append((d.time, *d.qpos[:3], tilt, ctrl.stepping, *(R.T @ d.qvel[:3])[:2]))
    v_body = quat_to_mat(d.qpos[3:7]).T @ d.qvel[0:3]
    return {
        "x": d.qpos[0], "y": d.qpos[1], "z": d.qpos[2], "heading": heading, "min_z": min_z,
        "max_tilt": max_tilt, "fell_at": fell_at, "stepping": ctrl.stepping,
        "speed": float(np.linalg.norm(v_body[:2])),
    }


FALL_HEIGHT, FALL_TILT = 0.15, 1.3  # GO2_INFO.fallHeight, fallTilt


def foot_contacts(d, feet):
    """Foot contact switches: True for each foot geom touching anything."""
    touching = [False] * 4
    for c in d.contact[: d.ncon]:
        for g in (c.geom1, c.geom2):
            if g in feet:
                touching[feet.index(g)] = True
    return touching


def yaw_of(q):
    w, x, y, z = q
    return math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


def const(vx=0.0, vy=0.0, wz=0.0, until=1e9):
    return lambda t: (vx, vy, wz) if t < until else (0.0, 0.0, 0.0)


SCENARIOS = {
    "stand": (const(), Knobs()),
    "fwd": (const(0.5), Knobs()),
    "fast": (const(1.0), Knobs()),
    "back": (const(-0.3), Knobs()),
    "side": (const(0, 0.2), Knobs()),
    "turn": (const(0, 0, 0.8), Knobs()),
    "stop": (const(0.5, until=5.0), Knobs()),
    "noise": (const(0.5), Knobs(noise=1.0)),
    "ice": (const(0.5), Knobs(friction=0.4)),
    "payload": (const(0.5), Knobs(payload=3.0)),
    "weak": (const(0.5), Knobs(strength=0.7)),
    "all": (const(0.5), Knobs(noise=1.0, friction=0.4, payload=3.0, strength=0.7)),
}


def report(name, r):
    fell = f"FELL@{r['fell_at']:.2f}s" if r["fell_at"] is not None else "ok"
    print(f"{name:8s} x={r['x']:6.2f} y={r['y']:6.2f} heading={r['heading']:6.2f} z={r['z']:.3f} "
          f"min_z={r['min_z']:.3f} tilt={r['max_tilt']:.2f} speed={r['speed']:.2f} "
          f"stepping={int(r['stepping'])} {fell}")


# "From the front" means the force points backwards.
PUSH_DIRECTIONS = {"front": math.pi, "back": 0.0, "side": math.pi / 2}
PUSH_MODES = {"standing": (0.0, 0.0, 0.0), "trotting": (0.5, 0.0, 0.0)}


def max_push(mode, direction, overrides):
    """Largest 0.1 s shove (30 N steps, like the TypeScript test) survived, pushed at t = 2 s."""
    cmd = PUSH_MODES[mode]
    best = 0
    for f in range(30, 601, 30):
        r = run(lambda t: cmd, 4.0, pushes=[(2.0, f, PUSH_DIRECTIONS[direction], 0.1)], gains=Gains(**overrides))
        if r["fell_at"] is not None:
            break
        best = f
    return best


HARDEST = Knobs(noise=1.0, friction=0.4, payload=3.0, strength=0.7)
MAX_COMMAND = np.array([1.0, 0.4, 1.5])  # GO2_INFO.maxCommand


def random_driving(seed):
    """Keyboard-like driving: a new command every 0.3-2 s, often full stick, often combined."""
    rng = np.random.default_rng(seed)
    times, cmds, t = [], [], 0.0
    while t < 20.0:
        c = rng.uniform(-1, 1, 3) * MAX_COMMAND
        c[rng.random(3) < 0.4] = 0.0
        if rng.random() < 0.3:
            c = np.sign(c) * MAX_COMMAND
        times.append(t)
        cmds.append(tuple(c))
        t += rng.uniform(0.3, 2.0)
    return lambda t: cmds[int(np.searchsorted(times, t, side="right")) - 1]


def fuzz_run(seed, hardest, overrides):
    r = run(random_driving(seed), 20.0, HARDEST if hardest else Knobs(), seed=seed, gains=Gains(**overrides))
    return r["fell_at"]


def run_scenario(name, overrides):
    cmd, knobs = SCENARIOS[name]
    return run(cmd, 10.0, knobs, gains=Gains(**overrides))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated scenario names")
    ap.add_argument("--pushes", action="store_true")
    ap.add_argument("--fuzz", type=int, metavar="SEEDS")
    ap.add_argument("--set", default="", help='gain overrides, e.g. "kv=5, accel=(1, 1, 2)"')
    args = ap.parse_args()
    overrides = eval(f"dict({args.set})")
    with Pool(3) as pool:
        if args.pushes:
            jobs = [(m, d, overrides) for m in PUSH_MODES for d in PUSH_DIRECTIONS]
            for (mode, direction, _), best in zip(jobs, pool.starmap(max_push, jobs)):
                print(f"push {mode:8s} from {direction:5s}: survives {best} N for 0.1 s")
        elif args.fuzz:
            for hardest in (False, True):
                falls = pool.starmap(fuzz_run, [(s, hardest, overrides) for s in range(args.fuzz)])
                fell = [s for s, f in enumerate(falls) if f is not None]
                label = "hardest knobs" if hardest else "default knobs"
                print(f"random driving, {label}: {len(fell)}/{args.fuzz} runs of 20 s fell (seeds {fell})")
        else:
            names = [n for n in SCENARIOS if not args.only or n in args.only.split(",")]
            for name, r in zip(names, pool.starmap(run_scenario, [(n, overrides) for n in names])):
                report(name, r)


if __name__ == "__main__":
    main()
