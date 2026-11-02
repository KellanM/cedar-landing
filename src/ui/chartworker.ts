/** Web worker: the CPU-heavy part of the chart (components, distance fields, contours, washes). */
import { computeChart, chartTransfer } from './chartart';

self.onmessage = (e: MessageEvent<{ px: Uint8Array; fw: number; fh: number; worldW: number; id: number }>) => {
  const { px, fw, fh, worldW, id } = e.data;
  const d = computeChart(px, fw, fh, worldW);
  (self as unknown as Worker).postMessage({ id, d }, chartTransfer(d));
};
