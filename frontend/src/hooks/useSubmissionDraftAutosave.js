import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { getSubmissionDraft, saveSubmissionDraft } from '../services/submissionsApi.js';

const LOCAL_DRAFT_PREFIX = 'lab-p:submission-draft';
const AUTOSAVE_DELAY_MS = 2000;

function safeStringify(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch (error) {
    return '{}';
  }
}

function readLocalDraft(key) {
  if (!key || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function writeLocalDraft(key, payload) {
  if (!key || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch (error) {
    // localStorage may be unavailable or full; backend autosave can still work.
  }
}

function removeLocalDraft(key) {
  if (!key || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    // ignore
  }
}

function isMeaningfulDraft(draftJson) {
  const values = draftJson?.values || {};
  return Object.values(values).some((value) => value !== null && value !== undefined && String(value) !== '');
}

export function makeSubmissionDraftStorageKey({ scope, experimentId, submissionId }) {
  return `${LOCAL_DRAFT_PREFIX}:${scope || 'student'}:${experimentId || 'unknown'}:${submissionId || 'pending'}`;
}

export function useSubmissionDraftAutosave({
  enabled = true,
  scope = 'student',
  experiment,
  submission,
  formValues,
  imageSlots,
  collectImagePaths,
  ensureSubmission,
  canSaveToServer = false,
  onServerSubmissionResolved,
  onRestore,
} = {}) {
  const [status, setStatus] = useState('idle');
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const revisionRef = useRef(0);
  const timerRef = useRef(null);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const lastServerHashRef = useRef('');
  const latestPayloadRef = useRef(null);
  const restoredKeysRef = useRef(new Set());

  const experimentId = experiment?.meta?.id;
  const submissionId = submission?.id;
  const storageKey = makeSubmissionDraftStorageKey({ scope, experimentId, submissionId });
  const pendingStorageKey = makeSubmissionDraftStorageKey({ scope, experimentId, submissionId: null });

  const buildPayload = useCallback((nextValues = formValues, nextImageSlots = imageSlots) => {
    const now = new Date().toISOString();
    const resolvedImageSlots = nextImageSlots || {};
    const derivedImagePaths = Object.values(resolvedImageSlots).flat().map((item) => item?.url).filter(Boolean);
    return {
      key: storageKey,
      pendingKey: pendingStorageKey,
      localRevision: revisionRef.current,
      updatedAt: now,
      draftJson: {
        values: nextValues || {},
        experiment_id: experimentId,
        experiment_name: experiment?.meta?.name,
        _meta: {
          save_mode: 'autosave',
          saved_at: now,
          source: 'browser_autosave',
        },
      },
      imagePaths: derivedImagePaths.length ? derivedImagePaths : (collectImagePaths?.() || []),
      imageSlots: resolvedImageSlots,
    };
  }, [collectImagePaths, experiment?.meta?.name, experimentId, formValues, imageSlots, pendingStorageKey, storageKey]);

  const persistLocal = useCallback((payload) => {
    writeLocalDraft(payload.key, payload);
    if (payload.pendingKey && payload.pendingKey !== payload.key) {
      writeLocalDraft(payload.pendingKey, payload);
    }
    latestPayloadRef.current = payload;
    setStatus('local_saved');
  }, []);

  const saveToServer = useCallback(async (payload = latestPayloadRef.current) => {
    if (!enabled || !canSaveToServer || !payload) return null;
    if (savingRef.current) {
      pendingRef.current = true;
      return null;
    }

    const payloadHash = safeStringify({
      draftJson: payload.draftJson,
      imagePaths: payload.imagePaths,
      imageSlots: payload.imageSlots,
    });
    if (payloadHash === lastServerHashRef.current) return null;

    savingRef.current = true;
    setStatus('syncing');
    try {
      const resolvedSubmission = submissionId ? submission : await ensureSubmission?.();
      if (!resolvedSubmission?.id) return null;
      onServerSubmissionResolved?.(resolvedSubmission);
      const saved = await saveSubmissionDraft(
        resolvedSubmission.id,
        payload.draftJson,
        payload.imagePaths,
        payload.imageSlots,
        payload.localRevision,
      );
      lastServerHashRef.current = payloadHash;
      setLastSavedAt(saved.updated_at || new Date().toISOString());
      setStatus('synced');
      if (payload.pendingKey && payload.pendingKey !== payload.key) removeLocalDraft(payload.pendingKey);
      return saved;
    } catch (error) {
      setStatus('error');
      return null;
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        window.setTimeout(() => saveToServer(latestPayloadRef.current), 0);
      }
    }
  }, [canSaveToServer, enabled, ensureSubmission, onServerSubmissionResolved, submission, submissionId]);

  const scheduleSave = useCallback((nextValues = formValues, nextImageSlots = imageSlots) => {
    if (!enabled) return;
    revisionRef.current += 1;
    const payload = buildPayload(nextValues, nextImageSlots);
    persistLocal(payload);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      saveToServer(payload);
    }, AUTOSAVE_DELAY_MS);
  }, [buildPayload, enabled, formValues, imageSlots, persistLocal, saveToServer]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return saveToServer(latestPayloadRef.current);
  }, [saveToServer]);

  useEffect(() => {
    if (!enabled || !canSaveToServer || !latestPayloadRef.current) return;
    saveToServer(latestPayloadRef.current);
  }, [canSaveToServer, enabled, saveToServer]);

  useEffect(() => {
    if (!enabled || !experimentId) return undefined;
    const restoreKey = `${scope}:${experimentId}:${submissionId || 'pending'}`;
    if (restoredKeysRef.current.has(restoreKey)) return undefined;
    restoredKeysRef.current.add(restoreKey);

    let cancelled = false;
    const restore = async () => {
      const localDraft = readLocalDraft(storageKey) || readLocalDraft(pendingStorageKey);
      let serverDraft = null;
      if (submissionId && canSaveToServer) {
        try {
          serverDraft = await getSubmissionDraft(submissionId);
        } catch (error) {
          serverDraft = null;
        }
      }
      if (cancelled) return;

      const localUpdated = localDraft?.updatedAt ? new Date(localDraft.updatedAt).getTime() : 0;
      const serverUpdated = serverDraft?.updated_at ? new Date(serverDraft.updated_at).getTime() : 0;
      const chosen = localUpdated > serverUpdated
        ? localDraft
        : (serverDraft?.draft_json ? {
          draftJson: serverDraft.draft_json,
          imagePaths: serverDraft.image_paths || [],
          imageSlots: serverDraft.image_slots || {},
          localRevision: serverDraft.local_revision || 0,
          updatedAt: serverDraft.updated_at,
        } : localDraft);

      if (chosen?.draftJson && isMeaningfulDraft(chosen.draftJson)) {
        onRestore?.(chosen);
        setStatus('restored');
        message.info('已恢复上次未提交草稿。');
      }
    };

    restore();
    return () => {
      cancelled = true;
    };
  }, [canSaveToServer, enabled, experimentId, onRestore, pendingStorageKey, scope, storageKey, submissionId]);

  useEffect(() => {
    if (!enabled) return undefined;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const handleBeforeUnload = () => {
      if (latestPayloadRef.current) persistLocal(latestPayloadRef.current);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [enabled, flush, persistLocal]);

  return {
    status,
    lastSavedAt,
    scheduleSave,
    flush,
  };
}
