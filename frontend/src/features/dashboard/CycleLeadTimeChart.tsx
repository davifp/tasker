'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AccessibleChart } from '@/components/charts/AccessibleChart';
import type { DistributionSummary } from '@/lib/http/dashboard';

export interface CycleLeadTimeChartProps {
  window: string;
  distributions: DistributionSummary[];
}

export function CycleLeadTimeChart({
  window,
  distributions,
}: CycleLeadTimeChartProps): React.JSX.Element {
  const summary = distributions.map((d) => ({
    label: d.bucketWeek,
    value: d.medianCycleTime,
  }));
  return (
    <AccessibleChart
      ariaLabel={`Cycle and lead time distributions for ${window}`}
      data={summary}
      units="business hours (median cycle)"
      className="h-64 w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={distributions} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
          <XAxis dataKey="bucketWeek" fontSize={10} />
          <YAxis fontSize={10} />
          <Tooltip />
          <Legend />
          <Bar name="Median lead" dataKey="medianLeadTime" fill="#38bdf8" />
          <Bar name="P90 lead" dataKey="p90LeadTime" fill="#0ea5e9" />
          <Bar name="Median cycle" dataKey="medianCycleTime" fill="#a78bfa" />
          <Bar name="P90 cycle" dataKey="p90CycleTime" fill="#7c3aed" />
        </BarChart>
      </ResponsiveContainer>
    </AccessibleChart>
  );
}
