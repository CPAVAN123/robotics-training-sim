/**
 * The Robot handbook: reference chapters on how each robot is built and controlled, the technology behind it
 * and how the simulator works. Figures for the simulated robots come from the model files and controllers in
 * src/robots; figures for the real robots are rounded from Unitree's public product pages and are marked "about".
 */
import type { RobotId } from '../core/types';
import { GLOSSARY, ROBOT_FACTS } from './content';

export interface HandbookSection {
  title: string;
  paragraphs: string[];
  /** Optional label/value rows shown as a small table under the paragraphs. */
  facts?: [string, string][];
}

export interface HandbookChapter {
  id: string;
  title: string;
  /** One line shown in the chapter list. */
  summary: string;
  sections: HandbookSection[];
}

function overview(robot: RobotId): HandbookChapter {
  const f = ROBOT_FACTS[robot];
  const g1 = robot === 'g1';
  return {
    id: 'overview',
    title: g1 ? 'Meet the G1' : 'Meet the Go2',
    summary: 'What the robot is, who makes it and what it is used for.',
    sections: [
      {
        title: g1 ? 'A humanoid you can buy' : 'A robot dog for research and classrooms',
        paragraphs: g1
          ? [
              'The G1 is a humanoid (human-shaped) robot made by Unitree Robotics, a company founded in 2016 in Hangzhou, China. ' +
                'Unitree first became known for its robot dogs and announced the G1 in 2024 as a humanoid that universities and ' +
                'labs could afford.',
              'Researchers use it to study walking, balance, hands that grasp things, and robot learning: teaching robots new ' +
                'skills from practice in simulation or from human demonstrations.',
            ]
          : [
              'The Go2 is a four-legged "robot dog" made by Unitree Robotics in Hangzhou, China, launched in 2023. Quadrupeds ' +
                'like it are the most widely used legged robots today because four legs are naturally stable.',
              'Researchers use it to study locomotion and robot learning, schools use it for teaching, and robot dogs of this ' +
                'kind are used to inspect factories, power stations and construction sites.',
            ],
        facts: [
          ['Type', f.kindLabel],
          ['Maker', `${f.maker}, ${f.country}`],
          ['Size', f.size],
          ['Mass', g1 ? 'About 35 kg (real robot); 32.1 kg in this simulation' : 'About 15 kg (real robot); 15.2 kg in this simulation'],
          ['Motors simulated here', f.motors],
          ['Control loop here', f.loop],
        ],
      },
      {
        title: 'What is simulated and what is not',
        paragraphs: [
          g1
            ? 'The simulated G1 is Unitree\'s own model of the robot: the exact lengths, masses and joint limits of its body. ' +
              'Only the 12 leg joints move; the arms, waist and hands are fixed in place, because the walking controller Unitree ' +
              'published controls the legs only.'
            : 'The simulated Go2 is the model published in Google DeepMind\'s MuJoCo Menagerie, based on Unitree\'s data: the ' +
              'exact lengths, masses and joint limits of its body, and all 12 leg motors.',
          'Cameras, LiDAR, speakers, lights and the battery are not simulated. The controllers here only use the sensors that ' +
            'matter for walking: the IMU and the joint encoders.',
        ],
      },
    ],
  };
}

function components(robot: RobotId): HandbookChapter {
  const g1 = robot === 'g1';
  return {
    id: 'components',
    title: 'Parts of the robot',
    summary: 'Frame, motors, gears, battery, computer and sensors.',
    sections: [
      {
        title: 'The body: links and joints',
        paragraphs: [
          'A robot body is a chain of rigid parts called links (like your thigh bone) connected by joints (like your knee). ' +
            'Each joint here turns around one axis, so it has one degree of freedom (DOF).',
          g1
            ? 'Each G1 leg has 6 joints: the hip turns three ways (pitch: forward/back, roll: out to the side, yaw: twisting), ' +
              'then the knee, then the ankle turns two ways (pitch and roll). Six joints are the minimum to put a foot at any ' +
              'position and angle, which is why human legs work the same way. The full robot has more than 20 joints in total ' +
              'depending on the version, adding the waist, arms and optional hands.'
            : 'Each Go2 leg has 3 joints: the hip swings the leg out to the side (abduction), the thigh swings forward and back, ' +
              'and the knee bends. Three joints are enough to put a foot anywhere in 3D, and a round foot does not need an ankle.',
          'The links are made of aluminium alloy and plastic shells, so the legs are light. Light legs can swing quickly ' +
            'without shaking the body.',
        ],
      },
      {
        title: 'Motors and gears (actuators)',
        paragraphs: [
          'Each joint is driven by an actuator: a brushless electric motor with a planetary gearbox, packed together with its ' +
            'encoder and driver electronics. Unitree designs and builds its own actuators.',
          'The gearbox trades speed for strength: the motor spins fast with little torque, and the gears turn that into a ' +
            'slower joint with much more torque. Unitree uses a low gear ratio (a "quasi-direct drive"), so a joint can be ' +
            'pushed back by the ground without breaking the gears. That makes landings soft and lets the controller feel ' +
            'forces through the motor current.',
          g1
            ? 'In this simulation the strongest G1 joints (knees and hip roll) can make up to 139 N·m of torque, the other hip ' +
              'joints 88 N·m and the ankles 50 N·m. These limits come from Unitree\'s model file.'
            : 'In this simulation each Go2 hip and thigh motor can make up to 23.7 N·m and each knee up to 45.4 N·m. These limits ' +
              'come from the robot\'s model file.',
        ],
      },
      {
        title: 'Battery and computer',
        paragraphs: [
          g1
            ? 'The real G1 carries a removable lithium-ion battery that runs it for about 2 hours. Its onboard computer runs ' +
              'the low-level motor control, and research versions add a second, more powerful computer (an NVIDIA Jetson Orin) ' +
              'for vision and AI.'
            : 'The real Go2 carries a removable lithium-ion battery that runs it for roughly 1 to 4 hours depending on the ' +
              'battery and how hard it works. Research versions add an NVIDIA Jetson Orin computer for vision and AI.',
          'Motor control needs a fast, reliable computer loop (hundreds of times a second). Seeing, mapping and planning need ' +
            'lots of computing power but can run more slowly. That is why robots often split the work between two computers.',
        ],
      },
    ],
  };
}

function sensors(robot: RobotId): HandbookChapter {
  const g1 = robot === 'g1';
  return {
    id: 'sensors',
    title: 'Sensors',
    summary: 'How the robot knows which way is down, where its legs are and what is around it.',
    sections: [
      {
        title: 'Inside the body: IMU and encoders',
        paragraphs: [
          'The IMU (inertial measurement unit) is a chip with a gyroscope, which measures how fast the body is rotating, and an ' +
            'accelerometer, which measures acceleration. Standing still, the accelerometer feels the floor pushing the robot ' +
            'up against gravity, so it tells the robot which way is down. Combined over time, these tell the robot how tilted it is.',
          'Every joint has an encoder that measures its angle very precisely. From the joint angles and the known link lengths ' +
            'the robot can calculate where every foot is relative to its body. This is called forward kinematics.',
          'These two are the only sensors the walking controllers in this simulator use. The Sensor noise knob in the Physics ' +
            'lab adds random errors to exactly these readings.',
        ],
      },
      {
        title: 'Looking outside: LiDAR and cameras',
        paragraphs: [
          'A LiDAR sends out laser pulses and times their reflections to measure distances to thousands of points around it ' +
            'every second, building a 3D point cloud of the surroundings. A depth camera does something similar with light ' +
            'patterns or two lenses.',
          g1
            ? 'The real G1 has a LiDAR and a depth camera in its head, so it can map rooms, avoid obstacles and see objects to pick up.'
            : 'The real Go2 has a wide-angle LiDAR (Unitree\'s own L1) on its head and a camera at the front, so it can map its ' +
              'surroundings, avoid obstacles and follow a person.',
          'The simulator does not model these yet; the robots walk "blind", which is also how many real walking controllers ' +
            'work. Seeing is handled by a separate, slower navigation layer.',
        ],
      },
      {
        title: 'Feeling the ground',
        paragraphs: [
          'Knowing when a foot touches the ground is important for walking. Some robots have pressure sensors in the feet; ' +
            'others work it out from the motor torques and joint angles. The foot contact dots in the HUD show contact as ' +
            'the physics engine sees it.',
        ],
      },
    ],
  };
}

function control(robot: RobotId): HandbookChapter {
  const g1 = robot === 'g1';
  return {
    id: 'control',
    title: 'How it walks',
    summary: 'The control loop from your joystick to the motors.',
    sections: [
      {
        title: 'Layers of control',
        paragraphs: [
          'A walking robot is controlled in layers, from slow to fast:',
          '1. You (or a navigation program) decide where to go: a speed forward, sideways and a turning rate.',
          '2. The locomotion controller turns that command into target angles or torques for all 12 joints.',
          '3. Each joint\'s motor controller makes the joint follow its target.',
          '4. The motor driver switches the electric current in the motor thousands of times a second.',
          g1
            ? 'In this simulator the G1\'s locomotion controller thinks 50 times a second, and the joint controllers run 500 ' +
              'times a second, the same as the physics.'
            : 'In this simulator the Go2\'s whole controller runs 500 times a second, the same as the physics.',
        ],
      },
      {
        title: 'Joint control: a spring and a shock absorber',
        paragraphs: [
          'Each joint uses a PD controller: torque = kp × (target angle − angle) − kd × joint speed. The first part pulls the ' +
            'joint towards its target like a spring; the second resists fast movement like a shock absorber.',
          'A stiff spring (big kp) follows targets precisely but is harsh on landings; a soft spring absorbs bumps but ' +
            'wobbles. The Motor strength knob in the Physics lab scales the spring stiffness and the torque limit together.',
        ],
      },
      g1
        ? {
            title: 'The G1\'s brain: a neural network',
            paragraphs: [
              'The G1 walks with a neural network that Unitree trained with reinforcement learning and published as open ' +
                'source (the unitree_rl_gym project). This simulator runs that exact network.',
              '50 times a second the network reads 47 numbers: how fast the body is rotating, which way gravity points, your ' +
                'command, the 12 joint angles and speeds, what it did last time, and a clock for the step rhythm. It outputs ' +
                '12 target joint angles, which the PD controllers then follow.',
              'It is an LSTM network with 64 memory cells, so it remembers the last moments, followed by a layer of 32 ' +
                'neurons: about 31,000 numbers in total, learned from millions of practice steps in simulation.',
            ],
          }
        : {
            title: 'The Go2\'s brain here: physics rules',
            paragraphs: [
              'Unitree has not published the Go2\'s walking software, so this simulator uses a controller written by hand from ' +
                'physics, a "model-based" controller.',
              'It trots: diagonal legs step together, 0.36 seconds per cycle. For standing feet it calculates how hard each ' +
                'must push to hold the body up, keep it level and reach the commanded speed. For swinging feet it picks the ' +
                'landing spot with Raibert\'s rule: moving too fast, step further ahead to slow down.',
              'It then uses inverse kinematics, the reverse of forward kinematics, to find the joint angles that put each ' +
                'foot where it should be.',
            ],
          },
      {
        title: 'Learned versus hand-written control',
        paragraphs: [
          'Model-based controllers are predictable and their behaviour can be explained line by line, but engineers have to ' +
            'think of every situation in advance. Learned controllers can discover robust tricks, such as quick recovery ' +
            'steps, but they are harder to explain and need a lot of simulated practice.',
          'Most new legged robots, including Unitree\'s, now walk with learned controllers, often combined with model-based ' +
            'safety checks. Comparing the G1 and the Go2 in the Push recovery lesson is a good way to see the difference.',
        ],
      },
    ],
  };
}

function balance(): HandbookChapter {
  return {
    id: 'balance',
    title: 'Balance physics',
    summary: 'Centre of mass, support polygon and why pushes knock robots over.',
    sections: [
      {
        title: 'Centre of mass and support polygon',
        paragraphs: [
          'Gravity pulls on every part of the robot, but it acts as if all the weight were at one point: the centre of mass ' +
            '(COM). The support polygon is the shape you get by drawing around all the points where the feet touch the ground.',
          'A robot standing still stays up as long as the point on the ground straight below its COM is inside the support ' +
            'polygon. This is static balance. Turn on the Balance view (B) to see both.',
        ],
      },
      {
        title: 'Dynamic balance: walking is controlled falling',
        paragraphs: [
          'A humanoid on one foot has a tiny support polygon, so while walking it is almost always falling a little. It stays ' +
            'up by putting the next foot down in the right place in time. This is dynamic balance, and it is how people walk too.',
          'A quadruped trotting on two diagonal feet also balances dynamically, but its wide stance and four feet give it much ' +
            'more room for error, which is why robot dogs came to market before humanoids.',
        ],
      },
      {
        title: 'Pushes, momentum and friction',
        paragraphs: [
          'A push gives the robot momentum. Impulse (force × time) equals the change in momentum, so a 300 N shove for 0.1 s ' +
            'gives 30 N·s: enough to move a 30 kg robot at 1 m/s. To stop that, the feet must push back, usually by stepping ' +
            'into the direction of the push.',
          'Feet can only push sideways as hard as friction allows: at most μ × the weight on them. On ice (low μ) the feet slip ' +
            'before they can stop the robot.',
        ],
      },
    ],
  };
}

function simulator(): HandbookChapter {
  return {
    id: 'simulator',
    title: 'How the simulator works',
    summary: 'The MuJoCo physics engine, time steps and the sim-to-real gap.',
    sections: [
      {
        title: 'The physics engine: MuJoCo',
        paragraphs: [
          'This simulator uses MuJoCo ("Multi-Joint dynamics with Contact"), a physics engine maintained by Google DeepMind and ' +
            'used by robotics labs around the world. It runs inside your browser, compiled to WebAssembly.',
          'MuJoCo treats every link as a rigid body with a mass and a shape. It works out the forces in every joint and every ' +
            'contact with the ground or obstacles, then moves everything forward by one small time step: 2 milliseconds, ' +
            '500 times per simulated second.',
          'Contacts are the hard part of robot physics. MuJoCo models them as very stiff but slightly soft springs with ' +
            'friction, which is why a foot sinks about a centimetre into the floor.',
        ],
      },
      {
        title: 'Robot models',
        paragraphs: [
          'Each robot is described by a model file (MJCF, an XML format) that lists its links, their masses and inertia, the ' +
            'joints and their limits, the motors, and the 3D meshes used for drawing and collisions. The G1 file comes from ' +
            'Unitree; the Go2 file comes from MuJoCo Menagerie, a collection of carefully checked robot models.',
        ],
      },
      {
        title: 'Why train robots in simulation?',
        paragraphs: [
          'Practising on real hardware is slow, expensive and breaks robots. In simulation, thousands of robots can practise ' +
            'at once, faster than real time, and falling costs nothing. Unitree trained the G1\'s network with 4,096 virtual ' +
            'robots in parallel.',
          'The catch is the "sim-to-real gap": no simulator is perfect, so a controller can exploit details that are not ' +
            'true in reality. Engineers close the gap by randomising the simulation (friction, masses, pushes, sensor noise), ' +
            'exactly the knobs you can turn in the Physics lab, and by testing in a second simulator before trying the real robot.',
        ],
      },
    ],
  };
}

function world(): HandbookChapter {
  return {
    id: 'world',
    title: 'Robots around the world',
    summary: 'Who builds legged robots today and where the technology is going.',
    sections: [
      {
        title: 'China',
        paragraphs: [
          'China has become the biggest centre for legged and humanoid robots. Besides Unitree (Hangzhou), well-known makers ' +
            'include UBTech (Shenzhen, Walker humanoids for factories), AgiBot (Shanghai), Fourier (Shanghai, GR humanoids), ' +
            'Galbot (Beijing) and Deep Robotics (Hangzhou, quadrupeds for inspecting power stations and tunnels).',
        ],
      },
      {
        title: 'Elsewhere',
        paragraphs: [
          'In the United States, Boston Dynamics (Spot robot dog, Atlas humanoid), Agility Robotics (Digit, working in ' +
            'warehouses), Figure, Apptronik and Tesla (Optimus) are building humanoids. In Europe, ANYbotics (Switzerland) makes ' +
            'the ANYmal inspection robot, and 1X (Norway) builds home humanoids.',
        ],
      },
      {
        title: 'Where the technology is going',
        paragraphs: [
          'Most new walking controllers are trained with reinforcement learning in GPU-powered simulators such as NVIDIA Isaac ' +
            'Lab and MuJoCo, then moved to real robots.',
          'The next step is robot "foundation models": large AI models that take in camera images and spoken instructions and ' +
            'output actions, so one robot can learn many tasks. Walking, like the controllers in this simulator, stays the ' +
            'fast, low-level layer underneath.',
        ],
      },
    ],
  };
}

function glossary(): HandbookChapter {
  return {
    id: 'glossary',
    title: 'Glossary',
    summary: 'Short definitions of the words used in the lessons.',
    sections: [{ title: 'Words to know', paragraphs: [], facts: GLOSSARY.map((g) => [g.term, g.definition]) }],
  };
}

/** All handbook chapters for one robot, in reading order. */
export function handbook(robot: RobotId): HandbookChapter[] {
  return [overview(robot), components(robot), sensors(robot), control(robot), balance(), simulator(), world(), glossary()];
}
