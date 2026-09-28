/**
 * Student-facing robotics and physics text: robot fact cards, the "Explain" panels and the glossary.
 * Numbers quoted here come from the robot models and controllers in src/robots and from Unitree's
 * training configuration (unitree_rl_gym, legged_gym/envs/g1/g1_config.py).
 */
import type { RobotId, RobotInfo } from '../core/types';
import type { ExplainSection } from './types';

export const GRAVITY = 9.81;

export interface RobotFacts {
  kindLabel: string;
  maker: string;
  country: string;
  usedFor: string;
  controlTitle: string;
  controlLine: string;
  /** Mass of the simulated model, kg. */
  modelMassKg: number;
  size: string;
  motors: string;
  /** How often the controller thinks. */
  loop: string;
  /** Names of the motors in actuator order, grouped by leg for the HUD. */
  legs: { name: string; short: string; motors: string[] }[];
  /** Short names of the feet in RobotInfo.feet order. */
  feet: string[];
}

export const ROBOT_FACTS: Record<RobotId, RobotFacts> = {
  g1: {
    kindLabel: 'Humanoid',
    maker: 'Unitree Robotics',
    country: 'China',
    usedFor: 'Research and teaching: labs use it to study walking, balance and robot learning.',
    controlTitle: 'Neural-network policy',
    controlLine: 'a neural network trained by trial and error in simulation decides every leg move.',
    modelMassKg: 32.1,
    size: 'About 1.3 m tall',
    motors: '12 leg motors (the arms are held still here)',
    loop: 'Brain at 50 Hz, motors at 500 Hz',
    legs: [
      { name: 'Left leg', short: 'L', motors: ['Hip pitch', 'Hip roll', 'Hip yaw', 'Knee', 'Ankle pitch', 'Ankle roll'] },
      { name: 'Right leg', short: 'R', motors: ['Hip pitch', 'Hip roll', 'Hip yaw', 'Knee', 'Ankle pitch', 'Ankle roll'] },
    ],
    feet: ['Left', 'Right'],
  },
  go2: {
    kindLabel: 'Robot dog (quadruped)',
    maker: 'Unitree Robotics',
    country: 'China',
    usedFor: 'Research, classrooms and hobbyists; robot dogs like it also inspect factories and sites.',
    controlTitle: 'Model-based trot gait',
    controlLine: 'hand-written physics rules decide how hard each foot pushes and where it steps.',
    modelMassKg: 15.2,
    size: 'About 70 cm long, 40 cm tall',
    motors: '12 motors, 3 per leg',
    loop: 'Controller at 500 Hz',
    legs: [
      { name: 'Front left', short: 'FL', motors: ['Hip (out/in)', 'Thigh', 'Knee'] },
      { name: 'Front right', short: 'FR', motors: ['Hip (out/in)', 'Thigh', 'Knee'] },
      { name: 'Rear left', short: 'RL', motors: ['Hip (out/in)', 'Thigh', 'Knee'] },
      { name: 'Rear right', short: 'RR', motors: ['Hip (out/in)', 'Thigh', 'Knee'] },
    ],
    feet: ['Front left', 'Front right', 'Rear left', 'Rear right'],
  },
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const n0 = (v: number) => Math.round(v).toLocaleString('en');

function motorsSection(robot: RobotInfo): ExplainSection {
  const g1 = robot.id === 'g1';
  return {
    title: 'Joints, motors and torque',
    paragraphs: [
      'A joint is a place where two parts of the robot can rotate against each other, like your knee or hip. ' +
        'Every leg joint has its own electric motor.',
      'A motor twists its joint with a torque (a turning force), measured in newton-metres (N·m). ' +
        'Holding a 100 g apple at the end of a 1 m stick takes about 1 N·m.',
      g1
        ? 'The G1 has 3 motors at each hip (swing forward and back, swing out to the side, twist), 1 at each knee and 2 at each ' +
          'ankle. Its knee motors can make up to 139 N·m and its ankle motors 50 N·m.'
        : 'Each Go2 leg has 3 motors: one swings the leg out to the side, one swings the thigh forward and back, and one bends ' +
          'the knee. The hip and thigh motors can make up to 23.7 N·m and the knee motors 45.4 N·m.',
      'The motor bars in the panel show each motor\'s torque divided by its limit. Green is easy work, orange is hard work ' +
        'and red means the motor is close to (or at) its limit and cannot push any harder.',
    ],
  };
}

function sensorsSection(robot: RobotInfo): ExplainSection {
  const g1 = robot.id === 'g1';
  return {
    title: 'Sensors: how a robot feels itself',
    paragraphs: [
      'IMU (inertial measurement unit): a chip in the body with a gyroscope, which measures how fast the body is rotating, ' +
        'and an accelerometer, which measures acceleration. Standing still, the accelerometer feels the floor holding the ' +
        'robot up against gravity, so it shows which way is up; while the robot steps or is pushed, its own acceleration ' +
        'mixes in. So robots trust the gyroscope for fast changes and the accelerometer for the long-term average. ' +
        'Together they tell the robot which way is down and how much it is tilting. The tilt gauge shows this.',
      'Joint encoders: a sensor in every joint that measures its angle. From how quickly the angle changes, the robot also ' +
        'knows how fast each joint is moving.',
      g1
        ? 'The G1\'s walking network uses only the IMU and the joint encoders. It has no foot sensors: it works out when a ' +
          'foot is on the ground from how its joints move. The foot dots in the panel come from the physics engine, so you ' +
          'can see what the robot has to guess.'
        : 'The Go2 also has contact sensors in its feet, so the controller knows when a swinging foot has landed. The foot ' +
          'dots in the panel show which feet are touching the ground. No sensor measures the body\'s speed: a real Go2 ' +
          'works it out from the legs (a foot on the ground is not moving, so the joint speeds tell how the body moves) ' +
          'combined with the IMU. In this simulator the controller is simply given that speed, with a little noise.',
      'Real sensors are never perfect: their readings wobble a little (noise). You can explore this in the Physics lab.',
    ],
  };
}

function loopSection(robot: RobotInfo): ExplainSection {
  const g1 = robot.id === 'g1';
  return {
    title: 'The control loop (and what Hz means)',
    paragraphs: [
      'Every robot controller repeats the same three steps over and over: sense (read the sensors), decide (work out ' +
        'what to do) and act (send commands to the motors). This is called a feedback loop, because what the robot ' +
        'senses feeds back into what it does next.',
      'Hz (hertz) means "times per second". 50 Hz is once every 20 milliseconds; 500 Hz is once every 2 milliseconds.',
      g1
        ? 'The G1 runs two loops. At 50 Hz the neural network reads the sensors and picks a target angle for each of the ' +
          '12 leg joints. At 500 Hz every motor runs a much simpler PD controller that pushes its joint toward that target.'
        : 'The Go2 controller runs its whole loop at 500 Hz: it estimates how the body is moving, decides which feet should ' +
          'be on the ground, how hard each one should push, and where the swinging feet should land.',
      'Why so fast? A robot that starts to tip over falls in well under a second, so it has to notice and correct small ' +
        'errors many times per second, before they grow.',
    ],
  };
}

function pdSection(robot: RobotInfo): ExplainSection {
  const kp = robot.id === 'g1' ? 150 : null;
  return {
    title: 'PD control: a spring and a shock absorber',
    paragraphs: [
      'A PD (proportional–derivative) controller sets motor torque = kp × (target angle − angle) − kd × joint speed.',
      'The first part acts like a spring: the further the joint is from its target, the harder the motor pulls. The second ' +
        'part acts like a shock absorber: it resists fast movement so the joint does not overshoot and wobble.',
      kp
        ? `The G1\'s knee uses kp = ${kp} N·m per radian: if the knee is 0.1 radians (about 6°) away from its target, the ` +
          'motor pulls with 15 N·m.'
        : 'The Go2 uses a PD spring on every joint too, and adds the torque needed to make each standing foot push on the ' +
          'ground with the force its balance controller asked for.',
    ],
  };
}

function rlSection(): ExplainSection {
  return {
    title: 'How the G1 learned to walk (reinforcement learning)',
    paragraphs: [
      'Nobody wrote down the G1\'s leg movements. Unitree trained its neural network with reinforcement learning: learning ' +
        'by trial and error from rewards.',
      'In a simulator (NVIDIA Isaac Gym) thousands of virtual G1s, 4,096 at a time by default, tried to walk. Each got ' +
        'reward points for moving at the commanded speed and direction and for staying up, and lost points for tilting or ' +
        'bouncing its body, jerky movements and more. An algorithm called PPO slowly adjusted the network\'s numbers so ' +
        'it earned more reward. After millions of simulated steps, walking emerged.',
      'To make the network work outside that one simulator, the training world was randomised: floor friction anywhere ' +
        'from 0.1 to 1.25, an extra −1 to +3 kg on the body, random shoves every few seconds and noisy sensor readings. ' +
        'A network that copes with all of these is more likely to cope with reality.',
      'Unitree\'s recipe is Train → Play → Sim2Sim → Sim2Real: after training, the network is tested in a different ' +
        'simulator (MuJoCo, the same physics engine running in this page) and then on the real robot.',
      'The network is small: an LSTM with 64 memory cells, so it can remember the last moments, followed by one layer of ' +
        '32 neurons. It reads 47 numbers 50 times a second and outputs 12 target joint angles.',
    ],
  };
}

function modelBasedSection(): ExplainSection {
  return {
    title: 'How the Go2 walks here (model-based control)',
    paragraphs: [
      'This Go2 controller was written by hand from physics, not learned. Every 2 milliseconds it:',
      '1. estimates the body\'s tilt from the IMU and reads how fast the body is moving; 2. decides which feet are on the ' +
        'ground in the trot rhythm; 3. works out how hard each standing foot must push to hold the body up, keep it level ' +
        'and reach the commanded speed; 4. picks where each swinging foot should land; 5. turns all that into motor torques.',
      'Foot placement uses Raibert\'s rule (from the 1980s hopping robots of Marc Raibert, who later founded Boston ' +
        'Dynamics): if the body is moving faster than it should, put the next foot down further ahead to slow it.',
      'The software on a real Go2 is Unitree\'s own and works differently; this controller was written for the simulator.',
    ],
  };
}

function gaitSection(robot: RobotInfo): ExplainSection {
  return {
    title: 'What is a gait?',
    paragraphs: [
      'A gait is a repeating pattern of leg movements, like walking, trotting or galloping.',
      robot.id === 'g1'
        ? 'The G1 walks with a 0.8 second rhythm: each leg steps once per cycle. Its network is given a clock signal (a sine ' +
          'and cosine of the cycle phase), which is why it keeps marching gently on the spot even when told to stand.'
        : 'The Go2 trots: the diagonal legs (front left + rear right, then front right + rear left) step together, 0.36 ' +
          'seconds per cycle, and each foot is on the ground half of the time. When you let go of the controls it stops ' +
          'stepping and stands on all four feet.',
      'Animals switch gaits as they speed up (a horse walks, trots, canters and gallops) because each gait is most ' +
        'efficient at a different speed.',
    ],
  };
}

export function meetExplain(robot: RobotInfo): ExplainSection[] {
  return [motorsSection(robot), sensorsSection(robot), loopSection(robot), pdSection(robot), gaitSection(robot)];
}

export function courseExplain(robot: RobotInfo): ExplainSection[] {
  const m = ROBOT_FACTS[robot.id].modelMassKg;
  const slopeN = m * GRAVITY * Math.sin((1.8 * Math.PI) / 180);
  return [
    {
      title: 'Driving a walking robot',
      paragraphs: [
        'You never move the legs yourself. You send a velocity command (how fast to go forward, sideways and how fast to ' +
          'turn) and the controller works out the leg movements. That is how most real walking robots are driven too.',
        `The ${robot.name} accepts up to ${robot.maxCommand.vx} m/s forward, ${robot.maxCommand.vy} m/s sideways and ` +
          `${robot.maxCommand.yawRate} rad/s of turning. Your command ramps up smoothly instead of jumping, because a ` +
          'sudden change is hard to balance, just like being yanked forward.',
      ],
    },
    {
      title: 'Turning needs grip',
      paragraphs: [
        'To walk in a curve, the floor has to push the robot sideways toward the centre of the curve. The force needed is ' +
          'm × v² ÷ r (mass × speed² ÷ radius).',
        `For the ${robot.name} (${m} kg) at 0.8 m/s on a 1 m radius that is about ${n0((m * 0.8 * 0.8) / 1)} N. Faster or ` +
          'tighter turns need more grip from friction. Slow down before sharp turns.',
      ],
    },
    {
      title: 'Ramps and bumps',
      paragraphs: [
        `On the loading ramp (a 1.8° slope) gravity pulls the robot back down the slope with m × g × sin(angle): about ` +
          `${n0(slopeN)} N for the ${robot.name}. The motors must work a little harder going up.`,
        robot.id === 'g1'
          ? 'The G1\'s network was trained only on flat floors, so bumps and slopes are new to it. Cross them slowly and ' +
            'straight: in tests, sidestepping or turning on the ramp made it fall about 1 time in 24.'
          : 'The Go2 controller assumes flat ground but reacts to each foot touching down, so it copes with small bumps. ' +
            'Cross them straight.',
      ],
    },
    gaitSection(robot),
  ];
}

export function pushExplain(robot: RobotInfo): ExplainSection[] {
  const m = ROBOT_FACTS[robot.id].modelMassKg;
  const comHeight = robot.id === 'g1' ? 0.7 : 0.27;
  const tc = Math.sqrt(comHeight / GRAVITY);
  return [
    {
      title: 'Centre of mass',
      paragraphs: [
        'The centre of mass (COM) is the average position of all of the robot\'s mass. Gravity pulls on the whole robot as ' +
          'if all its weight hung from that one point.',
        `The ${robot.name}'s centre of mass is about ${Math.round(comHeight * 100)} cm above the floor. Turn on the ` +
          'balance view (B) to see a dot straight below it on the ground.',
      ],
    },
    {
      title: 'Support polygon',
      paragraphs: [
        'Draw a rubber band around every point where the feet touch the ground: the shape inside is the support polygon ' +
          '(the green area in the balance view).',
        'A robot standing still is balanced when its centre of mass is above the support polygon. If the COM moves ' +
          'outside, gravity tips the robot over that edge unless it takes a step. That is why a wide stance is steadier.',
        robot.id === 'go2'
          ? 'While trotting, only two diagonal feet are down, so the "polygon" is just a line. The Go2 stays up by moving ' +
            'quickly from one pair of feet to the other, not by being statically stable.'
          : 'While walking, the G1 stands on one foot for much of each step, so its support polygon is just one small foot. ' +
            'The centre of mass is often outside it: walking is a controlled fall that is caught by the next step.',
      ],
    },
    {
      title: 'Pushes, momentum and impulse',
      paragraphs: [
        'A push changes the robot\'s momentum (mass × velocity). The change equals force × time, called the impulse.',
        `The lesson's pushes last 0.1 s. A 300 N push gives an impulse of 30 N·s, enough to change the ${m} kg ` +
          `${robot.name}'s speed by about ${(30 / m).toFixed(1)} m/s. The bigger the push, the more speed the robot must ` +
          'soak up with its feet.',
      ],
    },
    {
      title: 'Recovering by stepping',
      paragraphs: [
        'Once the centre of mass is moving, you can only stop it by putting a foot down ahead of it. Roboticists call that ' +
          'spot the capture point: about speed × √(height ÷ g) in front of the centre of mass.',
        `For the ${robot.name} √(height ÷ g) is about ${tc.toFixed(2)} s, so after a push that gives 1 m/s it must step ` +
          `about ${Math.round(tc * 100)} cm further out. Bigger pushes need bigger, faster steps, and past some point no step ` +
          'is big enough.',
        robot.id === 'g1'
          ? 'The G1 learned this itself: during training it was shoved at random every few seconds and was rewarded for ' +
            'staying up.'
          : 'The Go2 controller does it with Raibert\'s rule: the faster the body moves the wrong way, the further it moves ' +
            'the next footstep to catch it.',
        'Some directions are harder than others: a push from the side has to be caught by a sideways step, and legs step ' +
          'sideways less easily than forward.',
      ],
    },
  ];
}

export function labExplain(robot: RobotInfo): ExplainSection[] {
  const g1 = robot.id === 'g1';
  return [
    {
      title: 'Friction',
      paragraphs: [
        'Friction is the sideways grip between two surfaces. The most it can give is μ × the force pressing the surfaces ' +
          'together, where μ (the Greek letter mu) is the friction coefficient.',
        'Rubber on dry concrete has μ of about 0.6 to 1.0; a shoe on ice about 0.05 to 0.2. When a foot needs more ' +
          'sideways force than μ × (the weight on it), it slips.',
      ],
    },
    {
      title: 'Payload and weight',
      paragraphs: [
        'Weight is mass × g (g = 9.81 m/s²). Every extra kilogram is another 9.8 N that the leg motors must hold up at every ' +
          'step, so the knees in particular work harder: watch their load bars.',
        g1
          ? 'The G1\'s network was trained with only −1 to +3 kg of extra mass, yet in tests it still walked carrying 15 kg.'
          : 'The Go2 balance controller plans with its normal mass, so a payload makes it walk slower than you ask. In this ' +
            'simulation it still walked with 30 kg, twice its own mass. Real robots also have to worry about motors ' +
            'overheating and batteries, which this simulation leaves out.',
      ],
    },
    {
      title: 'Motor strength',
      paragraphs: [
        'This knob scales both the most torque each motor can make and the stiffness (kp) of its PD spring, like fitting ' +
          'weaker or stronger motors.',
        g1
          ? 'In tests the G1 still walked at 70% but fell at 65%. Surprise: that is mostly not because the motors cannot ' +
            'hold its weight. With normal stiffness it could still stand on half the torque. It falls because the joints ' +
            'become softer than the ones its network was trained with, so the network\'s timing no longer matches its body.'
          : 'The Go2 controller notices weak motors and walks slower on purpose: weak motors cannot swing the legs forward ' +
            'fast enough for quick steps.',
      ],
    },
    {
      title: 'Sensor noise',
      paragraphs: [
        'Noise is random error in a sensor reading. Here it is added only to what the controller sees, never to the real ' +
          'robot: at level 1 the gyroscope reading is off by up to 0.2 rad/s and joint angles by up to 0.01 rad (half a degree).',
        g1
          ? 'Level 1 is the same noise Unitree added to the readings during training, so the G1 barely notices. From about ' +
            'level 3 the network reacts to movements that are not really happening: in tests it walked unevenly and ' +
            'covered 15–25% less ground at full speed, and at level 5 it sometimes fell.'
          : 'The Go2 controller smooths its readings with a filter (it trusts the gyroscope for fast changes and gravity for ' +
            'slow ones), which hides a lot of the noise.',
      ],
    },
    {
      title: 'Slow motion',
      paragraphs: [
        'Slow motion changes only how fast you watch. The physics still takes one 2-millisecond step at a time, exactly as ' +
          'before, so the robot behaves the same, just slower on your screen.',
      ],
    },
    g1 ? rlSection() : modelBasedSection(),
  ];
}

export interface GlossaryEntry {
  term: string;
  definition: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  { term: 'Actuator', definition: 'Anything that makes a robot move. Here: the electric motors in the joints.' },
  { term: 'Centre of mass (COM)', definition: 'The average position of all of an object\'s mass. Gravity acts as if it pulls there.' },
  { term: 'Controller', definition: 'The program that reads the sensors and decides the motor commands, many times per second.' },
  { term: 'Encoder', definition: 'A sensor that measures the angle of a joint.' },
  { term: 'Feedback', definition: 'Using what you measure to correct what you do next, like steering a bike.' },
  { term: 'Friction coefficient (μ)', definition: 'How grippy two surfaces are. Maximum grip = μ × the force pressing them together.' },
  { term: 'Gait', definition: 'A repeating pattern of leg movements: walk, trot, gallop…' },
  { term: 'Hertz (Hz)', definition: 'Times per second. A 500 Hz loop runs every 2 milliseconds.' },
  { term: 'IMU', definition: 'Inertial measurement unit: a gyroscope (how fast the body rotates) plus an accelerometer (acceleration; standing still, the push of the floor against gravity). Together they tell which way is down.' },
  { term: 'Impulse', definition: 'Force × time. It equals the change in momentum a push causes.' },
  { term: 'Neural network', definition: 'A program made of many simple connected units whose numbers (weights) are learned from experience or data.' },
  { term: 'PD controller', definition: 'Torque = kp × (target − angle) − kd × speed: a virtual spring plus a shock absorber.' },
  { term: 'Policy', definition: 'In robot learning, the thing that decides the action from what the robot senses. The G1\'s policy is a neural network.' },
  { term: 'Reinforcement learning', definition: 'Learning by trial and error: actions that earn more reward become more likely.' },
  { term: 'Sim-to-real', definition: 'Moving a controller trained or tested in simulation onto the real robot.' },
  { term: 'Support polygon', definition: 'The shape around all the points where the feet touch the ground.' },
  { term: 'Torque', definition: 'A turning force, measured in newton-metres (N·m).' },
];

/** Plain-language explanation of a knob's current value for the Physics lab panel. */
export function knobExplanation(
  robot: RobotInfo,
  knob: 'friction' | 'payloadKg' | 'motorStrength' | 'sensorNoise' | 'timeScale',
  value: number,
  massKg: number,
): { title: string; lines: string[] } {
  const g1 = robot.id === 'g1';
  switch (knob) {
    case 'friction': {
      const grip = value * massKg * GRAVITY;
      return {
        title: `Friction μ = ${value.toFixed(2)}${value <= 0.25 ? ' (icy!)' : value >= 0.9 ? ' (grippy)' : ''}`,
        lines: [
          `Most sideways grip for the whole robot: μ × weight = ${value.toFixed(2)} × ${massKg.toFixed(1)} kg × 9.81 = ${n0(grip)} N.`,
          value < 0.3
            ? 'Feet slide when they push sideways or backwards harder than this. Walk gently, start and stop slowly, avoid sharp turns.'
            : 'Plenty of grip for normal walking. Try lowering it to see when the feet start to slip.',
        ],
      };
    }
    case 'payloadKg': {
      const base = massKg - value;
      return {
        title: value > 0 ? `Backpack: +${value.toFixed(1)} kg` : 'No backpack',
        lines: [
          `Total mass ${massKg.toFixed(1)} kg (${value > 0 ? `+${pct(value / base)}` : 'normal'}), so the legs hold up ${n0(massKg * GRAVITY)} N of weight.`,
          value > 0
            ? 'Watch the knee load bars: each extra kilogram means more torque at every step.'
            : 'Add mass to see the motor load bars rise.',
        ],
      };
    }
    case 'motorStrength': {
      const knee = (g1 ? 139 : 45.43) * value;
      return {
        title: `Motors at ${pct(value)}`,
        lines: [
          `Knee motors can now make at most ${knee.toFixed(1)} N·m, and every joint's PD spring is ${pct(value)} as stiff.`,
          g1
            ? value < 0.8
              ? 'Softer joints sag and react late. The G1\'s network expects its normal stiffness, so it may stumble.'
              : 'Close to normal: the network is used to this body.'
            : value < 1
              ? 'The Go2 walks slower on purpose so its weaker legs can still swing forward in time.'
              : 'Factory motors.',
        ],
      };
    }
    case 'sensorNoise':
      return {
        title: value === 0 ? 'Perfect sensors' : `Sensor noise × ${value.toFixed(1)}`,
        lines: [
          value === 0
            ? 'The controller sees the exact truth. Real robots never do.'
            : `Gyro readings are off by up to ${(0.2 * value).toFixed(2)} rad/s and joint angles by up to ${(0.01 * value).toFixed(3)} rad. The real robot is unchanged; only what it senses is wrong.`,
          g1
            ? 'Unitree trained the network with exactly the level-1 noise, so small amounts barely matter.'
            : 'The Go2 filters its readings, trading a little delay for much smoother estimates.',
        ],
      };
    case 'timeScale':
      return {
        title: value >= 1 ? 'Real time' : `Slow motion: ${pct(value)} speed`,
        lines: [
          'Only your view is slowed down. The physics still takes 500 steps per simulated second, so the robot behaves exactly the same.',
        ],
      };
  }
}
