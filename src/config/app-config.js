const defaults = {
  googleDrive: {
    folderId: null,
    apiKey: null,
  },
  /**
   * Planet interior mailing form (optional). Set in app-config.local.json, e.g. Google Form POST URL + entry id for email.
   * @type {{ formAction: string | null, emailFieldName: string, mailtoFallback: string | null }}
   */
  mailingList: {
    formAction: null,
    /** Google Forms: entry.XXXXXXXX; generic forms: field name for email. */
    emailFieldName: "EMAIL",
    /** Used when formAction is null: opens default mail client. */
    mailtoFallback: null,
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
  return {
    googleDrive: gd,
    mailingList,
  };
}

export default await buildConfig();
