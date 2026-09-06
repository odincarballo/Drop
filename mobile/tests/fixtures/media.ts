import type { MediaAnalysis } from '@/models/media';

// Snapshot of MockMediaProvider; the live integration check also validates the API contract.
export const demoMedia: MediaAnalysis = {
  videoFormats: [
    {
      id: 'mock-video-360p',
      resolution: '640x360',
      container: 'mp4',
      codec: 'h264',
      hasAudio: false,
      estimatedSize: 6000000,
    },
    {
      id: 'mock-video-720p',
      resolution: '1280x720',
      container: 'mp4',
      codec: 'h264',
      hasAudio: false,
      estimatedSize: 20000000,
    },
    {
      id: 'mock-video-1080p',
      resolution: '1920x1080',
      container: 'mp4',
      codec: 'h264',
      hasAudio: true,
      estimatedSize: 60000000,
    },
  ],
  audioFormats: [
    {
      id: 'mock-audio-128k',
      container: 'm4a',
      codec: 'aac',
      bitrate: 128000,
      estimatedSize: 2464000,
    },
    {
      id: 'mock-audio-256k',
      container: 'm4a',
      codec: 'aac',
      bitrate: 256000,
      estimatedSize: 4928000,
    },
  ],
  id: 'mock-c040e73f-3afe-5244-b82c-a399ec4435d5',
  title: 'MediaDrop Demo Video',
  thumbnail:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAACX0lEQVR42u3bsQnAIABFQadwOrvsXwixT5EdAo8c3AQfHhbqmNcCooYJQMCAgAEBg4ABAQMCBgQMAgYEDAgYBAwIGBAwIGAQMCBgQMCAgEHAgIABAYOAAQEDAgYEDAIGBAwIGBAwCBgQMCBgEDAgYEDAgIBBwICAAQGDgK0AAgYEDAgYBAwIGBAwIGAQMCBgQMAgYEDAgIABAYOAAQEDAv6PfW4jIOBwwC9TIOBwwDJGwPmANYyA2wHLGAHnA5YxAs4HrGEE3A5Yxgg4H7CMBUw+YA0LmHbAMhYw+YBlLGDyAWtYwLQDlrGAyQcsYwGTD1jDAqYdsIwFTD5gGQuYfMAaFjDtgGUsYPIBy1jA5APWsIBpByxjAZMPWMYCJh+whgVMO2AZC5h8wDIWMPmANSxg2gHLWMDkA5axgMkHrGEB0w5YxgImH7CMBYwTGAELWLoCRsDqFTDugREwXmIhYAGrV8D4jYSA6QRsfAFTDdjyAiYZsM0FTDJgawuYasCmFjDJgI0sYJIBm1fAVAO2rYBJBmxVAZMM2J4CphqwMQVMMmAzCphkwAYUMNWArSdgkgHbTcAkA7aYgKkGbC4BkwzYUAImGbCJEHA1YPsg4GTAlkHAyYBtgoCrARsEAScDNgUCTgZsBAQMAgYEDAgYEDAIGBAwIGAQMCBgQMCAgEHAgIABAYOArQACBgQMCBgEDAgYEDAgYBAwIGBAwCBgQMCAgAEBg4ABAQMCBgQMAgYEDAgYBAwIGBAwIGAQMCBgQMCAgEHAgIABAYOAAQEDAgYEDAIGBAwIGAQMCBj42AMyFGXNr3GN4gAAAABJRU5ErkJggg==',
  duration: 154.0,
  source: 'mock',
  estimatedSize: 60000000,
};
