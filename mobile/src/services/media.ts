import { mediaAnalysisSchema, type MediaAnalysis } from '@/models/media';
import { apiClient } from './api';

export function analyzeMedia(
  url: string,
  signal: AbortSignal,
): Promise<MediaAnalysis> {
  return apiClient.request('/analyze', {
    method: 'POST',
    body: { url },
    signal,
    schema: mediaAnalysisSchema,
  });
}
