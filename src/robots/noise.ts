/**
 * Sensor noise for the sensorNoise knob, shared by both robots. It uses the model and sizes Unitree's
 * legged_gym training adds to the G1 policy's observations: every reading gets uniform noise in
 * [-a, a] ((2·rand − 1)·scale, noise_level 1), so knob level 1 is exactly the training noise.
 */

/** Noise amplitudes (half-widths) at knob level 1, from legged_gym's noise_scales. */
export const SENSOR_NOISE = {
  gyro: 0.2, // rad/s
  gravity: 0.05, // unit gravity vector
  jointAngle: 0.01, // rad
  jointSpeed: 1.5, // rad/s
} as const;

/** Uniform noise in [-amplitude, amplitude]; exactly 0, without drawing, when the amplitude is 0. */
export function uniformNoise(amplitude: number, rng: () => number): number {
  return amplitude === 0 ? 0 : amplitude * (2 * rng() - 1);
}
