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
