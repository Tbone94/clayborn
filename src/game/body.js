// Creature physics. Every number here comes from the creature's drawn shape (stats.phys).
import { sfx } from '../fx/audio.js';

const GRAV = 24;

export class Body {
  constructor(creature, x = 0, z = 0) {
    this.c = creature;
    this.x = x; this.y = 5; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.heading = 0; // radians; forward = (cos h, -sin h)
    this.grounded = false; this.swimming = false; this.gliding = false;
    this.dashT = 0; this.dashCD = 0; this.stun = 0; this.airT = 0;
    this.out = false;
    this.refresh();
  }
  refresh() { this.P = this.c.stats.phys; }

  get fx() { return Math.cos(this.heading); }
  get fz() { return -Math.sin(this.heading); }

  // world: { height(x,z), water: level, splash(x,z), dust(x,y,z), bounds?(b) }
  step(dt, ctl, world) {
    const P = this.P;
    this.dashCD = Math.max(0, this.dashCD - dt); this.dashT = Math.max(0, this.dashT - dt); this.stun = Math.max(0, this.stun - dt);
    const ground = world.height(this.x, this.z);
    const water = world.water ?? -100;
    const deep = ground < water - 0.35;
    const inWater = deep && this.y <= water + 0.05;

    let mx = ctl.mx || 0, mz = ctl.mz || 0;
    const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    if (this.stun > 0) { mx *= 0.15; mz *= 0.15; }

    let top = inWater ? P.swim : P.maxSpeed;
    if (this.gliding) top *= 1.12;
    const accel = (this.grounded || inWater ? P.accel : P.accel * 0.45) * (this.stun > 0 ? 0.3 : 1);
    const tx = mx * top, tz = mz * top;
    if (this.dashT <= 0) {
      const k = Math.min(1, (accel * dt) / Math.max(1, top));
      this.vx += (tx - this.vx) * k * (ml > 0.05 || this.grounded || inWater ? 1 : 0.1);
      this.vz += (tz - this.vz) * k * (ml > 0.05 || this.grounded || inWater ? 1 : 0.1);
    }
    if (ml > 0.1 && this.stun <= 0) {
      const want = Math.atan2(-mz, mx);
      let d = want - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 10);
    }

    // jump / glide / dash
    if (this.grounded || inWater) this.airJumps = P.airJumps || 0;
    if (ctl.jumpPressed && (this.grounded || inWater) && this.stun <= 0) {
      this.vy = inWater ? P.jump * 0.75 : P.jump; this.grounded = false;
      ctl.onJump?.(); this.c.motion.land = -0.6;
      if (this.isPlayer) sfx.boing(P.gait === 'hop' ? 1.3 : 1);
    } else if (ctl.jumpPressed && !this.grounded && !inWater && this.airJumps > 0 && this.stun <= 0) {
      // Flapper: flap for another lift in mid-air
      this.airJumps--; this.vy = Math.max(this.vy, P.jump * 0.8); this.c.motion.flapT = 0.35;
      if (this.isPlayer) sfx.whoosh();
    }
    this.gliding = false;
    if (!this.grounded && !inWater && ctl.jump && this.vy < 0 && P.glide > 0) {
      const fall = 7.5 - P.glide * 6.6; // big wings ≈ floaty
      if (this.vy < -fall) this.vy += (-fall - this.vy) * Math.min(1, dt * 8);
      this.gliding = true;
      // gliding keeps you moving forward
      const sp = Math.hypot(this.vx, this.vz), want = P.maxSpeed * (0.7 + P.glide * 0.6);
      if (sp < want) { this.vx += this.fx * (want - sp) * dt * 2; this.vz += this.fz * (want - sp) * dt * 2; }
    }
    if (ctl.dashPressed && this.dashCD <= 0 && this.stun <= 0) {
      const pow = (5.5 + this.c.stats.power * 0.4) * (P.dashMult || 1);
      this.vx = this.fx * pow; this.vz = this.fz * pow; this.dashT = 0.25; this.dashCD = 1.2;
      if (this.grounded) this.vy = 2.5;
      if (this.isPlayer) sfx.whoosh();
    }

    // integrate
    this.vy -= GRAV * dt;
    if (inWater) { // buoyancy: float with the top of the body poking out
      const floatY = water - Math.min(0.6, (P.height || 1) * 0.45);
      this.vy += (floatY - this.y) * 30 * dt; this.vy *= Math.pow(0.02, dt);
    }
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;

    const g2 = world.height(this.x, this.z);
    const wasGrounded = this.grounded;
    if (this.y <= g2 && !(g2 < water - 0.35)) {
      // walls: if the step up is big, push back instead of teleporting up
      if (g2 - this.y > 0.6 && wasGrounded) {
        this.x -= this.vx * dt; this.z -= this.vz * dt; this.vx *= -0.2; this.vz *= -0.2;
        this.y = world.height(this.x, this.z);
      } else {
        if (!wasGrounded && this.vy < -7) { this.c.motion.land = Math.min(1, -this.vy / 18); world.dust?.(this.x, g2, this.z); if (this.isPlayer) sfx.thud(); }
        this.y = g2; if (this.vy < 0) this.vy = 0;
      }
      this.grounded = true;
    } else if (this.y <= g2) { this.y = g2; this.vy = Math.max(0, this.vy); this.grounded = false; }
    else this.grounded = this.y - g2 < 0.05 && this.vy <= 0;
    if (!wasGrounded && !this.swimming && deep && this.y < water && this.vy < -2) world.splash?.(this.x, water, this.z);
    this.swimming = deep && this.y < water + 0.1;
    if (this.grounded || this.swimming) {
      const f = Math.pow(this.grounded ? 0.0005 : 0.05, dt);
      if (ml < 0.05 && this.dashT <= 0) { this.vx *= f; this.vz *= f; }
    }
    this.airT = this.grounded || this.swimming ? 0 : this.airT + dt;
    this.sync();
  }

  sync() {
    const g = this.c.group;
    g.position.set(this.x, this.y, this.z);
    g.rotation.y = this.heading;
    const m = this.c.motion;
    m.speed = Math.hypot(this.vx, this.vz);
    m.grounded = this.grounded; m.swimming = this.swimming; m.gliding = this.gliding; m.vy = this.vy;
    m.dizzy = this.stun > 0 ? 1 : 0;
  }
}

// circle collisions between creatures; dashing creatures shove harder
export function collide(bodies, onBonk) {
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i], b = bodies[j];
    if (a.out || b.out) continue;
    const dx = b.x - a.x, dz = b.z - a.z, dy = Math.abs(a.y - b.y);
    const R = a.P.radius + b.P.radius;
    const d = Math.hypot(dx, dz);
    if (d >= R || d < 1e-4 || dy > 1.2) continue;
    const nx = dx / d, nz = dz / d, pen = R - d;
    const ma = a.P.mass, mb = b.P.mass;
    a.x -= nx * pen * (mb / (ma + mb)); a.z -= nz * pen * (mb / (ma + mb));
    b.x += nx * pen * (ma / (ma + mb)); b.z += nz * pen * (ma / (ma + mb));
    const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
    if (rel > 0) {
      let shoveA = 1, shoveB = 1;
      if (a.dashT > 0) shoveA = 1.55 * (0.6 + a.c.stats.power * 0.07);
      if (b.dashT > 0) shoveB = 1.55 * (0.6 + b.c.stats.power * 0.07);
      const imp = rel * 1.05;
      b.vx += nx * imp * (ma / (ma + mb)) * shoveA / b.P.stability; b.vz += nz * imp * (ma / (ma + mb)) * shoveA / b.P.stability;
      a.vx -= nx * imp * (mb / (ma + mb)) * shoveB / a.P.stability; a.vz -= nz * imp * (mb / (ma + mb)) * shoveB / a.P.stability;
      if (rel > 5) { if (a.dashT > 0) b.stun = 0.4; if (b.dashT > 0) a.stun = 0.4; b.vy += 2.5; a.vy += 1.5; onBonk?.(a, b, rel); }
    }
  }
}
