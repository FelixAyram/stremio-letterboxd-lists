const MAX_HEAP_MB = parseInt(process.env.MAX_HEAP_MB || '380', 10);
const MAX_HEAVY_OPS = parseInt(process.env.MAX_HEAVY_OPS || '2', 10);
const WARN_HEAP_MB = parseInt(process.env.WARN_HEAP_MB || '320', 10);

let heavyRunning = 0;
const heavyQueue = [];
const onMemoryPressure = [];

function heapUsedMb() {
  return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
}

function memoryStatus() {
  const heap = heapUsedMb();
  return {
    heapMb: heap,
    rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    warn: heap >= WARN_HEAP_MB,
    critical: heap >= MAX_HEAP_MB
  };
}

function drainHeavyQueue() {
  while (heavyRunning < MAX_HEAVY_OPS && heavyQueue.length) {
    const next = heavyQueue.shift();
    next();
  }
}

function runHeavy(fn, label = 'task') {
  return new Promise((resolve, reject) => {
    const status = memoryStatus();
    if (status.critical) {
      console.warn(`[mem] rechazado ${label} heap=${status.heapMb}MB`);
      reject(new Error('Servidor ocupado, reintenta en unos segundos'));
      return;
    }

    const execute = async () => {
      heavyRunning++;
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      } finally {
        heavyRunning--;
        drainHeavyQueue();
      }
    };

    if (heavyRunning < MAX_HEAVY_OPS) execute();
    else heavyQueue.push(execute);
  });
}

function registerMemoryPressureHandler(fn) {
  onMemoryPressure.push(fn);
}

function checkMemoryPressure() {
  const status = memoryStatus();
  if (status.warn) {
    console.warn(`[mem] presion heap=${status.heapMb}MB rss=${status.rssMb}MB`);
    if (status.critical) {
      for (const fn of onMemoryPressure) {
        try { fn(); } catch (e) { console.error('[mem]', e.message); }
      }
    }
  }
  return status;
}

let watchdogTimer;
function startMemoryWatchdog(intervalMs = 60000) {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => checkMemoryPressure(), intervalMs);
  if (watchdogTimer.unref) watchdogTimer.unref();
}

module.exports = {
  runHeavy,
  memoryStatus,
  checkMemoryPressure,
  registerMemoryPressureHandler,
  startMemoryWatchdog,
  heapUsedMb
};
