import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useContext,
  useState,
  type PropsWithChildren,
  type Dispatch,
  type SetStateAction,
} from 'react';

type ViewMode = 'list' | 'grid';
const LibraryViewContext = createContext<{
  viewMode: ViewMode;
  setViewMode: Dispatch<SetStateAction<ViewMode>>;
} | null>(null);

const VIEW_PREFERENCE_KEY = 'drop.library.view.v1';
export function LibraryViewProvider({ children }: PropsWithChildren) {
  const [viewMode, setSelectedMode] = useState<ViewMode>('list');
  const currentMode = useRef<ViewMode>('list');
  const revision = useRef(0);
  const pending = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    pending.current = pending.current
      .then(() => AsyncStorage.getItem(VIEW_PREFERENCE_KEY))
      .then((saved) => {
        if (!active || revision.current !== 0) return;
        const mode = saved === 'grid' ? 'grid' : 'list';
        currentMode.current = mode;
        setSelectedMode(mode);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const setViewMode = useCallback<Dispatch<SetStateAction<ViewMode>>>(
    (next) => {
      const mode =
        typeof next === 'function' ? next(currentMode.current) : next;
      revision.current += 1;
      currentMode.current = mode;
      setSelectedMode(mode);
      // Wait for hydration and previous writes; failed writes must not poison the queue.
      // UI selection is optimistic, not an assertion that storage succeeded.
      pending.current = pending.current
        .then(() => AsyncStorage.setItem(VIEW_PREFERENCE_KEY, mode))
        .catch(() => undefined);
    },
    [],
  );
  return (
    <LibraryViewContext.Provider value={{ viewMode, setViewMode }}>
      {children}
    </LibraryViewContext.Provider>
  );
}

export function useLibraryView() {
  const value = useContext(LibraryViewContext);
  if (!value) throw new Error('LibraryViewProvider is required');
  return value;
}
