import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ModelSettingsModal } from "@/components/models/ModelSettingsModal"
import type { ModelConfig } from "@/types/models"
import { TranscriptSettings } from "@/components/transcript/TranscriptSettings"
import type { TranscriptModelProps } from "@/types/transcript"
import { RecordingSettings } from "@/components/recording/RecordingSettings"
import type { RecordingPreferences } from "@/types/audio"
import { About } from "@/components/settings/About"
import { MeetingDetectorSettings } from "@/components/meeting-detection/MeetingDetectorSettings"

interface SettingTabsProps {
    modelConfig: ModelConfig;
    setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
    onSave: (config: ModelConfig) => void;
    transcriptModelConfig: TranscriptModelProps;
    setTranscriptModelConfig: (config: TranscriptModelProps) => void;
    onSaveTranscript: (config: TranscriptModelProps) => void;
    setSaveSuccess: (success: boolean | null) => void;
    defaultTab?: string;
}

export function SettingTabs({ 
    modelConfig, 
    setModelConfig, 
    onSave, 
    setSaveSuccess,
    defaultTab = "transcriptSettings",
    transcriptModelConfig,
    setTranscriptModelConfig,
    onSaveTranscript,
}: SettingTabsProps) {

    const handleTabChange = () => {
        setSaveSuccess(null); // Reset save success when tab changes
    };

    return (
        <Tabs defaultValue={defaultTab} className="w-full max-h-[calc(100vh-10rem)] overflow-y-auto" onValueChange={handleTabChange}>
  <TabsList>
    <TabsTrigger value="transcriptSettings">Transcripción</TabsTrigger>
    <TabsTrigger value="modelSettings">Resumen IA</TabsTrigger>
    <TabsTrigger value="recordingSettings">Preferencias</TabsTrigger>
    <TabsTrigger value="meetingDetection">Reuniones</TabsTrigger>
    <TabsTrigger value="about">Acerca de</TabsTrigger>
  </TabsList>
  <TabsContent value="modelSettings">
    <ModelSettingsModal

modelConfig={modelConfig}
setModelConfig={setModelConfig}
onSave={onSave}
/>
  </TabsContent>
<TabsContent value="transcriptSettings">
    <TranscriptSettings
    transcriptModelConfig={transcriptModelConfig}
    setTranscriptModelConfig={setTranscriptModelConfig}
    // onSave={onSaveTranscript}
  />
  </TabsContent>
  <TabsContent value="recordingSettings">
    <RecordingSettings />
  </TabsContent>
  <TabsContent value="meetingDetection">
    <MeetingDetectorSettings />
  </TabsContent>
  <TabsContent value="about">
    <About />
  </TabsContent>
</Tabs>
    )
}


