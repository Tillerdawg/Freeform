/** Every timestamped persistence decision (autosave deadlines, version-history
 * retention, backup reminders) takes an injectable clock instead of calling
 * `Date.now()` directly, so tests can exercise exact day/second boundaries
 * deterministically. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
