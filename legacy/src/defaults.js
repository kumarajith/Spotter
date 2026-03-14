/** Default activities seeded per guild on first /setup. Add or remove entries here. */
const DEFAULT_ACTIVITIES = [
  { emoji: '🦵', name: 'Legs' },
  { emoji: '🫸', name: 'Push' },
  { emoji: '🫷', name: 'Pull' },
  { emoji: '⬇️', name: 'Lower' },
  { emoji: '⬆️', name: 'Upper' },
  { emoji: '🚶', name: 'Walk' },
  { emoji: '😴', name: 'Rest' },
];

/** Max consecutive rest-only days before streak resets. */
export const REST_STREAK_LIMIT = 5;

export default DEFAULT_ACTIVITIES;
