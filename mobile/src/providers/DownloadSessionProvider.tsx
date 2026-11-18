import {
  createContext,
  useContext,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { useDownloadRecovery } from '@/hooks/useDownloadRecovery';
import { useDownloadForeground } from '@/hooks/useDownloadForeground';
import { useLocalYoutubeSpike } from '@/hooks/useLocalYoutubeSpike';
import { useMediaAnalysis } from '@/hooks/useMediaAnalysis';
import { useMediaDownload } from '@/hooks/useMediaDownload';
import { isYoutubeUrl } from '@/services/onDeviceYoutube';

function useSession() {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const foregroundGeneration = useDownloadForeground();
  const recovery = useDownloadRecovery(foregroundGeneration);
  const conventional = useRef(false);
  const {
    url,
    state,
    isBusy: isAnalyzing,
    isPasting,
    updateUrl,
    isPastePending,
    pasteUrl: readClipboard,
    analyze,
    resetAnalysis,
    select,
  } = useMediaAnalysis();
  const canStartDownload = () =>
    recovery.loaded && !recovery.record && !isPastePending();
  const spike = useLocalYoutubeSpike(
    foregroundGeneration,
    canStartDownload,
    recovery.showInterrupted,
  );
  const download = useMediaDownload(
    foregroundGeneration,
    canStartDownload,
    recovery.showInterrupted,
  );
  const canChangeInput = () =>
    !recovery.record &&
    !download.hasActiveOperation() &&
    !spike.hasActiveOperation();

  const localYoutube = isYoutubeUrl(url);
  const isBusy =
    !recovery.loaded ||
    recovery.working ||
    isAnalyzing ||
    download.isActive ||
    spike.isBusy;
  const [needsLink, setNeedsLink] = useState(false);

  function replaceInput(value: string) {
    download.reset();
    spike.reset();
    setShowTechnicalDetails(false);
    updateUrl(value);
  }

  function retryRecovered() {
    return recovery.dismiss((record) => {
      if (record.source === 'direct') {
        conventional.current = true;
        setNeedsLink(true);
        replaceInput('');
      } else {
        const link =
          'https://www.youtube.com/watch?v=' + record.selection.videoId;
        replaceInput(link);
        void spike.analyze(link, record.selection);
      }
    });
  }

  function changeUrl(value: string) {
    if (!canChangeInput()) return;
    setNeedsLink(false);
    replaceInput(value);
  }

  function pasteUrl() {
    if (isBusy) return;
    return readClipboard(canChangeInput, changeUrl);
  }

  function newDownload() {
    conventional.current = false;
    changeUrl('');
  }

  async function runAnalysis() {
    if (
      !canStartDownload() ||
      download.hasActiveOperation() ||
      spike.hasActiveOperation() ||
      spike.isBusy
    )
      return;
    download.reset();
    if (localYoutube) {
      resetAnalysis();
      await spike.analyze(url);
    } else {
      await analyze();
    }
  }

  return {
    url,
    state,
    isPasting,
    pasteUrl,
    select,
    spike,
    download: {
      ...download,
      start: (
        media: Parameters<typeof download.start>[0],
        selection: Parameters<typeof download.start>[1],
      ) => download.start(media, selection, conventional.current),
    },
    localYoutube,
    isBusy,
    recovery,
    needsLink,
    retryRecovered,
    changeUrl,
    newDownload,
    runAnalysis,
    showTechnicalDetails,
    setShowTechnicalDetails,
  };
}

const DownloadSessionContext = createContext<ReturnType<
  typeof useSession
> | null>(null);

// A route is only a view of this session. Cleanup belongs to the app layout,
// never to a screen departure. Native background policies remain unchanged.
export function DownloadSessionProvider({ children }: PropsWithChildren) {
  const session = useSession();
  return (
    <DownloadSessionContext.Provider value={session}>
      {children}
    </DownloadSessionContext.Provider>
  );
}

export function useDownloadSession() {
  const session = useContext(DownloadSessionContext);
  if (!session) throw new Error('DownloadSessionProvider is required');
  return session;
}
