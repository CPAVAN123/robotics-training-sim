import type { RobotInfo } from '../../core/types';

// PLACEHOLDER: owned by the Go2 gait work; values to be confirmed against the model.
export const GO2_INFO: RobotInfo = {
  id: 'go2',
  name: 'Unitree Go2',
  maker: 'Unitree Robotics (Hangzhou, China)',
  kind: 'quadruped',
  modelDir: 'models/go2',
  mjcf: 'go2.xml',
  baseBody: 'base',
  feet: ['FL', 'FR', 'RL', 'RR'],
  maxCommand: { vx: 0.8, vy: 0.3, yawRate: 1.0 },
  fallHeight: 0.15,
  fallTilt: 1.0,
  blurb: 'A four-legged robot dog.',
};
