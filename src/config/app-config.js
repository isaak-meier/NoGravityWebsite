const defaults = {
  googleDrive: {
    folderId: null,
    apiKey: null,
  },
  /**
   * Planet interior mailing list (field name for the email input only).
   * @type {{ formAction: string | null, emailFieldName: string, mailtoFallback: string | null }}
   */
  mailingList: {
    formAction: null,
    emailFieldName: "EMAIL",
    mailtoFallback: null,
  },
  /**
   * Backend API — required for the mailing panel and optional auth UI.
   * Override in app-config.local.json for local dev (e.g. http://127.0.0.1:8787).
   * @type {{ baseUrl: string | null }}
   */
  api: {
    baseUrl: "https://api.nxgrxvity.com",
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
  const gd =
    raw?.googleDrive && typeof raw.googleDrive === "object"
      ? { ...defaults.googleDrive, ...raw.googleDrive }
      : { ...defaults.googleDrive };
  const mailingList =
    raw?.mailingList && typeof raw.mailingList === "object"
      ? { ...defaults.mailingList, ...raw.mailingList }
      : { ...defaults.mailingList };
  const api =
    raw?.api && typeof raw.api === "object"
      ? { ...defaults.api, ...raw.api }
      : { ...defaults.api };
  return {
    googleDrive: gd,
    mailingList,
    api,
  };
}

export default await buildConfig();
