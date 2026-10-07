/**
 * Controles para celular: joystick virtual (mover) + arrastar no resto da tela (olhar).
 */
export class TouchControls {
  constructor(player, { onInteract, onPause, onScan }) {
    this.player = player;
    this.active = false;
    this.joyId = null;
    this.lookId = null;
    this.last = { x: 0, y: 0 };

    this.joy = document.getElementById('joystick');
    this.knob = document.getElementById('joystick-knob');
    this.btnE = document.getElementById('touch-e');

    const surface = document.getElementById('app');

    this.joy.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      this.joyId = e.pointerId;
      this.joy.setPointerCapture(e.pointerId);
      this.moveJoy(e);
    });
    this.joy.addEventListener('pointermove', (e) => e.pointerId === this.joyId && this.moveJoy(e));
    const endJoy = (e) => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = null;
      this.player.touchMove.set(0, 0);
      this.knob.style.transform = '';
    };
    this.joy.addEventListener('pointerup', endJoy);
    this.joy.addEventListener('pointercancel', endJoy);

    surface.addEventListener('pointerdown', (e) => {
      if (!this.active || e.pointerType !== 'touch' || this.lookId !== null) return;
      this.lookId = e.pointerId;
      this.last = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      this.player.look(e.clientX - this.last.x, e.clientY - this.last.y);
      this.last = { x: e.clientX, y: e.clientY };
    });
    const endLook = (e) => {
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    window.addEventListener('pointerup', endLook);
    window.addEventListener('pointercancel', endLook);

    document.getElementById('touch-jump').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.player.jump();
    });
    this.btnE.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      onInteract();
    });
    document.getElementById('touch-pause').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      onPause();
    });
    document.getElementById('touch-scan').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      onScan();
    });
  }

  moveJoy(e) {
    const rect = this.joy.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const max = rect.width / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.player.touchMove.set(dx / max, -dy / max);
  }

  setReady(ready) {
    this.btnE.classList.toggle('ready', ready);
  }
}
