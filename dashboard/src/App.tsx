import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from './components/Header';
import { StatsCards } from './components/StatsCards';
import { TestResults } from './components/TestResults';
import { BuildMetrics } from './components/BuildMetrics';
import { FeatureTimeline } from './components/FeatureTimeline';
import { ImprovementCandidates } from './components/ImprovementCandidates';
import { TranscriptionProviders } from './components/TranscriptionProviders';
import { SessionLog } from './components/SessionLog';
import { ArchitectureOverview } from './components/ArchitectureOverview';
import { PromptsPanel } from './components/PromptsPanel';
import { ConversationLog } from './components/ConversationLog';
import { CoachSimulation } from './components/CoachSimulation';

type View = 'overview' | 'simulations' | 'conversations' | 'prompts' | 'architecture';

const navItems: { id: View; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'simulations', label: 'Coach Test', icon: '🧪' },
  { id: 'conversations', label: 'Conversaciones', icon: '💬' },
  { id: 'prompts', label: 'Prompts & Agents', icon: '🤖' },
  { id: 'architecture', label: 'Arquitectura', icon: '🏗' },
];

export default function App() {
  const [view, setView] = useState<View>('overview');

  return (
    <div className="min-h-screen bg-surface-0">
      <Header />

      {/* Navigation Tabs */}
      <div className="sticky top-[65px] z-40 border-b border-surface-3 bg-surface-1/80 backdrop-blur-xl">
        <div className="mx-auto max-w-[1600px] px-6">
          <nav className="flex gap-1 py-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={`relative rounded-md px-4 py-2 text-xs font-medium transition-colors ${
                  view === item.id
                    ? 'text-white'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-surface-2'
                }`}
              >
                <span className="relative z-10 flex items-center gap-1.5">
                  <span>{item.icon}</span>
                  {item.label}
                </span>
                {view === item.id && (
                  <motion.div
                    layoutId="nav-indicator"
                    className="absolute inset-0 rounded-md bg-surface-3"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                  />
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-[1600px] px-6 py-6">
        <AnimatePresence mode="wait">
          {view === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              <StatsCards />

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <TestResults />
                <BuildMetrics />
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <FeatureTimeline />
                <ImprovementCandidates />
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
                <TranscriptionProviders />
                <SessionLog />
                <div className="lg:col-span-2 xl:col-span-1">
                  {/* Quick tip summary */}
                  <QuickTipsSummary />
                </div>
              </div>
            </motion.div>
          )}

          {view === 'simulations' && (
            <motion.div
              key="simulations"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              <CoachSimulation />
            </motion.div>
          )}

          {view === 'conversations' && (
            <motion.div
              key="conversations"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              <StatsCards />
              <ConversationLog />
            </motion.div>
          )}

          {view === 'prompts' && (
            <motion.div
              key="prompts"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <PromptsPanel />
                <div className="space-y-6">
                  <PromptUsageChart />
                  <AgentActivityMatrix />
                </div>
              </div>
            </motion.div>
          )}

          {view === 'architecture' && (
            <motion.div
              key="architecture"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <ArchitectureOverview />
                <TranscriptionProviders />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <footer className="mt-8 border-t border-surface-3 pt-4 pb-8 text-center">
          <p className="text-xs text-gray-600">
            Maity Desktop Dev Dashboard — Generado con datos de{' '}
            <span className="font-mono text-gray-500">memory/</span> y{' '}
            <span className="font-mono text-gray-500">CLAUDE.md</span>
          </p>
          <p className="mt-1 text-[10px] text-gray-700">
            Actualizar <span className="font-mono">src/data/metrics.ts</span> despues de cada ciclo de mejora
          </p>
        </footer>
      </main>
    </div>
  );
}

// ============================================================
// Inline sub-components for new views
// ============================================================

import { Card, CardHeader, CardTitle } from './components/Card';
import { conversations, prompts } from './data/metrics';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

function QuickTipsSummary() {
  const allTips = conversations.flatMap((c) => c.tips);
  const applied = allTips.filter((t) => t.applied).length;
  const categories = [...new Set(allTips.map((t) => t.category))];
  const byCat = categories.map((cat) => ({
    name: cat,
    total: allTips.filter((t) => t.category === cat).length,
    applied: allTips.filter((t) => t.category === cat && t.applied).length,
  }));

  const catColors: Record<string, string> = {
    optimization: '#f59e0b',
    architecture: '#3b82f6',
    testing: '#22c55e',
    security: '#ef4444',
    ux: '#a855f7',
    performance: '#06b6d4',
  };

  return (
    <Card delay={0.35}>
      <CardHeader>
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-cyan/10">
          <svg className="h-3.5 w-3.5 text-accent-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.663 17h4.673M12 3v1m6.364 1.636-.707.707M21 12h-1M4 12H3m3.343-5.657-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
        <CardTitle>Tips Resumen</CardTitle>
        <span className="ml-auto rounded-full bg-accent-green/10 px-2 py-0.5 text-[10px] font-bold text-accent-green">
          {applied}/{allTips.length} aplicados
        </span>
      </CardHeader>

      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={byCat} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#222230" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#6b7280' }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} width={80} />
            <Tooltip
              contentStyle={{ background: '#1a1a25', border: '1px solid #222230', borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: '#9ca3af' }}
            />
            <Bar dataKey="applied" name="Aplicados" radius={[0, 4, 4, 0]}>
              {byCat.map((entry) => (
                <Cell key={entry.name} fill={catColors[entry.name] || '#6b7280'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function PromptUsageChart() {
  const data = prompts.map((p) => ({
    name: p.name.replace(' Agent', '').replace(' Protocol', ''),
    sessions: p.usedIn.length,
    type: p.type,
  }));

  const typeColors: Record<string, string> = {
    system: '#ef4444',
    agent: '#3b82f6',
    skill: '#a855f7',
    hook: '#f59e0b',
  };

  return (
    <Card delay={0.3}>
      <CardHeader>
        <CardTitle>Uso de Prompts por Sesion</CardTitle>
      </CardHeader>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#222230" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#6b7280' }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#6b7280' }} width={120} />
            <Tooltip
              contentStyle={{ background: '#1a1a25', border: '1px solid #222230', borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: '#9ca3af' }}
            />
            <Bar dataKey="sessions" name="Sesiones" radius={[0, 4, 4, 0]}>
              {data.map((entry) => (
                <Cell key={entry.name} fill={typeColors[entry.type] || '#6b7280'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function AgentActivityMatrix() {
  const agentPrompts = prompts.filter((p) => p.type === 'agent');

  return (
    <Card delay={0.35}>
      <CardHeader>
        <CardTitle>Agent Activity Matrix</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-2 gap-2">
        {agentPrompts.map((agent) => {
          const sessionsUsed = agent.usedIn.length;
          const maxSessions = conversations.length;
          const pct = Math.round((sessionsUsed / maxSessions) * 100);

          return (
            <div
              key={agent.id}
              className="rounded-lg border border-surface-3 bg-surface-2/50 p-3 hover:border-surface-4 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-white truncate">
                  {agent.name.replace(' Agent', '')}
                </span>
                <span className="text-[10px] font-mono text-gray-500">{pct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1.5 text-[10px] text-gray-600 line-clamp-2">{agent.content}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
