import { GenerationProgressPanel } from './MusicGenerationProgress';
import { CompactTagSelector } from './MusicTagEditor';
import {
  detailTagColors,
  detailTemplateOptions,
  instrumentOptions,
  instrumentTagColors,
  styleOptions,
  styleTagColors,
} from './musicRegulationOptions';
import styles from './MusicRegulation.module.css';

/**
 * The prompt-builder form of the music regulation page: the three tag layers
 * (乐器 / 风格 / 细节), the prompt preview, the generation wait panel, and
 * the duration + submit actions. Presentational — all selection state and
 * the generate flow live on the page.
 */

type MusicPromptFormProps = {
  generatedPrompt: string;
  instruments: string[];
  customInstrument: string;
  selectedStyles: string[];
  customStyle: string;
  detailTemplates: string[];
  details: string;
  openTagSelectorId: string | null;
  onTagSelectorOpenChange: (id: string) => void;
  onDetailsChange: (value: string) => void;
  isGenerating: boolean;
  generationDeviceLabel: string;
  onCancel: () => void;
  generationDuration: number;
  onDurationChange: (duration: number) => void;
  /** Generate requires a signed-in user (the page owns the auth state). */
  isSignedIn: boolean;
  canGenerate: boolean;
  onSubmit: () => void;
};

export function MusicPromptForm({
  generatedPrompt,
  instruments,
  customInstrument,
  selectedStyles,
  customStyle,
  detailTemplates,
  details,
  openTagSelectorId,
  onTagSelectorOpenChange,
  onDetailsChange,
  isGenerating,
  generationDeviceLabel,
  onCancel,
  generationDuration,
  onDurationChange,
  isSignedIn,
  canGenerate,
  onSubmit,
}: MusicPromptFormProps) {
  return (
    <form
      className={`${styles.promptPanel} flex w-full min-w-0 flex-col`}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className={`${styles.promptHeader} flex flex-col`}>
        <span>音乐生成</span>
        <strong>提示词构建</strong>
      </div>

      <div className={`${styles.layeredFields} grid`}>
        <div className={`${styles.promptField} flex min-w-0 flex-col`}>
          <span>第 1 层 · 乐器</span>
          <CompactTagSelector
            id="instrument"
            label="乐器"
            options={instrumentOptions}
            isOpen={openTagSelectorId === 'instrument'}
            selectedValues={instruments}
            colors={instrumentTagColors}
            customValue={customInstrument}
            onOpenChange={onTagSelectorOpenChange}
          />
        </div>

        <div className={`${styles.promptField} flex min-w-0 flex-col`}>
          <span>第 2 层 · 风格</span>
          <CompactTagSelector
            id="style"
            label="风格"
            options={styleOptions}
            isOpen={openTagSelectorId === 'style'}
            selectedValues={selectedStyles}
            colors={styleTagColors}
            customValue={customStyle}
            onOpenChange={onTagSelectorOpenChange}
          />
        </div>

        <div className={`${styles.promptField} flex min-w-0 flex-col`}>
          <span>第 3 层 · 细节（可选）</span>
          <CompactTagSelector
            id="details"
            label="细节"
            options={detailTemplateOptions}
            isOpen={openTagSelectorId === 'details'}
            selectedValues={detailTemplates}
            colors={detailTagColors}
            onOpenChange={onTagSelectorOpenChange}
          />
          <textarea
            value={details}
            maxLength={260}
            rows={3}
            onChange={(event) => onDetailsChange(event.currentTarget.value)}
            placeholder="soft rhythm, warm tone, slow tempo..."
          />
        </div>
      </div>

      <div className={styles.promptPreview} title={generatedPrompt}>
        {generatedPrompt || '选择乐器和风格后生成提示词。'}
      </div>

      {isGenerating ? (
        <GenerationProgressPanel deviceLabel={generationDeviceLabel} onCancel={onCancel} />
      ) : null}

      <div className={`${styles.promptActions} grid items-end`}>
        <label className={`${styles.durationField} flex min-w-0 flex-col`}>
          <span>长度</span>
          <select
            value={generationDuration}
            onChange={(event) => onDurationChange(Number(event.currentTarget.value))}
          >
            <option value={15}>15s</option>
            <option value={30}>30s</option>
            <option value={60}>60s</option>
            <option value={120}>120s</option>
          </select>
        </label>

        <button
          className={`${styles.generateButton} ${isGenerating ? styles.isBusy : ''}`}
          type="submit"
          data-agent-action="generate_music"
          disabled={!isSignedIn || isGenerating || !canGenerate}
        >
          {isGenerating ? '正在生成 WAV' : '生成 WAV'}
        </button>
      </div>
    </form>
  );
}
