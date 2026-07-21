import { motion } from 'framer-motion';
import { cn } from '@maity/shared';

interface ProgressIndicatorProps {
  currentStep: number; // 0-18
  totalSteps: number; // 19
  answeredSteps: number; // Number of questions actually answered
  className?: string;
}

export function ProgressIndicator({
  currentStep,
  totalSteps,
  answeredSteps,
  className,
}: ProgressIndicatorProps) {
  const progress = (answeredSteps / totalSteps) * 100;

  return (
    <div className={cn('w-full space-y-3', className)}>
      {/* Step Counter */}
      <div className="flex justify-between items-center text-sm">
        <span className="font-medium text-foreground">
          Pregunta {currentStep + 1} de {totalSteps}
        </span>
        <span className="text-muted-foreground">{Math.round(progress)}%</span>
      </div>

      {/* Progress Bar */}
      <div className="relative h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
        <motion.div
          className="absolute top-0 left-0 h-full bg-gradient-to-r from-primary to-primary/80 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
        />
      </div>

      {/* Mini Step Indicators */}
      <div className="flex gap-1">
        {Array.from({ length: totalSteps }).map((_, index) => (
          <motion.div
            key={index}
            className={cn(
              'flex-1 h-1 rounded-full transition-colors duration-300',
              index <= currentStep
                ? 'bg-primary'
                : 'bg-gray-200 dark:bg-gray-800'
            )}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.02 }}
          />
        ))}
      </div>
    </div>
  );
}
