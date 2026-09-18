/**
 * The line a generate command prints for a human to paste into
 * `docs/ASSET_PROVENANCE.md`'s Meshy table (see that file's "The supplied
 * Meshy assets" section for the table shape this follows: file / draws-as /
 * source). "Draws as" is deliberately left as a TODO -- this tool downloads a
 * base model, not a unit; which unit it becomes is a decision made once it is
 * imported into Blender and is not this CLI's to make.
 */
import type { TaskKind } from './options';

export interface ProvenanceInput {
  readonly kind: TaskKind;
  readonly glbPath: string; // repo-relative
  readonly aiModel: string;
  readonly refined: boolean;
  readonly taskId: string;
  readonly promptOrSource: string; // the text prompt, or the image path/URL
  readonly generatedAt: string; // yyyy-mm-dd
}

export function buildProvenanceLine(input: ProvenanceInput): string {
  const method =
    input.kind === 'text'
      ? `Meshy AI text-to-3d (${input.aiModel}${input.refined ? '+refine' : ''}, prompt: "${input.promptOrSource}")`
      : `Meshy AI image-to-3d (${input.aiModel}, source: ${input.promptOrSource})`;
  return (
    `| ${input.glbPath} | TODO: draws as | ${method} -- AI-generated, disclosed per CONTRIBUTING.md, ` +
    `task ${input.taskId}, generated ${input.generatedAt} |`
  );
}
