export function bakeNormals(HM, N, cell) {
  const d = new Uint8Array(N * N * 4);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const l = HM[z * N + Math.max(0, x - 1)];
      const r = HM[z * N + Math.min(N - 1, x + 1)];
      const u = HM[Math.max(0, z - 1) * N + x];
      const dn = HM[Math.min(N - 1, z + 1) * N + x];
      const nx = -(r - l) / (2 * cell);
      const nz = -(dn - u) / (2 * cell);
      const ny = 1;
      const L = Math.hypot(nx, ny, nz);
      const i = (z * N + x) * 4;
      d[i] = ((nx / L) * 0.5 + 0.5) * 255;
      d[i + 1] = ((ny / L) * 0.5 + 0.5) * 255;
      d[i + 2] = ((nz / L) * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  return d;
}
