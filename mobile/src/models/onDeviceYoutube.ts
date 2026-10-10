import { z } from 'zod';

const optionalNumber = z.number().finite().nonnegative().nullable();
const formatSchema = z.object({
  id: z.string().max(80),
  container: z.string().max(20),
  codec: z.string().max(100).nullable(),
  resolution: z.string().max(40).nullable(),
  height: optionalNumber,
  width: optionalNumber,
  fps: optionalNumber,
  hasAudio: z.boolean(),
  bitrateKbps: optionalNumber,
  estimatedSize: optionalNumber,
  exactSize: optionalNumber.optional(),
  dynamicRange: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,40}$/)
    .nullable()
    .optional(),
  protocol: z.string().max(80).nullable(),
  directDownload: z.boolean(),
});

export const localYoutubeResultSchema = z
  .object({
    metadata: z
      .object({
        id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
        analysisId: z.string().regex(/^[a-f0-9]{32}$/),
        preferredAudioFormatId: z.string().max(80).nullable(),
        preferredVideoFormatId: z.string().max(80).nullable(),
        title: z.string().max(240),
        duration: optionalNumber,
        thumbnail: z
          .string()
          .url()
          .nullable()
          .refine((value) => {
            if (value === null) return true;
            const url = new URL(value);
            return (
              url.protocol === 'https:' && url.hostname.endsWith('.ytimg.com')
            );
          }),
        videoFormats: z.array(formatSchema).max(100),
        audioFormats: z.array(formatSchema).max(30),
        resolutions: z.array(z.number().positive()).max(100),
      })
      .optional(),
    error: z.object({ code: z.string().regex(/^[A-Z_]+$/) }).optional(),
    exceptionType: z.string().max(100).optional(),
    engine: z.string().max(200).optional(),
    deviceRuntime: z.enum(['ios-device', 'ios-simulator']).optional(),
    ytDlpVersion: z.string().max(40).optional(),
    elapsedSeconds: z.number().nonnegative().optional(),
    residentBytes: z.number().nonnegative().optional(),
    jsChallengeCalls: z.number().int().nonnegative().optional(),
    networkRequests: z.number().int().nonnegative().optional(),
    metadataBytes: z.number().nonnegative().optional(),
    requestHosts: z.array(z.string().max(253)).max(40).optional(),
  })
  .refine((value) => Boolean(value.metadata) !== Boolean(value.error));

export type LocalYoutubeResult = z.infer<typeof localYoutubeResultSchema>;
export type LocalYoutubeMetadata = NonNullable<LocalYoutubeResult['metadata']>;
export type LocalYoutubeVideoFormat =
  LocalYoutubeMetadata['videoFormats'][number];
export type LocalYoutubeAudioFormat =
  LocalYoutubeMetadata['audioFormats'][number];

const diagnosticRange = z
  .string()
  .max(80)
  .regex(/^bytes=\d+-\d+$/);
const diagnosticContentRange = z
  .string()
  .max(160)
  .regex(/^bytes (?:\d+-\d+|\*)\/\d+$/);
const diagnosticLength = z.string().max(40).regex(/^\d+$/);
const diagnosticHost = z
  .string()
  .max(253)
  .regex(/^(?:[a-z0-9-]+\.)*googlevideo\.com$/);

export const localHttpTransferDiagnosticsSchema = z.object({
  requestedRange: diagnosticRange.optional(),
  statusCode: z.number().int().min(100).max(599).optional(),
  contentRange: diagnosticContentRange.optional(),
  contentLength: diagnosticLength.optional(),
  finalHost: diagnosticHost.optional(),
  failureStatusCode: z.number().int().min(100).max(599).optional(),
  failureRequestedRange: diagnosticRange.optional(),
  failureHost: diagnosticHost.optional(),
  failureContentRange: diagnosticContentRange.optional(),
  failureContentLength: diagnosticLength.optional(),
  failureRangeIndex: z.number().int().positive().optional(),
  failureBytesPersisted: z.number().int().nonnegative().optional(),
  failurePhase: z.enum(['audio', 'video']).optional(),
  failureCategory: z
    .enum([
      'connection',
      'timeout',
      'server',
      'forbidden',
      'range',
      'rate_limit',
      'integrity',
      'security',
      'dns',
      'cancelled',
      'other',
    ])
    .optional(),
  failureTransportCode: z
    .union([
      z.literal(-999),
      z.literal(-1001),
      z.literal(-1003),
      z.literal(-1004),
      z.literal(-1005),
      z.literal(-1009),
      z.literal(-1200),
      z.literal(-1202),
    ])
    .optional(),
  failureRangeAttempt: z.number().int().min(1).max(3).optional(),
  retriesUsed: z.number().int().min(0).max(4).optional(),
  recoverySecondsRemaining: z.number().int().min(0).max(30).optional(),
  forbiddenAudioRefreshStages: z
    .array(
      z.enum([
        'first_403',
        'budget_unavailable',
        'budget_reserved',
        'started',
        'identity_confirmed',
        'identity_rejected',
        'refresh_failed',
        'restarted_at_zero',
        'second_403',
        'timed_out',
        'cancelled',
      ]),
    )
    .max(12)
    .optional(),
});

export type LocalHttpTransferDiagnostics = z.infer<
  typeof localHttpTransferDiagnosticsSchema
>;

export const localAudioDownloadEventSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum([
    'PREPARING',
    'DOWNLOADING',
    'RETRYING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ]),
  formatId: z.string().max(80).optional(),
  container: z.literal('m4a').optional(),
  codec: z.string().max(100).optional(),
  bytesDownloaded: z.number().int().nonnegative().optional(),
  totalBytes: z.number().int().nonnegative().optional(),
  progress: z.number().min(0).max(1).optional(),
  retryCategory: z.enum(['connection', 'timeout', 'server']).optional(),
  fileName: z.string().max(120).optional(),
  fileSize: z.number().int().nonnegative().optional(),
  localUri: z.string().startsWith('file://').optional(),
  errorCode: z
    .string()
    .regex(/^[A-Z_]+$/)
    .optional(),
  httpDiagnostics: localHttpTransferDiagnosticsSchema.optional(),
});

export type LocalAudioDownloadEvent = z.infer<
  typeof localAudioDownloadEventSchema
>;

export const localVideoDownloadEventSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum([
    'PREPARING',
    'DOWNLOADING',
    'RETRYING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ]),
  formatId: z.string().max(80).optional(),
  container: z.literal('mp4').optional(),
  codec: z.string().max(100).optional(),
  height: z.number().int().positive().optional(),
  bytesDownloaded: z.number().int().nonnegative().optional(),
  totalBytes: z.number().int().nonnegative().optional(),
  progress: z.number().min(0).max(1).optional(),
  retryCategory: z.enum(['connection', 'timeout', 'server']).optional(),
  fileName: z.string().max(120).optional(),
  fileSize: z.number().int().nonnegative().optional(),
  localUri: z.string().startsWith('file://').optional(),
  errorCode: z
    .string()
    .regex(/^[A-Z_]+$/)
    .optional(),
  httpDiagnostics: localHttpTransferDiagnosticsSchema.optional(),
});

export type LocalVideoDownloadEvent = z.infer<
  typeof localVideoDownloadEventSchema
>;

export const localCombinedDownloadEventSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum([
    'PREPARING',
    'DOWNLOADING_VIDEO',
    'DOWNLOADING_AUDIO',
    'RETRYING_VIDEO',
    'RETRYING_AUDIO',
    'MUXING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ]),
  videoFormatId: z.string().max(80).optional(),
  audioFormatId: z.string().max(80).optional(),
  bytesDownloaded: z.number().int().nonnegative().optional(),
  totalBytes: z.number().int().nonnegative().optional(),
  progress: z.number().min(0).max(1).optional(),
  retryCategory: z.enum(['connection', 'timeout', 'server']).optional(),
  fileName: z.string().max(120).optional(),
  fileSize: z.number().int().nonnegative().optional(),
  localUri: z.string().startsWith('file://').optional(),
  durationSeconds: z.number().finite().positive().optional(),
  height: z.number().int().positive().optional(),
  videoCodec: z.string().max(100).optional(),
  audioCodec: z.string().max(100).optional(),
  errorCode: z
    .string()
    .regex(/^[A-Z_]+$/)
    .optional(),
  videoHttpDiagnostics: localHttpTransferDiagnosticsSchema.optional(),
  audioHttpDiagnostics: localHttpTransferDiagnosticsSchema.optional(),
});

export type LocalCombinedDownloadEvent = z.infer<
  typeof localCombinedDownloadEventSchema
>;
