// Keyboard + touch stick + drag-to-look, flattened into one simple state.
export class Input {
  constructor(app) {
    this.app = app;
    this.keys = new Set();
    this.pressed = new Set();
    this.stick = { x: 0, y: 0 };
    this.camDX = 0; this.camDY = 0;
    this.touchJump = false; this.touchJumpPressed = false; this.touchDash = false;
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (k === ' ' && app.mode !== 'creator') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    // drag to look (island + events)
    const gl = document.getElementById('gl');
    let drag = null;
    gl.addEventListener('pointerdown', (e) => { if (app.mode === 'island' || app.mode === 'event' || app.mode === 'title') drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
    window.addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id) { this.camDX += e.clientX - drag.x; this.camDY += e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; } });
    window.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.id) drag = null; });

    // touch stick
    const stick = document.getElementById('stick'), knob = stick.querySelector('i');
    let sid = null, c = null;
    stick.addEventListener('pointerdown', (e) => { sid = e.pointerId; stick.setPointerCapture(sid); const r = stick.getBoundingClientRect(); c = { x: r.left + r.width / 2, y: r.top + r.height / 2, R: r.width / 2 }; move(e); });
    const move = (e) => {
      if (e.pointerId !== sid) return;
      let dx = (e.clientX - c.x) / c.R, dy = (e.clientY - c.y) / c.R; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
      this.stick.x = dx; this.stick.y = -dy;
      knob.style.transform = `translate(${dx * c.R * 0.6}px, ${dy * c.R * 0.6}px)`;
    };
    stick.addEventListener('pointermove', move);
    const up = (e) => { if (e.pointerId !== sid) return; sid = null; this.stick.x = this.stick.y = 0; knob.style.transform = ''; };
    stick.addEventListener('pointerup', up); stick.addEventListener('pointercancel', up);
    const jb = document.getElementById('t-jump'), db = document.getElementById('t-dash');
    jb.addEventListener('pointerdown', (e) => { e.preventDefault(); this.touchJump = true; this.touchJumpPressed = true; });
    jb.addEventListener('pointerup', () => { this.touchJump = false; });
    jb.addEventListener('pointercancel', () => { this.touchJump = false; });
    db.addEventListener('pointerdown', (e) => { e.preventDefault(); this.touchDash = true; });
  }

  get moveX() { const k = this.keys; return ((k.has('d') || k.has('arrowright')) ? 1 : 0) - ((k.has('a') || k.has('arrowleft')) ? 1 : 0) + this.stick.x; }
  get moveY() { const k = this.keys; return ((k.has('w') || k.has('arrowup')) ? 1 : 0) - ((k.has('s') || k.has('arrowdown')) ? 1 : 0) + this.stick.y; }
  get jump() { return this.keys.has(' ') || this.touchJump; }
  get jumpPressed() { return this.pressed.has(' ') || this.touchJumpPressed; }
  get dashPressed() { return this.pressed.has('shift') || this.touchDash; }
  get interactPressed() { return this.pressed.has('e') || this.pressed.has('enter'); }

  takeCam() { const d = [this.camDX, this.camDY]; this.camDX = 0; this.camDY = 0; return d; }
  endFrame() { this.pressed.clear(); this.touchJumpPressed = false; this.touchDash = false; }
}
