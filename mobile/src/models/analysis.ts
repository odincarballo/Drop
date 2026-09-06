import type { MediaAnalysis } from './media';
import type { DownloadSelection } from './selection';

export type AnalysisState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: MediaAnalysis; selection: DownloadSelection }
  | { status: 'error'; message: string };
