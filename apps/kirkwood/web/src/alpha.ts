// Makes GPUI's canvas composite by its alpha, so the scene's canvas under
// it shows wherever GPUI drew nothing.
//
// gpui-pre-web configures its surface opaque, and wgpu's WebGPU backend
// offers no other alpha mode. But the pixels are already right for it: the
// renderer clears every frame to transparent and blends source-over, which
// leaves premultiplied color and a true alpha in the canvas. So the only
// change is how the browser composites the canvas: `alphaMode:
// 'premultiplied'` on WebGPU. A WebGL2 context composites that way by
// default, so that path needs nothing. The other half is the crate's: the
// theme token `Root` fills the window with is transparent (`web.rs`).
//
// It leans on two things GPUI doesn't promise (the transparent clear, the
// blend): `docs/DECISIONS.md`, "Table". Call before the wasm starts.

export function compositeByAlpha(): void {
  if (typeof GPUCanvasContext === 'undefined') return;
  const configure = GPUCanvasContext.prototype.configure;
  GPUCanvasContext.prototype.configure = function (configuration) {
    configure.call(this, { ...configuration, alphaMode: 'premultiplied' });
  };
}
