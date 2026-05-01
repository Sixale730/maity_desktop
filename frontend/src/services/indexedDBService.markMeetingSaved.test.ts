import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import { indexedDBService } from './indexedDBService';

const makeMeeting = (id: string, overrides: Partial<{ savedToSQLite: boolean; lastUpdated: number }> = {}) => ({
  meetingId: id,
  title: `Meeting ${id}`,
  startTime: Date.now() - 60_000,
  lastUpdated: Date.now() - 60_000,
  transcriptCount: 0,
  savedToSQLite: false,
  ...overrides,
});

describe('indexedDBService — recovery flag flow', () => {
  // Tests share the same fake-indexeddb instance — use unique IDs per test to
  // avoid cross-test interference. Resetting fake-indexeddb mid-suite causes
  // hangs because connections stay open in the singleton service.

  it('getAllMeetings returns only meetings with savedToSQLite=false', async () => {
    await indexedDBService.saveMeetingMetadata(makeMeeting('t1-unsaved-1'));
    await indexedDBService.saveMeetingMetadata(makeMeeting('t1-saved', { savedToSQLite: true }));
    await indexedDBService.saveMeetingMetadata(makeMeeting('t1-unsaved-2'));

    const recoverable = await indexedDBService.getAllMeetings();
    const ids = recoverable.map(m => m.meetingId);

    expect(ids).toContain('t1-unsaved-1');
    expect(ids).toContain('t1-unsaved-2');
    expect(ids).not.toContain('t1-saved');
  });

  it('markMeetingSaved flips the flag so the meeting is excluded from recovery', async () => {
    await indexedDBService.saveMeetingMetadata(makeMeeting('t2-1'));

    let recoverable = await indexedDBService.getAllMeetings();
    expect(recoverable.map(m => m.meetingId)).toContain('t2-1');

    await indexedDBService.markMeetingSaved('t2-1');

    recoverable = await indexedDBService.getAllMeetings();
    expect(recoverable.map(m => m.meetingId)).not.toContain('t2-1');
  });

  it('markMeetingSaved on a non-existent meeting is a no-op (does not throw)', async () => {
    await expect(indexedDBService.markMeetingSaved('t3-does-not-exist')).resolves.toBeUndefined();
  });

  it('regression: empty/cancelled meeting marked as saved no longer surfaces as recoverable', async () => {
    // Simulates the fix in commit 3.4: when a recording stops with 0
    // transcripts (immediate error before any audio was transcribed),
    // useRecordingStop now calls markMeetingAsSaved() so the empty record
    // doesn't trigger the "hay algo por recuperar" dialog forever.
    const emptyMeeting = makeMeeting('t4-empty-error-session', { savedToSQLite: false });
    await indexedDBService.saveMeetingMetadata(emptyMeeting);

    // Before fix: this would return the empty meeting on every restart.
    let recoverable = await indexedDBService.getAllMeetings();
    expect(recoverable.map(m => m.meetingId)).toContain('t4-empty-error-session');

    // After fix: useRecordingStop calls markMeetingAsSaved -> markMeetingSaved.
    await indexedDBService.markMeetingSaved('t4-empty-error-session');

    recoverable = await indexedDBService.getAllMeetings();
    expect(recoverable.map(m => m.meetingId)).not.toContain('t4-empty-error-session');
  });
});
