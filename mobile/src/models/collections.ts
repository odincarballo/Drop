export type Collection = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type CollectionSummary = Collection & { itemCount: number };
