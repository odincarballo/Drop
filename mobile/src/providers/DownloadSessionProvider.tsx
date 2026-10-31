import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren,
} from 'react';

import { useLocalYoutubeSpike } from '@/hooks/useLocalYoutubeSpike';
import { useMediaAnalysis } from '@/hooks/useMediaAnalysis';
import { useMediaDownload } from '@/hooks/useMediaDownload';
import { isYoutubeUrl } from '@/services/onDeviceYoutube';

function useSession() {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const spike = useLocalYoutubeSpike();
  const {
    url,
    state,
    isBusy: isAnalyzing,
    isPasting,
    updateUrl,
    pasteUrl,
    analyze,
    resetAnalysis,
    select,
  } = useMediaAnalysis(() => {
    spike.reset();
    setShowTechnicalDetails(false);
  });
  const download = useMediaDownload();
  const localYoutube = isYoutubeUrl(url);
  const isBusy = isAnalyzing || download.isActive || spike.isBusy;

  function changeUrl(value: string) {
    download.reset();
    updateUrl(value);
  }

  function newDownload() {
    changeUrl('');
    setShowTechnicalDetails(false);
  }

  async function runAnalysis() {
    if (download.isActive || spike.isBusy) return;
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
    download,
    localYoutube,
    isBusy,
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
