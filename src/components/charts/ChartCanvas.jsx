import { useEffect, useRef } from "react";
import { Chart } from "chart.js";

export default function ChartCanvas({ type, data, options, height = 260 }) {
  const ref = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!ref.current || !data) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(ref.current, { type, data, options });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [data, type, options]);

  return (
    <div style={{ position: "relative", height }}>
      <canvas ref={ref} />
    </div>
  );
}
