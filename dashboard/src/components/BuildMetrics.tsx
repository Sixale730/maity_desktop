import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend,
} from 'recharts';
import { Card, CardHeader, CardTitle } from './Card';
import { buildSnapshots } from '../data/metrics';

const chartData = buildSnapshots.map((snap, i) => ({
  name: `Build ${i + 1}`,
  date: snap.date,
  exe: snap.exeSize,
  msi: snap.msiSize,
  time: snap.buildTime,
  tests: snap.testsTotal,
  warnings: snap.warnings,
}));

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg border border-surface-3 bg-surface-2 p-3 shadow-xl">
      <p className="mb-1 text-xs font-semibold text-gray-400">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-xs" style={{ color: entry.color }}>
          {entry.name}: <span className="font-mono font-semibold">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

export function BuildMetrics() {
  return (
    <Card delay={0.2} className="col-span-1 lg:col-span-2">
      <CardHeader>
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-500/10">
          <svg className="h-3.5 w-3.5 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        </div>
        <CardTitle>Build Metrics</CardTitle>
      </CardHeader>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Bundle Size Chart */}
        <div>
          <p className="mb-2 text-xs font-medium text-gray-500">Bundle Size (MB)</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="gradExe" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradMsi" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a855f7" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#a855f7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#222230" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} domain={[25, 65]} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="exe" stroke="#3b82f6" fill="url(#gradExe)" name="EXE" strokeWidth={2} />
                <Area type="monotone" dataKey="msi" stroke="#a855f7" fill="url(#gradMsi)" name="MSI" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Build Time + Tests */}
        <div>
          <p className="mb-2 text-xs font-medium text-gray-500">Build Time (min) & Tests Count</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#222230" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  iconSize={8}
                  wrapperStyle={{ fontSize: '10px', color: '#6b7280' }}
                />
                <Bar dataKey="time" fill="#f59e0b" name="Build Time" radius={[4, 4, 0, 0]} />
                <Bar dataKey="tests" fill="#22c55e" name="Tests" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Card>
  );
}
