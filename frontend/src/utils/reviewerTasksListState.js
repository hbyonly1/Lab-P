const REVIEWER_TASKS_LIST_STATE_KEY = 'reviewer-tasks:list-state';
const REVIEWER_TASKS_LIST_STATE_TTL_MS = 30 * 60 * 1000;

export function readReviewerTasksListState() {
  try {
    const raw = window.sessionStorage.getItem(REVIEWER_TASKS_LIST_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.expiresAt || parsed.expiresAt < Date.now()) {
      window.sessionStorage.removeItem(REVIEWER_TASKS_LIST_STATE_KEY);
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

export function writeReviewerTasksListState(state) {
  try {
    window.sessionStorage.setItem(
      REVIEWER_TASKS_LIST_STATE_KEY,
      JSON.stringify({
        ...state,
        savedAt: Date.now(),
        expiresAt: Date.now() + REVIEWER_TASKS_LIST_STATE_TTL_MS,
      }),
    );
  } catch (error) {
    // sessionStorage can fail in private windows; list state restore is non-critical.
  }
}

export function mergeReviewerTasksListState(patch) {
  writeReviewerTasksListState({
    ...(readReviewerTasksListState() || {}),
    ...patch,
  });
}
