/**
 * Camera that follows the robot. Students can orbit (drag), zoom (wheel / pinch) and pan; the camera
 * keeps their chosen angle while it glides after the robot. In "chase" mode it also swings round
 * behind the robot, so "forward" on the keyboard is always "away from you".
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** After the student drags the view, chase mode waits this long before swinging back, s. */
const CHASE_PAUSE_S = 2.5;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  chase: boolean;
  private showcasing = false;
  private lastInteraction = -Infinity;
  private dragging = false;
  private clock = 0;
  private readonly offset = new THREE.Vector3();
  private readonly goal = new THREE.Vector3();

  /** With reduced motion the camera doesn't swing round on its own and stops as soon as you let go. */
  constructor(dom: HTMLElement, reducedMotion: boolean) {
    this.chase = !reducedMotion;
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 250);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(-3, -3, 2);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = !reducedMotion;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 25;
    // Stay above the floor.
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.autoRotateSpeed = 0.6;
    this.controls.addEventListener('start', () => {
      this.dragging = true;
    });
    this.controls.addEventListener('end', () => {
      this.dragging = false;
      this.lastInteraction = this.clock;
    });
  }

  /** Home-screen mode: slowly circle the robot (unless reduced motion is on) and never chase. */
  setShowcase(on: boolean, reducedMotion: boolean): void {
    this.showcasing = on;
    this.controls.autoRotate = on && !reducedMotion;
  }

  /** Frames the robot from behind at a distance that suits its size. */
  frame(target: THREE.Vector3, heading: number, distance: number, height: number): void {
    this.controls.target.copy(target);
    this.camera.position.set(
      target.x - Math.cos(heading) * distance,
      target.y - Math.sin(heading) * distance,
      target.z + height,
    );
    this.controls.update();
  }

  /** Jumps to the robot without gliding (after a reset teleports it). */
  snap(target: THREE.Vector3): void {
    this.offset.subVectors(this.camera.position, this.controls.target);
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(this.offset);
    this.controls.update();
  }

  update(dt: number, target: THREE.Vector3, heading: number): void {
    this.clock += dt;
    // Glide toward the robot; move the camera by the same amount so the viewing angle is kept.
    const k = 1 - Math.exp(-dt * 6);
    this.goal.copy(target).sub(this.controls.target).multiplyScalar(k);
    this.controls.target.add(this.goal);
    this.camera.position.add(this.goal);

    if (this.chase && !this.showcasing && !this.dragging && this.clock - this.lastInteraction > CHASE_PAUSE_S) {
      this.offset.subVectors(this.camera.position, this.controls.target);
      const horizontal = Math.hypot(this.offset.x, this.offset.y);
      const current = Math.atan2(this.offset.y, this.offset.x);
      const behind = heading + Math.PI;
      const error = Math.atan2(Math.sin(behind - current), Math.cos(behind - current));
      const angle = current + error * (1 - Math.exp(-dt * 1.8));
      this.camera.position.set(
        this.controls.target.x + Math.cos(angle) * horizontal,
        this.controls.target.y + Math.sin(angle) * horizontal,
        this.camera.position.z,
      );
    }
    this.controls.update();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.controls.dispose();
  }
}
