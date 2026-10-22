/** One pending, manually requested playback occurrence. The current item is not here. */
export type QueueEntry = {
  id: string;
  itemId: string;
  position: number;
  addedAt: string;
};
