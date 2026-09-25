// Temporary content adapter. Gameplay uses persisted prompt/media records, not this array.
export const NO_CONTEXT_TEST_PROMPTS = [
  { instruction: 'What has just happened here?', media: { type: 'image', url: '/no-context/meeting.svg', alt: 'A cat sits at the head of a very serious meeting.' } },
  { instruction: 'Caption this.', media: { type: 'image', url: '/no-context/shopping.svg', alt: 'An astronaut shops for one banana.' } },
  { instruction: 'What was said immediately before this?', media: { type: 'image', url: '/no-context/traffic.svg', alt: 'A duck directs a queue of cars.' } },
  { instruction: 'Give this image a headline.', media: { type: 'image', url: '/no-context/island.svg', alt: 'An office chair sits alone on a tiny island.' } },
  { instruction: 'Wrong answers only: what are they celebrating?', media: { type: 'image', url: '/no-context/picnic.svg', alt: 'Two robots hold a picnic beside a toaster.' } },
]
