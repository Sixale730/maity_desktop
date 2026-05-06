import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getFormResponses, type FormResponse } from '@/features/conversations/services/conversations.service';

export interface RadarCompetency {
  competencia: string;
  usuario: number;
}

const SAMPLE_FORM: FormResponse = {
  q5: '3', q6: '3', q7: '4', q8: '4', q9: '5', q10: '5',
  q11: '5', q12: '5', q13: '5', q14: '5', q15: '5', q16: '5',
};

function mapToRadar(r: FormResponse): RadarCompetency[] {
  const v = (s: string | undefined) => (s ? parseInt(s, 10) * 20 : 0);
  const avg = (a: number, b: number) => Math.round((a + b) / 2);
  return [
    { competencia: 'Claridad',   usuario: avg(v(r.q5),  v(r.q6))  },
    { competencia: 'Adaptación', usuario: avg(v(r.q7),  v(r.q8))  },
    { competencia: 'Persuasión', usuario: avg(v(r.q9),  v(r.q10)) },
    { competencia: 'Estructura', usuario: avg(v(r.q11), v(r.q12)) },
    { competencia: 'Propósito',  usuario: avg(v(r.q13), v(r.q14)) },
    { competencia: 'Empatía',    usuario: avg(v(r.q15), v(r.q16)) },
  ];
}

export function useFormResponsesRadar() {
  const { maityUser } = useAuth();
  const [radarData, setRadarData] = useState<RadarCompetency[]>(() => mapToRadar(SAMPLE_FORM));
  const [loading, setLoading] = useState(true);

  const fetchResponses = useCallback(async () => {
    if (!maityUser?.id) {
      setRadarData(mapToRadar(SAMPLE_FORM));
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await getFormResponses(maityUser.id);
      setRadarData(mapToRadar(data ?? SAMPLE_FORM));
    } catch {
      setRadarData(mapToRadar(SAMPLE_FORM));
    } finally {
      setLoading(false);
    }
  }, [maityUser?.id]);

  useEffect(() => {
    fetchResponses();
  }, [fetchResponses]);

  return { radarData, loading };
}
