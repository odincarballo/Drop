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
  protocol: z.string().max(80).nullable(),
});

export const localYoutubeResultSchema = z
  .object({
    metadata: z
      .object({
        id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
        analysisId: z.string().regex(/^[a-f0-9]{32}$/),
        preferredAudioFormatId: z.string().max(80).nullable(),
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

export const localAudioDownloadEventSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum([
    'PREPARING',
    'DOWNLOADING',
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
  fileName: z.string().max(120).optional(),
  fileSize: z.number().int().nonnegative().optional(),
  localUri: z.string().startsWith('file://').optional(),
  errorCode: z
    .string()
    .regex(/^[A-Z_]+$/)
    .optional(),
});

export type LocalAudioDownloadEvent = z.infer<
  typeof localAudioDownloadEventSchema
>;

export const localEjsFixtureResultSchema = z
  .object({
    fixture: z
      .object({
        status: z.literal('passed'),
        challengeType: z.literal('n'),
        challengeInput: z.string().max(100),
        expected: z.string().max(100),
        actual: z.string().max(100),
        playerId: z.string().max(40),
        playerSha256: z.string().regex(/^[a-f0-9]{64}$/),
        provider: z.literal('MediaDropEmbedded'),
        providerRegistered: z.literal(true),
        scriptSource: z.string().max(100),
        ejsVersion: z.string().max(40),
      })
      .optional(),
    error: z.object({ code: z.string().regex(/^[A-Z_]+$/) }).optional(),
    exceptionType: z.string().max(100).optional(),
    engine: z.string().max(200).optional(),
    deviceRuntime: z.enum(['ios-device', 'ios-simulator']).optional(),
    elapsedSeconds: z.number().nonnegative(),
    residentBytes: z.number().nonnegative().optional(),
    jsChallengeCalls: z.number().int().nonnegative(),
    nativeRunJsCalls: z.number().int().nonnegative(),
    processAttempts: z.number().int().nonnegative(),
    subprocessUsed: z.literal(false),
    quickJsFilesystem: z.literal(false),
    quickJsNetwork: z.literal(false),
    diagnostics: z.object({
      providerInvoked: z.boolean(),
      runJsInvoked: z.boolean(),
      quickJsCompletedNormally: z.boolean(),
      scriptLength: z.number().int().nonnegative().optional(),
      responseType: z.string().max(40).optional(),
      responseLength: z.number().int().nonnegative().nullable().optional(),
      responsePayloadType: z.string().max(40).nullable().optional(),
      responsePreview: z.string().max(500).optional(),
      parserError: z.string().max(160).nullable().optional(),
      runtimeError: z.string().max(100).optional(),
      consoleLogCaptured: z.boolean().optional(),
      evaluationReturnIgnored: z.boolean().optional(),
      javascriptExceptionCaught: z.boolean().optional(),
      quickJsFilesystemAttempts: z.literal(0),
      quickJsNetworkAttempts: z.literal(0),
      native: z
        .object({
          scriptBytes: z.number().int().nonnegative().optional(),
          memoryLimitBytes: z.number().int().positive().optional(),
          stackLimitBytes: z.number().int().positive().optional(),
          timeoutSeconds: z.number().positive().optional(),
          outputLimitBytes: z.number().int().positive().optional(),
          capturedBytes: z.number().int().nonnegative().optional(),
          consoleCalls: z.number().int().nonnegative().optional(),
          interrupted: z.boolean().optional(),
          timedOut: z.boolean().optional(),
          cancelled: z.boolean().optional(),
          completedNormally: z.boolean().optional(),
          quickJsMallocBytes: z.number().int().nonnegative().optional(),
          quickJsMemoryUsedBytes: z.number().int().nonnegative().optional(),
          captureError: z.string().max(100).optional(),
          exceptionName: z.string().max(80).optional(),
          exceptionMessage: z.string().max(301).optional(),
          exceptionStack: z.string().max(1001).optional(),
          errorCode: z
            .string()
            .regex(/^[A-Z_]+$/)
            .optional(),
          elapsedSeconds: z.number().nonnegative().optional(),
          diagnosticError: z
            .string()
            .regex(/^[A-Z_]+$/)
            .optional(),
        })
        .optional(),
    }),
  })
  .refine((value) => Boolean(value.fixture) !== Boolean(value.error));

export type LocalEjsFixtureResult = z.infer<typeof localEjsFixtureResultSchema>;
