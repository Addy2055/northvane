import { bakeNormals } from './normals.js';

self.onmessage = (e) => {
  const { hm, N, cell } = e.data;
  const d = bakeNormals(hm, N, cell);
  self.postMessage(d, [d.buffer]);
};
