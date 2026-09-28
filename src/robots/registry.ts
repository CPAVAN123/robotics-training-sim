import type { LoadFile } from '../core/mujoco';
import type { RobotController, RobotId, RobotInfo } from '../core/types';
import { createG1Controller } from './g1/controller';
import { G1_INFO, G1_POLICY_PATH } from './g1/info';
import type { G1PolicyWeights } from './g1/policy';
import { createGo2Controller } from './go2/controller';
import { GO2_INFO } from './go2/info';

export const ROBOTS: Record<RobotId, RobotInfo> = { g1: G1_INFO, go2: GO2_INFO };

/** Builds a fresh controller for the robot, downloading anything it needs (the G1 policy weights). */
export async function createController(id: RobotId, loadFile: LoadFile): Promise<RobotController> {
  switch (id) {
    case 'g1': {
      const weights = JSON.parse(new TextDecoder().decode(await loadFile(G1_POLICY_PATH))) as G1PolicyWeights;
      return createG1Controller(weights);
    }
    case 'go2':
      return createGo2Controller();
  }
}
