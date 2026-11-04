import {
  createContext,
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

// UI-only session state. A new app owner starts in list mode; nothing is persisted.
export function LibraryViewProvider({ children }: PropsWithChildren) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
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
