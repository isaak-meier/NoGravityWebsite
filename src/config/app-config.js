const defaults = {
  googleDrive: {
    folderId: null,
    apiKey: null,
  },
};

async function tryLoadLocalJson() {
  try {
    const res = await fetch(new URL("app-config.local.json", import.meta.url));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function buildConfig() {
  const raw = await tryLoadLocalJson();
  if (raw?.googleDrive && typeof raw.googleDrive === "object") {
    return {
      googleDrive: {
        ...defaults.googleDrive,
        ...raw.googleDrive,
      },
    };
  }
  return defaults;
}

export default await buildConfig();
