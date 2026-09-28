import type { RobotInfo } from '../../core/types';

export const GO2_INFO: RobotInfo = {
  id: 'go2',
  name: 'Unitree Go2',
  maker: 'Unitree Robotics (Hangzhou, China)',
  kind: 'quadruped',
  modelDir: 'models/go2',
  mjcf: 'go2.xml',
  baseBody: 'base',
  feet: ['FL', 'FR', 'RL', 'RR'],
  // Measured with tools/go2_gait_lab.py: tracked within ~10% even with every Physics Lab knob at
  // its hardest test setting (noise 1, friction 0.4, +3 kg, 70% motors).
  maxCommand: { vx: 1.0, vy: 0.4, yawRate: 1.5 },
  // Standing, the base is about 0.29 m up; lying on its side or back it is below 0.15 m. Hard
  // shoves can tip it past 1 rad and it may still recover; past 1.3 rad it is going over.
  fallHeight: 0.15,
  fallTilt: 1.3,
  blurb:
    'The Unitree Go2 is a robot dog made by Unitree Robotics in Hangzhou, China. It weighs about ' +
    '15 kg and is used by researchers and in classrooms. Each leg has three motors: one swings ' +
    'the leg out to the side, one swings it forward and back, and one bends the knee. Here it ' +
    'trots: diagonal legs step together, a balance controller decides how hard each foot pushes ' +
    'on the ground, and every step lands a little ahead of the body so the robot keeps catching ' +
    'itself, just like you do when you walk.',
};
