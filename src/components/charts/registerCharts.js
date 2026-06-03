import { Chart, registerables } from "chart.js";

let registered = false;

export function registerCharts() {
  if (!registered) {
    Chart.register(...registerables);
    registered = true;
  }
}
