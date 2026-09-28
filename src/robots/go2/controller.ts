import type { MjData, MjModel, MotionCommand, PhysicsKnobs, RobotController } from '../../core/types';

// PLACEHOLDER: replaced by the real trot gait controller. Holds the standing pose with PD.
const HOME = [0, 0.9, -1.8, 0, 0.9, -1.8, 0, 0.9, -1.8, 0, 0.9, -1.8];

export function createGo2Controller(): RobotController {
  const torques = new Float64Array(12);
  const torqueLimits = new Float64Array(12);
  return {
    robot: 'go2',
    torques,
    torqueLimits,
    reset(model: MjModel) {
      for (let i = 0; i < 12; i++) torqueLimits[i] = model.actuator_ctrlrange[2 * i + 1];
    },
    step(_model: MjModel, data: MjData, _command: MotionCommand, knobs: PhysicsKnobs) {
      for (let i = 0; i < 12; i++) {
        const lim = torqueLimits[i] * knobs.motorStrength;
        const tau = 60 * (HOME[i] - data.qpos[7 + i]) - 2 * data.qvel[6 + i];
        torques[i] = Math.max(-lim, Math.min(lim, tau));
        data.ctrl[i] = torques[i];
      }
    },
  };
}
