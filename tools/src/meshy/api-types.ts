/**
 * Request/response shapes for the two Meshy endpoints this CLI drives, as
 * specified in the task brief from docs.meshy.ai. Kept separate from
 * `options.ts` (the enum vocabulary) so the wire shape and the CLI's own
 * option types can diverge without editing both in the same place.
 */
import type {
  AiModel,
  ModelType,
  OriginAt,
  PoseMode,
  TargetFormat,
  TaskStatus,
  TextureResolution,
  Topology,
} from './options';

export interface TextPreviewRequest {
  readonly mode: 'preview';
  readonly prompt: string;
  readonly model_type: ModelType;
  readonly ai_model: AiModel;
  readonly ultra_mode?: boolean;
  readonly should_remesh?: boolean;
  readonly topology: Topology;
  readonly target_polycount: number;
  readonly pose_mode: PoseMode;
  readonly target_formats: readonly TargetFormat[];
  readonly auto_size?: boolean;
  readonly origin_at: OriginAt;
}

export interface TextRefineRequest {
  readonly mode: 'refine';
  readonly preview_task_id: string;
  readonly enable_pbr?: boolean;
  readonly texture_resolution: TextureResolution;
  readonly texture_prompt?: string;
  readonly texture_image_url?: string;
  readonly remove_lighting?: boolean;
}

export type TextToThreeDRequest = TextPreviewRequest | TextRefineRequest;

export interface ImageToThreeDRequest {
  readonly image_url: string;
  readonly model_type: ModelType;
  readonly ai_model: AiModel;
  readonly ultra_mode?: boolean;
  readonly should_texture?: boolean;
  readonly enable_pbr?: boolean;
  readonly texture_resolution?: TextureResolution;
  readonly texture_prompt?: string;
  readonly should_remesh?: boolean;
  readonly topology: Topology;
  readonly target_polycount: number;
  readonly pose_mode?: PoseMode;
  readonly image_enhancement?: boolean;
  readonly remove_lighting?: boolean;
  readonly target_formats: readonly TargetFormat[];
  readonly auto_size?: boolean;
  readonly origin_at?: OriginAt;
  readonly alpha_thumbnail?: boolean;
  readonly multi_view_thumbnails?: boolean;
}

export interface SubmitTaskResponse {
  readonly result: string;
}

export interface BalanceResponse {
  readonly balance: number;
}

export interface ModelUrls {
  readonly glb?: string;
  readonly fbx?: string;
  readonly obj?: string;
  readonly mtl?: string;
  readonly usdz?: string;
  readonly stl?: string;
  readonly '3mf'?: string;
}

export interface TextureUrlSet {
  readonly base_color?: string;
  readonly metallic?: string;
  readonly normal?: string;
  readonly roughness?: string;
  readonly emission?: string;
}

export interface TaskErrorBody {
  readonly message: string;
}

export interface TextToThreeDTask {
  readonly id: string;
  readonly status: TaskStatus;
  readonly progress: number;
  readonly model_urls?: ModelUrls;
  readonly thumbnail_url?: string;
  readonly alpha_thumbnail_url?: string;
  readonly texture_urls?: readonly TextureUrlSet[];
  readonly task_error?: TaskErrorBody;
  readonly consumed_credits?: number;
  readonly created_at?: number;
  readonly started_at?: number;
  readonly finished_at?: number;
  readonly expires_at?: number;
}

export interface ImageToThreeDTask extends TextToThreeDTask {
  readonly thumbnail_urls?: readonly string[];
  readonly pre_remeshed_glb?: string;
}

/**
 * `POST /openapi/v1/remesh`, per https://docs.meshy.ai/en/api/remesh (fetched
 * 2026-09-27). Exactly one of `input_task_id`/`model_url` is required -- this
 * CLI's `remesh` command only ever sends `input_task_id`, since `model_url`
 * (a publicly accessible URL or data URI) has no use case here yet. The
 * `resize_*`/`auto_size`/`origin_at`/`convert_format_only` fields are
 * documented "deprecated" and deliberately omitted below.
 */
export interface RemeshRequest {
  readonly input_task_id?: string;
  readonly model_url?: string;
  readonly target_formats?: readonly TargetFormat[];
  readonly topology?: Topology;
  readonly target_polycount?: number;
  readonly decimation_mode?: number;
  readonly alpha_thumbnail?: boolean;
}

/** Same task shape as text/image -- `type` is always `"remesh"` and it adds
 *  `preceding_tasks` (queue position while PENDING); it never carries
 *  `texture_urls` or `thumbnail_urls`, both already optional on the base. */
export interface RemeshTask extends TextToThreeDTask {
  readonly type?: 'remesh';
  readonly preceding_tasks?: number;
}
