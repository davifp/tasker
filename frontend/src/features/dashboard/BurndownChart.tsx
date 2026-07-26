'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AccessibleChart } from '@/components/charts/AccessibleChart';
import type { BurndownPoint } from '@/lib/http/dashboard';

export interface BurndownChartProps {
  sprintNumber: number;
  points: BurndownPoint[];
}

/**
 * Sprint burndown as a Recharts LineChart, wrapped in `AccessibleChart` so
 * assistive tech announces the summary in one line. Renders the ideal line
 * (planned points at day 0 → 0 at end) alongside remaining points.
 */
export function BurndownChart({ sprintNumber, points }: BurndownChartProps): React.JSX.Element {
  const chartData = withIdealSeries(points);
  const summary = points.map((p) => ({ label: p.day, value: p.remainingPoints }));
  return (
    <AccessibleChart
      ariaLabel={`Burndown for Sprint ${sprintNumber} — ${points.length} days`}
      data={summary}
      units="points remaining"
      className="h-64 w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
          <XAxis dataKey="day" fontSize={10} />
          <YAxis fontSize={10} />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            name="Ideal"
            dataKey="ideal"
            stroke="#94a3b8"
            strokeDasharray="4 4"
            dot={false}
          />
          <Line
            type="monotone"
            name="Remaining"
            dataKey="remainingPoints"
            stroke="#2563eb"
            strokeWidth={2}
            dot={{ r: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </AccessibleChart>
  );
}

/**
 * Adds a straight-line ideal series from the first day's planned points
 * down to 0 on the last day. Callers pass the raw matview output; this
 * helper stays inside the chart component so upstream code does not need
 * to know about the visual overlay.
 */
function withIdealSeries(points: BurndownPoint[]) {
  if (points.length === 0) return [];
  const planned = points[0]!.plannedPoints;
  const total = points.length - 1;
  return points.map((p, idx) => ({
    ...p,
    ideal: total > 0 ? planned - (planned / total) * idx : planned,
  }));
}
