import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RefreshCw, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';

interface CustomOpenAISettingsProps {
  endpoint: string;
  setEndpoint: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  apiKey: string;
  setApiKey: (value: string) => void;
  maxTokens: string;
  setMaxTokens: (value: string) => void;
  temperature: string;
  setTemperature: (value: string) => void;
  topP: string;
  setTopP: (value: string) => void;
  isAdvancedOpen: boolean;
  setIsAdvancedOpen: (value: boolean) => void;
  isTestingConnection: boolean;
  onTestConnection: () => void;
}

export function CustomOpenAISettings({
  endpoint,
  setEndpoint,
  model,
  setModel,
  apiKey,
  setApiKey,
  maxTokens,
  setMaxTokens,
  temperature,
  setTemperature,
  topP,
  setTopP,
  isAdvancedOpen,
  setIsAdvancedOpen,
  isTestingConnection,
  onTestConnection,
}: CustomOpenAISettingsProps) {
  return (
    <div className="space-y-4 border-t pt-4">
      <div>
        <Label htmlFor="custom-endpoint">URL del Endpoint *</Label>
        <Input
          id="custom-endpoint"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="http://localhost:8000/v1"
          className="mt-1"
        />
        <p className="text-xs text-muted-foreground mt-1">
          URL base de la API compatible con OpenAI
        </p>
      </div>

      <div>
        <Label htmlFor="custom-model">Nombre del Modelo *</Label>
        <Input
          id="custom-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="gpt-4, llama-3-70b, etc."
          className="mt-1"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Identificador del modelo a usar para solicitudes
        </p>
      </div>

      <div>
        <Label htmlFor="custom-api-key">Clave API (opcional)</Label>
        <Input
          id="custom-api-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Dejar vacío si no es requerido"
          className="mt-1"
        />
      </div>

      {/* Advanced Options */}
      <div>
        <div
          className="flex items-center justify-between cursor-pointer py-2"
          onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
        >
          <Label className="cursor-pointer">Opciones Avanzadas</Label>
          {isAdvancedOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>

        {isAdvancedOpen && (
          <div className="space-y-3 pl-2 border-l-2 border-muted mt-2">
            <div>
              <Label htmlFor="custom-max-tokens">Tokens Máximos</Label>
              <Input
                id="custom-max-tokens"
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder="e.g., 4096"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="custom-temperature">Temperatura (0.0-2.0)</Label>
              <Input
                id="custom-temperature"
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                placeholder="e.g., 0.7"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="custom-top-p">Top P (0.0-1.0)</Label>
              <Input
                id="custom-top-p"
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={topP}
                onChange={(e) => setTopP(e.target.value)}
                placeholder="e.g., 0.9"
                className="mt-1"
              />
            </div>
          </div>
        )}
      </div>

      {/* Test Connection */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onTestConnection}
        disabled={isTestingConnection || !endpoint.trim() || !model.trim()}
        className="w-full"
      >
        {isTestingConnection ? (
          <>
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            Probando Conexión...
          </>
        ) : (
          <>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Probar Conexión
          </>
        )}
      </Button>
    </div>
  );
}
