// Makes GPUI's canvas composite by its alpha, so a canvas under it shows
// wherever GPUI drew nothing.
//
// gpui-pre-web (0.3.12) configures its surface opaque (`transparent: false`
// in `WebWindow::new`; `set_background_appearance` does nothing), and wgpu's
// WebGPU backend (29.0.4) offers no other alpha mode. But the pixels are
// already right for it: the renderer clears every frame to transparent and
// blends with source-over on both channels, which leaves premultiplied
// color and a true alpha in the canvas. So the only change is how the
// browser composites the canvas: `alphaMode: 'premultiplied'` on WebGPU. A
// WebGL2 context composites that way by default (wgpu-hal sets only
// `antialias`), so that path needs nothing.
//
// Install before the wasm starts. `?opaque` leaves the canvas as GPUI
// configures it: the control.

export function compositeByAlpha(): boolean {
  if (new URLSearchParams(location.search).has('opaque')) return false;
  if (typeof GPUCanvasContext === 'undefined') return true;
  const configure = GPUCanvasContext.prototype.configure;
  GPUCanvasContext.prototype.configure = function (configuration) {
    configure.call(this, { ...configuration, alphaMode: 'premultiplied' });
  };
  return true;
}
