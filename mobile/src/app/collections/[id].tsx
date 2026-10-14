import { useLocalSearchParams } from 'expo-router';

import { CollectionItemsView } from '@/components/CollectionItemsView';

export default function CollectionDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  return <CollectionItemsView kind="collection" collectionId={id} />;
}
