const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE_PATH = path.join(DATA_DIR, 'maintenance.json');

const DEFAULT_STATE = {
  enabled: false,
  reason: null,
  endsAt: null,
  updatedAt: null,
  updatedBy: null,
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readState() {
  try {
    if (!fs.existsSync(FILE_PATH)) return { ...DEFAULT_STATE };
    const raw = fs.readFileSync(FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed.enabled),
      reason:
        typeof parsed.reason === 'string' && parsed.reason.trim()
          ? parsed.reason.trim()
          : null,
      endsAt:
        typeof parsed.endsAt === 'string' && parsed.endsAt.trim()
          ? parsed.endsAt.trim()
          : null,
      updatedAt:
        typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      updatedBy:
        parsed.updatedBy != null && Number.isFinite(Number(parsed.updatedBy))
          ? Number(parsed.updatedBy)
          : null,
    };
  } catch (err) {
    console.warn('[MaintenanceStore] read failed:', err.message);
    return { ...DEFAULT_STATE };
  }
}

function writeState(state) {
  ensureDir();
  const payload = {
    enabled: Boolean(state.enabled),
    reason: state.reason || null,
    endsAt: state.endsAt || null,
    updatedAt: state.updatedAt || new Date().toISOString(),
    updatedBy: state.updatedBy != null ? Number(state.updatedBy) : null,
  };
  const tmp = `${FILE_PATH}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, FILE_PATH);
  return payload;
}

module.exports = {
  readState,
  writeState,
  DEFAULT_STATE,
  FILE_PATH,
};
