'use client';

import { Sparkles, CheckCircle2, Lightbulb, MessageCircle, LayoutList, Shield, Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CommunicationFeedback } from '@/types/communication';

interface CommunicationFeedbackPanelProps {
  feedback: CommunicationFeedback;
}

// Component to display an insight card
function InsightCard({
  icon: Icon,
  title,
  content
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  content: string;
}) {
  return (
    <div className="p-3 bg-secondary rounded-lg border border-border">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-primary" />
        <h5 className="text-sm font-medium text-foreground">{title}</h5>
      </div>
      <p className="text-sm text-muted-foreground">{content}</p>
    </div>
  );
}

export function CommunicationFeedbackPanel({ feedback }: CommunicationFeedbackPanelProps) {
  // Check if there's any meaningful feedback data
  const hasScores = feedback.overall_score !== undefined ||
                    feedback.clarity !== undefined ||
                    feedback.engagement !== undefined ||
                    feedback.structure !== undefined;

  const hasContent = hasScores ||
                     feedback.feedback ||
                     feedback.summary ||
                     (feedback.strengths && feedback.strengths.length > 0) ||
                     (feedback.areas_to_improve && feedback.areas_to_improve.length > 0);

  if (!hasContent) {
    return null;
  }

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="h-5 w-5 text-primary" />
          Analisis de Comunicacion
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall Score */}
        {feedback.overall_score !== undefined && (
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Puntuacion General</span>
              <span className="font-medium text-foreground">{feedback.overall_score.toFixed(1)}/10</span>
            </div>
            <Progress value={feedback.overall_score * 10} className="h-2" />
          </div>
        )}

        {/* Individual Scores */}
        <div className="grid gap-3 sm:grid-cols-3">
          {feedback.clarity !== undefined && (
            <div className="p-3 bg-secondary rounded-lg">
              <div className="text-xs text-muted-foreground mb-1">Claridad</div>
              <div className="text-xl font-bold text-foreground">{feedback.clarity.toFixed(1)}/10</div>
            </div>
          )}
          {feedback.engagement !== undefined && (
            <div className="p-3 bg-secondary rounded-lg">
              <div className="text-xs text-muted-foreground mb-1">Engagement</div>
              <div className="text-xl font-bold text-foreground">{feedback.engagement.toFixed(1)}/10</div>
            </div>
          )}
          {feedback.structure !== undefined && (
            <div className="p-3 bg-secondary rounded-lg">
              <div className="text-xs text-muted-foreground mb-1">Estructura</div>
              <div className="text-xl font-bold text-foreground">{feedback.structure.toFixed(1)}/10</div>
            </div>
          )}
        </div>

        {/* Feedback Text (uses summary as fallback) */}
        {(feedback.feedback || feedback.summary) && (
          <p className="text-sm text-muted-foreground">{feedback.feedback || feedback.summary}</p>
        )}

        {/* Strengths & Areas to Improve */}
        <div className="grid gap-4 sm:grid-cols-2">
          {feedback.strengths && feedback.strengths.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2 text-green-600">Fortalezas</h4>
              <ul className="space-y-1">
                {feedback.strengths.map((s, i) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span className="text-muted-foreground">{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {feedback.areas_to_improve && feedback.areas_to_improve.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2 text-amber-600">Areas de Mejora</h4>
              <ul className="space-y-1">
                {feedback.areas_to_improve.map((a, i) => (
                  <li key={i} className="text-sm text-muted-foreground">
                    <span className="text-amber-500 mr-2">•</span>
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Insights/Observations */}
        {feedback.observations && (
          <div className="space-y-3 pt-4 border-t border-border">
            <h4 className="text-sm font-medium flex items-center gap-2 text-foreground">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Insights
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              {feedback.observations.clarity && (
                <InsightCard
                  icon={MessageCircle}
                  title="Claridad"
                  content={feedback.observations.clarity}
                />
              )}
              {feedback.observations.structure && (
                <InsightCard
                  icon={LayoutList}
                  title="Estructura"
                  content={feedback.observations.structure}
                />
              )}
              {feedback.observations.objections && (
                <InsightCard
                  icon={Shield}
                  title="Objeciones"
                  content={feedback.observations.objections}
                />
              )}
              {feedback.observations.calls_to_action && (
                <InsightCard
                  icon={Target}
                  title="Llamadas a la Accion"
                  content={feedback.observations.calls_to_action}
                />
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
