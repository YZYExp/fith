export const parseMatrix = (tf: string) => {
  if (!tf || tf === 'none') return null;
  const m = tf.match(/matrix\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { a: p[0], b: p[1], c: p[2], d: p[3], e: p[4], f: p[5] };
  }
  const m3 = tf.match(/matrix3d\(([^)]+)\)/);
  if (m3) {
    const p = m3[1].split(',').map((x) => parseFloat(x));
    return { a: p[0], b: p[1], c: p[4], d: p[5], e: p[12], f: p[13] };
  }
  return null;
};
