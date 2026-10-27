/**
 * Renderer-side file access: saving uses browser downloads and loading uses a
 * file picker, so the UI never touches these DOM APIs directly.
 */

export const APP_VERSION = '0.1.0';

const MIME_TYPES = {
  performance: 'application/json',
  midi: 'audio/midi',
  wav: 'audio/wav',
};

function browserDownload(name, data, kind) {
  const blob = new Blob([data], { type: MIME_TYPES[kind] || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { ok: true, filePath: name };
}

function browserPickText(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return resolve({ ok: false, canceled: true });
      try {
        resolve({ ok: true, filePath: file.name, text: await file.text() });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
    input.click();
  });
}

export const platform = {
  /** @param {{kind: 'performance'|'midi'|'wav', defaultName: string, data: string|Uint8Array}} options */
  async saveFile(options) {
    return browserDownload(options.defaultName, options.data, options.kind);
  },

  async openPerformance() {
    return browserPickText('.json,application/json');
  },
};
