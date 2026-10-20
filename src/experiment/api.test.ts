import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { deleteRun, listRuns } from './api';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('experiment run api', () => {
  it('invokes experiment_delete with runId and userId', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      runId: 'run-123',
      userId: 'user-op',
      subjectId: 'sub-001',
      status: 'completed',
    });

    const result = await deleteRun('run-123', 'user-op');
    expect(invoke).toHaveBeenCalledWith('experiment_delete', {
      runId: 'run-123',
      userId: 'user-op',
    });
    expect(result.runId).toBe('run-123');
  });

  it('invokes experiment_list with userId', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await listRuns('user-op');
    expect(invoke).toHaveBeenCalledWith('experiment_list', {
      userId: 'user-op',
    });
  });
});
