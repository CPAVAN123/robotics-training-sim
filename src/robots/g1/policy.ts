/**
 * Forward pass of Unitree's pretrained G1 walking policy (unitree_rl_gym deploy/pre_train/g1/motion.pt):
 * LSTM(47 -> 64) followed by Linear(64 -> 32) + ELU + Linear(32 -> 12).
 * Weights come from public/policies/g1_walk.json (tools/export_g1_policy.py).
 * No allocation per step: all buffers are created once in the constructor.
 */

/** Shape of public/policies/g1_walk.json. Matrices are row-major [out][in], as in PyTorch. */
export interface G1PolicyWeights {
  num_obs: number;
  num_actions: number;
  hidden: number;
  lstm: { weight_ih: number[][]; weight_hh: number[][]; bias_ih: number[]; bias_hh: number[] };
  actor: { weight: number[][]; bias: number[] }[];
}

export class G1Policy {
  readonly numObs: number;
  readonly numActions: number;
  /** Output of the last forward() call. */
  readonly action: Float32Array;

  private readonly hidden: number;
  private readonly mid: number;
  /** [4H x (numObs + H)]: input and recurrent weights side by side, so one pass computes all gates. */
  private readonly wGates: Float64Array;
  /** b_ih + b_hh, [4H]. */
  private readonly bGates: Float64Array;
  private readonly w1: Float64Array;
  private readonly b1: Float64Array;
  private readonly w2: Float64Array;
  private readonly b2: Float64Array;
  /** [obs, h]: the concatenated input to the gate matrix. */
  private readonly xh: Float64Array;
  private readonly gates: Float64Array;
  /** LSTM hidden and cell state, kept in float32 like PyTorch. */
  private readonly h: Float32Array;
  private readonly c: Float32Array;
  private readonly z1: Float64Array;

  constructor(w: G1PolicyWeights) {
    const nIn = w.num_obs;
    const H = w.hidden;
    this.numObs = nIn;
    this.numActions = w.num_actions;
    this.hidden = H;
    this.mid = w.actor[0].bias.length;
    if (w.lstm.weight_ih.length !== 4 * H || w.lstm.weight_ih[0].length !== nIn || w.lstm.weight_hh[0].length !== H) {
      throw new Error('g1 policy: LSTM weight shapes do not match num_obs/hidden');
    }
    if (w.actor.length !== 2 || w.actor[0].weight[0].length !== H || w.actor[1].bias.length !== this.numActions) {
      throw new Error('g1 policy: actor must be Linear(hidden->mid) + ELU + Linear(mid->num_actions)');
    }

    const cols = nIn + H;
    this.wGates = new Float64Array(4 * H * cols);
    this.bGates = new Float64Array(4 * H);
    for (let r = 0; r < 4 * H; r++) {
      const row = r * cols;
      for (let k = 0; k < nIn; k++) this.wGates[row + k] = w.lstm.weight_ih[r][k];
      for (let k = 0; k < H; k++) this.wGates[row + nIn + k] = w.lstm.weight_hh[r][k];
      this.bGates[r] = w.lstm.bias_ih[r] + w.lstm.bias_hh[r];
    }
    this.w1 = Float64Array.from(w.actor[0].weight.flat());
    this.b1 = Float64Array.from(w.actor[0].bias);
    this.w2 = Float64Array.from(w.actor[1].weight.flat());
    this.b2 = Float64Array.from(w.actor[1].bias);

    this.xh = new Float64Array(cols);
    this.gates = new Float64Array(4 * H);
    this.h = new Float32Array(H);
    this.c = new Float32Array(H);
    this.z1 = new Float64Array(this.mid);
    this.action = new Float32Array(this.numActions);
  }

  /** Forget the LSTM memory (start of an episode). */
  reset(): void {
    this.h.fill(0);
    this.c.fill(0);
    this.action.fill(0);
  }

  /** One policy step. Reads `obs` (numObs values), updates the LSTM state and returns `this.action`. */
  forward(obs: ArrayLike<number>): Float32Array {
    const nIn = this.numObs;
    const H = this.hidden;
    const cols = nIn + H;
    const { xh, gates, wGates, bGates, h, c } = this;

    for (let k = 0; k < nIn; k++) xh[k] = obs[k];
    for (let k = 0; k < H; k++) xh[nIn + k] = h[k];
    for (let r = 0; r < 4 * H; r++) {
      let s = bGates[r];
      const row = r * cols;
      for (let k = 0; k < cols; k++) s += wGates[row + k] * xh[k];
      gates[r] = s;
    }
    // PyTorch gate order: input, forget, cell candidate, output.
    for (let j = 0; j < H; j++) {
      const i = sigmoid(gates[j]);
      const f = sigmoid(gates[H + j]);
      const g = Math.tanh(gates[2 * H + j]);
      const o = sigmoid(gates[3 * H + j]);
      c[j] = f * c[j] + i * g;
      h[j] = o * Math.tanh(c[j]);
    }

    const { z1, w1, b1, w2, b2, action } = this;
    for (let r = 0; r < this.mid; r++) {
      let s = b1[r];
      const row = r * H;
      for (let k = 0; k < H; k++) s += w1[row + k] * h[k];
      z1[r] = s > 0 ? s : Math.expm1(s); // ELU, alpha = 1
    }
    for (let r = 0; r < this.numActions; r++) {
      let s = b2[r];
      const row = r * this.mid;
      for (let k = 0; k < this.mid; k++) s += w2[row + k] * z1[k];
      action[r] = s;
    }
    return action;
  }
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
