// GH-943 P0: the settled-frame check. Two zero-time repaints of a frame that has finished must photograph byte-identically.
// Pure (two buffers in, a verdict out) so a test can feed it a frame that differs by one byte and watch it refuse.

/** Why these two photographs are not one settled frame, or null when they are byte-identical. */
export function settledFrameRefusal(first: Uint8Array, second: Uint8Array): string | null {
  if (first.length !== second.length) {
    return `settled-frame: two zero-time repaints photographed at different sizes (${first.length} vs ${second.length} bytes)`;
  }
  let differing = 0;
  let firstAt = -1;
  for (let i = 0; i < first.length; i++) {
    if (first[i] !== second[i]) {
      differing++;
      if (firstAt < 0) firstAt = i;
    }
  }
  if (differing === 0) return null;
  return (
    `settled-frame: two zero-time repaints differ in ${differing} byte(s) of the encoded PNG (first at ${firstAt}); the frame had not settled ` +
    '(an async upload, a compile, a texture still arriving, or WebGPU presenting a frame in flight)'
  );
}
