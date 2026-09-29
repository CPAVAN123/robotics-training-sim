import type { Checkpoint, SimulationApi } from '../../../src/core/types';
import { waypointCommand } from '../../../src/robots/autopilot';

export interface CourseResult {
  /** Checkpoints reached, in order. */
  reached: number;
  /** Sim time at which each checkpoint was reached, s. */
  times: number[];
  fell: boolean;
  /** Sim time when the run ended (last checkpoint, fall or time limit), s. */
  time: number;
}

/** Drives the robot through `checkpoints` in order with the autopilot, re-planning every 20 ms. */
export function runCourse(sim: SimulationApi, checkpoints: Checkpoint[], timeLimitS: number, speed = 1): CourseResult {
  const times: number[] = [];
  let next = 0;
  while (next < checkpoints.length && sim.data.time < timeLimitS) {
    const state = sim.getState();
    if (state.fallen) break;
    const cp = checkpoints[next];
    if (Math.hypot(cp.x - state.position[0], cp.y - state.position[1]) < cp.radius) {
      times.push(state.time);
      next++;
      continue;
    }
    sim.setCommand(waypointCommand(state, cp, sim.robot, { speed }));
    for (let i = 0; i < 10; i++) sim.stepOnce();
  }
  const state = sim.getState();
  return { reached: next, times, fell: state.fallen, time: state.time };
}
