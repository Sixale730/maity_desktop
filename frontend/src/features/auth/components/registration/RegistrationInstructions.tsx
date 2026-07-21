import { Button } from '@/ui/components/ui/button';
import { Card, CardContent } from '@/ui/components/ui/card';
import { MessageCircle, Target, Sparkles, ChevronLeft } from 'lucide-react';

interface RegistrationInstructionsProps {
  onStart: () => void;
  /** Opcional: volver al paso anterior (avatar). Si no se pasa, no se muestra el botón. */
  onBack?: () => void;
}

export function RegistrationInstructions({ onStart, onBack }: RegistrationInstructionsProps) {
  return (
    <div className="w-full space-y-6">
      {/* Welcome Message */}
      <div className="text-center space-y-2 mb-4">
        <h1 className="text-3xl sm:text-4xl font-bold text-foreground">
          ¡Bienvenido a Maity!
        </h1>
        <p className="text-lg sm:text-xl text-muted-foreground">
          Tu coach de comunicación con IA. En solo 3 minutos configuraremos tu experiencia.
        </p>
      </div>

      {/* Header */}
      <div className="text-center space-y-3">
        <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
          Autoevaluación Maity: Descubre tu estilo de comunicación
        </h2>
        <div className="space-y-1">
          <p className="text-base sm:text-lg text-muted-foreground">
            Explora cómo te expresas, conectas e inspiras a los demás.
          </p>
          <p className="text-base sm:text-lg text-muted-foreground">
            En solo 1 minuto, obtendrás un mapa visual de tus fortalezas y oportunidades.
          </p>
        </div>
      </div>

      {/* 3 Steps Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Step 1: Introducción */}
        <Card className="bg-gradient-to-br from-blue-900/20 to-blue-800/10 border-blue-500/30">
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-blue-400" />
              <h3 className="font-semibold text-base">1. Introducción</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Maity te acompañará a conocer cómo comunicas y qué te hace único al expresarte.
            </p>
          </CardContent>
        </Card>

        {/* Step 2: Evaluación rápida */}
        <Card className="bg-gradient-to-br from-pink-900/20 to-pink-800/10 border-pink-500/30">
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-pink-400" />
              <h3 className="font-semibold text-base">2. Evaluación rápida</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Contesta brevemente sobre cómo hablas, escuchas y conectas.
            </p>
          </CardContent>
        </Card>

        {/* Step 3: Resultados */}
        <Card className="bg-gradient-to-br from-yellow-900/20 to-yellow-800/10 border-yellow-500/30">
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-yellow-400" />
              <h3 className="font-semibold text-base">3. Resultados</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Descubre tus fortalezas comunicativas y recibe sugerencias personalizadas.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Video */}
      <Card className="bg-muted/50">
        <CardContent className="p-0">
          <div className="aspect-video rounded-lg overflow-hidden">
            <iframe
              width="100%"
              height="100%"
              src="https://www.youtube.com/embed/Nf3Y_SEuhbw"
              title="Autoevaluación Maity - Video introductorio"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full h-full"
              // react-doctor-disable-next-line react-doctor/iframe-missing-sandbox -- trusted first-party YouTube embed (hardcoded src); the player needs allow-scripts+allow-same-origin. The sandbox still blocks top-nav/forms/downloads.
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            />
          </div>
        </CardContent>
      </Card>

      {/* Bottom Text */}
      <div className="text-center space-y-4">
        <p className="text-sm sm:text-base text-muted-foreground">
          Observa cómo tu voz, tus gestos y tus palabras crean impacto. Maity te mostrará cómo comunicar con más claridad, empatía y propósito.
        </p>

        <p className="text-sm font-medium text-foreground">
          Esta autoevaluación dura solo 1 minuto
        </p>

        {/* Botones: Regresar + Comenzar */}
        <div className="flex flex-col-reverse sm:flex-row items-center justify-center gap-3">
          {onBack && (
            <Button
              onClick={onBack}
              variant="outline"
              size="lg"
              className="w-full sm:w-auto px-6"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Regresar
            </Button>
          )}
          <Button
            onClick={onStart}
            size="lg"
            className="w-full sm:w-auto px-8 bg-primary hover:bg-primary/90 text-white font-semibold shadow-lg hover:shadow-pink-500/25 hover:-translate-y-0.5 transition-all"
          >
            Comenzar
          </Button>
        </div>
      </div>
    </div>
  );
}
