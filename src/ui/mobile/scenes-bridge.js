/**
 * The desktop SceneControls asks window.prompt / window.confirm synchronously
 * inside its click handlers. On mobile we collect the answer with an in-sheet
 * dialog first, then replay the click with the answer pre-supplied. The
 * override only lives for the duration of that one synchronous call.
 */
export function runWithDialogAnswers(win, answers, run) {
  const { prompt, confirm } = answers;
  const savedPrompt = win.prompt;
  const savedConfirm = win.confirm;
  if (prompt !== undefined) win.prompt = () => prompt;
  if (confirm !== undefined) win.confirm = () => confirm;
  try {
    return run();
  } finally {
    win.prompt = savedPrompt;
    win.confirm = savedConfirm;
  }
}

/** Summary line for the Scenes tile. */
export function scenesSummary({ running, sceneTitle, shotCount }) {
  if (running) return 'Playing';
  if (!sceneTitle) return 'No scenes';
  return `${sceneTitle} · ${shotCount} shot${shotCount === 1 ? '' : 's'}`;
}

/** Clamp a 0..100 percentage from a CSS width string like "42%". */
export function parsePercent(text) {
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
