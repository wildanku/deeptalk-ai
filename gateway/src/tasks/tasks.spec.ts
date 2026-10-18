import { testConfig } from '../config/testing';
import { CloudTasksQueue } from './cloud-tasks.queue';
import { TaskHandlers } from './task-handlers';
import { taskName, type TaskQueue } from './task-queue';
import { LocalScheduler } from './tasks.module';

describe('CloudTasksQueue', () => {
  const client = {
    queuePath: jest.fn(
      (p: string, l: string, q: string) =>
        `projects/${p}/locations/${l}/queues/${q}`,
    ),
    createTask: jest.fn(),
  };
  const queue = new CloudTasksQueue(client, {
    project: 'proj',
    location: 'asia-southeast2',
    targetUrl: 'https://gateway.example.run.app/',
    token: 't'.repeat(32),
  });

  beforeEach(() => jest.clearAllMocks());

  it('creates a named, scheduled HTTP task back to the gateway', async () => {
    client.createTask.mockResolvedValue([{}]);
    await queue.enqueue('ai-session-timers', {
      name: 'idle-0190:abc-1700000000123',
      payload: { kind: 'idle', sessionId: 's1' },
      at: 1_700_000_000_123,
    });
    const [[request]] = client.createTask.mock.calls as [
      [
        {
          parent: string;
          task: {
            name: string;
            scheduleTime: { seconds: number; nanos: number };
            httpRequest: {
              url: string;
              headers: Record<string, string>;
              body: Buffer;
            };
          };
        },
      ],
    ];
    expect(request.parent).toBe(
      'projects/proj/locations/asia-southeast2/queues/ai-session-timers',
    );
    expect(request.task.name).toBe(
      `${request.parent}/tasks/idle-0190_abc-1700000000123`,
    );
    expect(request.task.scheduleTime).toEqual({
      seconds: 1_700_000_000,
      nanos: 123_000_000,
    });
    expect(request.task.httpRequest.url).toBe(
      'https://gateway.example.run.app/v1/internal/tasks/ai-session-timers',
    );
    expect(request.task.httpRequest.headers['x-tasks-token']).toHaveLength(32);
    expect(JSON.parse(request.task.httpRequest.body.toString())).toEqual({
      kind: 'idle',
      sessionId: 's1',
    });
  });

  it('treats an existing task name as success (deduplication)', async () => {
    client.createTask.mockRejectedValue(
      Object.assign(new Error('exists'), { code: 6 }),
    );
    await expect(
      queue.enqueue('ai-outbox', { name: 'outbox-x-a0', payload: { id: 'x' } }),
    ).resolves.toBeUndefined();
  });

  it('surfaces other errors', async () => {
    client.createTask.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 7 }),
    );
    await expect(
      queue.enqueue('ai-outbox', { name: 'outbox-x-a0', payload: { id: 'x' } }),
    ).rejects.toThrow('denied');
  });
});

describe('TaskHandlers', () => {
  it('routes queues and recurring jobs, including the local scheduled queue', async () => {
    const handlers = new TaskHandlers();
    const outbox = jest.fn(() => Promise.resolve());
    const sweep = jest.fn(() => Promise.resolve());
    handlers.register('ai-outbox', outbox);
    handlers.registerJob('outbox-sweep', sweep);

    await handlers.run('ai-outbox', { id: 'x' });
    await handlers.run('ai-scheduled', { job: 'outbox-sweep' });

    expect(outbox).toHaveBeenCalledWith({ id: 'x' });
    expect(sweep).toHaveBeenCalledTimes(1);
    await expect(handlers.runJob('nope')).rejects.toMatchObject({
      status: 404,
    });
    await expect(handlers.run('ai-evals', {})).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('LocalScheduler.periods', () => {
  const scheduler = new LocalScheduler(
    {} as TaskQueue,
    testConfig({
      ACCOUNT_SYNC_INTERVAL_SECONDS: '300',
    }),
  );

  it('one period per minute, per sync interval, and per day after 03:00 local time', () => {
    // 02:59 and 03:01 in Jakarta (UTC+7).
    const before = scheduler.periods(new Date('2026-10-14T19:59:00Z'));
    const after = scheduler.periods(new Date('2026-10-14T20:01:00Z'));

    expect(before.retention).toBeNull();
    expect(after.retention).toBe('2026-10-15');
    expect(after['outbox-sweep']).not.toBe(before['outbox-sweep']);
    expect(after['account-sync']).toBe(
      String(Math.floor(Date.parse('2026-10-14T20:01:00Z') / 300_000)),
    );
    // Routine reminders run without Cloud Scheduler too: one period per 5 minutes.
    expect(after['routine-reminders']).toBe(
      String(Math.floor(Date.parse('2026-10-14T20:01:00Z') / 300_000)),
    );
  });
});

it('taskName keeps Cloud Tasks-safe characters only', () => {
  expect(taskName('resweep-merge-v3-deleted-data:42')).toBe(
    'resweep-merge-v3-deleted-data_42',
  );
  expect(taskName('x'.repeat(600))).toHaveLength(500);
});
