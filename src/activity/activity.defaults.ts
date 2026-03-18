export interface DefaultActivity {
  name: string;
  displayName: string;
  emoji: string;
}

export const DEFAULT_ACTIVITIES: DefaultActivity[] = [
  { name: 'legs', displayName: 'Legs', emoji: '🦵' },
  { name: 'push', displayName: 'Push', emoji: '🫸' },
  { name: 'pull', displayName: 'Pull', emoji: '🫷' },
  { name: 'lower', displayName: 'Lower', emoji: '⬇️' },
  { name: 'upper', displayName: 'Upper', emoji: '⬆️' },
  { name: 'walk', displayName: 'Walk', emoji: '🚶' },
  { name: 'rest', displayName: 'Rest', emoji: '😴' },
];
