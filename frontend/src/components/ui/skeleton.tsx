import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  lines?: number;
}

export function Skeleton({
  className,
  variant = 'text',
  width,
  height,
  lines = 1,
}: SkeletonProps) {
  const widthStyle = width ? (typeof width === 'number' ? `${width}px` : width) : undefined;
  const heightStyle = height ? (typeof height === 'number' ? `${height}px` : height) : undefined;

  const baseClasses = 'bg-gray-800 animate-pulse';

  let variantClasses = '';
  if (variant === 'text') {
    variantClasses = 'rounded h-4';
  } else if (variant === 'circular') {
    variantClasses = 'rounded-full';
  } else if (variant === 'rectangular') {
    variantClasses = 'rounded-lg';
  }

  if (lines > 1) {
    return (
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={cn(baseClasses, variantClasses, className)}
            style={{
              width: i === lines - 1 ? '60%' : widthStyle || '100%',
              height: heightStyle || undefined,
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(baseClasses, variantClasses, className)}
      style={{
        width: widthStyle || '100%',
        height: heightStyle || undefined,
      }}
    />
  );
}

/**
 * Skeleton for transcript entries (avatar circle + 2 text lines)
 */
export function SkeletonTranscript() {
  return (
    <div className="space-y-4 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {/* Avatar circle */}
          <Skeleton
            variant="circular"
            width={32}
            height={32}
            className="flex-shrink-0"
          />
          {/* Text content */}
          <div className="flex-1">
            <Skeleton variant="text" width="40%" height={16} className="mb-2" />
            <Skeleton variant="text" lines={2} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton for meeting cards in sidebar/list view
 */
export function SkeletonMeetingCard() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="border border-gray-700 rounded-lg p-3 space-y-2">
          {/* Title bar */}
          <Skeleton variant="text" width="70%" height={18} />
          {/* Text lines */}
          <Skeleton variant="text" lines={2} />
          {/* Timestamp */}
          <Skeleton variant="text" width="40%" height={14} />
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton for summary view (heading + paragraphs + subheading + more content)
 */
export function SkeletonSummary() {
  return (
    <div className="space-y-6 p-4">
      {/* Main heading */}
      <Skeleton variant="text" width="50%" height={24} />

      {/* First paragraph section (4 lines) */}
      <div className="space-y-2">
        <Skeleton variant="text" lines={4} />
      </div>

      {/* Subheading */}
      <Skeleton variant="text" width="35%" height={20} />

      {/* Second paragraph section (3 lines) */}
      <div className="space-y-2">
        <Skeleton variant="text" lines={3} />
      </div>

      {/* Another section */}
      <Skeleton variant="text" width="45%" height={20} />
      <div className="space-y-2">
        <Skeleton variant="text" lines={2} />
      </div>
    </div>
  );
}

/**
 * Skeleton for transcript page loading state
 */
export function SkeletonTranscriptPage() {
  return (
    <div className="flex flex-col h-full">
      {/* Header area */}
      <div className="border-b border-gray-700 p-4 space-y-3">
        <Skeleton variant="text" width="60%" height={28} />
        <Skeleton variant="text" width="80%" height={16} />
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-4">
        <SkeletonTranscript />
      </div>
    </div>
  );
}
