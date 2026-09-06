import { z } from 'zod';

const optionalSize = z.number().int().nonnegative().nullable();

export const mediaAnalysisSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  thumbnail: z
    .union([
      z.url({ protocol: /^https?$/ }),
      z
        .string()
        .max(131072)
        .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
    ])
    .nullable(),
  duration: z.number().nonnegative().nullable(),
  source: z.string().nullable(),
  estimatedSize: optionalSize,
  videoFormats: z.array(
    z.object({
      id: z.string().min(1),
      resolution: z.string().nullable(),
      container: z.string().nullable(),
      codec: z.string().nullable(),
      hasAudio: z.boolean().nullable(),
      estimatedSize: optionalSize,
    }),
  ),
  audioFormats: z.array(
    z.object({
      id: z.string().min(1),
      container: z.string().nullable(),
      codec: z.string().nullable(),
      bitrate: z.number().int().positive().nullable(),
      estimatedSize: optionalSize,
    }),
  ),
});

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export type MediaAnalysis = z.infer<typeof mediaAnalysisSchema>;
export type VideoFormat = MediaAnalysis['videoFormats'][number];
export type AudioFormat = MediaAnalysis['audioFormats'][number];

export type DownloadType = 'VIDEO_AUDIO' | 'VIDEO_ONLY' | 'AUDIO_ONLY';
export type DownloadRequest = {
  mediaId: string;
  downloadType: DownloadType;
  formatId: string;
};

export const jobSchema = z.object({
  id: z.string().min(1),
  status: z.enum([
    'PENDING',
    'DOWNLOADING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ]),
  progress: z.number().min(0).max(1).nullable(),
  bytesDownloaded: z.number().int().nonnegative(),
  totalBytes: optionalSize,
  fileName: z.string().nullable(),
  fileSize: optionalSize,
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  downloadUrl: z
    .string()
    .regex(/^\/jobs\/[A-Za-z0-9_-]+\/file$/)
    .nullable(),
});

export type DownloadJob = z.infer<typeof jobSchema>;
