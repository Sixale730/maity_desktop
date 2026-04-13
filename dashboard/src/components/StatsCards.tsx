import { Code2, FlaskConical, Layers, Timer, CheckCircle2, FileCode2 } from 'lucide-react';
import { Card } from './Card';
import { totalStats } from '../data/metrics';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  suffix?: string;
  color: string;
  delay: number;
}

function StatCard({ icon, label, value, suffix, color, delay }: StatCardProps) {
  return (
    <Card delay={delay} className="relative overflow-hidden">
      <div className={`absolute -right-4 -top-4 h-20 w-20 rounded-full opacity-10 blur-2xl ${color}`} />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
          <p className="mt-1 text-3xl font-bold text-white">
            {typeof value === 'number' ? value.toLocaleString() : value}
            {suffix && <span className="ml-1 text-base font-normal text-gray-500">{suffix}</span>}
          </p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
          {icon}
        </div>
      </div>
    </Card>
  );
}

export function StatsCards() {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
      <StatCard
        icon={<Code2 className="h-5 w-5 text-brand-300" />}
        label="LOC Totales"
        value={totalStats.totalLoc}
        color="bg-brand-500"
        delay={0.05}
      />
      <StatCard
        icon={<FlaskConical className="h-5 w-5 text-green-300" />}
        label="Tests"
        value={totalStats.totalTests}
        suffix="pass"
        color="bg-accent-green"
        delay={0.1}
      />
      <StatCard
        icon={<Layers className="h-5 w-5 text-purple-300" />}
        label="Ciclos"
        value={totalStats.totalCycles}
        color="bg-accent-purple"
        delay={0.15}
      />
      <StatCard
        icon={<FileCode2 className="h-5 w-5 text-cyan-300" />}
        label="Archivos"
        value={totalStats.totalFiles}
        color="bg-accent-cyan"
        delay={0.2}
      />
      <StatCard
        icon={<CheckCircle2 className="h-5 w-5 text-green-300" />}
        label="Build Success"
        value={`${totalStats.buildSuccessRate}%`}
        color="bg-accent-green"
        delay={0.25}
      />
      <StatCard
        icon={<Timer className="h-5 w-5 text-amber-300" />}
        label="Build Promedio"
        value={totalStats.avgBuildTime}
        suffix="min"
        color="bg-accent-amber"
        delay={0.3}
      />
    </div>
  );
}
