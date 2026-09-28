import type { RobotInfo } from '../../core/types';

/** Where the registry fetches the policy weights from (relative to the site root, like the models). */
export const G1_POLICY_PATH = 'policies/g1_walk.json';

export const G1_INFO: RobotInfo = {
  id: 'g1',
  name: 'Unitree G1',
  maker: 'Unitree Robotics (Hangzhou, China)',
  kind: 'humanoid',
  modelDir: 'models/g1',
  mjcf: 'g1_12dof.xml',
  baseBody: 'pelvis',
  // Each foot touches the ground through four small spheres (heel and toe corners) on the ankle roll link.
  feet: ['left_ankle_roll_link', 'right_ankle_roll_link'],
  maxCommand: { vx: 0.8, vy: 0.4, yawRate: 1.0 },
  fallHeight: 0.5,
  fallTilt: 0.8,
  blurb:
    'The Unitree G1 is a humanoid robot about 1.3 m tall that weighs about 35 kg, made by Unitree Robotics in ' +
    'Hangzhou, China. Here it walks with the 12 motors in its legs: three at each hip, one at each knee and two at ' +
    'each ankle, while its arms are held still. Fifty times a second a small neural network, trained by Unitree ' +
    'in simulation with reinforcement learning, reads the robot\'s balance sensor and joint angles and decides ' +
    'where every leg joint should go. Five hundred times a second each motor pushes its joint toward that target, ' +
    'like a stiff spring with a shock absorber.',
};
