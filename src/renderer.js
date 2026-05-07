// ===========================================================
// Slidecast — renderer
// Draws current slide + subtitle on a 1920x1080 canvas, ~60fps.
// Slide source can be:
//   - 'images': dataURL/objectURL list  (PDF-rendered or uploaded images)
//   - 'iframe': a hidden iframe element rendering the live HTML deck
// ===========================================================

export class SlidecastRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = canvas.width;
    this.height = canvas.height;
    this.bg = '#000000';
    this.subtitleStyle = {
      fontFamily: '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif',
      size: 44,
      lineHeight: 1.35,
      color: '#ffffff',
      bgAlpha: 0.55,
      bgColor: '#000000',
      maxWidthFrac: 0.84,
      bottomMargin: 80,
      paddingX: 36,
      paddingY: 22,
      radius: 14,
      enabled: true,
    };

    // Slide source
    this.mode = 'idle';        // 'images' | 'iframe' | 'idle'
    this.images = [];          // HTMLImageElement[]
    this.iframe = null;        // HTMLIFrameElement (hidden, sized to 1920x1080)

    // current state
    this.currentSlide = 0;
    this.currentSubtitle = '';

    // rAF
    this._raf = null;
    this._rendering = false;
  }

  setBackground(c) { this.bg = c; }
  setSubtitleStyle(patch) { Object.assign(this.subtitleStyle, patch); }

  async loadImages(urls) {
    this.images = await Promise.all(urls.map(u => new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.crossOrigin = 'anonymous';
      im.src = u;
    })));
    this.mode = 'images';
  }

  attachIframe(iframe) {
    this.iframe = iframe;
    this.mode = 'iframe';
  }

  setSlide(idx) {
    this.currentSlide = idx;
    if (this.mode === 'iframe' && this.iframe && this.iframe.contentWindow) {
      // Try to call a goTo() function exposed by deck-stage or our chrome
      try {
        const win = this.iframe.contentWindow;
        if (typeof win.__slidecastGoTo === 'function') {
          win.__slidecastGoTo(idx);
        } else {
          const stage = this.iframe.contentDocument?.querySelector('deck-stage');
          if (stage && typeof stage.goTo === 'function') stage.goTo(idx);
        }
      } catch {}
    }
  }

  setSubtitle(text) { this.currentSubtitle = text || ''; }

  start() {
    if (this._rendering) return;
    this._rendering = true;
    const tick = () => {
      if (!this._rendering) return;
      this.draw();
      this._raf = requestAnimationFrame(tick);
    };
    tick();
  }

  stop() {
    this._rendering = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  draw() {
    const { ctx, width: W, height: H } = this;
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, W, H);

    if (this.mode === 'images' && this.images.length) {
      const im = this.images[Math.max(0, Math.min(this.images.length - 1, this.currentSlide))];
      this._drawContain(im, 0, 0, W, H);
    } else if (this.mode === 'iframe' && this.iframe) {
      // Capture iframe via html2canvas-free path: use the iframe's documentElement
      // via OffscreenCanvas-friendly trick? Browsers don't allow drawing iframes
      // directly. Instead we layer the iframe behind the canvas using DOM and
      // draw a transparent layer here.
      // For recording, we therefore COMPOSITE in DOM via captureStream of the
      // wrapper element using requestVideoFrameCallback — simpler to just
      // use an HTMLCanvasElement-only mode. So in iframe mode, recording uses
      // a different stream (canvas covers subtitles, iframe covers visuals).
      // Here, leave the canvas transparent except for subtitles.
      ctx.clearRect(0, 0, W, H);
    }

    if (this.subtitleStyle.enabled && this.currentSubtitle) {
      this._drawSubtitle(this.currentSubtitle);
    }
  }

  _drawContain(im, x, y, w, h) {
    if (!im || !im.naturalWidth) return;
    const ar = im.naturalWidth / im.naturalHeight;
    const targetAr = w / h;
    let dw, dh;
    if (ar > targetAr) { dw = w; dh = w / ar; }
    else { dh = h; dw = h * ar; }
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;
    this.ctx.drawImage(im, dx, dy, dw, dh);
  }

  _wrapText(text, maxWidth) {
    // Chinese-friendly wrap: try by char run, allow break anywhere; but prefer to break
    // after punctuation。
    const ctx = this.ctx;
    const lines = [];
    let cur = '';
    for (const ch of text) {
      const test = cur + ch;
      if (ctx.measureText(test).width <= maxWidth) {
        cur = test;
      } else {
        if (cur) lines.push(cur);
        cur = ch;
      }
      // soft-break after punctuation if we're getting near the end
      if (/[。？！，、；：]/.test(ch) && ctx.measureText(cur).width > maxWidth * 0.6) {
        lines.push(cur);
        cur = '';
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  _drawSubtitle(text) {
    const s = this.subtitleStyle;
    const { ctx, width: W, height: H } = this;
    ctx.save();
    ctx.font = `600 ${s.size}px ${s.fontFamily}`;
    ctx.textBaseline = 'middle';
    const maxW = Math.floor(W * s.maxWidthFrac);
    const lines = this._wrapText(text, maxW);
    const lineH = Math.round(s.size * s.lineHeight);
    const blockH = lines.length * lineH;

    // measure widest
    let maxLineW = 0;
    for (const l of lines) maxLineW = Math.max(maxLineW, ctx.measureText(l).width);

    const boxW = Math.min(maxW, maxLineW) + s.paddingX * 2;
    const boxH = blockH + s.paddingY * 2;
    const boxX = (W - boxW) / 2;
    const boxY = H - s.bottomMargin - boxH;

    // background
    ctx.fillStyle = `rgba(0,0,0,${s.bgAlpha})`;
    this._roundRect(boxX, boxY, boxW, boxH, s.radius);
    ctx.fill();

    // text
    ctx.fillStyle = s.color;
    ctx.textAlign = 'center';
    const cx = boxX + boxW / 2;
    let y = boxY + s.paddingY + lineH / 2;
    for (const ln of lines) {
      ctx.fillText(ln, cx, y);
      y += lineH;
    }
    ctx.restore();
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}


