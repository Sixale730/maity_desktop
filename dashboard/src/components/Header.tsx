import { motion } from 'framer-motion';
import { Activity, GitBranch, Calendar } from 'lucide-react';
import { projectInfo, totalStats } from '../data/metrics';

export function Header() {
  return (
    <motion.header
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="border-b border-surface-3 bg-surface-1/80 backdrop-blur-xl sticky top-0 z-50"
    >
      <div className="mx-auto max-w-[1600px] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-500/25">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">
                {projectInfo.name}{' '}
                <span className="text-brand-400">Dev Dashboard</span>
              </h1>
              <p className="text-xs text-gray-500">{projectInfo.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <GitBranch className="h-3.5 w-3.5" />
              <span className="font-mono">v{projectInfo.version}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Calendar className="h-3.5 w-3.5" />
              <span>{projectInfo.lastUpdate}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-accent-green animate-pulse-slow" />
              <span className="text-xs font-medium text-accent-green">
                {totalStats.totalTests}/{totalStats.totalTests} Tests Pass
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.header>
  );
}
