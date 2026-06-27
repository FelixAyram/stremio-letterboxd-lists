const { warmupListCache } = require('../addon');
const github = require('./github-sync');

const jobs = new Map();

function getWarmStatus(userId) {
  return jobs.get(userId) || { status: 'idle' };
}

async function runWarmup(userId, lists) {
  const job = {
    status: 'running',
    startedAt: Date.now(),
    current: null,
    listIndex: 0,
    listTotal: lists.length,
    progress: null,
    lists: {},
    githubSynced: null
  };
  jobs.set(userId, job);

  try {
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i];
      job.current = list.name || list.id;
      job.listIndex = i + 1;
      job.progress = { phase: 'scrape', current: 0, total: 1 };

      try {
        const result = await warmupListCache(userId, list, (p) => {
          job.progress = p;
        });
        job.lists[list.id] = { ok: true, ...result };
      } catch (e) {
        job.lists[list.id] = { ok: false, error: e.message };
        console.error(`[warmup:${userId}] ${list.id}:`, e.message);
      }
    }

    job.progress = { phase: 'sync', current: 1, total: 1 };
    job.githubSynced = await github.pushNow();
    job.status = 'done';
    job.finishedAt = Date.now();
  } catch (e) {
    job.status = 'error';
    job.error = e.message;
    console.error(`[warmup:${userId}]`, e.message);
  }

  return job;
}

function startWarmup(userId, lists) {
  const current = jobs.get(userId);
  if (current?.status === 'running') return current;

  runWarmup(userId, lists).catch((e) => {
    const job = jobs.get(userId);
    if (job && job.status === 'running') {
      job.status = 'error';
      job.error = e.message;
    }
  });

  return jobs.get(userId);
}

module.exports = { startWarmup, getWarmStatus };
